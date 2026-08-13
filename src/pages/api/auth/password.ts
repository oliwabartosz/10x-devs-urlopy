export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

// CONVENTION BREAK, deliberate: this route speaks JSON + zod + `{ error }` + status codes,
// unlike its two neighbours signin.ts and signout.ts, which take FormData and answer with a
// redirect. Those two redirect because they are full page navigations. This one is called from
// a dialog that must render the error inline beside the offending field, and a redirect would
// destroy the dialog's state. Do not "fix" this back into the neighbours' shape.
//
// Self-service only: the caller changes their OWN password, off the existing SSR cookie
// session — no service key involved. The moderator-initiated reset is a different route
// (employees/[id]/password.ts) with a different actor and different session semantics.

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const PasswordChangeSchema = z.object({
  current_password: z.string().min(1),
  // The floor is 8 to match the app's own EmployeeCreateSchema (employees/index.ts:76),
  // NOT the 6 in supabase/config.toml:175.
  new_password: z.string().min(8),
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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  let updateError: Awaited<ReturnType<typeof supabase.auth.updateUser>>["error"];
  try {
    // The optional `current_password` argument gives an old-password check without touching
    // any project setting.
    ({ error: updateError } = await supabase.auth.updateUser({
      password: new_password,
      current_password,
    }));
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Nie udało się zmienić hasła." }, 500);
  }

  if (updateError) {
    // Match on status/code, never on the English message string — impl-review-phases-2-4.md F4.
    //
    // `reauthentication_needed` is what production returns if `secure_password_change` is
    // enabled there and the session is older than 24 h. That setting lives in the Supabase
    // dashboard, not in this repo (supabase/config.toml:211 governs `supabase start` only), so
    // it is unverifiable from here — handling it is what makes this route correct under either
    // setting instead of surfacing an opaque 500.
    if (updateError.code === "reauthentication_needed") {
      return json({ error: "Ze względów bezpieczeństwa zaloguj się ponownie, zanim zmienisz hasło." }, 400);
    }
    if (updateError.status === 400 || updateError.status === 401 || updateError.status === 422) {
      return json({ error: "Obecne hasło jest nieprawidłowe." }, 400);
    }
    Sentry.captureException(updateError, { tags: { route } });
    return json({ error: "Nie udało się zmienić hasła." }, 500);
  }

  // What Supabase Studio itself does, so the change actually evicts the user's other sessions
  // while the caller's own survives.
  //
  // A failure HERE must not turn a successful password change into an error response — the
  // password is already changed, and reporting failure would send the user to retry with a
  // "current password" that is no longer current. Log and return 200, mirroring the
  // compensating-delete idiom at employees/index.ts:157-164.
  try {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) {
      Sentry.captureException(signOutError, {
        level: "warning",
        tags: { route, action: "sign_out_others" },
      });
    }
  } catch (err) {
    Sentry.captureException(err, { level: "warning", tags: { route, action: "sign_out_others" } });
  }

  return json({ success: true }, 200);
};
