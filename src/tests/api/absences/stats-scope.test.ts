import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { APIContext } from "astro";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import type { Absence } from "@/types";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, createTestModerator, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { GET } from "@/pages/api/absences/stats";

// The access boundary on `GET /api/absences/stats` — the only thing in this change that is a
// boundary rather than a presentation. `GET /api/absences` stays team-wide by design (the grid
// and Szczegóły need it), so the scoping has to be proven here, on the route the Statystyki tab
// actually reads.
//
// RLS is bypassed on the service-role Drizzle connection (src/lib/employees.ts:4-12), so both the
// role scoping and the `is_system` exclusion are app-enforced only. Nothing below asserts against
// the join fragment; every case goes through the handler.
describe("GET /api/absences/stats — role scoping", () => {
  // The route's window is a whole calendar year, so "the moderator sees both rows" would otherwise
  // depend on whatever else happens to be seeded. 2027 is untouched by every other suite under
  // src/tests/ (checked) — but NOT by the repo as a whole: tests/e2e/absence-grid-range.spec.ts
  // reserves 2027-03 and sweeps 2027-03-01…2027-03-31 on teardown. No collision today, because
  // that sweep filters to its own employeeId and fixtureRows() below filters to ours. Pick a
  // different month if you add dates here, and re-grep tests/e2e/ before claiming a year is free.
  const YEAR = "2027";
  const DATES = {
    employee: "2027-03-02",
    moderator: "2027-03-03",
    system: "2027-03-04",
    systemEmployee: "2027-03-05",
  };
  const SUITE_DATES = Object.values(DATES);

  let db!: Db;
  let employeeId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  // A second `is_system` fixture left at `role: "employee"`, so it takes the non-moderator arm of
  // `absenceEmployeeJoin`. Without it, `visibleEmployeesFilter()` on that arm is untested: the
  // own-scope `eq(employee_id, callerId)` already hides every *other* system row, so the filter
  // could be deleted from absence-list.ts and no assertion in this repo would notice.
  let systemAsEmployeeId!: string;
  let employeeAuthId!: string;
  let moderatorAuthId!: string;
  let systemAsEmployeeAuthId!: string;
  let vacationTypeId!: number;

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  const makeContext = (authUserId: string | null, query: string): APIContext => {
    const url = new URL(`http://test.invalid/api/absences/stats${query}`);
    return {
      locals: authUserId === null ? {} : { user: { id: authUserId } },
      params: {},
      request: new Request(url, { method: "GET" }),
      url,
    } as unknown as APIContext;
  };

  /** Only this suite's fixtures — the year is isolated, but the assertions stay explicit. */
  const fixtureRows = (rows: Absence[]) =>
    rows.filter((r) => [employeeId, moderatorId, systemEmployeeId, systemAsEmployeeId].includes(r.employee_id));

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    moderatorId = await createTestModerator(db);
    systemEmployeeId = await createTestEmployee(db);
    systemAsEmployeeId = await createTestEmployee(db);
    // `role: moderator` as well as the flag, mirroring how the real admin is seeded (AGENTS.md:55).
    await db.update(employees).set({ role: "moderator", is_system: true }).where(eq(employees.id, systemEmployeeId));
    // Flag only — role stays "employee", which is the whole point of this fixture.
    await db.update(employees).set({ is_system: true }).where(eq(employees.id, systemAsEmployeeId));
    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);
    systemAsEmployeeAuthId = await authIdOf(systemAsEmployeeId);

    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    expect(rows, 'absence_types row for "urlop" — drifted from the seed migration?').toHaveLength(1);
    vacationTypeId = rows[0].id;

    await db.insert(absences).values([
      { employee_id: employeeId, absence_type_id: vacationTypeId, date: DATES.employee, is_full_day: true },
      { employee_id: moderatorId, absence_type_id: vacationTypeId, date: DATES.moderator, is_full_day: true },
      { employee_id: systemEmployeeId, absence_type_id: vacationTypeId, date: DATES.system, is_full_day: true },
      {
        employee_id: systemAsEmployeeId,
        absence_type_id: vacationTypeId,
        date: DATES.systemEmployee,
        is_full_day: true,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(absences)
      .where(
        and(
          inArray(absences.employee_id, [employeeId, moderatorId, systemEmployeeId, systemAsEmployeeId]),
          inArray(absences.date, SUITE_DATES),
        ),
      );
    // Undo the fixture flag before teardown — an orphaned row left with it set reads as a second
    // technical admin (rationale: holiday-balances/delete.test.ts:63-64).
    await db
      .update(employees)
      .set({ is_system: false })
      .where(inArray(employees.id, [systemEmployeeId, systemAsEmployeeId]));
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, systemEmployeeId);
    await teardownTestEmployee(db, systemAsEmployeeId);
  });

  it("gives a moderator every visible employee's rows", async () => {
    const res = await GET(makeContext(moderatorAuthId, `?year=${YEAR}`));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Result-Truncated")).toBe("0");
    const ids = fixtureRows((await res.json()) as Absence[]).map((r) => r.employee_id);
    expect(ids).toContain(employeeId);
    expect(ids).toContain(moderatorId);
  });

  it("gives a non-moderator only their own rows", async () => {
    const res = await GET(makeContext(employeeAuthId, `?year=${YEAR}`));

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Absence[];
    expect(
      rows.every((r) => r.employee_id === employeeId),
      "a non-moderator must never see another column",
    ).toBe(true);
    expect(rows.map((r) => r.date)).toContain(DATES.employee);
  });

  // The scope comes from the caller's own row, so no request parameter can reach the decision.
  // If this ever starts honouring `employee_id`, the boundary is gone.
  it("ignores an employee_id parameter a non-moderator adds to widen scope", async () => {
    const res = await GET(makeContext(employeeAuthId, `?year=${YEAR}&employee_id=${moderatorId}`));

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Absence[];
    expect(rows.every((r) => r.employee_id === employeeId)).toBe(true);
    // `[].every()` is true, so without this the case would also pass if the parameter broke the
    // query outright and returned nothing.
    expect(rows.map((r) => r.date)).toContain(DATES.employee);
  });

  // A moderator's own row is not special-cased away by the same parameter.
  it("ignores an employee_id parameter for a moderator too", async () => {
    const res = await GET(makeContext(moderatorAuthId, `?year=${YEAR}&employee_id=${employeeId}`));

    expect(res.status).toBe(200);
    const ids = fixtureRows((await res.json()) as Absence[]).map((r) => r.employee_id);
    expect(ids).toContain(moderatorId);
  });

  it.each([
    { label: "a moderator", auth: () => moderatorAuthId },
    { label: "a non-moderator", auth: () => employeeAuthId },
  ])("excludes the technical admin's absences for $label", async ({ auth }) => {
    const res = await GET(makeContext(auth(), `?year=${YEAR}`));

    const rows = (await res.json()) as Absence[];
    expect(rows.map((r) => r.employee_id)).not.toContain(systemEmployeeId);
  });

  // The non-moderator arm of `absenceEmployeeJoin` carries `visibleEmployeesFilter()` on top of
  // the own-scope predicate. Only an `is_system` *caller* can prove it is doing work — for every
  // other caller the own-scope predicate hides system rows on its own, so the filter is dead
  // weight to the assertions. Drop it from absence-list.ts and this is the case that goes red.
  it("hides an is_system caller's own rows on the non-moderator arm", async () => {
    const res = await GET(makeContext(systemAsEmployeeAuthId, `?year=${YEAR}`));

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Absence[];
    expect(rows.map((r) => r.employee_id)).not.toContain(systemAsEmployeeId);
    expect(rows.map((r) => r.date)).not.toContain(DATES.systemEmployee);
  });

  it.each([
    { label: "missing", query: "" },
    { label: "non-numeric", query: "?year=abcd" },
    { label: "three digits", query: "?year=202" },
    // Postgres has no year zero: `0000-01-01` raises 22008 at the driver, so a loose `\d{4}`
    // turns a bad request into a 500 and a Sentry event. YearSchema is `[12]\d{3}` for this.
    { label: "year-zero", query: "?year=0000" },
  ])("answers 400 for a $label year", async ({ query }) => {
    const res = await GET(makeContext(moderatorAuthId, query));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Podaj year=YYYY." });
  });

  // Auth is checked before the year, so an unauthenticated caller never learns whether the
  // parameter was well-formed.
  it("answers 401 with no authenticated user", async () => {
    const res = await GET(makeContext(null, `?year=${YEAR}`));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Brak autoryzacji." });
  });

  it("answers 403 for an authenticated user with no employee row", async () => {
    const res = await GET(makeContext(crypto.randomUUID(), `?year=${YEAR}`));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Nie znaleziono rekordu pracownika." });
  });

  // The window is half-open on the calendar year: an adjacent year must return none of these rows.
  it("returns nothing from an adjacent year", async () => {
    const res = await GET(makeContext(moderatorAuthId, "?year=2028"));

    expect(res.status).toBe(200);
    expect(fixtureRows((await res.json()) as Absence[])).toHaveLength(0);
  });
});
