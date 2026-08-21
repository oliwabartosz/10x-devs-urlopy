export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveModeratorTarget } from "@/lib/employee-target-guard";

// Moderator-initiated password reset, for the "worker forgot their password" case.
//
// Added mid-implementation; it reverses this change's own "No moderator-initiated password
// reset for a worker" exclusion. The authority granted here is larger than the e-mail change
// beside it — a moderator who sets a worker's password has full access to that account — and
// there is no audit trail anywhere in this system, so nothing records who did it or when.
// That was decided with eyes open; see the plan's "What We're NOT Doing".
//
// A separate sub-resource rather than a verb on email.ts: the two are independent operations,
// and a moderator resetting a password must not have to restate an address.

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// The 8-character floor matches EmployeeCreateSchema (employees/index.ts:76) and the
// self-service route, NOT the 6 in supabase/config.toml:175.
const PasswordResetSchema = z.object({
  password: z.string().min(8),
});

export const PATCH: APIRoute = async (context) => {
  const route = "PATCH /api/employees/:id/password";
  const resolved = await resolveModeratorTarget(context, route);
  if (resolved instanceof Response) return resolved;

  if (resolved.target.deleted_at !== null) {
    return json({ error: "Cannot update a deactivated employee" }, 409);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = PasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return json({ error: "Admin client is not configured" }, 503);
  }

  try {
    const { error } = await adminClient.auth.admin.updateUserById(resolved.target.user_id, {
      password: parsed.data.password,
    });
    if (error) {
      // Never let the password reach Sentry — capture the auth error alone.
      Sentry.captureException(error, { tags: { route } });
      return json({ error: "Nie udało się zmienić hasła." }, 500);
    }
    // No session revocation, deliberately. The self-service route in Phase 4 signs out the
    // user's *other* sessions because the actor there is the account owner. Here the actor is
    // not, so revoking would sign the worker out mid-work with no explanation — and the
    // forgotten-password case means they have no live session to evict anyway.
    //
    // Never echo the password back.
    return json({ success: true }, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Nie udało się zmienić hasła." }, 500);
  }
};
