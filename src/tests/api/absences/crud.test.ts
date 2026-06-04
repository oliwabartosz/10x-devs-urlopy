import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";

describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Absence CRUD — integration", () => {
  let db: Db;
  let testEmployeeId: string;

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);
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
        hours: "2.50",
      })
      .returning();

    expect(row.employee_id).toBe(testEmployeeId);
    expect(row.absence_type_id).toBe(1);
    expect(row.date).toBe("2026-01-15");
    expect(row.is_full_day).toBe(false);
    expect(row.id).toBeTruthy();

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("INSERT — hours is returned as a string (postgres-js NUMERIC behavior)", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: 1,
        date: "2026-01-16",
        is_full_day: false,
        hours: "2.50",
      })
      .returning();

    expect(typeof row.hours).toBe("string");
    expect(row.hours).toBe("2.50");

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
      .set({ comment: "updated comment", is_full_day: false, hours: "4.00" })
      .where(eq(absences.id, inserted.id))
      .returning();

    expect(updated.comment).toBe("updated comment");
    expect(updated.is_full_day).toBe(false);
    expect(updated.hours).toBe("4.00");

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
      const e = err as { code?: string; cause?: { code?: string } };
      return e.code === "23505" || e.cause?.code === "23505";
    });
  });
});
