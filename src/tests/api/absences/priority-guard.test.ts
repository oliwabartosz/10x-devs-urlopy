import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import type { APIContext } from "astro";
import { and, eq, inArray } from "drizzle-orm";
import { isPriorityViolation } from "@/lib/services/absence-priority";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { LEAVE_TYPE_NAME, PLANNED_LEAVE_TYPE_NAME } from "@/lib/absence-types";
import { POST } from "@/pages/api/absences/index";
import { PATCH } from "@/pages/api/absences/[id]";
import { POST as BULK } from "@/pages/api/absences/bulk";
import { GET } from "@/pages/api/absences/index";

// The guard service is wrapped (not replaced) so it behaves exactly as normal by default;
// the TOCTOU test below overrides it for a single call to inject a competing write at the
// precise point the handler invokes it. Mirrors partial-day-guard.test.ts:16-21.
vi.mock("@/lib/services/absence-priority", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/absence-priority")>();
  return { isPriorityViolation: vi.fn(actual.isPriorityViolation) };
});

const guardHook = vi.mocked(isPriorityViolation);

// Handler-level (route) coverage for the FR-008 priority-type restriction.
//
// `crud.test.ts` exercises the `isPriorityViolation` service directly; these tests invoke the
// exported route handlers and assert the HTTP contract (status + body), so a route that stops
// *calling* the guard fails here even though the service keeps working. That split is why
// `partial-day-guard.test.ts` exists as its own file, and this is its twin.
describe("Absence priority guard — route level", () => {
  let db!: Db;
  let testEmployeeId!: string;
  let authUserId!: string;
  let leaveTypeId!: number;
  let plannedLeaveTypeId!: number;
  let ineligibleTypeId!: number;

  // September 2026, unclaimed by any other suite. Weekdays only — `bulk.ts` refuses weekends.
  const BULK_RUN = ["2026-09-01", "2026-09-02"];

  // Ids by name, never hard-coded: a seed rename must fail loudly here rather than silently
  // disable a name-keyed rule (partial-day-guard.test.ts:36-40 is the idiom).
  const typeIdByName = async (name: string): Promise<number> => {
    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, name));
    expect(rows, `absence_types row for "${name}" — constant drifted from the seed catalogue?`).toHaveLength(1);
    return rows[0].id;
  };

  // Minimal stand-in for the APIContext fields these handlers read: `locals.user` (auth),
  // `request` (body), `params.id` for PATCH and `url` for GET.
  const makeContext = (method: string, path: string, body: unknown, params: Record<string, string> = {}): APIContext =>
    ({
      locals: { user: { id: authUserId } },
      params,
      request: new Request(`http://test.invalid${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      url: new URL(`http://test.invalid${path}`),
    }) as unknown as APIContext;

  const postRequest = (body: unknown) => POST(makeContext("POST", "/api/absences", body));
  const patchRequest = (id: string, body: unknown) => PATCH(makeContext("PATCH", `/api/absences/${id}`, body, { id }));
  const bulkRequest = (body: unknown) => BULK(makeContext("POST", "/api/absences/bulk", body));

  beforeAll(async () => {
    db = await getTestDb();
    testEmployeeId = await createTestEmployee(db);
    authUserId = (
      await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, testEmployeeId))
    )[0].user_id;

    leaveTypeId = await typeIdByName(LEAVE_TYPE_NAME);
    plannedLeaveTypeId = await typeIdByName(PLANNED_LEAVE_TYPE_NAME);
    ineligibleTypeId = await typeIdByName("choroba");
  });

  // A bulk call writes N rows, so a failed assertion mid-test leaves a whole run behind
  // (bulk.test.ts carries the same afterEach for the same reason).
  afterEach(async () => {
    await db.delete(absences).where(and(eq(absences.employee_id, testEmployeeId), inArray(absences.date, BULK_RUN)));
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
  });

  const baseBody = (overrides: Record<string, unknown>) => ({
    date: "2026-09-07",
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    is_priority: false,
    substitute_employee_id: null,
    ...overrides,
  });

  const storedPriority = async (id: string): Promise<boolean> =>
    (await db.select({ is_priority: absences.is_priority }).from(absences).where(eq(absences.id, id)))[0].is_priority;

  // --- POST ------------------------------------------------------------------------------

  it("POST rejects an ineligible type + priority with 400 and the Polish message naming both types", async () => {
    const res = await postRequest(baseBody({ absence_type_id: ineligibleTypeId, is_priority: true }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Priorytet jest dostępny tylko dla typów");
    expect(body.error).toContain(LEAVE_TYPE_NAME);
    expect(body.error).toContain(PLANNED_LEAVE_TYPE_NAME);

    const rows = await db.select().from(absences).where(eq(absences.employee_id, testEmployeeId));
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  it("POST accepts urlop + priority and stores the flag", async () => {
    const res = await postRequest(baseBody({ absence_type_id: leaveTypeId, date: "2026-09-08", is_priority: true }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; is_priority: boolean };
    expect(body.is_priority, "the flag must round-trip through `.returning()`").toBe(true);
    expect(await storedPriority(body.id)).toBe(true);

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("POST accepts urlop planowany + priority", async () => {
    const res = await postRequest(
      baseBody({ absence_type_id: plannedLeaveTypeId, date: "2026-09-09", is_priority: true }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; is_priority: boolean };
    expect(body.is_priority).toBe(true);

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("POST accepts an ineligible type when unflagged (the unchanged path)", async () => {
    const res = await postRequest(baseBody({ absence_type_id: ineligibleTypeId, date: "2026-09-10" }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; is_priority: boolean };
    expect(body.is_priority).toBe(false);

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("POST defaults is_priority to false when the body omits it", async () => {
    const body = baseBody({ absence_type_id: ineligibleTypeId, date: "2026-09-11" }) as Record<string, unknown>;
    delete body.is_priority;

    const res = await postRequest(body);

    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; is_priority: boolean };
    expect(created.is_priority).toBe(false);

    await db.delete(absences).where(eq(absences.id, created.id));
  });

  // Guard ordering: `assertAbsenceTypeExists` (422) must run before this guard (400). An unknown
  // id resolves to an undefined name, which the guard's own fallback would report as a rule
  // violation — the wrong problem with the wrong status.
  it("POST answers 422, not 400, for an unknown absence_type_id carrying the flag", async () => {
    const res = await postRequest(baseBody({ absence_type_id: 999_999, date: "2026-09-14", is_priority: true }));

    expect(res.status).toBe(422);
  });

  // --- PATCH -----------------------------------------------------------------------------

  it("PATCH rejects a body carrying ONLY an ineligible type on a flagged row", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: leaveTypeId,
        date: "2026-09-15",
        is_full_day: true,
        is_priority: true,
      })
      .returning({ id: absences.id });

    // The decided semantics: rejected, not silently cleared. The body omits `is_priority`
    // entirely, so the guard must resolve it from the existing row.
    const res = await patchRequest(row.id, { absence_type_id: ineligibleTypeId });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Priorytet jest dostępny tylko dla typów");

    const [after] = await db
      .select({ absence_type_id: absences.absence_type_id, is_priority: absences.is_priority })
      .from(absences)
      .where(eq(absences.id, row.id));
    expect(after.absence_type_id, "rejected PATCH must not have applied the type change").toBe(leaveTypeId);
    expect(after.is_priority, "rejected PATCH must not have cleared the flag either").toBe(true);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("PATCH rejects flagging a row whose stored type is ineligible", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: ineligibleTypeId,
        date: "2026-09-16",
        is_full_day: true,
      })
      .returning({ id: absences.id });

    // Body omits `absence_type_id` — the guard must resolve the type from the existing row.
    const res = await patchRequest(row.id, { is_priority: true });

    expect(res.status).toBe(400);
    expect(await storedPriority(row.id)).toBe(false);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("PATCH allows moving a flagged row between the two eligible types", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: leaveTypeId,
        date: "2026-09-17",
        is_full_day: true,
        is_priority: true,
      })
      .returning({ id: absences.id });

    const res = await patchRequest(row.id, { absence_type_id: plannedLeaveTypeId });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { absence_type_id: number; is_priority: boolean };
    expect(body.absence_type_id).toBe(plannedLeaveTypeId);
    expect(body.is_priority).toBe(true);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("PATCH allows clearing the flag while switching to an ineligible type in one body", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: leaveTypeId,
        date: "2026-09-18",
        is_full_day: true,
        is_priority: true,
      })
      .returning({ id: absences.id });

    const res = await patchRequest(row.id, { absence_type_id: ineligibleTypeId, is_priority: false });

    expect(res.status).toBe(200);
    expect(await storedPriority(row.id)).toBe(false);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  // Regression for the TOCTOU between the guard's read and the UPDATE, on the `is_priority` CAS
  // pin specifically. The body supplies the type (so that pin is absent) and omits the flag, so
  // the *only* thing standing between a concurrent flagging and an ineligible-but-flagged stored
  // row is `omitted.is_priority ? eq(absences.is_priority, existing.is_priority)`.
  //
  // The interleaving is made deterministic by hooking `isPriorityViolation`, which the handler
  // calls after reading the existing row and before issuing the UPDATE — exactly the window a
  // concurrent PATCH would commit in.
  it("PATCH refuses to write on stale premises when the flag is set underneath it", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: leaveTypeId,
        date: "2026-09-21",
        is_full_day: true,
        is_priority: false,
      })
      .returning({ id: absences.id });

    guardHook.mockImplementationOnce(async () => {
      await db.update(absences).set({ is_priority: true }).where(eq(absences.id, row.id));
      return false; // "allowed" — judged against the pre-write state the handler read
    });

    const res = await patchRequest(row.id, { absence_type_id: ineligibleTypeId });

    // 409: the UPDATE's compare-and-swap detected the row moved and refused to apply.
    expect(res.status).toBe(409);

    const [after] = await db
      .select({ absence_type_id: absences.absence_type_id, is_priority: absences.is_priority })
      .from(absences)
      .where(eq(absences.id, row.id));
    expect(after.is_priority).toBe(true);
    expect(after.absence_type_id, "a flagged row must never end up on an ineligible type").toBe(leaveTypeId);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  // --- bulk ------------------------------------------------------------------------------

  const bulkBody = (overrides: Record<string, unknown> = {}) => ({
    dates: BULK_RUN,
    absence_type_id: leaveTypeId,
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    is_priority: false,
    substitute_employee_id: null,
    ...overrides,
  });

  it("bulk rejects an ineligible type + priority and writes none of the run", async () => {
    const res = await bulkRequest(bulkBody({ absence_type_id: ineligibleTypeId, is_priority: true }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Priorytet jest dostępny tylko dla typów");

    const rows = await db
      .select({ id: absences.id })
      .from(absences)
      .where(and(eq(absences.employee_id, testEmployeeId), inArray(absences.date, BULK_RUN)));
    expect(rows, "rejected bulk POST must not have inserted a row").toHaveLength(0);
  });

  it("bulk accepts urlop + priority and flags every day of the run", async () => {
    const res = await bulkRequest(bulkBody({ is_priority: true }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { absences: { is_priority: boolean }[] };
    expect(body.absences).toHaveLength(BULK_RUN.length);
    expect(
      body.absences.every((r) => r.is_priority),
      "every row of the run carries the shared flag",
    ).toBe(true);
  });

  // --- read-back -------------------------------------------------------------------------

  it("GET /api/absences returns is_priority on every row", async () => {
    const created = await postRequest(
      baseBody({ absence_type_id: leaveTypeId, date: "2026-09-22", is_priority: true }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await GET(makeContext("GET", "/api/absences?year=2026", undefined));

    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; is_priority: boolean }[];
    expect(
      rows.every((r) => typeof r.is_priority === "boolean"),
      "`absenceListColumns` must carry the column",
    ).toBe(true);
    expect(rows.find((r) => r.id === id)?.is_priority).toBe(true);

    await db.delete(absences).where(eq(absences.id, id));
  });
});
