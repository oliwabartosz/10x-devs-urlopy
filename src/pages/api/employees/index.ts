import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import type { Employee } from "@/types";

export const GET: APIRoute = async (context) => {
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
    .single()) as { data: { id: string; role: "employee" | "moderator" } | null; error: { code: string } | null };

  if (!callerResult.data) {
    return json({ error: "Employee record not found" }, 403);
  }

  if (callerResult.data.role === "moderator") {
    const adminClient = createAdminClient();
    if (adminClient) {
      const { data, error } = await adminClient
        .from("employees")
        .select("id, first_name, last_name, role, deleted_at, created_at")
        .order("last_name")
        .order("first_name");
      if (error) return json({ error: "Database error" }, 500);
      return json(data, 200);
    }
  }

  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, role, deleted_at, created_at")
    .is("deleted_at", null)
    .order("last_name")
    .order("first_name");
  if (error) return json({ error: "Database error" }, 500);
  return json(data, 200);
};

export const prerender = false;

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const EmployeeCreateSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.email(),
  role: z.enum(["employee", "moderator"]),
  password: z.string().min(8),
});

export const POST: APIRoute = async (context) => {
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = EmployeeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return json({ error: "Admin client is not configured" }, 503);
  }

  const { first_name, last_name, email, role, password } = parsed.data;

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    if (authError.status === 422) {
      return json({ error: "Konto z tym adresem email już istnieje." }, 409);
    }
    return json({ error: "Failed to create auth user" }, 500);
  }

  const { data: employee, error: insertError } = (await adminClient
    .from("employees")
    .insert({ user_id: authData.user.id, first_name, last_name, role })
    .select()
    .single()) as { data: Employee | null; error: { code: string; message: string } | null };

  if (insertError) {
    // compensating delete: prevent orphaned auth user when the DB insert fails
    await adminClient.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
    return json({ error: "Failed to create employee record" }, 500);
  }

  return json(employee, 201);
};
