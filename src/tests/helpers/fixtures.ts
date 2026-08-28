import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { users, employees, absences, holiday_balances } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

// A user row and an employee row in the same database, instead of a real Supabase Auth account
// plus a local row that pointed at it. This is what removes `SUPABASE_SERVICE_KEY` from the test
// environment and from CI secrets, and what makes teardown a local delete rather than a remote
// API call that could half-succeed.

/**
 * The password every fixture employee is seeded with.
 *
 * One shared value rather than a random one per row, so a suite can assert both directions: that
 * this password works before a reset and that it stops working after one. It is a real scrypt hash
 * now — the placeholder that stood here through Phases 1-3 could not be verified against, which is
 * exactly why the two employee sub-resource suites were skipped until this phase.
 */
export const FIXTURE_PASSWORD = "fixture-Password-123";

async function insertEmployee(db: Db, role: "employee" | "moderator"): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email: `test-${crypto.randomUUID()}@test.invalid`,
      password_hash: hashPassword(FIXTURE_PASSWORD),
    })
    .returning({ id: users.id });

  const [row] = await db
    .insert(employees)
    .values({
      user_id: user.id,
      role,
      first_name: "Test",
      last_name: "Employee",
    })
    .returning({ id: employees.id });
  return row.id;
}

export async function createTestEmployee(db: Db): Promise<string> {
  return insertEmployee(db, "employee");
}

/**
 * A moderator, seedable at last — `workers-data-edit/plan.md:431` recorded that it was not,
 * because the role lived on a row whose auth half had to be provisioned remotely. Replaces the
 * `db.update(employees).set({ role: "moderator" })` follow-up every moderator-aware suite used
 * to run against a freshly created employee.
 */
export async function createTestModerator(db: Db): Promise<string> {
  return insertEmployee(db, "moderator");
}

export async function teardownTestEmployee(db: Db | undefined, employeeId: string | undefined): Promise<void> {
  if (!db || !employeeId) return;
  try {
    const rows = await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, employeeId));
    const userId = rows[0]?.user_id;
    // Both tables reference `employees` without ON DELETE CASCADE, and node:sqlite enforces
    // foreign keys, so these have to go first regardless of which end the delete starts from.
    await db.delete(absences).where(eq(absences.employee_id, employeeId));
    await db.delete(holiday_balances).where(eq(holiday_balances.employee_id, employeeId));
    // `employees.user_id` cascades from `users`, so one delete clears both rows.
    if (userId) await db.delete(users).where(eq(users.id, userId));
    else await db.delete(employees).where(eq(employees.id, employeeId));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("teardownTestEmployee failed (rows may be orphaned):", err);
  }
}
