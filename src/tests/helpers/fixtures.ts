import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, absences } from "@/db/schema";

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for integration tests");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function createTestEmployee(db: Db): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: `test-${crypto.randomUUID()}@test.invalid`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error ?? !data.user) throw new Error(`Failed to create test auth user: ${error?.message}`);

  try {
    const [row] = await db
      .insert(employees)
      .values({
        user_id: data.user.id,
        role: "employee",
        first_name: "Test",
        last_name: "Employee",
      })
      .returning({ id: employees.id });
    return row.id;
  } catch (err) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw err;
  }
}

export async function teardownTestEmployee(db: Db | undefined, employeeId: string | undefined): Promise<void> {
  if (!db || !employeeId) return;
  const rows = await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, employeeId));
  const authUserId = rows[0]?.user_id;
  await db.delete(absences).where(eq(absences.employee_id, employeeId));
  await db.delete(employees).where(eq(employees.id, employeeId));
  if (authUserId) {
    const admin = getAdminClient();
    await admin.auth.admin.deleteUser(authUserId);
  }
}
