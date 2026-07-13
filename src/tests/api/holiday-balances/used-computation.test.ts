import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absence_types, absences, holiday_balances } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { buildBalanceView, computeUsedDays } from "@/lib/services/holiday-balance";

// Requires: 20260526000002_seed_absence_types.sql applied ('urlop' type must exist).
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Holiday balance — Used computation (integration)", () => {
  const YEAR = 2030;
  let db!: Db;
  let testEmployeeId!: string;
  let urlopTypeId!: number;
  let plannedTypeId!: number;
  let createdPlannedType = false;

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);

    const urlop = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    if (!urlop[0]) throw new Error("Seed missing: 'urlop' absence type not found");
    urlopTypeId = urlop[0].id;

    // 'urlop planowany' (S-13) may or may not be seeded yet; ensure a row exists so the
    // exclusion regression is deterministic, and remember whether we created it for teardown.
    const planned = await db
      .select({ id: absence_types.id })
      .from(absence_types)
      .where(eq(absence_types.name, "urlop planowany"));
    if (planned[0]) {
      plannedTypeId = planned[0].id;
    } else {
      const [row] = await db
        .insert(absence_types)
        .values({ name: "urlop planowany", color: "#123456" })
        .returning({ id: absence_types.id });
      plannedTypeId = row.id;
      createdPlannedType = true;
    }
  });

  afterEach(async () => {
    await db.delete(absences).where(eq(absences.employee_id, testEmployeeId));
    await db.delete(holiday_balances).where(eq(holiday_balances.employee_id, testEmployeeId));
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId); // deletes this employee's absences first
    if (createdPlannedType) await db.delete(absence_types).where(eq(absence_types.id, plannedTypeId));
    await db.$client.end();
  });

  const fullDayUrlop = (date: string) => ({
    employee_id: testEmployeeId,
    absence_type_id: urlopTypeId,
    date,
    is_full_day: true,
  });

  it("counts full-day + partial-hours/8 + used_adjustment_days", async () => {
    await db.insert(absences).values([
      fullDayUrlop(`${YEAR}-01-05`),
      fullDayUrlop(`${YEAR}-01-06`),
      // partial: 09:00–13:00 = 4h → 0.5 day
      {
        employee_id: testEmployeeId,
        absence_type_id: urlopTypeId,
        date: `${YEAR}-01-07`,
        is_full_day: false,
        start_time: "09:00",
        end_time: "13:00",
      },
    ]);

    // 2 full + 0.5 partial + 3 adjustment = 5.5
    const used = await computeUsedDays(db, testEmployeeId, YEAR, 3);
    expect(used).toBeCloseTo(5.5, 6);
  });

  it("excludes 'urlop planowany' and other non-urlop types from Used", async () => {
    await db
      .insert(absences)
      .values([
        fullDayUrlop(`${YEAR}-02-05`),
        { employee_id: testEmployeeId, absence_type_id: plannedTypeId, date: `${YEAR}-02-06`, is_full_day: true },
      ]);

    const used = await computeUsedDays(db, testEmployeeId, YEAR, 0);
    expect(used).toBe(1); // only the 'urlop' row counts
  });

  it("ignores urlop absences outside the requested year window", async () => {
    await db.insert(absences).values([fullDayUrlop(`${YEAR}-06-01`), fullDayUrlop(`${YEAR + 1}-01-02`)]);

    const used = await computeUsedDays(db, testEmployeeId, YEAR, 0);
    expect(used).toBe(1); // next-year row excluded
  });

  it("buildBalanceView: left = current + carryover − used, from a stored row", async () => {
    await db
      .insert(absences)
      .values([fullDayUrlop(`${YEAR}-03-01`), fullDayUrlop(`${YEAR}-03-02`), fullDayUrlop(`${YEAR}-03-03`)]);
    const [stored] = await db
      .insert(holiday_balances)
      .values({
        employee_id: testEmployeeId,
        year: YEAR,
        current_entitlement_days: 26,
        carryover_days: 4,
        used_adjustment_days: 0,
        valid_until: "2030-12-31",
      })
      .returning();

    const view = await buildBalanceView(db, testEmployeeId, YEAR, stored);
    expect(view.balance_id).toBe(stored.id);
    expect(view.used_days).toBe(3);
    expect(view.left_days).toBe(27); // 26 + 4 − 3
    expect(view.valid_until).toBe("2030-12-31");
  });

  it("buildBalanceView: surfaces a negative Left (never clamps)", async () => {
    await db
      .insert(absences)
      .values([fullDayUrlop(`${YEAR}-04-01`), fullDayUrlop(`${YEAR}-04-02`), fullDayUrlop(`${YEAR}-04-03`)]);
    const [stored] = await db
      .insert(holiday_balances)
      .values({ employee_id: testEmployeeId, year: YEAR, current_entitlement_days: 1, carryover_days: 0 })
      .returning();

    const view = await buildBalanceView(db, testEmployeeId, YEAR, stored);
    expect(view.used_days).toBe(3);
    expect(view.left_days).toBe(-2);
  });

  it("buildBalanceView: synthesizes a zeroed view when no row exists (balance_id null)", async () => {
    await db.insert(absences).values([fullDayUrlop(`${YEAR}-05-01`)]);

    const view = await buildBalanceView(db, testEmployeeId, YEAR, null);
    expect(view.balance_id).toBeNull();
    expect(view.current_entitlement_days).toBe(0);
    expect(view.carryover_days).toBe(0);
    expect(view.used_adjustment_days).toBe(0);
    expect(view.valid_until).toBeNull();
    expect(view.used_days).toBe(1);
    expect(view.left_days).toBe(-1); // 0 − 1
  });

  it("upsert on (employee_id, year) is last-write-wins, single row", async () => {
    await db
      .insert(holiday_balances)
      .values({ employee_id: testEmployeeId, year: YEAR, current_entitlement_days: 20, carryover_days: 0 });

    await db
      .insert(holiday_balances)
      .values({ employee_id: testEmployeeId, year: YEAR, current_entitlement_days: 26, carryover_days: 4 })
      .onConflictDoUpdate({
        target: [holiday_balances.employee_id, holiday_balances.year],
        set: { current_entitlement_days: 26, carryover_days: 4 },
      });

    const rows = await db
      .select()
      .from(holiday_balances)
      .where(and(eq(holiday_balances.employee_id, testEmployeeId), eq(holiday_balances.year, YEAR)));
    expect(rows).toHaveLength(1);
    expect(rows[0].current_entitlement_days).toBe(26);
    expect(rows[0].carryover_days).toBe(4);
  });
});
