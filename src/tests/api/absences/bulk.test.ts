import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { POST } from "@/pages/api/absences/bulk";
import type { AbsenceBulkCreateResult } from "@/types";

// Route-level coverage for POST /api/absences/bulk, which shipped with none.
//
// The only automated exercise this route had was tests/e2e/absence-grid-range.spec.ts, which can
// send exactly the bodies the drag gesture is capable of producing — so it covers the happy path
// and structurally cannot reach a single rejection path. Every case below sends a body the UI
// cannot: a weekend, a duplicate, an over-cap list, a nonexistent calendar day, someone else's
// employee_id. That is the class of request the route exists to refuse (its header comment:
// the service-role connection bypasses RLS, so nothing else backstops a hand-crafted body).
//
// Harness template: partial-day-guard.test.ts — direct handler import, hand-built APIContext,
// describe.skipIf on DATABASE_URL_DIRECT. Caller-varying makeContext from korekta-gate.test.ts:32,
// nullable-locals for the 401 case from employees/email.test.ts:32.
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Absence bulk create (route level)", () => {
  let db!: Db;
  let employeeId!: string;
  let colleagueId!: string;
  let moderatorId!: string;
  let employeeAuthId!: string;
  let moderatorAuthId!: string;
  let vacationTypeId!: number;

  // May 2026, unclaimed by any other suite (existing ones hold Jan–Apr). Each test gets its own
  // weekday run: `absences` carries UNIQUE (employee_id, date), so a shared date would make one
  // test's leftover row the next test's failure.
  const WEEKEND_RUN = ["2026-05-01", "2026-05-02", "2026-05-04"]; // Fri, Sat, Mon
  const PARTIAL_DAY_RUN = ["2026-05-05", "2026-05-06"];
  const DUPLICATE_RUN = ["2026-05-07", "2026-05-07"];
  const EMPLOYEE_GATE_RUN = ["2026-05-08"];
  const MODERATOR_RUN = ["2026-05-14"];
  const REPORTING_RUN = ["2026-05-11", "2026-05-12", "2026-05-13"];

  const SUITE_DATES = [
    ...new Set([
      ...WEEKEND_RUN,
      ...PARTIAL_DAY_RUN,
      ...DUPLICATE_RUN,
      ...EMPLOYEE_GATE_RUN,
      ...MODERATOR_RUN,
      ...REPORTING_RUN,
    ]),
  ];

  // One past the route's cap. `MAX_BULK_DATES` was made module-private in 1a2451b, so the boundary
  // is asserted with a literal count rather than an import — this test drifts if the cap moves,
  // which is the intended trade: a test that imports the constant proves only that zod was called.
  const OVER_CAP_RUN = [
    ...Array.from({ length: 31 }, (_, i) => `2026-07-${(i + 1).toString().padStart(2, "0")}`),
    "2026-08-03",
  ];

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  // Narrow stand-in for the APIContext fields this handler reads: `locals.user` and `request`.
  // A null authUserId produces the unauthenticated shape the 401 case needs.
  const makeContext = (authUserId: string | null, body: unknown): APIContext =>
    ({
      locals: authUserId ? { user: { id: authUserId } } : {},
      params: {},
      request: new Request("http://test.invalid/api/absences/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL("http://test.invalid/api/absences/bulk"),
    }) as unknown as APIContext;

  const post = (authUserId: string | null, body: unknown) => POST(makeContext(authUserId, body));

  const bulkBody = (overrides: Record<string, unknown> = {}) => ({
    dates: EMPLOYEE_GATE_RUN,
    absence_type_id: vacationTypeId,
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    substitute_employee_id: null,
    ...overrides,
  });

  // Scoped to the test's own dates, never to employee_id alone: a bare employee filter reports a
  // leftover row from an earlier test as if this call had written it (hours-clamp.test.ts:116-118).
  const storedFor = (targetId: string, dates: string[]) =>
    db
      .select({ date: absences.date, absence_type_id: absences.absence_type_id, comment: absences.comment })
      .from(absences)
      .where(and(eq(absences.employee_id, targetId), inArray(absences.date, dates)))
      .orderBy(asc(absences.date));

  beforeAll(async () => {
    db = getTestDb();
    employeeId = await createTestEmployee(db);
    colleagueId = await createTestEmployee(db);
    moderatorId = await createTestEmployee(db);
    await db.update(employees).set({ role: "moderator" }).where(eq(employees.id, moderatorId));
    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);

    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    expect(rows, 'absence_types row for "urlop" — drifted from the seed migration?').toHaveLength(1);
    vacationTypeId = rows[0].id;
  });

  // The one absence suite where an afterEach earns its place: a bulk call writes N rows, so a
  // failed assertion mid-test leaves a whole run behind rather than a single row.
  afterEach(async () => {
    await db
      .delete(absences)
      .where(
        and(inArray(absences.employee_id, [employeeId, colleagueId, moderatorId]), inArray(absences.date, SUITE_DATES)),
      );
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, colleagueId);
    await teardownTestEmployee(db, moderatorId);
    await db.$client.end();
  });

  it("rejects a body containing a weekend, naming the day, and writes none of the run", async () => {
    const res = await post(employeeAuthId, bulkBody({ dates: WEEKEND_RUN }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("2026-05-02");

    // The whole request fails, not just the offending day: the weekdays beside it stay unwritten.
    const rows = await storedFor(employeeId, WEEKEND_RUN);
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  it("rejects a non-training type with is_full_day: false", async () => {
    const res = await post(
      employeeAuthId,
      bulkBody({ dates: PARTIAL_DAY_RUN, is_full_day: false, start_time: "09:00", end_time: "11:00" }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Godziny są dostępne tylko dla typów");

    const rows = await storedFor(employeeId, PARTIAL_DAY_RUN);
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  // Caught by the schema refine, so it never reaches the upsert — where a repeated conflict target
  // would surface as PG 21000 ("cannot affect row a second time"), i.e. a 500 rather than a 400.
  it("rejects duplicate dates at the schema, not at Postgres", async () => {
    const res = await post(employeeAuthId, bulkBody({ dates: DUPLICATE_RUN }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Lista dni zawiera duplikaty.");

    const rows = await storedFor(employeeId, DUPLICATE_RUN);
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  it("rejects a date list one past the cap", async () => {
    const res = await post(employeeAuthId, bulkBody({ dates: OVER_CAP_RUN }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("31");

    const rows = await storedFor(employeeId, OVER_CAP_RUN);
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  // The reason bulk.ts validates dates with DateSchema rather than the create route's bare regex:
  // 2026-02-31 passes `\d{4}-\d{2}-\d{2}` and is rejected only by Postgres, as a 500-shaped failure
  // partway through a list instead of a 400 naming the bad date.
  it("rejects an invalid calendar date with 400, not a Postgres 500", async () => {
    const res = await post(employeeAuthId, bulkBody({ dates: ["2026-02-31"] }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid calendar date");
  });

  // The privilege-escalation gate. A regular employee's employee_id is silently ignored rather than
  // rejected — the deliberate existing contract — so the proof is where the rows landed.
  it("ignores a regular employee's employee_id and writes their own column", async () => {
    const res = await post(employeeAuthId, bulkBody({ dates: EMPLOYEE_GATE_RUN, employee_id: colleagueId }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as AbsenceBulkCreateResult;
    expect(body.absences).toHaveLength(EMPLOYEE_GATE_RUN.length);
    expect(
      body.absences.every((row) => row.employee_id === employeeId),
      "a non-moderator's employee_id must not retarget the write",
    ).toBe(true);

    expect(await storedFor(colleagueId, EMPLOYEE_GATE_RUN), "the colleague's column must stay empty").toHaveLength(0);
    expect(await storedFor(employeeId, EMPLOYEE_GATE_RUN)).toHaveLength(EMPLOYEE_GATE_RUN.length);
  });

  // Control for the case above: the branch itself works, so the employee case proves the role gate
  // rather than a broken retarget path.
  it("honours a moderator's employee_id and writes the colleague's column", async () => {
    const res = await post(moderatorAuthId, bulkBody({ dates: MODERATOR_RUN, employee_id: colleagueId }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as AbsenceBulkCreateResult;
    expect(body.absences.every((row) => row.employee_id === colleagueId)).toBe(true);

    expect(await storedFor(colleagueId, MODERATOR_RUN)).toHaveLength(MODERATOR_RUN.length);
    expect(await storedFor(moderatorId, MODERATOR_RUN), "the moderator's own column must stay empty").toHaveLength(0);
  });

  // bulk.ts:191-198 documents the report as computed from a read taken *before* the upsert, which
  // makes it independently falsifiable from the write — so both are asserted, not just the body.
  it("reports created_dates on a free range and overwritten_dates on the rewrite", async () => {
    const first = await post(employeeAuthId, bulkBody({ dates: REPORTING_RUN, comment: "Pierwsza tura" }));

    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as AbsenceBulkCreateResult;
    expect(firstBody.created_dates).toEqual(REPORTING_RUN);
    expect(firstBody.overwritten_dates).toEqual([]);

    const second = await post(employeeAuthId, bulkBody({ dates: REPORTING_RUN, comment: "Druga tura" }));

    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as AbsenceBulkCreateResult;
    expect(secondBody.created_dates).toEqual([]);
    expect(secondBody.overwritten_dates).toEqual(REPORTING_RUN);

    const rows = await storedFor(employeeId, REPORTING_RUN);
    expect(rows.map((r) => r.date)).toEqual(REPORTING_RUN);
    expect(
      rows.every((r) => r.comment === "Druga tura"),
      "the overwrite must have replaced the stored rows, not merely reported doing so",
    ).toBe(true);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post(null, bulkBody({ dates: REPORTING_RUN }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Brak autoryzacji." });
  });
});
