import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, users } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { DATABASE_PATH } from "@/tests/helpers/astro-env";
import { verifyPassword } from "@/lib/auth";
import { seedAdmin } from "../../../scripts/seed-admin";

// The bootstrap contract: one hidden `is_system` moderator, created from ADMIN_LOGIN /
// ADMIN_PASSWORD, and re-running is a no-op. `install.sh` calls this on every upgrade, so a
// second run that created a second admin — or reset the operator's password back to whatever is
// still sitting in /etc/urlopy/env — would be a real production fault, not a test-only one.

const ADMIN_EMAIL = "seed-admin@test.invalid";
const ADMIN_PASSWORD = "seed-Admin-Password-1";

describe("seed-admin bootstrap", () => {
  let db!: Db;

  const systemRows = () =>
    db.select({ id: employees.id, user_id: employees.user_id }).from(employees).where(eq(employees.is_system, true));

  beforeAll(async () => {
    db = await getTestDb();
  });

  afterAll(async () => {
    const rows = await systemRows();
    for (const row of rows) await db.delete(users).where(eq(users.id, row.user_id));
  });

  it("creates exactly one is_system moderator, and running twice does not create a second", async () => {
    await seedAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, databasePath: DATABASE_PATH, keepOpen: true });
    const first = await systemRows();
    expect(first).toHaveLength(1);

    await seedAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, databasePath: DATABASE_PATH, keepOpen: true });
    const second = await systemRows();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
  });

  it("the seeded admin is a moderator whose password verifies", async () => {
    const [row] = await systemRows();
    const [employee] = await db.select().from(employees).where(eq(employees.id, row.id));
    expect(employee.role).toBe("moderator");
    expect(employee.is_system).toBe(true);
    expect(employee.deleted_at).toBeNull();

    const [user] = await db.select().from(users).where(eq(users.id, row.user_id));
    expect(user.email).toBe(ADMIN_EMAIL);
    expect(verifyPassword(ADMIN_PASSWORD, user.password_hash)).toBe(true);
    expect(verifyPassword("some-other-password", user.password_hash)).toBe(false);
  });

  it("adopts an orphaned users row from a half-finished run instead of colliding with it", async () => {
    // Clear the is_system employee but leave its user row behind — exactly the state a run that
    // died between the two inserts would leave, and the one the UNIQUE index on users.email would
    // otherwise make unrecoverable without manual surgery.
    const [existing] = await systemRows();
    await db.delete(employees).where(eq(employees.id, existing.id));
    expect(await systemRows()).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.email, ADMIN_EMAIL))).toHaveLength(1);

    const RECOVERY_PASSWORD = "recovery-Password-2";
    await seedAdmin({ email: ADMIN_EMAIL, password: RECOVERY_PASSWORD, databasePath: DATABASE_PATH, keepOpen: true });

    const after = await systemRows();
    expect(after).toHaveLength(1);
    expect(after[0].user_id).toBe(existing.user_id);
    // The password in the environment is the one that works after a recovery run.
    const [user] = await db.select().from(users).where(eq(users.id, existing.user_id));
    expect(verifyPassword(RECOVERY_PASSWORD, user.password_hash)).toBe(true);
  });
});
