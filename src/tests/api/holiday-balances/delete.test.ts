import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, holiday_balances } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { DELETE } from "@/pages/api/holiday-balances/[id]";

describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Holiday balance — DELETE (integration)", () => {
  const YEAR = 2031;
  let db!: Db;
  // The owner of every fixture balance row below, and the caller in the ownership cases.
  let testEmployeeId!: string;
  let otherEmployeeId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  let testAuthId!: string;
  let otherAuthId!: string;
  let moderatorAuthId!: string;

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  const makeContext = (authUserId: string, balanceId: string): APIContext =>
    ({
      locals: { user: { id: authUserId } },
      params: { id: balanceId },
      request: new Request(`http://test.invalid/api/holiday-balances/${balanceId}`, { method: "DELETE" }),
      url: new URL(`http://test.invalid/api/holiday-balances/${balanceId}`),
    }) as unknown as APIContext;

  const del = (authUserId: string, balanceId: string) => DELETE(makeContext(authUserId, balanceId));

  const seedBalance = async (employeeId: string): Promise<string> => {
    const [row] = await db
      .insert(holiday_balances)
      .values({ employee_id: employeeId, year: YEAR, current_entitlement_days: 26, carryover_days: 4 })
      .returning({ id: holiday_balances.id });
    return row.id;
  };

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);
    otherEmployeeId = await createTestEmployee(db);
    moderatorId = await createTestEmployee(db);
    systemEmployeeId = await createTestEmployee(db);
    await db.update(employees).set({ role: "moderator" }).where(eq(employees.id, moderatorId));
    await db.update(employees).set({ is_system: true }).where(eq(employees.id, systemEmployeeId));
    testAuthId = await authIdOf(testEmployeeId);
    otherAuthId = await authIdOf(otherEmployeeId);
    moderatorAuthId = await authIdOf(moderatorId);
  });

  afterEach(async () => {
    await db
      .delete(holiday_balances)
      .where(inArray(holiday_balances.employee_id, [testEmployeeId, otherEmployeeId, moderatorId, systemEmployeeId]));
  });

  afterAll(async () => {
    // Undo the fixture's is_system flag before teardown — the invariant is app-enforced, so
    // leaving it set would make an orphaned row look like a second technical admin.
    await db.update(employees).set({ is_system: false }).where(eq(employees.id, systemEmployeeId));
    await teardownTestEmployee(db, testEmployeeId);
    await teardownTestEmployee(db, otherEmployeeId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, systemEmployeeId);
    await db.$client.end();
  });

  // Mirrors the DELETE /api/holiday-balances/:id semantics at the DB level (the route adds
  // auth, uuid and ownership guards on top of this delete-by-id + returning()).
  it("delete by id returns the deleted id and removes the row", async () => {
    const [stored] = await db
      .insert(holiday_balances)
      .values({ employee_id: testEmployeeId, year: YEAR, current_entitlement_days: 26, carryover_days: 4 })
      .returning();

    const deleted = await db
      .delete(holiday_balances)
      .where(eq(holiday_balances.id, stored.id))
      .returning({ id: holiday_balances.id });

    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe(stored.id);

    const rows = await db.select().from(holiday_balances).where(eq(holiday_balances.id, stored.id));
    expect(rows).toHaveLength(0);
  });

  it("delete of a non-existent id returns an empty array (route maps this to 404)", async () => {
    const missingId = "00000000-0000-0000-0000-000000000000";
    const deleted = await db
      .delete(holiday_balances)
      .where(eq(holiday_balances.id, missingId))
      .returning({ id: holiday_balances.id });

    expect(deleted).toHaveLength(0);
  });

  // Route-level ownership gate. Supersedes S-15's "any valid caller may delete any balance"
  // (context/archive/2026-06-22-urlop-balance/plan.md:211) now that the moderator balance
  // editing in this change makes other people's balance ids reachable from the UI.
  describe("ownership gate", () => {
    it("an employee deletes their own balance", async () => {
      const balanceId = await seedBalance(testEmployeeId);

      const res = await del(testAuthId, balanceId);
      expect(res.status).toBe(204);

      const rows = await db.select().from(holiday_balances).where(eq(holiday_balances.id, balanceId));
      expect(rows).toHaveLength(0);
    });

    it("an employee cannot delete another employee's balance", async () => {
      const balanceId = await seedBalance(testEmployeeId);

      const res = await del(otherAuthId, balanceId);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });

      const rows = await db.select().from(holiday_balances).where(eq(holiday_balances.id, balanceId));
      expect(rows).toHaveLength(1); // untouched
    });

    it("a moderator deletes another employee's balance", async () => {
      const balanceId = await seedBalance(testEmployeeId);

      const res = await del(moderatorAuthId, balanceId);
      expect(res.status).toBe(204);

      const rows = await db.select().from(holiday_balances).where(eq(holiday_balances.id, balanceId));
      expect(rows).toHaveLength(0);
    });

    // The 404 must precede the ownership check, otherwise the endpoint leaks which ids exist:
    // a non-owner probing a random id would get 403 for a real row and 404 for a fake one.
    it("a non-existent id is 404 even for a caller who owns nothing", async () => {
      const res = await del(otherAuthId, "00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    });

    it("nobody may delete the technical admin's balance", async () => {
      const balanceId = await seedBalance(systemEmployeeId);

      const res = await del(moderatorAuthId, balanceId);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Nie można modyfikować tego konta." });

      const rows = await db.select().from(holiday_balances).where(eq(holiday_balances.id, balanceId));
      expect(rows).toHaveLength(1); // untouched
    });
  });
});
