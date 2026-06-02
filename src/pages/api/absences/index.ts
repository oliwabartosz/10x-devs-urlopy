export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { eq, isNull, and, gte, lt, asc, sql } from "drizzle-orm";

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const YearSchema = z.string().regex(/^\d{4}$/);
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Invalid calendar date");

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const yearParam = context.url.searchParams.get("year");
  const fromParam = context.url.searchParams.get("from");
  const toParam = context.url.searchParams.get("to");

  const yearParsed = YearSchema.safeParse(yearParam);
  const fromParsed = DateSchema.safeParse(fromParam);
  const toParsed = DateSchema.safeParse(toParam);

  if (yearParam !== null && (fromParam !== null || toParam !== null)) {
    return json({ error: "Provide year=YYYY or from=YYYY-MM-DD&to=YYYY-MM-DD, not both" }, 400);
  }

  const useYearMode = yearParsed.success;
  const useDateRangeMode = !useYearMode && fromParsed.success && toParsed.success;

  if (!useYearMode && !useDateRangeMode) {
    return json({ error: "Provide year=YYYY or from=YYYY-MM-DD&to=YYYY-MM-DD" }, 400);
  }

  const db = createDb(DATABASE_URL);

  let employeeRow: { id: string } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch {
    return json({ error: "Database error" }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Employee record not found" }, 403);
  }

  let from: string;
  let to: string;

  if (useYearMode) {
    const year = yearParsed.data;
    from = `${year}-01-01`;
    to = `${(parseInt(year, 10) + 1).toString().padStart(4, "0")}-01-01`;
  } else if (fromParsed.success && toParsed.success) {
    from = fromParsed.data;
    if (new Date(from + "T00:00:00Z") > new Date(toParsed.data + "T00:00:00Z")) {
      return json({ error: "from must be ≤ to" }, 400);
    }
    const toDate = new Date(toParsed.data + "T00:00:00Z");
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    to = toDate.toISOString().slice(0, 10);
    const spanMs = new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime();
    if (spanMs > 90 * 24 * 60 * 60 * 1000) {
      return json({ error: "Date range exceeds maximum of 90 days" }, 400);
    }
  } else {
    return json({ error: "Provide year=YYYY or from=YYYY-MM-DD&to=YYYY-MM-DD" }, 400);
  }

  try {
    const data = await db
      .select({
        id: absences.id,
        employee_id: absences.employee_id,
        absence_type_id: absences.absence_type_id,
        date: absences.date,
        is_full_day: absences.is_full_day,
        hours: sql<number | null>`${absences.hours}::float`,
        comment: absences.comment,
        substitute_employee_id: absences.substitute_employee_id,
        created_at: absences.created_at,
      })
      .from(absences)
      .where(and(gte(absences.date, from), lt(absences.date, to)))
      .orderBy(asc(absences.date));
    return json(data, 200);
  } catch {
    return json({ error: "Database error" }, 500);
  }
};

const AbsenceCreateSchema = z
  .object({
    employee_id: z.uuid().optional(),
    absence_type_id: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    is_full_day: z.boolean(),
    hours: z.number().positive().nullable(),
    comment: z.string().max(500).nullable(),
    substitute_employee_id: z.uuid().nullable(),
  })
  .refine((d) => (d.is_full_day ? d.hours === null : d.hours !== null), {
    message: "hours must be null when is_full_day is true, and set otherwise",
  });

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = AbsenceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const { employee_id: requestedEmployeeId, ...absenceData } = parsed.data;
  let targetEmployeeId = employeeRow.id;

  if (employeeRow.role === "moderator" && requestedEmployeeId) {
    let targetRow: { id: string } | undefined;
    try {
      targetRow = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, requestedEmployeeId), isNull(employees.deleted_at)))
        .then((r) => r[0]);
    } catch {
      return json({ error: "Database error" }, 503);
    }
    if (!targetRow) {
      return json({ error: "Pracownik nie został znaleziony." }, 404);
    }
    targetEmployeeId = targetRow.id;
  }

  try {
    const [absenceRow] = await db
      .insert(absences)
      .values({ employee_id: targetEmployeeId, ...absenceData })
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
    return json(absenceRow, 201);
  } catch (err) {
    const pgError = err as { code?: unknown };
    console.error("[POST /api/absences] insert error:", JSON.stringify({ code: pgError.code, type: typeof pgError.code, msg: String(err) }));
    if (pgError.code === "42501") return json({ error: "Forbidden" }, 403);
    if (pgError.code === "23505") return json({ error: "You already have an absence entry for this day." }, 409);
    if (pgError.code === "23514") return json({ error: "Invalid hours/is_full_day combination" }, 400);
    return json({ error: "Database error" }, 500);
  }
};
