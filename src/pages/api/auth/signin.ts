import type { APIRoute } from "astro";
import * as Sentry from "@sentry/astro";
import {
  clearSignInFailures,
  clientIp,
  createSession,
  findUserByEmail,
  isSignInThrottled,
  recordSignInFailure,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { withBase } from "@/lib/base-path";

/**
 * The app's own messages, in Polish, replacing `?error=${error.message}` — which reflected
 * whatever English string the provider happened to return straight into the URL.
 *
 * One message for every failure mode, deliberately. A distinct "no such account" would confirm
 * which addresses exist, and a distinct "too many attempts" would tell an attacker exactly when
 * their window resets; both are free intelligence for anyone probing the box.
 */
const INVALID_CREDENTIALS = "Nieprawidłowy adres email lub hasło.";

export const POST: APIRoute = async (context) => {
  try {
    const form = await context.request.formData();
    // `FormData.get` can return a File. Narrow rather than stringify: a multipart body carrying a
    // file where the password should be must be a failed sign-in, never the literal
    // "[object Object]" compared against a hash.
    const field = (name: string): string => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const email = field("email").trim();
    const password = field("password");
    const ip = clientIp(context.request.headers);

    const reject = () => context.redirect(withBase(`/?error=${encodeURIComponent(INVALID_CREDENTIALS)}`));

    if (!email || !password) return reject();
    if (isSignInThrottled(email, ip)) return reject();

    const user = await findUserByEmail(email);
    // Verify even when no row matched, against a hash that cannot match: skipping the scrypt work
    // would make "unknown address" measurably faster than "wrong password" and hand back the
    // account enumeration the single message above is there to prevent.
    const ok = user ? verifyPassword(password, user.password_hash) : verifyPassword(password, "");

    if (!user || !ok) {
      recordSignInFailure(email, ip);
      return reject();
    }

    clearSignInFailures(email);
    setSessionCookie(context.cookies, await createSession(user.id));
    return context.redirect(withBase("/"));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/auth/signin" } });
    return new Response("Internal Server Error", { status: 500 });
  }
};
