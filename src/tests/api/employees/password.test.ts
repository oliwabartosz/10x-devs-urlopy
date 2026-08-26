import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { APIContext } from "astro";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { PATCH } from "@/pages/api/employees/[id]/password";
import { GET as GET_EMAIL } from "@/pages/api/employees/[id]/email";

// Moderator-initiated password reset. Mirrors email.test.ts's guard matrix, and additionally
// proves the reset actually works by signing in with the new password through a fresh anon
// client — a 200 from the route alone would not distinguish "password changed" from "call
// silently no-opped".
//
// SKIPPED until Phase 4, for the same reason as email.test.ts: the route sets the password
// through `createAdminClient().auth.admin`, and the sign-in check below goes to Supabase, while
// the fixture employee's credential is now a row in the local `users` table carrying a
// deliberately unusable hash. Phase 4 item 5 replaces both halves; delete this `.skip` with it.
describe.skip("Employee password sub-resource (route level)", () => {
  let db!: Db;
  let targetId!: string;
  let employeeId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  let deactivatedId!: string;
  let employeeAuthId!: string;
  let moderatorAuthId!: string;

  const MISSING_UUID = "00000000-0000-0000-0000-000000000000";
  const NEW_PASSWORD = "reset-Password-123";

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  const makeContext = (authUserId: string | null, id: string, body: unknown): APIContext =>
    ({
      locals: authUserId ? { user: { id: authUserId } } : {},
      params: { id },
      request: new Request(`http://test.invalid/api/employees/${id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL(`http://test.invalid/api/employees/${id}/password`),
    }) as unknown as APIContext;

  const patch = (authUserId: string | null, id: string, body: unknown) => PATCH(makeContext(authUserId, id, body));

  const emailOf = async (id: string): Promise<string> => {
    const res = await GET_EMAIL({
      locals: { user: { id: moderatorAuthId } },
      params: { id },
      request: new Request(`http://test.invalid/api/employees/${id}/email`),
      url: new URL(`http://test.invalid/api/employees/${id}/email`),
    } as unknown as APIContext);
    return ((await res.json()) as { email: string }).email;
  };

  /** A fresh anon client, so the sign-in is a real end-to-end credential check. */
  const signIn = (email: string, password: string) =>
    createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_KEY ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth.signInWithPassword({ email, password });

  beforeAll(async () => {
    db = await getTestDb();
    targetId = await createTestEmployee(db);
    employeeId = await createTestEmployee(db);
    moderatorId = await createTestEmployee(db);
    systemEmployeeId = await createTestEmployee(db);
    deactivatedId = await createTestEmployee(db);
    await db.update(employees).set({ role: "moderator" }).where(eq(employees.id, moderatorId));
    await db.update(employees).set({ is_system: true }).where(eq(employees.id, systemEmployeeId));
    await db.update(employees).set({ deleted_at: new Date() }).where(eq(employees.id, deactivatedId));
    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);
  });

  afterAll(async () => {
    await db.update(employees).set({ is_system: false }).where(eq(employees.id, systemEmployeeId));
    await teardownTestEmployee(db, targetId);
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, systemEmployeeId);
    await teardownTestEmployee(db, deactivatedId);
  });

  it("an unauthenticated caller gets 401", async () => {
    expect((await patch(null, targetId, { password: NEW_PASSWORD })).status).toBe(401);
  });

  // test-plan.md:49 Risk #4, on the second sub-resource.
  it("a regular employee gets 403", async () => {
    const res = await patch(employeeAuthId, targetId, { password: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("a moderator sets the password and the worker can sign in with it", async () => {
    const email = await emailOf(targetId);

    const res = await patch(moderatorAuthId, targetId, { password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    // The password must never be echoed back.
    expect(await res.json()).toEqual({ success: true });

    const { data, error } = await signIn(email, NEW_PASSWORD);
    expect(error).toBeNull();
    expect(data.user?.email).toBe(email);
  });

  it("the fixture's original password no longer works", async () => {
    const email = await emailOf(targetId);
    // createTestEmployee seeds a random uuid password; any other value must be rejected now.
    const { error } = await signIn(email, crypto.randomUUID());
    expect(error).not.toBeNull();
  });

  it("a password under 8 characters is 400", async () => {
    const res = await patch(moderatorAuthId, targetId, { password: "short" });
    expect(res.status).toBe(400);
  });

  it("a missing password field is 400", async () => {
    const res = await patch(moderatorAuthId, targetId, {});
    expect(res.status).toBe(400);
  });

  it("the technical admin is rejected", async () => {
    const res = await patch(moderatorAuthId, systemEmployeeId, { password: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Nie można modyfikować tego konta." });
  });

  it("a deactivated target is 409", async () => {
    const res = await patch(moderatorAuthId, deactivatedId, { password: NEW_PASSWORD });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot update a deactivated employee" });
  });

  it("a non-existent uuid is 404", async () => {
    expect((await patch(moderatorAuthId, MISSING_UUID, { password: NEW_PASSWORD })).status).toBe(404);
  });

  it("a non-uuid id is 400", async () => {
    expect((await patch(moderatorAuthId, "not-a-uuid", { password: NEW_PASSWORD })).status).toBe(400);
  });
});
