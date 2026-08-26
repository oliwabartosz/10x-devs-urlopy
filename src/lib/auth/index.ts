/**
 * The auth seam that replaces `src/lib/supabase.ts`.
 *
 * A barrel rather than a factory: `createClient(headers, cookies)` existed because the Supabase SSR
 * client had to be built per request around the cookie jar. Nothing here holds request state — the
 * session functions take the cookie jar as an argument and the database handle is memoised by
 * `createDb` — so there is no object to construct, and no `null`-when-unconfigured case to handle.
 */
export {
  SESSION_COOKIE,
  createSession,
  readSession,
  readSessionId,
  destroySession,
  destroyOtherSessions,
  setSessionCookie,
  clearSessionCookie,
  type SessionUser,
} from "./session";

export { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, WeakPasswordError } from "./password";

export {
  DuplicateEmailError,
  createUser,
  deleteUser,
  getUserEmail,
  updateUserEmail,
  setUserPassword,
  findUserByEmail,
  findUserById,
  type AuthUser,
  type CredentialRow,
} from "./users";

export { clientIp, isSignInThrottled, recordSignInFailure, clearSignInFailures, resetRateLimits } from "./rate-limit";
