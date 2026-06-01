export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Absence } from "@/types";

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

  const useYearMode = yearParsed.success;
  const useDateRangeMode = !useYearMode && fromParsed.success && toParsed.success;

  if (!useYearMode && !useDateRangeMode) {
    return json({ error: "Provide year=YYYY or from=YYYY-MM-DD&to=YYYY-MM-DD" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const employeeCheck = (await supabase
    .from("employees")
    .select("id")
    .eq("user_id", context.locals.user.id)
    .is("deleted_at", null)
    .single()) as { data: { id: string } | null; error: { code: string } | null };
  if (employeeCheck.error?.code === "PGRST116" || !employeeCheck.data) {
    return json({ error: "Employee record not found" }, 403);
  }
  if (employeeCheck.error) {
    return json({ error: "Database error" }, 503);
  }

  let from: string;
  let to: string;

  if (useYearMode) {
    const year = yearParsed.data;
    from = `${year}-01-01`;
    to = `${String(Number(year) + 1)}-01-01`;
  } else if (fromParsed.success && toParsed.success) {
    from = fromParsed.data;
    if (new Date(from) > new Date(toParsed.data)) {
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

  // No employee_id filter — absences_select RLS allows all authenticated users to read
  // all absences so the team grid can display every employee's column.
  const result = (await supabase
    .from("absences")
    .select("id, employee_id, absence_type_id, date, is_full_day, hours, comment, substitute_employee_id, created_at")
    .gte("date", from)
    .lt("date", to)
    .order("date")) as { data: Absence[] | null; error: { message: string } | null };

  if (result.error) {
    return json({ error: "Database error" }, 500);
  }

  return json(result.data ?? [], 200);
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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const employeeResult = (await supabase
    .from("employees")
    .select("id, role")
    .eq("user_id", context.locals.user.id)
    .is("deleted_at", null)
    .single()) as {
    data: { id: string; role: "employee" | "moderator" } | null;
    error: { code: string; message: string } | null;
  };

  if (employeeResult.error?.code === "PGRST116" || !employeeResult.data) {
    return json({ error: "Employee record not found" }, 403);
  }
  if (employeeResult.error) {
    return json({ error: "Database error" }, 503);
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
  let targetEmployeeId = employeeResult.data.id;

  if (employeeResult.data.role === "moderator" && requestedEmployeeId) {
    const targetResult = (await supabase
      .from("employees")
      .select("id")
      .eq("id", requestedEmployeeId)
      .is("deleted_at", null)
      .single()) as { data: { id: string } | null; error: { code: string; message: string } | null };
    if (targetResult.error?.code === "PGRST116" || !targetResult.data) {
      return json({ error: "Pracownik nie został znaleziony." }, 404);
    }
    if (targetResult.error) {
      return json({ error: "Database error" }, 503);
    }
    targetEmployeeId = targetResult.data.id;
  }

  const result = (await supabase
    .from("absences")
    .insert({ employee_id: targetEmployeeId, ...absenceData })
    .select()
    .single()) as { data: Absence | null; error: { code: string; message: string } | null };

  if (result.error) {
    if (result.error.code === "42501") return json({ error: "Forbidden" }, 403);
    if (result.error.code === "23505") {
      return json({ error: "You already have an absence entry for this day." }, 409);
    }
    if (result.error.code === "23514") {
      return json({ error: "Invalid hours/is_full_day combination" }, 400);
    }
    return json({ error: "Database error" }, 500);
  }

  return json(result.data, 201);
};
