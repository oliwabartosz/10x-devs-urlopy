export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { DuplicateEmailError, getUserEmail, updateUserEmail } from "@/lib/auth";
import { resolveModeratorTarget } from "@/lib/employee-target-guard";
import { reportError } from "@/lib/report";

// A sibling of [id]/restore.ts rather than a field on [id].ts, deliberately: the address lives
// on the `users` row (it lived in Supabase Auth before that), not in the employees table, and
// [id].ts writes `parsed.data` straight into `db.update(employees)`. An `email` key entering that
// handler would have to be split back out of the update payload — a trap for the next person to
// add a field.
//
// This supersedes context/changes/employee-management/plan.md:39 ("No ability to change an
// employee's email after creation"). That decision rested on there being no read path to
// maintain and on creation-time-only identity; neither holds now that moderators are the sole
// account administrators and there is no self-service signup surface.

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const EmailUpdateSchema = z.object({
  email: z.email(),
});

export const GET: APIRoute = async (context) => {
  const route = "GET /api/employees/:id/email";
  const resolved = await resolveModeratorTarget(context, route);
  if (resolved instanceof Response) return resolved;

  try {
    const email = await getUserEmail(resolved.target.user_id);
    if (email === null) {
      // An employee row whose `user_id` names no user. The FK makes this unreachable, so if it
      // ever fires the database has been edited by hand — report it rather than returning "".
      reportError(new Error("Employee row has no matching users row"), { tags: { route } });
      return json({ error: "Database error" }, 503);
    }
    // Only the address. Never the user row, never user_id — an island must not receive auth
    // identifiers (employee-management/reviews/impl-review-phases-2-4.md F2).
    return json({ email }, 200);
  } catch (err) {
    reportError(err, { tags: { route } });
    return json({ error: "Database error" }, 503);
  }
};

export const PATCH: APIRoute = async (context) => {
  const route = "PATCH /api/employees/:id/email";
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

  const parsed = EmailUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }
  const { email } = parsed.data;

  // The pre-check that used to sit here is gone, and its race with it.
  //
  // It existed because `admin.updateUserById` reported a duplicate address as `{ status: 500,
  // code: "unexpected_failure", message: "Error updating user" }` — byte-identical to any other
  // server-side failure — so a collision could only be caught by looking first, and a concurrent
  // insert between the look and the write landed as an opaque 500. The `UNIQUE` index on
  // `users.email` answers the question exactly and atomically instead, and `updateUserEmail`
  // lifts it into `DuplicateEmailError`. Nothing is lost: the message and the 409 are unchanged.
  try {
    // Immediate and unconfirmed, which is what the moderator flow wants and what the Supabase
    // admin API was chosen for: a self-service address change would have entered a double-confirm
    // e-mail flow, and there is no SMTP on this box to carry it.
    //
    // No session revocation, deliberately. The worker's session is keyed by `users.id`, which does
    // not change here, so they stay signed in — as they did before, when the address lived in a
    // JWT claim that simply went stale.
    await updateUserEmail(resolved.target.user_id, email);
    return json({ email }, 200);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return json({ error: "Konto z tym adresem email już istnieje." }, 409);
    }
    reportError(err, { tags: { route } });
    return json({ error: "Failed to update auth user" }, 500);
  }
};
