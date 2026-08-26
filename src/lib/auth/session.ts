import { randomBytes } from "node:crypto";
import type { AstroCookies } from "astro";
import { and, eq, lt, ne } from "drizzle-orm";
import { createDb, sessions, users } from "@/db/index";
import { DATABASE_PATH, PUBLIC_ORIGIN } from "astro:env/server";

/**
 * Opaque server-side sessions backed by the `sessions` table.
 *
 * Opaque rather than a signed token, because `ChangePasswordDialog.tsx:51` already promises the
 * user that changing their password logs out their other sessions — a promise only a server-side
 * session store can keep. A stateless JWT would have to lie or carry a revocation list anyway.
 *
 * The cookie this issues is strictly better than the Supabase one it replaces, which was
 * observably neither `HttpOnly` nor `Secure` (`tests/e2e/.auth/user.json` shows it in the clear).
 */

export const SESSION_COOKIE = "urlopy_session";

/** Thirty days, matching the "stay signed in on the office machine" expectation of an internal tool. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * `Secure` is driven by configuration, not by `import.meta.env.PROD`: the flag must follow the
 * scheme the browser actually sees, and behind nginx the Node process cannot observe it. An
 * install served over plain HTTP on a closed network (a real case for this deployment) would
 * otherwise set a cookie the browser refuses to send back, producing a login loop with no error.
 * Phase 5 wires the same value into `site` and `security.allowedDomains`.
 */
function wantsSecureCookie(): boolean {
  return (PUBLIC_ORIGIN ?? "").startsWith("https://");
}

function db() {
  return createDb(DATABASE_PATH);
}

/** Create a session row and return its id. The caller sets the cookie via {@link setSessionCookie}. */
export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await db()
    .insert(sessions)
    .values({ id, user_id: userId, expires_at: new Date(Date.now() + SESSION_TTL_MS) });
  return id;
}

export function setSessionCookie(cookies: AstroCookies, sessionId: string): void {
  cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: wantsSecureCookie(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

/** The session id the request carries, or null. */
export function readSessionId(cookies: AstroCookies): string | null {
  return cookies.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Resolve the request's cookie to a live user, or null.
 *
 * Expired rows are pruned opportunistically here rather than on a timer: this is the only code
 * path that runs on every request, and a cron for it would be one more thing `install.sh` has to
 * provision on an offline box.
 */
export async function readSession(cookies: AstroCookies): Promise<SessionUser | null> {
  const id = readSessionId(cookies);
  if (!id) return null;

  const now = new Date();
  const rows = await db()
    .select({ userId: users.id, email: users.email, expiresAt: sessions.expires_at })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db().delete(sessions).where(lt(sessions.expires_at, now));
    return null;
  }
  return { id: row.userId, email: row.email };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Revoke every session belonging to `userId` except `keepId`.
 *
 * This is what `POST /api/auth/password` needs to make good on the dialog's toast: the caller who
 * just changed their password stays signed in, everyone else holding that credential does not.
 */
export async function destroyOtherSessions(userId: string, keepId: string | null): Promise<void> {
  const scope = keepId ? and(eq(sessions.user_id, userId), ne(sessions.id, keepId)) : eq(sessions.user_id, userId);
  await db().delete(sessions).where(scope);
}
