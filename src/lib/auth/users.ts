import { eq } from "drizzle-orm";
import { createDb, users } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { extractDbErrorCode, SQLITE_CONSTRAINT_UNIQUE } from "@/lib/db-errors";
import { hashPassword } from "./password";

/**
 * The `users`-table service that replaces `createAdminClient()`.
 *
 * It covers exactly what the routes use today and nothing more: create with a chosen password
 * (pre-verified — there is no confirmation flow and never was one live, every former `createUser`
 * passed `email_confirm: true`), delete, read the address, change the address, set a password
 * without knowing the old one, and look up by address for sign-in.
 *
 * The `null`-when-unconfigured contract is gone with the service key that motivated it: SQLite is
 * always available, so the three 503 "Admin client is not configured" branches have no analogue.
 *
 * Case-insensitive uniqueness on the address comes from `COLLATE NOCASE` on the column, applied in
 * `drizzle/0000_baseline.sql` because Drizzle cannot express it. SQLite's NOCASE folds ASCII only,
 * which is correct for the address forms in use here.
 */

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with that e-mail address already exists");
    this.name = "DuplicateEmailError";
  }
}

function db() {
  return createDb(DATABASE_PATH);
}

/** Rethrow a UNIQUE violation on `users.email` as the typed error the routes map to 409. */
function asDuplicate(err: unknown): never {
  if (extractDbErrorCode(err) === SQLITE_CONSTRAINT_UNIQUE) throw new DuplicateEmailError();
  throw err;
}

export interface AuthUser {
  id: string;
  email: string;
}

export async function createUser(email: string, password: string): Promise<AuthUser> {
  try {
    const [row] = await db()
      .insert(users)
      .values({ email, password_hash: hashPassword(password) })
      .returning({ id: users.id, email: users.email });
    return row;
  } catch (err) {
    asDuplicate(err);
  }
}

export async function deleteUser(id: string): Promise<void> {
  await db().delete(users).where(eq(users.id, id));
}

export async function getUserEmail(id: string): Promise<string | null> {
  const rows = await db().select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return rows[0]?.email ?? null;
}

export async function updateUserEmail(id: string, email: string): Promise<void> {
  try {
    await db().update(users).set({ email, updated_at: new Date() }).where(eq(users.id, id));
  } catch (err) {
    asDuplicate(err);
  }
}

/** Set a password without knowing the old one — the moderator-initiated reset, and the second half of a self-service change. */
export async function setUserPassword(id: string, password: string): Promise<void> {
  await db()
    .update(users)
    .set({ password_hash: hashPassword(password), updated_at: new Date() })
    .where(eq(users.id, id));
}

export interface CredentialRow extends AuthUser {
  password_hash: string;
}

/** The row a credential check needs. `COLLATE NOCASE` makes this case-insensitive on the address. */
export async function findUserByEmail(email: string): Promise<CredentialRow | null> {
  const rows = await db()
    .select({ id: users.id, email: users.email, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<CredentialRow | null> {
  const rows = await db()
    .select({ id: users.id, email: users.email, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}
