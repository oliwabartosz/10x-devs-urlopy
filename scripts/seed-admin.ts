/**
 * Seed the technical admin account (role: moderator, is_system: true) from env.
 *
 * Runs in Node: Drizzle opens the SQLite file at DATABASE_PATH and a Supabase service-role
 * client still creates the auth user. Mirrors the S-04 create path (`createUser` -> Drizzle
 * insert, compensating `deleteUser` on insert failure; see
 * src/pages/api/employees/index.ts:111-163).
 *
 * NOTE (sqlite-install): the database half is ported; the auth half is not. Phase 4 replaces the
 * Supabase calls below with a local `users` row and a scrypt hash, at which point the
 * compensating-delete dance goes away too (both rows land in one database). Until then this
 * script compiles and its idempotency gate is correct, but it cannot complete a run.
 *
 * Idempotent: no-ops if an `is_system` row already exists, and adopts a
 * pre-existing auth user with the same email (recovering a half-finished run).
 *
 * Usage: `npm run seed:admin` (reads `.env` via `process.loadEnvFile`).
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { createDb, closeDb } from "../src/db/index";
import { employees } from "../src/db/schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`✖ Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/** Find an existing auth user by email. `listUsers` is paginated; scan until found. */
async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < perPage) break;
  }
  return null;
}

async function main(): Promise<void> {
  process.loadEnvFile();

  const email = requireEnv("ADMIN_LOGIN");
  const password = requireEnv("ADMIN_PASSWORD");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_KEY");
  const databasePath = requireEnv("DATABASE_PATH");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const db = createDb(databasePath);

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

    // Create the auth user, or adopt a pre-existing one with the same email
    // (recovers from a half-run where the auth user landed but the row did not).
    let userId: string;
    let createdThisRun = false;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      if (error.status === 422) {
        const found = await findUserByEmail(admin, email);
        if (!found) {
          // eslint-disable-next-line no-console
          console.error(`✖ Auth reports ${email} exists, but the user could not be found.`);
          process.exit(1);
        }
        userId = found.id;
        // eslint-disable-next-line no-console
        console.log(`• Auth user for ${email} already exists; adopting it.`);
      } else {
        throw error;
      }
    } else {
      userId = data.user.id;
      createdThisRun = true;
    }

    try {
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
      // eslint-disable-next-line no-console
      console.log(`✔ Seeded admin employee ${row.id} (auth user ${userId}).`);
    } catch (err) {
      // Compensating delete only when we created the user this run — never delete
      // a pre-existing account we merely adopted.
      if (createdThisRun) {
        await admin.auth.admin.deleteUser(userId).catch((compErr: unknown) => {
          // eslint-disable-next-line no-console
          console.error("✖ Failed to roll back auth user", userId, compErr);
        });
      }
      throw err;
    }
  } finally {
    closeDb(databasePath);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("✖ seed:admin failed:", err);
  process.exit(1);
});
