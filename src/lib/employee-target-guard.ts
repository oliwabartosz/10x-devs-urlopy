import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees } from "@/db/index";
import { eq, isNull, and } from "drizzle-orm";
import { isProtectedAdmin } from "@/lib/employees";

/**
 * The guard shared by the `employees/[id]` Auth sub-resources (`email.ts`, `password.ts`).
 *
 * Scope note: this is deliberately NOT the shared guard for the five pre-existing routes that
 * duplicate a similar block. Refactoring those is a separate change (see the plan's "What We're
 * NOT Doing"). This exists only so the two sub-resources added together do not ship as an
 * immediate copy-paste pair — they need the target's `user_id`, which none of the five do.
 */

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const UUIDSchema = z.uuid();

export interface ModeratorTarget {
  id: string;
  user_id: string;
  deleted_at: Date | null;
  is_system: boolean;
}

/**
 * Runs, in order: authenticated → resolves to a non-deleted employee → is a moderator → the id
 * parses as a uuid → the target exists → the target is not the protected technical admin.
 *
 * Returns the target row when every gate passes, or the `Response` to send when one does not.
 * The deactivated-target check is left to the caller: `GET` must still read a deactivated
 * worker's address, while `PATCH` must refuse to write it.
 */
export async function resolveModeratorTarget(
  context: Parameters<APIRoute>[0],
  route: string,
): Promise<Response | ModeratorTarget> {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createDb(DATABASE_URL);

  let caller: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    caller = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Database error" }, 503);
  }
  if (!caller) {
    return json({ error: "Employee record not found" }, 403);
  }
  if (caller.role !== "moderator") {
    return json({ error: "Forbidden" }, 403);
  }

  const idParsed = UUIDSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return json({ error: "Invalid employee ID" }, 400);
  }

  // Service role sees all rows — no isNull filter needed to read soft-deleted employees
  let target: ModeratorTarget | undefined;
  try {
    target = await db
      .select({
        id: employees.id,
        user_id: employees.user_id,
        deleted_at: employees.deleted_at,
        is_system: employees.is_system,
      })
      .from(employees)
      .where(eq(employees.id, idParsed.data))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Database error" }, 503);
  }
  if (!target) {
    return json({ error: "Employee not found" }, 404);
  }
  // The technical admin is immutable through every API path (RLS is bypassed).
  if (isProtectedAdmin(target)) {
    return json({ error: "Nie można modyfikować tego konta." }, 403);
  }

  return target;
}
