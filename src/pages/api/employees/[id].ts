import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Employee } from "@/types";

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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const callerResult = (await supabase
    .from("employees")
    .select("id, role")
    .eq("user_id", context.locals.user.id)
    .is("deleted_at", null)
    .single()) as {
    data: { id: string; role: "employee" | "moderator" } | null;
    error: { code: string; message: string } | null;
  };

  if (callerResult.error?.code === "PGRST116" || !callerResult.data) {
    return json({ error: "Employee record not found" }, 403);
  }
  if (callerResult.error) {
    return json({ error: "Database error" }, 503);
  }
  if (callerResult.data.role !== "moderator") {
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

  // Moderator RLS policy (employees_select_moderator_all) lets us see all employees incl. deleted
  const targetResult = (await supabase.from("employees").select("id, deleted_at").eq("id", idParsed.data).single()) as {
    data: { id: string; deleted_at: string | null } | null;
    error: { code: string; message: string } | null;
  };

  if (targetResult.error?.code === "PGRST116" || !targetResult.data) {
    return json({ error: "Employee not found" }, 404);
  }
  if (targetResult.error) {
    return json({ error: "Database error" }, 503);
  }
  if (targetResult.data.deleted_at !== null) {
    return json({ error: "Cannot update a deactivated employee" }, 409);
  }

  const updateResult = (await supabase
    .from("employees")
    .update(parsed.data)
    .eq("id", idParsed.data)
    .select()
    .single()) as { data: Employee | null; error: { code: string; message: string } | null };

  if (updateResult.error) {
    if (updateResult.error.code === "42501") return json({ error: "Forbidden" }, 403);
    return json({ error: "Database error" }, 500);
  }

  return json(updateResult.data, 200);
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const callerResult = (await supabase
    .from("employees")
    .select("id, role")
    .eq("user_id", context.locals.user.id)
    .is("deleted_at", null)
    .single()) as {
    data: { id: string; role: "employee" | "moderator" } | null;
    error: { code: string; message: string } | null;
  };

  if (callerResult.error?.code === "PGRST116" || !callerResult.data) {
    return json({ error: "Employee record not found" }, 403);
  }
  if (callerResult.error) {
    return json({ error: "Database error" }, 503);
  }
  if (callerResult.data.role !== "moderator") {
    return json({ error: "Forbidden" }, 403);
  }

  const idParsed = UUIDSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return json({ error: "Invalid employee ID" }, 400);
  }

  if (idParsed.data === callerResult.data.id) {
    return json({ error: "Nie możesz usunąć własnego konta." }, 400);
  }

  const targetResult = (await supabase.from("employees").select("id, deleted_at").eq("id", idParsed.data).single()) as {
    data: { id: string; deleted_at: string | null } | null;
    error: { code: string; message: string } | null;
  };

  if (targetResult.error?.code === "PGRST116" || !targetResult.data) {
    return json({ error: "Employee not found" }, 404);
  }
  if (targetResult.error) {
    return json({ error: "Database error" }, 503);
  }
  if (targetResult.data.deleted_at !== null) {
    return json({ error: "Employee is already deactivated" }, 404);
  }

  const updateResult = (await supabase
    .from("employees")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", idParsed.data)
    .select()
    .single()) as { data: unknown; error: { code: string; message: string } | null };

  if (updateResult.error) {
    if (updateResult.error.code === "42501") return json({ error: "Forbidden" }, 403);
    return json({ error: "Database error" }, 500);
  }

  return json({ success: true }, 200);
};
