import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { isPartialDayViolation } from "@/lib/services/absence-partial-day";
import { ONSITE_TRAINING_TYPE_NAME, OFFSITE_TRAINING_TYPE_NAME } from "@/lib/absence-types";

// Requires: 20260526000002_seed_absence_types.sql applied (absence_type_id: 1 must exist)
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Absence CRUD — integration", () => {
  let db!: Db;
  let testEmployeeId!: string;
  let onsiteTypeId!: number;
  let offsiteTypeId!: number;
  let nonTrainingTypeId!: number;

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);
    onsiteTypeId = (
      await db
        .select({ id: absence_types.id })
        .from(absence_types)
        .where(eq(absence_types.name, ONSITE_TRAINING_TYPE_NAME))
    )[0].id;
    offsiteTypeId = (
      await db
        .select({ id: absence_types.id })
        .from(absence_types)
        .where(eq(absence_types.name, OFFSITE_TRAINING_TYPE_NAME))
    )[0].id;
    nonTrainingTypeId = (
      await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"))
    )[0].id;
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
    await db.$client.end();
  });

  it("INSERT — RETURNING contains submitted field values", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-15",
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:30",
      })
      .returning();

    expect(row.employee_id).toBe(testEmployeeId);
    expect(row.absence_type_id).toBe(1);
    expect(row.date).toBe("2026-01-15");
    expect(row.is_full_day).toBe(false);
    expect(row.id).toBeTruthy();

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("INSERT — start_time and end_time are returned as HH:MM:SS strings (postgres-js TIME behavior)", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-16",
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:30",
      })
      .returning();

    expect(typeof row.start_time).toBe("string");
    expect(typeof row.end_time).toBe("string");
    expect(row.start_time).toBe("09:00:00");
    expect(row.end_time).toBe("11:30:00");

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("SELECT — row is readable immediately after INSERT with correct columns", async () => {
    const [inserted] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-17",
        is_full_day: true,
      })
      .returning();

    const rows = await db.select().from(absences).where(eq(absences.id, inserted.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].employee_id).toBe(testEmployeeId);
    expect(rows[0].absence_type_id).toBe(1);
    expect(rows[0].date).toBe("2026-01-17");
    expect(rows[0].is_full_day).toBe(true);

    await db.delete(absences).where(eq(absences.id, inserted.id));
  });

  it("UPDATE (PATCH) — RETURNING contains updated field values", async () => {
    const [inserted] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-18",
        is_full_day: true,
      })
      .returning();

    const [updated] = await db
      .update(absences)
      .set({ comment: "updated comment", is_full_day: false, start_time: "09:00", end_time: "13:00" })
      .where(eq(absences.id, inserted.id))
      .returning();

    expect(updated.comment).toBe("updated comment");
    expect(updated.is_full_day).toBe(false);
    expect(updated.start_time).toBe("09:00:00");
    expect(updated.end_time).toBe("13:00:00");

    await db.delete(absences).where(eq(absences.id, inserted.id));
  });

  it("DELETE — SELECT returns zero rows after deletion", async () => {
    const [inserted] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-19",
        is_full_day: true,
      })
      .returning();

    await db.delete(absences).where(eq(absences.id, inserted.id));

    const rows = await db.select().from(absences).where(eq(absences.id, inserted.id));
    expect(rows).toHaveLength(0);
  });

  it("INSERT with reversed times (end_time < start_time) — DB CHECK constraint rejects with 23514", async () => {
    await expect(
      db.insert(absences).values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-21",
        is_full_day: false,
        start_time: "14:00",
        end_time: "09:00",
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as { cause?: { code?: string } };
      return e.cause?.code === "23514";
    });
  });

  it("INSERT with equal times (end_time === start_time) — DB CHECK constraint rejects with 23514", async () => {
    await expect(
      db.insert(absences).values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-22",
        is_full_day: false,
        start_time: "09:00",
        end_time: "09:00",
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as { cause?: { code?: string } };
      return e.cause?.code === "23514";
    });
  });

  it("Duplicate INSERT — error has PG code 23505 accessible via cause.code", async () => {
    await db.insert(absences).values({
      employee_id: testEmployeeId,
      absence_type_id: 1,
      date: "2026-01-20",
      is_full_day: true,
    });

    await expect(
      db.insert(absences).values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-20",
        is_full_day: true,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as { cause?: { code?: string } };
      return e.cause?.code === "23505";
    });

    await db.delete(absences).where(eq(absences.employee_id, testEmployeeId));
  });

  // S-14: partial-day (time-range) entries are allowed only for the onsite-training type.
  // The rule is a handler-level guard (`isPartialDayViolation`), not a DB constraint, so these
  // exercise the guard against the seeded absence_types rather than a raw INSERT.
  describe("partial-day type restriction (S-14)", () => {
    it("guard allows onsite-training + partial-day", async () => {
      expect(await isPartialDayViolation(db, onsiteTypeId, false)).toBe(false);
    });

    it("guard allows offsite-training + partial-day", async () => {
      expect(await isPartialDayViolation(db, offsiteTypeId, false)).toBe(false);
    });

    it("guard rejects a non-training type + partial-day", async () => {
      expect(await isPartialDayViolation(db, nonTrainingTypeId, false)).toBe(true);
    });

    it("guard allows a non-training type + full-day", async () => {
      expect(await isPartialDayViolation(db, nonTrainingTypeId, true)).toBe(false);
    });

    it("PATCH effective-state — changing only the type of an onsite partial-day entry to a non-training type is rejected", async () => {
      const [inserted] = await db
        .insert(absences)
        .values({
          employee_id: testEmployeeId,
          absence_type_id: onsiteTypeId,
          date: "2026-02-01",
          is_full_day: false,
          start_time: "09:00",
          end_time: "11:00",
        })
        .returning();

      // Simulate a PATCH body that changes only the type; the effective is_full_day is resolved
      // from the existing row, exactly as the PATCH handler does.
      const existing = (
        await db
          .select({ absence_type_id: absences.absence_type_id, is_full_day: absences.is_full_day })
          .from(absences)
          .where(eq(absences.id, inserted.id))
      )[0];
      const body: { absence_type_id?: number; is_full_day?: boolean } = { absence_type_id: nonTrainingTypeId };
      const effectiveTypeId = body.absence_type_id ?? existing.absence_type_id;
      const effectiveIsFullDay = body.is_full_day ?? existing.is_full_day;

      expect(await isPartialDayViolation(db, effectiveTypeId, effectiveIsFullDay)).toBe(true);

      await db.delete(absences).where(eq(absences.id, inserted.id));
    });
  });
});
