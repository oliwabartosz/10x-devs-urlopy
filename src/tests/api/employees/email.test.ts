import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { GET, PATCH } from "@/pages/api/employees/[id]/email";

// First route-level coverage for the employee endpoint family, and the first real exercise of
// test-plan.md:49 Risk #4 ("Regular employee reaches moderator-only employee management
// endpoints"). Harness template: korekta-gate.test.ts:32-44 — direct handler import, hand-built
// APIContext.
//
// Un-skipped in Phase 4: the address these assert on is a column on the local `users` row now,
// read and written by `@/lib/auth`, so the suite runs against the same temp SQLite file as its
// ten siblings and needs nothing provisioned remotely.
describe("Employee e-mail sub-resource (route level)", () => {
  let db!: Db;
  let targetId!: string;
  let employeeId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  let deactivatedId!: string;
  let employeeAuthId!: string;
  let moderatorAuthId!: string;

  const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  const makeContext = (authUserId: string | null, id: string, body?: unknown): APIContext =>
    ({
      locals: authUserId ? { user: { id: authUserId } } : {},
      params: { id },
      request: new Request(`http://test.invalid/api/employees/${id}/email`, {
        method: body === undefined ? "GET" : "PATCH",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      }),
      url: new URL(`http://test.invalid/api/employees/${id}/email`),
    }) as unknown as APIContext;

  const get = (authUserId: string | null, id: string) => GET(makeContext(authUserId, id));
  const patch = (authUserId: string | null, id: string, body: unknown) => PATCH(makeContext(authUserId, id, body));

  const readEmail = async (id: string): Promise<string> => {
    const res = await get(moderatorAuthId, id);
    const data = (await res.json()) as { email: string };
    return data.email;
  };

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

  it("an unauthenticated caller gets 401 on both verbs", async () => {
    expect((await get(null, targetId)).status).toBe(401);
    expect((await patch(null, targetId, { email: "x@test.invalid" })).status).toBe(401);
  });

  // test-plan.md:49 Risk #4.
  it("a regular employee gets 403 on both verbs", async () => {
    const getRes = await get(employeeAuthId, targetId);
    expect(getRes.status).toBe(403);
    expect(await getRes.json()).toEqual({ error: "Forbidden" });

    const patchRes = await patch(employeeAuthId, targetId, { email: `nope-${crypto.randomUUID()}@test.invalid` });
    expect(patchRes.status).toBe(403);
    expect(await patchRes.json()).toEqual({ error: "Forbidden" });
  });

  it("a moderator reads the target's real address", async () => {
    const res = await get(moderatorAuthId, targetId);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { email: string };
    expect(data.email).toMatch(/^test-.*@test\.invalid$/);
    // The auth user object and user_id must never leave the route.
    expect(Object.keys(data)).toEqual(["email"]);
  });

  it("a moderator changes the address, verified by reading it back", async () => {
    const next = `changed-${crypto.randomUUID()}@test.invalid`;
    const res = await patch(moderatorAuthId, targetId, { email: next });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: next });
    expect(await readEmail(targetId)).toBe(next);
  });

  it("a malformed address is 400", async () => {
    const res = await patch(moderatorAuthId, targetId, { email: "not-an-address" });
    expect(res.status).toBe(400);
  });

  it("an address already in use is 409 with the Polish message", async () => {
    const taken = await readEmail(employeeId);
    const before = await readEmail(targetId);

    const res = await patch(moderatorAuthId, targetId, { email: taken });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Konto z tym adresem email już istnieje." });

    expect(await readEmail(targetId)).toBe(before); // original survives
  });

  it("the technical admin is rejected on both verbs", async () => {
    const getRes = await get(moderatorAuthId, systemEmployeeId);
    expect(getRes.status).toBe(403);
    expect(await getRes.json()).toEqual({ error: "Nie można modyfikować tego konta." });

    const patchRes = await patch(moderatorAuthId, systemEmployeeId, {
      email: `sys-${crypto.randomUUID()}@test.invalid`,
    });
    expect(patchRes.status).toBe(403);
  });

  // GET must still read a deactivated worker's address; only the write refuses.
  it("a deactivated target is readable but not writable", async () => {
    expect((await get(moderatorAuthId, deactivatedId)).status).toBe(200);

    const res = await patch(moderatorAuthId, deactivatedId, { email: `del-${crypto.randomUUID()}@test.invalid` });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot update a deactivated employee" });
  });

  it("a non-existent uuid is 404 on both verbs", async () => {
    expect((await get(moderatorAuthId, MISSING_UUID)).status).toBe(404);
    expect((await patch(moderatorAuthId, MISSING_UUID, { email: "a@test.invalid" })).status).toBe(404);
  });

  it("a non-uuid id is 400 on both verbs", async () => {
    expect((await get(moderatorAuthId, "not-a-uuid")).status).toBe(400);
    expect((await patch(moderatorAuthId, "not-a-uuid", { email: "a@test.invalid" })).status).toBe(400);
  });
});
