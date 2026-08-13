import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, holiday_balances } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { POST } from "@/pages/api/holiday-balances/index";

// The balance upsert was the last mutation path in the codebase without an `is_system` guard.
// RLS is bypassed on the service-role connection (context/changes/admin-bootstrap/plan.md:38),
// so the technical admin's immutability is app-enforced only — these cases are the enforcement.
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Holiday balance — is_system guard on POST", () => {
  const YEAR = 2032;
  let db!: Db;
  let employeeId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  let employeeAuthId!: string;
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

  const post = (authUserId: string, employee_id: string) =>
    POST(
      makeContext(authUserId, {
        employee_id,
        year: YEAR,
        current_entitlement_days: 26,
        carryover_days: 4,
      }),
    );

  const storedRowsFor = async (employee_id: string) =>
    db.select().from(holiday_balances).where(eq(holiday_balances.employee_id, employee_id));

  beforeAll(async () => {
    db = getTestDb();
    employeeId = await createTestEmployee(db);
    moderatorId = await createTestEmployee(db);
    systemEmployeeId = await createTestEmployee(db);
    await db.update(employees).set({ role: "moderator" }).where(eq(employees.id, moderatorId));
    await db.update(employees).set({ is_system: true }).where(eq(employees.id, systemEmployeeId));
    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);
  });

  afterEach(async () => {
    await db
      .delete(holiday_balances)
      .where(inArray(holiday_balances.employee_id, [employeeId, moderatorId, systemEmployeeId]));
  });

  afterAll(async () => {
    // Undo the fixture flag before teardown — see the note in delete.test.ts.
    await db.update(employees).set({ is_system: false }).where(eq(employees.id, systemEmployeeId));
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, systemEmployeeId);
    await db.$client.end();
  });

  it("a moderator cannot write the technical admin's balance", async () => {
    const res = await post(moderatorAuthId, systemEmployeeId);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Nie można modyfikować tego konta." });
    expect(await storedRowsFor(systemEmployeeId)).toHaveLength(0);
  });

  it("a regular employee cannot write the technical admin's balance either", async () => {
    const res = await post(employeeAuthId, systemEmployeeId);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Nie można modyfikować tego konta." });
    expect(await storedRowsFor(systemEmployeeId)).toHaveLength(0);
  });

  // Regression guard: the new check must reject exactly one row, not narrow the route.
  it("an ordinary employee target still writes", async () => {
    const res = await post(moderatorAuthId, employeeId);
    expect(res.status).toBe(200);

    const rows = await storedRowsFor(employeeId);
    expect(rows).toHaveLength(1);
    expect(rows[0].current_entitlement_days).toBe(26);
  });
});
