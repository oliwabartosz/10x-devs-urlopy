export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import {
  destroyOtherSessions,
  findUserById,
  MIN_PASSWORD_LENGTH,
  readSessionId,
  setUserPassword,
  verifyPassword,
} from "@/lib/auth";

// CONVENTION BREAK, deliberate: this route speaks JSON + zod + `{ error }` + status codes,
// unlike its two neighbours signin.ts and signout.ts, which take FormData and answer with a
// redirect. Those two redirect because they are full page navigations. This one is called from
// a dialog that must render the error inline beside the offending field, and a redirect would
// destroy the dialog's state. Do not "fix" this back into the neighbours' shape.
//
// Self-service only: the caller changes their OWN password, off the session cookie. The
// moderator-initiated reset is a different route (employees/[id]/password.ts) with a different
// actor and different session semantics.

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const PasswordChangeSchema = z.object({
  current_password: z.string().min(1),
  // The floor is 8, matching EmployeeCreateSchema (employees/index.ts:76) and
  // `MIN_PASSWORD_LENGTH`, which `hashPassword` enforces again at the boundary.
  new_password: z.string().min(MIN_PASSWORD_LENGTH),
});

export const POST: APIRoute = async (context) => {
  const route = "POST /api/auth/password";

  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = PasswordChangeSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }
  const { current_password, new_password } = parsed.data;

  if (new_password === current_password) {
    return json({ error: "Nowe hasło musi różnić się od obecnego." }, 400);
  }

  try {
    const user = await findUserById(context.locals.user.id);
    // The session resolved to a user id that no longer has a row. Nothing to change, and nothing
    // the caller can do about it — but it is not a wrong-password case, so do not say so.
    if (!user) {
      return json({ error: "Nie udało się zmienić hasła." }, 500);
    }

    // The three Supabase failure codes this used to discriminate on — `reauthentication_needed`,
    // `weak_password`, `same_password` — were all consequences of rules living in a dashboard we
    // could not read. Every one of them is now decided here: the equality check above covers
    // `same_password`, zod covers `weak_password`, and `reauthentication_needed` has no analogue
    // because there is no second factor and no session age policy.
    if (!verifyPassword(current_password, user.password_hash)) {
      return json({ error: "Obecne hasło jest nieprawidłowe." }, 400);
    }

    await setUserPassword(user.id, new_password);

    // Makes good on the toast at ChangePasswordDialog.tsx:51. The caller's own session is kept —
    // they are the one who made the change — while every other holder of the old credential is
    // evicted.
    //
    // A failure HERE must not turn a successful password change into an error response: the
    // password is already changed, and reporting failure would send the user to retry with a
    // "current password" that is no longer current.
    try {
      await destroyOtherSessions(user.id, readSessionId(context.cookies));
    } catch (err) {
      Sentry.captureException(err, { level: "warning", tags: { route, action: "sign_out_others" } });
    }

    return json({ success: true }, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Nie udało się zmienić hasła." }, 500);
  }
};
