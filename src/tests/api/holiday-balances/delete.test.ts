import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { holiday_balances } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";

// Mirrors the DELETE /api/holiday-balances/:id semantics at the DB level (the route adds
// only auth/uuid guards on top of this delete-by-id + returning()).
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Holiday balance — DELETE (integration)", () => {
  const YEAR = 2031;
  let db!: Db;
  let testEmployeeId!: string;

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);
  });

  afterEach(async () => {
    await db.delete(holiday_balances).where(eq(holiday_balances.employee_id, testEmployeeId));
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
    await db.$client.end();
  });

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
});
