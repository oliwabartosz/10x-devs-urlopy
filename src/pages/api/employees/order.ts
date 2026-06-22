import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees } from "@/db/index";
import { eq, isNull, and, sql } from "drizzle-orm";

export const prerender = false;

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const OrderSchema = z.object({
  order: z
    .array(
      z.object({
        id: z.uuid(),
        display_order: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
});

export const PATCH: APIRoute = async (context) => {
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
    Sentry.captureException(err, { tags: { route: "PATCH /api/employees/order" } });
    return json({ error: "Database error" }, 503);
  }
  if (!caller) {
    return json({ error: "Employee record not found" }, 403);
  }
  if (caller.role !== "moderator") {
    return json({ error: "Forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = OrderSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  try {
    const idList = sql.join(
      parsed.data.order.map((item) => sql`${item.id}::uuid`),
      sql`, `,
    );
    const ordList = sql.join(
      parsed.data.order.map((item) => sql`${item.display_order}::int`),
      sql`, `,
    );
    // `AND employees.is_system = false` keeps the technical admin out of the update
    // set: a crafted payload carrying the admin id reorders everyone else but no-ops
    // on the admin (RLS is bypassed, so this guard must live in the statement).
    await db.execute(
      sql`UPDATE employees SET display_order = v.ord FROM (SELECT UNNEST(ARRAY[${idList}]) AS id, UNNEST(ARRAY[${ordList}]) AS ord) AS v WHERE employees.id = v.id AND employees.is_system = false`,
    );
    return json({ ok: true }, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "PATCH /api/employees/order" } });
    return json({ error: "Database error" }, 500);
  }
};
