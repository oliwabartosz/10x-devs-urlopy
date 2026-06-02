import type { APIRoute } from "astro";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase-admin";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees } from "@/db/index";
import { eq, isNull, and, asc } from "drizzle-orm";

export const GET: APIRoute = async (context) => {
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

  const cols = {
    id: employees.id,
    first_name: employees.first_name,
    last_name: employees.last_name,
    role: employees.role,
    deleted_at: employees.deleted_at,
    created_at: employees.created_at,
  };

  try {
    const rows =
      caller.role === "moderator"
        ? await db.select(cols).from(employees).orderBy(asc(employees.last_name), asc(employees.first_name))
        : await db
            .select(cols)
            .from(employees)
            .where(isNull(employees.deleted_at))
            .orderBy(asc(employees.last_name), asc(employees.first_name));
    return json(rows, 200);
  } catch {
    return json({ error: "Database error" }, 500);
  }
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

  try {
    const [employee] = await db
      .insert(employees)
      .values({ user_id: authData.user.id, first_name, last_name, role })
      .returning();
    return json(employee, 201);
  } catch (err) {
    // compensating delete: prevent orphaned auth user when the DB insert fails
    await adminClient.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
    const e = err as { code?: string; cause?: { code?: string } };
    const code = e.code ?? e.cause?.code;
    if (code === "23505") return json({ error: "Konto z tym adresem email już istnieje." }, 409);
    return json({ error: "Failed to create employee record" }, 500);
  }
};
