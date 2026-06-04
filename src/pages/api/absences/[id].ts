export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DateSchema } from "@/lib/validators";
import { extractPgErrorCode } from "@/lib/db-errors";

const AbsenceUpdateSchema = z
  .object({
    absence_type_id: z.number().int().positive(),
    date: DateSchema,
    is_full_day: z.boolean(),
    hours: z.number().positive().nullable(),
    comment: z.string().max(500).nullable(),
    substitute_employee_id: z.uuid().nullable(),
  })
  .partial();

const AbsenceUpdateSchemaRefined = AbsenceUpdateSchema.refine(
  (d) => d.is_full_day === undefined || d.hours === undefined || (d.is_full_day ? d.hours === null : d.hours !== null),
  { message: "hours must be null when is_full_day is true, and set otherwise" },
);

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const id = context.params.id;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) {
    return json({ error: "Invalid id" }, 400);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = AbsenceUpdateSchemaRefined.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const db = createDb(DATABASE_URL);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch {
    return json({ error: "Database error" }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Employee record not found" }, 403);
  }

  try {
    const rows = await db
      .update(absences)
      .set(parsed.data)
      .where(
        employeeRow.role === "moderator"
          ? eq(absences.id, id)
          : and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id)),
      )
      .returning({
        id: absences.id,
        employee_id: absences.employee_id,
        absence_type_id: absences.absence_type_id,
        date: absences.date,
        is_full_day: absences.is_full_day,
        hours: sql<number | null>`${absences.hours}::float`,
        comment: absences.comment,
        substitute_employee_id: absences.substitute_employee_id,
        created_at: absences.created_at,
        updated_at: absences.updated_at,
      });
    if (rows.length === 0) return json({ error: "Not found" }, 404);
    return json(rows[0], 200);
  } catch (err) {
    const code = extractPgErrorCode(err);
    if (code === "42501") return json({ error: "Forbidden" }, 403);
    if (code === "23505") return json({ error: "You already have an absence entry for this day." }, 409);
    if (code === "23514") return json({ error: "Invalid hours/is_full_day combination" }, 400);
    return json({ error: "Database error" }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const id = context.params.id;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) {
    return json({ error: "Invalid id" }, 400);
  }

  const db = createDb(DATABASE_URL);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch {
    return json({ error: "Database error" }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Employee record not found" }, 403);
  }

  try {
    const deleted = await db
      .delete(absences)
      .where(
        employeeRow.role === "moderator"
          ? eq(absences.id, id)
          : and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id)),
      )
      .returning({ id: absences.id });
    if (deleted.length === 0) return json({ error: "Not found" }, 404);
    return new Response(null, { status: 204 });
  } catch (err) {
    const code = extractPgErrorCode(err);
    if (code === "42501") return json({ error: "Forbidden" }, 403);
    return json({ error: "Database error" }, 500);
  }
};
