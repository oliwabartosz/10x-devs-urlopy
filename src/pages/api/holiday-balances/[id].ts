export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { employees, holiday_balances } from "@/db/index";
import { and, eq, isNull } from "drizzle-orm";
import { isProtectedAdmin } from "@/lib/employees";

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const id = context.params.id;
  if (!id || !z.uuid().safeParse(id).success) {
    return json({ error: "Invalid id" }, 400);
  }

  const db = createDb(DATABASE_PATH);

  // Caller must resolve to a non-deleted employees row, and then own the row or be a moderator.
  //
  // This supersedes, in part, S-15's ruling that any valid caller may delete any balance by id
  // (context/archive/2026-06-22-urlop-balance/plan.md:211). That ruling was written when no UI
  // exposed anyone else's balance id; the moderator balance editing added in this change makes
  // other people's ids reachable, so an ungated delete is no longer defensible. S-15's *other*
  // ruling — that both roles may write `current_entitlement_days` and `carryover_days` for
  // anyone — is untouched; only the delete verb narrows here.
  //
  // Do not read this as "POST is ungated" — S-17 narrowed POST with a field-level gate, so
  // `used_adjustment_days` is moderator-only there (see index.ts).
  let caller: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    caller = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "DELETE /api/holiday-balances/:id" } });
    return json({ error: "Database error" }, 503);
  }
  if (!caller) {
    return json({ error: "Employee record not found" }, 403);
  }

  // Resolve the row's owner before deciding. The 404 is returned ahead of every ownership
  // check so the endpoint does not leak which balance ids exist.
  let target: { employee_id: string; is_system: boolean } | undefined;
  try {
    target = await db
      .select({ employee_id: holiday_balances.employee_id, is_system: employees.is_system })
      .from(holiday_balances)
      .innerJoin(employees, eq(employees.id, holiday_balances.employee_id))
      .where(eq(holiday_balances.id, id))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "DELETE /api/holiday-balances/:id" } });
    return json({ error: "Database error" }, 503);
  }
  if (!target) {
    return json({ error: "Not found" }, 404);
  }
  // The technical admin is immutable through every API path (RLS is bypassed).
  if (isProtectedAdmin(target)) {
    return json({ error: "Nie można modyfikować tego konta." }, 403);
  }
  if (target.employee_id !== caller.id && caller.role !== "moderator") {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const deleted = await db
      .delete(holiday_balances)
      .where(eq(holiday_balances.id, id))
      .returning({ id: holiday_balances.id });
    if (deleted.length === 0) return json({ error: "Not found" }, 404);
    return new Response(null, { status: 204 });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "DELETE /api/holiday-balances/:id" } });
    // No code discrimination left: the only arm here was Postgres `42501` (insufficient
    // privilege), which came from RLS — bypassed on the service-role connection and nonexistent
    // on a local SQLite file. Every failure reaching here is a real server error.
    return json({ error: "Database error" }, 500);
  }
};
