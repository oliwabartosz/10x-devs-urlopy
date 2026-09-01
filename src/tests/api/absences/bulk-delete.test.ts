import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, createTestModerator, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { DELETE } from "@/pages/api/absences/bulk";
import type { AbsenceBulkDeleteResult } from "@/types";

// Route-level coverage for DELETE /api/absences/bulk.
//
// The gesture can send exactly one shape of body: a contiguous weekday run inside one employee
// column, holding at least one row. Every rejection path below is therefore unreachable from the
// UI — which is precisely the class of request the route exists to refuse, since no database policy
// backstops a hand-crafted body (there is no RLS on a local SQLite file).
//
// The reporting cases are the other half: `deleted_dates` / `missing_dates` must partition the
// requested dates exactly, because the dialog reads `missing_dates` as its staleness signal.
//
// Harness template: partial-day-guard.test.ts — direct handler import, hand-built APIContext.
// Caller-varying makeContext from korekta-gate.test.ts:32, nullable-locals for the 401 case from
// employees/email.test.ts:32.
describe("Absence bulk delete (route level)", () => {
  const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

  let db!: Db;
  let employeeId!: string;
  let colleagueId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  let deactivatedId!: string;
  let softDeletedTargetId!: string;
  let employeeAuthId!: string;
  let moderatorAuthId!: string;
  let deactivatedAuthId!: string;
  let vacationTypeId!: number;

  // October 2026. The window is per-suite bookkeeping, not global: `src/tests/helpers/astro-env.ts`
  // hands every test *file* its own throwaway SQLite database, so no other suite can collide with
  // this one. What does matter is uniqueness *within* the suite — `absences` carries
  // UNIQUE (employee_id, date), so two tests sharing a date would make one's leftover row the
  // other's failure.
  const HAPPY_RUN = ["2026-10-01", "2026-10-02", "2026-10-05"]; // Thu, Fri, Mon
  const MIXED_RUN = ["2026-10-06", "2026-10-07", "2026-10-08"]; // only the first two get a row
  const ALL_FREE_RUN = ["2026-10-09", "2026-10-12"];
  const EMPLOYEE_SCOPE_RUN = ["2026-10-13"];
  const MODERATOR_RUN = ["2026-10-14"];
  const SYSTEM_ADMIN_RUN = ["2026-10-15"];
  const UNKNOWN_TARGET_RUN = ["2026-10-16"];
  const SOFT_DELETED_TARGET_RUN = ["2026-10-19"];
  const NEIGHBOUR_RUN = ["2026-10-20", "2026-10-21"];
  const NEIGHBOUR_DATE = "2026-10-22"; // occupied, adjacent, deliberately not requested
  const UNAUTHENTICATED_RUN = ["2026-10-23"];
  const WEEKEND_RUN = ["2026-10-24"]; // Sat — POST refuses this date, DELETE must not
  const NO_EMPLOYEE_ROW_RUN = ["2026-10-26"];
  const DUPLICATE_RUN = ["2026-10-27", "2026-10-27"];
  const IMPOSSIBLE_RUN = ["2026-02-31"]; // a real-looking day that does not exist

  // One past the route's cap. `MAX_BULK_DATES` is module-private, so the boundary is asserted with
  // a literal count rather than an import — this test drifts if the cap moves, which is the
  // intended trade (bulk.test.ts:44-49): a test that imports the constant proves only that zod was
  // called.
  const OVER_CAP_RUN = [
    ...Array.from({ length: 31 }, (_, i) => `2026-12-${(i + 1).toString().padStart(2, "0")}`),
    "2026-11-30",
  ];

  // Every date the suite can address, including those of tests that assert nothing is deleted: a
  // gate that later loosens starts reaching rows, and a cleanup that cannot reach them would leave
  // them behind (bulk.test.ts:51-53).
  const SUITE_DATES = [
    ...new Set([
      ...HAPPY_RUN,
      ...MIXED_RUN,
      ...ALL_FREE_RUN,
      ...EMPLOYEE_SCOPE_RUN,
      ...MODERATOR_RUN,
      ...SYSTEM_ADMIN_RUN,
      ...UNKNOWN_TARGET_RUN,
      ...SOFT_DELETED_TARGET_RUN,
      ...NEIGHBOUR_RUN,
      NEIGHBOUR_DATE,
      ...UNAUTHENTICATED_RUN,
      ...WEEKEND_RUN,
      ...NO_EMPLOYEE_ROW_RUN,
      ...DUPLICATE_RUN,
      ...IMPOSSIBLE_RUN,
      ...OVER_CAP_RUN,
    ]),
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
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL("http://test.invalid/api/absences/bulk"),
    }) as unknown as APIContext;

  const del = (authUserId: string | null, body: unknown) => DELETE(makeContext(authUserId, body));

  const seedRun = async (ownerId: string, dates: string[]): Promise<{ date: string; id: string }[]> =>
    db
      .insert(absences)
      .values(dates.map((date) => ({ employee_id: ownerId, absence_type_id: vacationTypeId, date, is_full_day: true })))
      .returning({ date: absences.date, id: absences.id });

  // Scoped to the caller's own dates, never to employee_id alone: a bare employee filter reports a
  // leftover row from an earlier test as if this call had written it (hours-clamp.test.ts:116-118).
  const storedFor = (targetId: string, dates: string[]) =>
    db
      .select({ date: absences.date, id: absences.id })
      .from(absences)
      .where(and(eq(absences.employee_id, targetId), inArray(absences.date, dates)))
      .orderBy(asc(absences.date));

  const reportOf = async (res: Response): Promise<AbsenceBulkDeleteResult> =>
    (await res.json()) as AbsenceBulkDeleteResult;

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    colleagueId = await createTestEmployee(db);
    moderatorId = await createTestModerator(db);
    systemEmployeeId = await createTestEmployee(db);
    deactivatedId = await createTestEmployee(db);
    softDeletedTargetId = await createTestEmployee(db);

    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);
    deactivatedAuthId = await authIdOf(deactivatedId);

    await db.update(employees).set({ is_system: true }).where(eq(employees.id, systemEmployeeId));
    // A deactivated caller: an authenticated user whose employee row no longer passes the
    // `isNull(deleted_at)` filter the caller lookup applies.
    await db.update(employees).set({ deleted_at: new Date() }).where(eq(employees.id, deactivatedId));
    await db.update(employees).set({ deleted_at: new Date() }).where(eq(employees.id, softDeletedTargetId));

    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    expect(rows, 'absence_types row for "urlop" — drifted from the seed migration?').toHaveLength(1);
    vacationTypeId = rows[0].id;
  });

  afterEach(async () => {
    await db
      .delete(absences)
      .where(
        and(
          inArray(absences.employee_id, [
            employeeId,
            colleagueId,
            moderatorId,
            systemEmployeeId,
            deactivatedId,
            softDeletedTargetId,
          ]),
          inArray(absences.date, SUITE_DATES),
        ),
      );
  });

  afterAll(async () => {
    // Undo the fixture's is_system flag before teardown — the invariant is app-enforced, so
    // leaving it set would make an orphaned row look like a second technical admin.
    await db.update(employees).set({ is_system: false }).where(eq(employees.id, systemEmployeeId));
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, colleagueId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, systemEmployeeId);
    await teardownTestEmployee(db, deactivatedId);
    await teardownTestEmployee(db, softDeletedTargetId);
  });

  describe("rejections the gesture cannot produce", () => {
    it("an unauthenticated caller gets 401 and nothing is deleted", async () => {
      await seedRun(employeeId, UNAUTHENTICATED_RUN);

      const res = await del(null, { dates: UNAUTHENTICATED_RUN });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Brak autoryzacji." });
      expect(await storedFor(employeeId, UNAUTHENTICATED_RUN)).toHaveLength(1);
    });

    it("a caller with no live employees row gets 403 and nothing is deleted", async () => {
      await seedRun(deactivatedId, NO_EMPLOYEE_ROW_RUN);

      const res = await del(deactivatedAuthId, { dates: NO_EMPLOYEE_ROW_RUN });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Nie znaleziono rekordu pracownika." });
      expect(await storedFor(deactivatedId, NO_EMPLOYEE_ROW_RUN)).toHaveLength(1);
    });

    it("an empty dates list is 400", async () => {
      const res = await del(employeeAuthId, { dates: [] });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Podaj co najmniej jeden dzień." });
    });

    it("32 dates exceed the cap with 400", async () => {
      await seedRun(employeeId, OVER_CAP_RUN.slice(0, 1));

      const res = await del(employeeAuthId, { dates: OVER_CAP_RUN });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("31");
      expect(await storedFor(employeeId, OVER_CAP_RUN), "an over-cap body must delete nothing").toHaveLength(1);
    });

    it("duplicate dates are rejected rather than de-duplicated", async () => {
      await seedRun(employeeId, [DUPLICATE_RUN[0]]);

      const res = await del(employeeAuthId, { dates: DUPLICATE_RUN });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Lista dni zawiera duplikaty." });
      expect(await storedFor(employeeId, DUPLICATE_RUN)).toHaveLength(1);
    });

    // 400, not 500: SQLite's TEXT date column would accept "2026-02-31" happily, so `DateSchema`
    // is the only layer that can tell the caller it asked for a day that does not exist.
    it("an impossible calendar day is 400, not a 500", async () => {
      const res = await del(employeeAuthId, { dates: IMPOSSIBLE_RUN });

      expect(res.status).toBe(400);
    });

    it("a body that is not JSON is 400", async () => {
      const context = {
        locals: { user: { id: employeeAuthId } },
        params: {},
        request: new Request("http://test.invalid/api/absences/bulk", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
        url: new URL("http://test.invalid/api/absences/bulk"),
      } as unknown as APIContext;

      const res = await DELETE(context);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Nieprawidłowe dane żądania." });
    });
  });

  describe("the per-day report", () => {
    it("deletes an entirely occupied run and reports every day as deleted", async () => {
      await seedRun(employeeId, HAPPY_RUN);

      const res = await del(employeeAuthId, { dates: HAPPY_RUN });

      expect(res.status).toBe(200);
      const report = await reportOf(res);
      expect(report.deleted_dates).toEqual([...HAPPY_RUN].sort());
      expect(report.missing_dates).toEqual([]);
      expect(await storedFor(employeeId, HAPPY_RUN)).toHaveLength(0);
    });

    it("partitions a mixed run exactly and removes only the occupied days", async () => {
      await seedRun(employeeId, MIXED_RUN.slice(0, 2));

      const res = await del(employeeAuthId, { dates: MIXED_RUN });

      expect(res.status).toBe(200);
      const report = await reportOf(res);
      expect(report.deleted_dates).toEqual(MIXED_RUN.slice(0, 2));
      expect(report.missing_dates).toEqual([MIXED_RUN[2]]);
      // The two lists partition the request: every requested day in exactly one of them.
      expect([...report.deleted_dates, ...report.missing_dates].sort()).toEqual([...MIXED_RUN].sort());
      expect(await storedFor(employeeId, MIXED_RUN)).toHaveLength(0);
    });

    it("an entirely free run is 200 with every day missing and nothing touched", async () => {
      const [neighbour] = await seedRun(employeeId, [NEIGHBOUR_DATE]);

      const res = await del(employeeAuthId, { dates: ALL_FREE_RUN });

      expect(res.status).toBe(200);
      const report = await reportOf(res);
      expect(report.deleted_dates).toEqual([]);
      expect(report.missing_dates).toEqual([...ALL_FREE_RUN].sort());

      const [after] = await storedFor(employeeId, [NEIGHBOUR_DATE]);
      expect(after.id, "a day outside the requested run must keep its original row").toBe(neighbour.id);
    });

    it("leaves an occupied day adjacent to the run untouched, with its original id", async () => {
      await seedRun(employeeId, NEIGHBOUR_RUN);
      const [neighbour] = await seedRun(employeeId, [NEIGHBOUR_DATE]);

      const res = await del(employeeAuthId, { dates: NEIGHBOUR_RUN });

      expect(res.status).toBe(200);
      expect((await reportOf(res)).deleted_dates).toEqual([...NEIGHBOUR_RUN].sort());
      expect(await storedFor(employeeId, NEIGHBOUR_RUN)).toHaveLength(0);

      const [after] = await storedFor(employeeId, [NEIGHBOUR_DATE]);
      expect(after.id, "the neighbouring row must not have been rewritten").toBe(neighbour.id);
    });

    // The asymmetry with POST, asserted rather than only commented. POST refuses a weekend date
    // outright; DELETE must remove a weekend row, otherwise legacy or hand-crafted weekend data
    // would be undeletable through the UI.
    it("deletes a weekend row, which POST would have refused to write", async () => {
      await seedRun(employeeId, WEEKEND_RUN);

      const res = await del(employeeAuthId, { dates: WEEKEND_RUN });

      expect(res.status).toBe(200);
      expect((await reportOf(res)).deleted_dates).toEqual(WEEKEND_RUN);
      expect(await storedFor(employeeId, WEEKEND_RUN)).toHaveLength(0);
    });
  });

  describe("the write-target gate", () => {
    // The case that would catch a hand-rolled ownership check regressing into the shared guard's
    // silent-ignore contract. `resolveAbsenceWriteTarget` ignores a non-moderator's `employee_id`
    // and resolves to the caller's own id, so this is 200 scoped to the caller — not a 403 — and
    // the colleague's row survives, appearing to the caller as a day that held nothing.
    it("an employee sending a colleague's employee_id deletes nothing of the colleague's", async () => {
      const seeded = await seedRun(colleagueId, EMPLOYEE_SCOPE_RUN);

      const res = await del(employeeAuthId, { employee_id: colleagueId, dates: EMPLOYEE_SCOPE_RUN });

      expect(res.status).toBe(200);
      const report = await reportOf(res);
      expect(report.deleted_dates).toEqual([]);
      expect(report.missing_dates).toEqual(EMPLOYEE_SCOPE_RUN);

      const [after] = await storedFor(colleagueId, EMPLOYEE_SCOPE_RUN);
      expect(after.id, "a colleague's row must survive a non-moderator's bulk delete").toBe(seeded[0].id);
    });

    it("a moderator sending a colleague's employee_id deletes the colleague's rows", async () => {
      await seedRun(colleagueId, MODERATOR_RUN);

      const res = await del(moderatorAuthId, { employee_id: colleagueId, dates: MODERATOR_RUN });

      expect(res.status).toBe(200);
      expect((await reportOf(res)).deleted_dates).toEqual(MODERATOR_RUN);
      expect(await storedFor(colleagueId, MODERATOR_RUN)).toHaveLength(0);
    });

    it("nobody may delete the technical admin's absences", async () => {
      await seedRun(systemEmployeeId, SYSTEM_ADMIN_RUN);

      const res = await del(moderatorAuthId, { employee_id: systemEmployeeId, dates: SYSTEM_ADMIN_RUN });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Nie można modyfikować tego konta." });
      expect(await storedFor(systemEmployeeId, SYSTEM_ADMIN_RUN)).toHaveLength(1);
    });

    // 404 before 403: a nonexistent id must never be answered "forbidden", or the endpoint leaks
    // which employee ids exist.
    it("an unknown employee_id from a moderator is 404", async () => {
      const res = await del(moderatorAuthId, { employee_id: MISSING_UUID, dates: UNKNOWN_TARGET_RUN });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Pracownik nie został znaleziony." });
    });

    it("a soft-deleted target is 404 and its rows survive", async () => {
      await seedRun(softDeletedTargetId, SOFT_DELETED_TARGET_RUN);

      const res = await del(moderatorAuthId, { employee_id: softDeletedTargetId, dates: SOFT_DELETED_TARGET_RUN });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Pracownik nie został znaleziony." });
      expect(await storedFor(softDeletedTargetId, SOFT_DELETED_TARGET_RUN)).toHaveLength(1);
    });
  });
});
