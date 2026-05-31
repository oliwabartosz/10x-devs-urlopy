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

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const yearParam = context.url.searchParams.get("year");
  const yearParsed = YearSchema.safeParse(yearParam);
  if (!yearParsed.success) {
    return json({ error: "year param required (YYYY)" }, 400);
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

  const year = yearParsed.data;
  const from = `${year}-01-01`;
  const to = `${String(Number(year) + 1)}-01-01`;

  const result = (await supabase
    .from("absences")
    .select("id, employee_id, absence_type_id, date, is_full_day, hours, comment, substitute_employee_id, created_at")
    .gte("date", from)
    .lt("date", to)
    .order("date")) as { data: Absence[] | null; error: { message: string } | null };

  if (result.error) {
    return json({ error: result.error.message }, 500);
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
    if (!targetResult.data) {
      return json({ error: "Pracownik nie został znaleziony." }, 404);
    }
    targetEmployeeId = requestedEmployeeId;
  }

  const result = (await supabase
    .from("absences")
    .insert({ employee_id: targetEmployeeId, ...absenceData })
    .select()
    .single()) as { data: Absence | null; error: { code: string; message: string } | null };

  if (result.error) {
    if (result.error.code === "23505") {
      return json({ error: "Masz już wpis nieobecności na ten dzień." }, 409);
    }
    if (result.error.code === "23514") {
      return json({ error: "Invalid hours/is_full_day combination" }, 400);
    }
    return json({ error: "Database error" }, 500);
  }

  return json(result.data, 201);
};
