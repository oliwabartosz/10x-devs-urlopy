/**
 * Seed the technical admin account (role: moderator, is_system: true) from env.
 *
 * Runs in Node against the SQLite file at DATABASE_PATH: a `users` row carrying a local scrypt
 * hash, then the `employees` row that points at it. Both land in one transaction, which is what
 * removes the compensating-delete dance this script used to need when the credential lived in a
 * remote service — and which is safe HERE, unlike in a request handler, because nothing else is
 * touching the handle while a one-shot script runs.
 *
 * Idempotent: no-ops if an `is_system` row already exists, and adopts a pre-existing `users` row
 * with the same address (recovering a half-finished run).
 *
 * Usage: `npm run seed:admin` (reads `.env` via `process.loadEnvFile`).
 *
 * The work lives in the exported `seedAdmin` rather than in `main`, so the idempotency invariant
 * this script exists to uphold can be asserted directly by a test instead of by spawning a
 * subprocess that would need a `.env` on disk to start at all.
 */
import { eq } from "drizzle-orm";
import { createDb, closeDb, getRawHandle } from "../src/db/index";
import { employees, users } from "../src/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`✖ Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

export interface SeedAdminOptions {
  email: string;
  password: string;
  databasePath: string;
  /** Leave the handle open. The CLI closes it; a test sharing its file with other suites must not. */
  keepOpen?: boolean;
}

export async function seedAdmin({ email, password, databasePath, keepOpen = false }: SeedAdminOptions): Promise<void> {
  const db = createDb(databasePath);
  const handle = getRawHandle(databasePath);

  try {
    // Idempotency: exactly one is_system row is the invariant. If present, stop.
    const existing = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.is_system, true))
      .limit(1);
    if (existing.length > 0) {
      // eslint-disable-next-line no-console
      console.log("✔ Admin already seeded (is_system row exists); nothing to do.");
      return;
    }

    // A `users` row with this address but no is_system employee means a previous run died between
    // the two inserts. Adopt it rather than colliding with the UNIQUE index, and reset its hash so
    // the ADMIN_PASSWORD in the environment is the one that actually works.
    const priorUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    handle.exec("BEGIN");
    try {
      let userId: string;
      if (priorUser.length > 0) {
        userId = priorUser[0].id;
        await db
          .update(users)
          .set({ password_hash: hashPassword(password), updated_at: new Date() })
          .where(eq(users.id, userId));
        // eslint-disable-next-line no-console
        console.log(`• User row for ${email} already exists; adopting it and resetting the password.`);
      } else {
        const [created] = await db
          .insert(users)
          .values({ email, password_hash: hashPassword(password) })
          .returning({ id: users.id });
        userId = created.id;
      }

      const [row] = await db
        .insert(employees)
        .values({
          user_id: userId,
          role: "moderator",
          first_name: "System",
          last_name: "Admin",
          is_system: true,
        })
        .returning({ id: employees.id });
      handle.exec("COMMIT");
      // eslint-disable-next-line no-console
      console.log(`✔ Seeded admin employee ${row.id} (user ${userId}).`);
    } catch (err) {
      handle.exec("ROLLBACK");
      throw err;
    }
  } finally {
    if (!keepOpen) closeDb(databasePath);
  }
}

async function main(): Promise<void> {
  process.loadEnvFile();

  const email = requireEnv("ADMIN_LOGIN");
  const password = requireEnv("ADMIN_PASSWORD");
  const databasePath = requireEnv("DATABASE_PATH");

  if (password.length < MIN_PASSWORD_LENGTH) {
    // eslint-disable-next-line no-console
    console.error(`✖ ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  await seedAdmin({ email, password, databasePath });
}

// `import.meta.main` is false when a test imports this module, so the CLI does not fire on import.
if (import.meta.main) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("✖ seed:admin failed:", err);
    process.exit(1);
  });
}
