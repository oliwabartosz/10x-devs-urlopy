import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Absence, AbsenceUpdate } from "@/types";

const AbsenceUpdateSchema = z
  .object({
    absence_type_id: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    is_full_day: z.boolean(),
    hours: z.number().positive().nullable(),
    comment: z.string().nullable(),
    substitute_employee_id: z.uuid().nullable(),
  })
  .partial();

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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = AbsenceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const result = (await supabase
    .from("absences")
    .update(parsed.data as AbsenceUpdate)
    .eq("id", id)
    .select()
    .single()) as {
    data: Absence | null;
    error: { code: string; message: string } | null;
  };

  if (result.error) {
    if (result.error.code === "42501") return json({ error: "Forbidden" }, 403);
    if (result.error.code === "PGRST116") return json({ error: "Not found" }, 404);
    return json({ error: result.error.message }, 400);
  }

  if (!result.data) {
    return json({ error: "Not found" }, 404);
  }

  return json(result.data, 200);
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const id = context.params.id;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) {
    return json({ error: "Invalid id" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const result = (await supabase.from("absences").delete().eq("id", id).select()) as {
    data: unknown[] | null;
    error: { code: string; message: string } | null;
  };

  if (result.error) {
    if (result.error.code === "42501") return json({ error: "Forbidden" }, 403);
    return json({ error: result.error.message }, 400);
  }

  if (!result.data || result.data.length === 0) {
    return json({ error: "Not found" }, 404);
  }

  return new Response(null, { status: 204 });
};
