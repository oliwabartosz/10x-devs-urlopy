/**
 * Seed the Playwright test account (role: employee, is_system: false) from env.
 *
 * The E2E suite signs in as a real user and reads its own employee id off the grid
 * (`absence-grid-range.spec.ts` → `ownEmployeeId`). That only works for an employee the grid
 * actually renders, which is why this cannot be folded into `seed:admin`: the technical admin is
 * `is_system`, and `AbsenceGrid.tsx` hides it while the write-target guards reject it. Signing in
 * as the admin gets you an authenticated session and a grid with no column of your own.
 *
 * Why the script exists at all: `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` in `.env` were minted
 * against the Supabase deployment `main` still targets. On this branch the database is a local
 * SQLite file, so those credentials authenticate against nothing and the whole suite dies in
 * `auth.setup.ts` with „Nieprawidłowy adres email lub hasło." — indistinguishable from a typo in
 * `.env`. One `npm run seed:e2e` on a fresh database is the difference.
 *
 * Idempotent: adopts a `users` row with the same address and resets its hash, so the password in
 * the environment is always the one that works. Never touches an `is_system` row — it fails loudly
 * instead, because silently seeding over the admin would be a far worse outcome than stopping.
 *
 * Usage: `npm run seed:e2e` (reads `.env` via `process.loadEnvFile`).
 *
 * The work lives in the exported `seedE2eUser` rather than in `main` so the idempotency and
 * visibility invariants can be asserted by a test instead of by spawning a subprocess.
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

export interface SeedE2eOptions {
  email: string;
  password: string;
  databasePath: string;
  /** Leave the handle open. The CLI closes it; a test sharing its file with other suites must not. */
  keepOpen?: boolean;
}

/** @returns the id of the employee row the suite will drive. */
export async function seedE2eUser({
  email,
  password,
  databasePath,
  keepOpen = false,
}: SeedE2eOptions): Promise<string> {
  const db = createDb(databasePath);
  const handle = getRawHandle(databasePath);

  try {
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
      } else {
        const [created] = await db
          .insert(users)
          .values({ email, password_hash: hashPassword(password) })
          .returning({ id: users.id });
        userId = created.id;
      }

      const prior = await db
        .select({ id: employees.id, is_system: employees.is_system, deleted_at: employees.deleted_at })
        .from(employees)
        .where(eq(employees.user_id, userId))
        .limit(1);

      let employeeId: string;
      if (prior.length > 0) {
        // Seeding over the technical admin would hand the suite an invisible employee and a run
        // that fails much later, in a spec, with no trace back to here.
        if (prior[0].is_system) {
          throw new Error(
            `${email} owns the is_system admin employee. The E2E account must be an ordinary employee — ` +
              `point E2E_USER_EMAIL at a different address.`,
          );
        }
        employeeId = prior[0].id;
        // A soft-deleted employee is filtered out of the grid, so the suite would authenticate and
        // then find no column of its own. Restore it rather than leaving a half-usable account.
        if (prior[0].deleted_at !== null) {
          await db.update(employees).set({ deleted_at: null }).where(eq(employees.id, employeeId));
        }
      } else {
        const [row] = await db
          .insert(employees)
          .values({ user_id: userId, role: "employee", first_name: "E2E", last_name: "Tester", display_order: 99 })
          .returning({ id: employees.id });
        employeeId = row.id;
      }

      handle.exec("COMMIT");
      return employeeId;
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

  const email = requireEnv("E2E_USER_EMAIL");
  const password = requireEnv("E2E_USER_PASSWORD");
  const databasePath = requireEnv("DATABASE_PATH");

  if (password.length < MIN_PASSWORD_LENGTH) {
    // eslint-disable-next-line no-console
    console.error(`✖ E2E_USER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  const employeeId = await seedE2eUser({ email, password, databasePath });
  // eslint-disable-next-line no-console
  console.log(`✔ E2E account ready: employee ${employeeId}. Run the suite with BASE_URL=http://localhost:4321.`);
}

// `import.meta.main` is false when a test imports this module, so the CLI does not fire on import.
if (import.meta.main) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("✖ seed:e2e failed:", err);
    process.exit(1);
  });
}
