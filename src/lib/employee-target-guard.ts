import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createDb } from "@/db/index";
import type { Db } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
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

export interface ResolvedModeratorTarget {
  target: ModeratorTarget;
  /**
   * The handle this guard already opened. Reuse it rather than calling `createDb()` again — which
   * is now a memo lookup returning the same handle either way, so this is about keeping the call
   * sites honest rather than about resource cost. It stopped being about cost when the
   * postgres-js pool behind Supabase's 15-client session pooler became a local SQLite file.
   */
  db: Db;
}

/**
 * Runs, in order: authenticated → resolves to a non-deleted employee → is a moderator → the id
 * parses as a uuid → the target exists → the target is not the protected technical admin.
 *
 * Returns the target row plus the pool it opened when every gate passes, or the `Response` to
 * send when one does not. Callers must reuse the returned `db` rather than opening their own.
 * The deactivated-target check is left to the caller: `GET` must still read a deactivated
 * worker's address, while `PATCH` must refuse to write it.
 */
export async function resolveModeratorTarget(
  context: Parameters<APIRoute>[0],
  route: string,
): Promise<Response | ResolvedModeratorTarget> {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createDb(DATABASE_PATH);

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

  // No isNull filter: this must resolve soft-deleted employees too, so GET can read a
  // deactivated worker's address while PATCH refuses to write it.
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

  return { target, db };
}
