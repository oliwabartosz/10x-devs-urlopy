import type { APIRoute } from "astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees } from "@/db/index";
import { eq, isNull, and } from "drizzle-orm";

export const prerender = false;

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const UUIDSchema = z.uuid();

export const POST: APIRoute = async (context) => {
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
  } catch {
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
  let target: { id: string; deleted_at: Date | null } | undefined;
  try {
    target = await db
      .select({ id: employees.id, deleted_at: employees.deleted_at })
      .from(employees)
      .where(eq(employees.id, idParsed.data))
      .then((r) => r[0]);
  } catch {
    return json({ error: "Database error" }, 503);
  }
  if (!target) {
    return json({ error: "Employee not found" }, 404);
  }
  if (target.deleted_at === null) {
    return json({ error: "Employee is already active" }, 409);
  }

  try {
    const rows = await db
      .update(employees)
      .set({ deleted_at: null })
      .where(eq(employees.id, idParsed.data))
      .returning();
    if (rows.length === 0) return json({ error: "Employee not found" }, 404);
    return json(rows[0], 200);
  } catch {
    return json({ error: "Database error" }, 500);
  }
};
