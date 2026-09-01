import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, users } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { DATABASE_PATH } from "@/tests/helpers/astro-env";
import { verifyPassword } from "@/lib/auth";
import { seedE2eUser } from "../../../scripts/seed-e2e";

// The contract the Playwright suite depends on: an ordinary, grid-visible employee whose password
// is whatever `.env` currently says. Both halves have already cost a run — credentials that
// authenticate against nothing fail in `auth.setup.ts`, and an invisible employee fails much later
// inside a spec, where nothing points back at the seed.

const E2E_EMAIL = "seed-e2e@test.invalid";
const E2E_PASSWORD = "seed-E2E-Password-1";

describe("seed-e2e bootstrap", () => {
  let db!: Db;

  const userRows = () => db.select({ id: users.id }).from(users).where(eq(users.email, E2E_EMAIL));

  beforeAll(async () => {
    db = await getTestDb();
  });

  afterAll(async () => {
    for (const row of await userRows()) await db.delete(users).where(eq(users.id, row.id));
  });

  it("creates a grid-visible employee, and running twice does not create a second", async () => {
    const first = await seedE2eUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      databasePath: DATABASE_PATH,
      keepOpen: true,
    });
    const second = await seedE2eUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      databasePath: DATABASE_PATH,
      keepOpen: true,
    });
    expect(second).toBe(first);

    const [employee] = await db.select().from(employees).where(eq(employees.id, first));
    expect(employee.role).toBe("employee");
    // Both are what keep the row in the grid, which is the only way the suite learns its own id.
    expect(employee.is_system).toBe(false);
    expect(employee.deleted_at).toBeNull();
  });

  it("resets the password so the value in the environment is the one that works", async () => {
    const ROTATED = "rotated-Password-2";
    await seedE2eUser({ email: E2E_EMAIL, password: ROTATED, databasePath: DATABASE_PATH, keepOpen: true });

    const [user] = await userRows().then((rows) => db.select().from(users).where(eq(users.id, rows[0].id)));
    expect(verifyPassword(ROTATED, user.password_hash)).toBe(true);
    expect(verifyPassword(E2E_PASSWORD, user.password_hash)).toBe(false);
  });

  it("restores a soft-deleted employee instead of leaving the suite without a column", async () => {
    const [existing] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.user_id, (await userRows())[0].id));
    await db.update(employees).set({ deleted_at: new Date() }).where(eq(employees.id, existing.id));

    const seeded = await seedE2eUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      databasePath: DATABASE_PATH,
      keepOpen: true,
    });

    expect(seeded).toBe(existing.id);
    const [employee] = await db.select().from(employees).where(eq(employees.id, existing.id));
    expect(employee.deleted_at).toBeNull();
  });

  it("refuses to seed over the technical admin rather than handing the suite an invisible employee", async () => {
    const [existing] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.user_id, (await userRows())[0].id));
    await db.update(employees).set({ is_system: true }).where(eq(employees.id, existing.id));

    await expect(
      seedE2eUser({ email: E2E_EMAIL, password: E2E_PASSWORD, databasePath: DATABASE_PATH, keepOpen: true }),
    ).rejects.toThrow(/is_system/);

    await db.update(employees).set({ is_system: false }).where(eq(employees.id, existing.id));
  });
});
