export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveModeratorTarget } from "@/lib/employee-target-guard";

// A sibling of [id]/restore.ts rather than a field on [id].ts, deliberately: the address lives
// in Supabase Auth, not in the employees table, and [id].ts writes `parsed.data` straight into
// `db.update(employees)`. An `email` key entering that handler would have to be split back out
// of the update payload — a trap for the next person to add a field.
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

  const adminClient = createAdminClient();
  if (!adminClient) {
    return json({ error: "Admin client is not configured" }, 503);
  }

  try {
    const { data, error } = await adminClient.auth.admin.getUserById(resolved.target.user_id);
    if (error ?? !data.user) {
      Sentry.captureException(error ?? new Error("Auth user not found"), { tags: { route } });
      return json({ error: "Database error" }, 503);
    }
    // Only the address. Never the auth user object, never user_id — an island must not
    // receive auth identifiers (employee-management/reviews/impl-review-phases-2-4.md F2).
    return json({ email: data.user.email ?? "" }, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
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

  const adminClient = createAdminClient();
  if (!adminClient) {
    return json({ error: "Admin client is not configured" }, 503);
  }

  // Duplicate detection happens HERE, before the write, because the Auth API gives us nothing
  // to detect it with afterwards.
  //
  // The plan specified reusing the `authError.status === 422` → 409 mapping from
  // employees/index.ts:137-140. That mapping is real, but it belongs to `createUser`.
  // `updateUserById` returns `{ status: 500, code: "unexpected_failure", message: "Error
  // updating user" }` for a duplicate address — byte-identical to any other server-side
  // failure. Verified against the live project. Mapping `unexpected_failure` to "duplicate"
  // would label unrelated failures as collisions, which is exactly the fragile matching
  // impl-review-phases-2-4.md F4 warns about.
  //
  // So: pre-check by address. This used to read `auth.users` — the one place the app's Drizzle
  // connection reached outside `src/db/schema.ts` — and now reads the local `users` table, which
  // is in the same database and in the schema. The `users.email` column is `COLLATE NOCASE`, so
  // `lower()` on both sides is belt-and-braces rather than load-bearing. Still one row by
  // address, not `admin.listUsers()`.
  //
  // A concurrent insert between this check and the write still lands as the opaque 500 below.
  // That race is accepted: it needs two moderators claiming the same address in the same
  // instant, and the fallback is a wrong-but-honest error rather than a wrong success.
  //
  // The guard's handle, not a second one — `createDb` memoises per path, so this is the same
  // connection either way, but taking it from the guard keeps the call sites honest.
  const { db } = resolved;
  try {
    const clash = await db.all(
      sql`select 1 from users where lower(email) = lower(${email}) and id <> ${resolved.target.user_id} limit 1`,
    );
    if (clash.length > 0) {
      return json({ error: "Konto z tym adresem email już istnieje." }, 409);
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Database error" }, 503);
  }

  try {
    // `email_confirm: true` is load-bearing: without it the address lands with
    // `email_verified: false`, which with confirmations enabled locks the worker out.
    // Mirrors createUser({ email_confirm: true }) at employees/index.ts:128.
    //
    // admin.updateUserById writes users.email directly and does NOT enter the email_change
    // double-confirm flow that self-service updateUser({ email }) uses — which is precisely
    // why the admin API is the right tool for the chosen immediate, no-confirmation
    // behaviour. No session revocation occurs: the worker's cookie session keeps working
    // with a stale `email` JWT claim until it refreshes.
    const { error } = await adminClient.auth.admin.updateUserById(resolved.target.user_id, {
      email,
      email_confirm: true,
    });
    if (error) {
      // Kept as belt-and-braces in case Supabase ever starts returning the 422 that
      // `createUser` returns. Today `updateUserById` does not — see the pre-check above,
      // which is what actually produces the 409.
      if (error.status === 422) {
        return json({ error: "Konto z tym adresem email już istnieje." }, 409);
      }
      Sentry.captureException(error, { tags: { route } });
      return json({ error: "Failed to update auth user" }, 500);
    }
    return json({ email }, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Failed to update auth user" }, 500);
  }
};
