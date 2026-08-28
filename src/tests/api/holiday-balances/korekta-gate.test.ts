import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, holiday_balances } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, createTestModerator, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { POST } from "@/pages/api/holiday-balances/index";
import type { HolidayBalanceView } from "@/types";

// Route-level coverage for the S-17 Korekta gate.
//
// `used_adjustment_days` is moderator-only, enforced by omitting the column from the write
// rather than by rejecting the request: a non-moderator must get 200 with the stored value
// preserved. Returning 403, or accepting the submitted value, are both wrong — the dialog
// does a full replace of all three fields, so the request always carries an adjustment.
//
// The other two fields stay open to both roles (S-15,
// context/archive/2026-06-22-urlop-balance/plan.md:34) — that is asserted here too, so a
// future over-correction to a route-level gate fails.
describe("Holiday balance — Korekta moderator gate (route level)", () => {
  const YEAR = 2031;
  let db!: Db;
  let employeeId!: string;
  let employeeAuthId!: string;
  let moderatorId!: string;
  let moderatorAuthId!: string;

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  const makeContext = (authUserId: string, body: unknown): APIContext =>
    ({
      locals: { user: { id: authUserId } },
      params: {},
      request: new Request("http://test.invalid/api/holiday-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL("http://test.invalid/api/holiday-balances"),
    }) as unknown as APIContext;

  const post = (authUserId: string, body: unknown) => POST(makeContext(authUserId, body));

  const payload = (overrides: Record<string, unknown> = {}) => ({
    employee_id: employeeId,
    year: YEAR,
    current_entitlement_days: 26,
    carryover_days: 4,
    used_adjustment_days: 7,
    ...overrides,
  });

  const storedRow = async () =>
    (
      await db
        .select()
        .from(holiday_balances)
        .where(and(eq(holiday_balances.employee_id, employeeId), eq(holiday_balances.year, YEAR)))
    )[0];

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    moderatorId = await createTestModerator(db);
    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);
  });

  afterEach(async () => {
    await db.delete(holiday_balances).where(eq(holiday_balances.employee_id, employeeId));
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, moderatorId);
  });

  it("non-moderator changing used_adjustment_days gets 200 and the stored value is unchanged", async () => {
    await db.insert(holiday_balances).values({
      employee_id: employeeId,
      year: YEAR,
      current_entitlement_days: 20,
      carryover_days: 0,
      used_adjustment_days: 3,
    });

    const res = await post(employeeAuthId, payload({ used_adjustment_days: 7 }));
    expect(res.status).toBe(200);

    const row = await storedRow();
    expect(row.used_adjustment_days).toBe(3); // preserved, not 7 and not zeroed
  });

  it("non-moderator still writes entitlement and carryover — the gate is one field, not the route", async () => {
    await db.insert(holiday_balances).values({
      employee_id: employeeId,
      year: YEAR,
      current_entitlement_days: 20,
      carryover_days: 0,
      used_adjustment_days: 3,
    });

    const res = await post(employeeAuthId, payload());
    expect(res.status).toBe(200);

    const row = await storedRow();
    expect(row.current_entitlement_days).toBe(26);
    expect(row.carryover_days).toBe(4);
  });

  it("non-moderator creating a new row gets 200 with adjustment 0", async () => {
    const res = await post(employeeAuthId, payload({ used_adjustment_days: 9 }));
    expect(res.status).toBe(200);

    const view = (await res.json()) as HolidayBalanceView;
    expect(view.used_adjustment_days).toBe(0);

    const row = await storedRow();
    expect(row.used_adjustment_days).toBe(0); // column default, not the submitted 9
  });

  it("moderator writes the submitted adjustment on update", async () => {
    await db.insert(holiday_balances).values({
      employee_id: employeeId,
      year: YEAR,
      current_entitlement_days: 20,
      carryover_days: 0,
      used_adjustment_days: 3,
    });

    const res = await post(moderatorAuthId, payload({ used_adjustment_days: 7 }));
    expect(res.status).toBe(200);

    const row = await storedRow();
    expect(row.used_adjustment_days).toBe(7);
  });

  it("moderator writes the submitted adjustment on insert", async () => {
    const res = await post(moderatorAuthId, payload({ used_adjustment_days: 9 }));
    expect(res.status).toBe(200);

    const view = (await res.json()) as HolidayBalanceView;
    expect(view.used_adjustment_days).toBe(9);
    expect((await storedRow()).used_adjustment_days).toBe(9);
  });

  it("moderator saving an unchanged adjustment does not zero it", async () => {
    await db.insert(holiday_balances).values({
      employee_id: employeeId,
      year: YEAR,
      current_entitlement_days: 20,
      carryover_days: 0,
      used_adjustment_days: 5,
    });

    const res = await post(moderatorAuthId, payload({ used_adjustment_days: 5 }));
    expect(res.status).toBe(200);
    expect((await storedRow()).used_adjustment_days).toBe(5);
  });

  // The schema deliberately carries no `.default(0)` on `used_adjustment_days`: omitting the
  // field must mean "leave unchanged", not "set to zero". Every case above sends the field
  // explicitly, so they pass either way — these two are the ones that fail if the default
  // comes back.
  it("moderator omitting the adjustment leaves the stored value alone", async () => {
    await db.insert(holiday_balances).values({
      employee_id: employeeId,
      year: YEAR,
      current_entitlement_days: 20,
      carryover_days: 0,
      used_adjustment_days: 5,
    });

    // `undefined` is dropped by JSON.stringify, so the body carries no such key at all.
    const res = await post(moderatorAuthId, payload({ used_adjustment_days: undefined }));
    expect(res.status).toBe(200);
    expect((await storedRow()).used_adjustment_days).toBe(5); // preserved, not zeroed
  });

  it("moderator omitting the adjustment on insert takes the column default", async () => {
    const res = await post(moderatorAuthId, payload({ used_adjustment_days: undefined }));
    expect(res.status).toBe(200);
    expect((await storedRow()).used_adjustment_days).toBe(0);
  });
});
