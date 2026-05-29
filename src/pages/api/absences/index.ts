import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Absence } from "@/types";

const AbsenceCreateSchema = z.object({
  absence_type_id: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_full_day: z.boolean(),
  hours: z.number().positive().nullable(),
  comment: z.string().nullable(),
  substitute_employee_id: z.uuid().nullable(),
});

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
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
    .select("id")
    .eq("user_id", context.locals.user.id)
    .is("deleted_at", null)
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (!employeeResult.data) {
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

  const result = (await supabase
    .from("absences")
    .insert({ employee_id: employeeResult.data.id, ...parsed.data })
    .select()
    .single()) as { data: Absence | null; error: { code: string; message: string } | null };

  if (result.error) {
    return json({ error: result.error.message }, 400);
  }

  return json(result.data, 201);
};
