import type { APIRoute } from "astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees } from "@/db/index";
import { eq, isNull, and, count } from "drizzle-orm";

export const prerender = false;

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const UUIDSchema = z.uuid();

const EmployeeUpdateSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    role: z.enum(["employee", "moderator"]).optional(),
  })
  .refine((d) => d.first_name !== undefined || d.last_name !== undefined || d.role !== undefined, {
    message: "At least one field must be provided",
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = EmployeeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  // Service role sees all rows — no isNull filter needed to read deleted employees
  let target: { id: string; role: "employee" | "moderator"; deleted_at: Date | null } | undefined;
  try {
    target = await db
      .select({ id: employees.id, role: employees.role, deleted_at: employees.deleted_at })
      .from(employees)
      .where(eq(employees.id, idParsed.data))
      .then((r) => r[0]);
  } catch {
    return json({ error: "Database error" }, 503);
  }
  if (!target) {
    return json({ error: "Employee not found" }, 404);
  }
  if (target.deleted_at !== null) {
    return json({ error: "Cannot update a deactivated employee" }, 409);
  }

  if (parsed.data.role === "employee" && target.role === "moderator") {
    try {
      const [{ value }] = await db
        .select({ value: count() })
        .from(employees)
        .where(and(eq(employees.role, "moderator"), isNull(employees.deleted_at)));
      if (value <= 1) {
        return json({ error: "Nie możesz zdegradować ostatniego moderatora." }, 409);
      }
    } catch {
      return json({ error: "Database error" }, 503);
    }
  }

  try {
    const rows = await db.update(employees).set(parsed.data).where(eq(employees.id, idParsed.data)).returning();
    if (rows.length === 0) return json({ error: "Employee not found" }, 404);
    return json(rows[0], 200);
  } catch {
    return json({ error: "Database error" }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
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

  if (idParsed.data === caller.id) {
    return json({ error: "Nie możesz usunąć własnego konta." }, 400);
  }

  // Service role sees all rows — no isNull filter needed
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
  if (target.deleted_at !== null) {
    return json({ error: "Employee is already deactivated" }, 409);
  }

  try {
    const rows = await db
      .update(employees)
      .set({ deleted_at: new Date() })
      .where(eq(employees.id, idParsed.data))
      .returning({ id: employees.id });
    if (rows.length === 0) return json({ error: "Employee not found" }, 404);
    return json({ success: true }, 200);
  } catch {
    return json({ error: "Database error" }, 500);
  }
};
