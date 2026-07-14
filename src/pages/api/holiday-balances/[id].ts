export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees, holiday_balances } from "@/db/index";
import { and, eq, isNull } from "drizzle-orm";
import { extractPgErrorCode } from "@/lib/db-errors";

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

  const db = createDb(DATABASE_URL);

  // Caller must resolve to a non-deleted employees row. No role/owner gate on the delete —
  // consistent with the "both roles can edit any balance" rule (POST has no role gate either).
  let caller: { id: string } | undefined;
  try {
    caller = await db
      .select({ id: employees.id })
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

  try {
    const deleted = await db
      .delete(holiday_balances)
      .where(eq(holiday_balances.id, id))
      .returning({ id: holiday_balances.id });
    if (deleted.length === 0) return json({ error: "Not found" }, 404);
    return new Response(null, { status: 204 });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "DELETE /api/holiday-balances/:id" } });
    const code = extractPgErrorCode(err);
    if (code === "42501") return json({ error: "Forbidden" }, 403);
    return json({ error: "Database error" }, 500);
  }
};
