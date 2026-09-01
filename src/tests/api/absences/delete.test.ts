import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, createTestModerator, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { DELETE } from "@/pages/api/absences/[id]";

// Route-level coverage for DELETE /api/absences/:id, which shipped with none.
//
// Nothing in `src/tests/` imported `DELETE` from this module before this suite — the four suites
// that touch `[id].ts` all import `PATCH`. `crud.test.ts:153` is the closest thing that existed,
// and it is a raw Drizzle `db.delete(...)` exercising no route, no auth gate and no ownership
// gate: it would keep passing with the entire handler deleted.
//
// This is the sibling the bulk-delete route lands beside, so its guards are pinned first. Every
// case asserts the row's survival or removal in the database, not only the status code — a
// refusal that still deletes is the failure this suite exists to catch.
//
// Harness template: partial-day-guard.test.ts — direct handler import, hand-built APIContext.
// Caller-varying makeContext from korekta-gate.test.ts:32, nullable-locals for the 401 case from
// employees/email.test.ts:32. Case list mirrors holiday-balances/delete.test.ts:100-155.
describe("Absence single-row DELETE (route level)", () => {
  const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

  let db!: Db;
  let employeeId!: string;
  let colleagueId!: string;
  let moderatorId!: string;
  let deactivatedId!: string;
  let employeeAuthId!: string;
  let moderatorAuthId!: string;
  let deactivatedAuthId!: string;
  let vacationTypeId!: number;

  // November 2026, unclaimed by any suite in `src/tests/` or `tests/` (the eight existing absence
  // suites hold Jan-Sep). Each seeding test gets its own weekday: `absences` carries
  // UNIQUE (employee_id, date), so a shared date would make one test's leftover row the next
  // test's failure.
  const DATES = {
    unauthenticated: "2026-11-02", // Mon
    noEmployeeRow: "2026-11-03", // Tue
    ownRow: "2026-11-04", // Wed
    colleagueRow: "2026-11-05", // Thu
    moderatorDelete: "2026-11-06", // Fri
    malformedId: "2026-11-09", // Mon
  };

  // Every date the suite can write, including the ones whose tests assert nothing is written: a
  // gate that later loosens starts landing rows, and a cleanup that cannot reach them would leave
  // them behind (bulk.test.ts:51-53).
  const SUITE_DATES = Object.values(DATES);

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  // Narrow stand-in for the APIContext fields this handler reads: `locals.user` and `params.id`.
  // The route sends no body, so `request` carries none. A null authUserId produces the
  // unauthenticated shape the 401 case needs.
  const makeContext = (authUserId: string | null, id: string): APIContext =>
    ({
      locals: authUserId ? { user: { id: authUserId } } : {},
      params: { id },
      request: new Request(`http://test.invalid/api/absences/${id}`, { method: "DELETE" }),
      url: new URL(`http://test.invalid/api/absences/${id}`),
    }) as unknown as APIContext;

  const del = (authUserId: string | null, id: string) => DELETE(makeContext(authUserId, id));

  const seedAbsence = async (ownerId: string, date: string): Promise<string> => {
    const [row] = await db
      .insert(absences)
      .values({ employee_id: ownerId, absence_type_id: vacationTypeId, date, is_full_day: true })
      .returning({ id: absences.id });
    return row.id;
  };

  const storedById = (id: string) => db.select({ id: absences.id }).from(absences).where(eq(absences.id, id));

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    colleagueId = await createTestEmployee(db);
    moderatorId = await createTestModerator(db);
    deactivatedId = await createTestEmployee(db);
    employeeAuthId = await authIdOf(employeeId);
    moderatorAuthId = await authIdOf(moderatorId);
    deactivatedAuthId = await authIdOf(deactivatedId);

    // The caller-lookup filters on `isNull(employees.deleted_at)`, so a soft-deleted employee is
    // an authenticated user with no live employee row — the 403 arm.
    await db.update(employees).set({ deleted_at: new Date() }).where(eq(employees.id, deactivatedId));

    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    expect(rows, 'absence_types row for "urlop" — drifted from the seed migration?').toHaveLength(1);
    vacationTypeId = rows[0].id;
  });

  afterEach(async () => {
    await db
      .delete(absences)
      .where(
        and(
          inArray(absences.employee_id, [employeeId, colleagueId, moderatorId, deactivatedId]),
          inArray(absences.date, SUITE_DATES),
        ),
      );
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, colleagueId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, deactivatedId);
  });

  it("an unauthenticated caller gets 401 and the row survives", async () => {
    const id = await seedAbsence(employeeId, DATES.unauthenticated);

    const res = await del(null, id);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Brak autoryzacji." });
    expect(await storedById(id), "a rejected DELETE must not have removed the row").toHaveLength(1);
  });

  it("a caller with no live employees row gets 403 and the row survives", async () => {
    const id = await seedAbsence(deactivatedId, DATES.noEmployeeRow);

    const res = await del(deactivatedAuthId, id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Nie znaleziono rekordu pracownika." });
    expect(await storedById(id), "a deactivated caller must not be able to delete their own row").toHaveLength(1);
  });

  it("an employee deletes their own row: 204 with no body, row gone", async () => {
    const id = await seedAbsence(employeeId, DATES.ownRow);

    const res = await del(employeeAuthId, id);

    expect(res.status).toBe(204);
    // The client never parses a success body (AbsenceFormDialog.tsx:474-476), so the route
    // answering `new Response(null, ...)` is part of the contract, not an implementation detail.
    expect(res.body).toBeNull();
    expect(await storedById(id)).toHaveLength(0);
  });

  // 404, not 403: ownership is a where-clause predicate here, never a pre-check, so a row that
  // does not match the caller is indistinguishable from one that does not exist. That is the
  // established convention on this route and the bulk delete must not contradict it — its
  // N-date analogue reports such a day as missing rather than refusing the request.
  it("an employee deleting a colleague's row gets 404 and the row survives", async () => {
    const id = await seedAbsence(colleagueId, DATES.colleagueRow);

    const res = await del(employeeAuthId, id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Nie znaleziono." });
    expect(await storedById(id), "someone else's row must survive a non-moderator's delete").toHaveLength(1);
  });

  it("a moderator deletes a colleague's row: 204, row gone", async () => {
    const id = await seedAbsence(colleagueId, DATES.moderatorDelete);

    const res = await del(moderatorAuthId, id);

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await storedById(id)).toHaveLength(0);
  });

  it("an unknown uuid is 404, even for a moderator", async () => {
    const res = await del(moderatorAuthId, MISSING_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Nie znaleziono." });
  });

  // The uuid shape check runs before the caller lookup, so a malformed id is 400 for any
  // authenticated caller — including one whose employee row would have failed the 403 gate.
  it("a malformed id is 400 and nothing is deleted", async () => {
    const id = await seedAbsence(employeeId, DATES.malformedId);

    const res = await del(employeeAuthId, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nieprawidłowy identyfikator." });
    expect(await storedById(id)).toHaveLength(1);
  });
});
