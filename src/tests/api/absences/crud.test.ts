import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { isPartialDayViolation } from "@/lib/services/absence-partial-day";
import { isPriorityViolation } from "@/lib/services/absence-priority";
import {
  ONSITE_TRAINING_TYPE_NAME,
  OFFSITE_TRAINING_TYPE_NAME,
  LEAVE_TYPE_NAME,
  PLANNED_LEAVE_TYPE_NAME,
} from "@/lib/absence-types";

// Requires the seeded absence-type catalogue (absence_type_id: 1 must exist). The test
// harness applies it: getTestDb() runs migrate + seed on a fresh file — src/db/seed.ts.
describe("Absence CRUD — integration", () => {
  let db!: Db;
  let testEmployeeId!: string;
  let onsiteTypeId!: number;
  let offsiteTypeId!: number;
  let nonTrainingTypeId!: number;
  let leaveTypeId!: number;
  let plannedLeaveTypeId!: number;
  let nonPriorityTypeId!: number;

  // Ids are resolved by name, never hard-coded: a seed rename must fail loudly here rather
  // than silently disable a name-keyed rule (partial-day-guard.test.ts:36-40 is the idiom).
  const typeIdByName = async (name: string): Promise<number> => {
    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, name));
    expect(rows, `absence_types row for "${name}" — constant drifted from the seed catalogue?`).toHaveLength(1);
    return rows[0].id;
  };

  beforeAll(async () => {
    db = await getTestDb();
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
    leaveTypeId = await typeIdByName(LEAVE_TYPE_NAME);
    plannedLeaveTypeId = await typeIdByName(PLANNED_LEAVE_TYPE_NAME);
    nonPriorityTypeId = await typeIdByName("choroba");
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
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

  it("INSERT — start_time and end_time round-trip verbatim as HH:MM strings", async () => {
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
    expect(row.start_time).toBe("09:00");
    expect(row.end_time).toBe("11:30");

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
    expect(updated.start_time).toBe("09:00");
    expect(updated.end_time).toBe("13:00");

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

  it("INSERT with reversed times (end_time < start_time) — DB CHECK constraint rejects with SQLITE_CONSTRAINT_CHECK", async () => {
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
      return e.cause?.code === "275";
    });
  });

  it("INSERT with equal times (end_time === start_time) — DB CHECK constraint rejects with SQLITE_CONSTRAINT_CHECK", async () => {
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
      return e.cause?.code === "275";
    });
  });

  it("Duplicate INSERT — error has SQLITE_CONSTRAINT_UNIQUE accessible via cause.code", async () => {
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
      return e.cause?.code === "2067";
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

  // FR-008: the informational priority marker is allowed only on the two leave types. Like the
  // partial-day rule this is a handler-level guard (`isPriorityViolation`), not a DB constraint —
  // SQLite cannot express a CHECK across the absence_types name — so these exercise the guard
  // against the seeded catalogue. Route-level coverage lives in priority-guard.test.ts.
  describe("priority type restriction (FR-008)", () => {
    it("guard allows urlop + flagged", async () => {
      expect(await isPriorityViolation(db, leaveTypeId, true)).toBe(false);
    });

    it("guard allows urlop planowany + flagged", async () => {
      expect(await isPriorityViolation(db, plannedLeaveTypeId, true)).toBe(false);
    });

    it("guard rejects an ineligible type + flagged", async () => {
      expect(await isPriorityViolation(db, nonPriorityTypeId, true)).toBe(true);
    });

    it("guard allows an ineligible type + unflagged", async () => {
      expect(await isPriorityViolation(db, nonPriorityTypeId, false)).toBe(false);
    });

    it("guard treats a nonexistent type id as a violation when flagged", async () => {
      // An undefined name is ineligible. Routes must run assertAbsenceTypeExists first, so an
      // unknown id is reported as 422 rather than surfacing here as a 400 rule violation.
      expect(await isPriorityViolation(db, 999_999, true)).toBe(true);
    });

    it("guard short-circuits an unflagged nonexistent type id without touching the catalogue", async () => {
      expect(await isPriorityViolation(db, 999_999, false)).toBe(false);
    });

    it("PATCH effective-state — changing only the type of a flagged urlop to an ineligible type is rejected", async () => {
      const [inserted] = await db
        .insert(absences)
        .values({
          employee_id: testEmployeeId,
          absence_type_id: leaveTypeId,
          date: "2026-02-02",
          is_full_day: true,
          is_priority: true,
        })
        .returning();

      // A PATCH body that changes only the type; the effective is_priority is resolved from the
      // existing row, exactly as the PATCH handler does.
      const existing = (
        await db
          .select({ absence_type_id: absences.absence_type_id, is_priority: absences.is_priority })
          .from(absences)
          .where(eq(absences.id, inserted.id))
      )[0];
      const body: { absence_type_id?: number; is_priority?: boolean } = { absence_type_id: nonPriorityTypeId };
      const effectiveTypeId = body.absence_type_id ?? existing.absence_type_id;
      const effectiveIsPriority = body.is_priority ?? existing.is_priority;

      expect(await isPriorityViolation(db, effectiveTypeId, effectiveIsPriority)).toBe(true);

      await db.delete(absences).where(eq(absences.id, inserted.id));
    });

    it("the column round-trips through an insert and defaults to false", async () => {
      const [flagged] = await db
        .insert(absences)
        .values({
          employee_id: testEmployeeId,
          absence_type_id: leaveTypeId,
          date: "2026-02-03",
          is_full_day: true,
          is_priority: true,
        })
        .returning();
      expect(flagged.is_priority).toBe(true);

      const [defaulted] = await db
        .insert(absences)
        .values({
          employee_id: testEmployeeId,
          absence_type_id: leaveTypeId,
          date: "2026-02-04",
          is_full_day: true,
        })
        .returning();
      expect(defaulted.is_priority, "NOT NULL DEFAULT false — existing rows need no backfill").toBe(false);

      await db.delete(absences).where(eq(absences.employee_id, testEmployeeId));
    });
  });
});
