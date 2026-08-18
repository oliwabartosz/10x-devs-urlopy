import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { POST as POST_SINGLE } from "@/pages/api/absences/index";
import { POST as POST_BULK } from "@/pages/api/absences/bulk";

// The `is_system` invariant on the two absence write paths, which both lacked it: `index.ts` never
// had the check, and `bulk.ts` inherited its absence by copying that route verbatim. Both now go
// through `@/lib/absence-write-target`, and every case below is asserted against *both* routes so
// the pair cannot drift apart again.
//
// Named to mirror holiday-balances/is-system-guard.test.ts, which exists for this same invariant on
// that route — and whose header comment ("the last mutation path in the codebase without an
// is_system guard") was false when written. These are the cases that make it true.
//
// RLS is bypassed on the service-role connection (src/lib/employees.ts:4-12), so the technical
// admin's immutability is app-enforced only. It is also seeded `role: moderator` (AGENTS.md:55),
// which is why the admin has two entrances here rather than one: a moderator can target it through
// the body, and it can reach the route as the caller writing its own column.
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Absence writes — is_system guard on both routes", () => {
  const FORBIDDEN = { error: "Nie można modyfikować tego konta." };

  let db!: Db;
  let employeeId!: string;
  let moderatorId!: string;
  let systemEmployeeId!: string;
  let moderatorAuthId!: string;
  let systemAuthId!: string;
  let vacationTypeId!: number;

  // May 2026, in a run distinct from bulk.test.ts's (which holds 05-01 through 05-14). One date per
  // (case, route) pair, all weekdays — the bulk route rejects weekends outright.
  const DATES = {
    single: { target: "2026-05-18", self: "2026-05-20", substitute: "2026-05-22", control: "2026-05-26" },
    bulk: { target: "2026-05-19", self: "2026-05-21", substitute: "2026-05-25", control: "2026-05-27" },
  };
  const SUITE_DATES = [...Object.values(DATES.single), ...Object.values(DATES.bulk)];

  const authIdOf = async (id: string): Promise<string> =>
    (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, id)))[0].user_id;

  const makeContext = (authUserId: string, path: string, body: unknown): APIContext =>
    ({
      locals: { user: { id: authUserId } },
      params: {},
      request: new Request(`http://test.invalid${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL(`http://test.invalid${path}`),
    }) as unknown as APIContext;

  const sharedFields = (overrides: Record<string, unknown>) => ({
    absence_type_id: vacationTypeId,
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    substitute_employee_id: null,
    ...overrides,
  });

  // The two routes differ only in how they carry the date, so one call shape drives both and every
  // case below runs identically against each.
  // `Response | Promise<Response>` because that is what `APIRoute` returns; the cases await it.
  type Write = (authUserId: string, date: string, overrides?: Record<string, unknown>) => Response | Promise<Response>;

  const writeSingle: Write = (authUserId, date, overrides = {}) =>
    POST_SINGLE(makeContext(authUserId, "/api/absences", sharedFields({ date, ...overrides })));

  const writeBulk: Write = (authUserId, date, overrides = {}) =>
    POST_BULK(makeContext(authUserId, "/api/absences/bulk", sharedFields({ dates: [date], ...overrides })));

  const ROUTES = [
    { name: "POST /api/absences", write: writeSingle, dates: DATES.single },
    { name: "POST /api/absences/bulk", write: writeBulk, dates: DATES.bulk },
  ];

  const storedFor = (targetId: string, date: string) =>
    db
      .select({ date: absences.date, substitute_employee_id: absences.substitute_employee_id })
      .from(absences)
      .where(and(eq(absences.employee_id, targetId), eq(absences.date, date)));

  beforeAll(async () => {
    db = getTestDb();
    employeeId = await createTestEmployee(db);
    moderatorId = await createTestEmployee(db);
    systemEmployeeId = await createTestEmployee(db);
    await db.update(employees).set({ role: "moderator" }).where(eq(employees.id, moderatorId));
    // `role: moderator` as well as the flag, mirroring how the real admin is seeded — that pairing
    // is exactly what makes the self-path entrance reachable.
    await db.update(employees).set({ role: "moderator", is_system: true }).where(eq(employees.id, systemEmployeeId));
    moderatorAuthId = await authIdOf(moderatorId);
    systemAuthId = await authIdOf(systemEmployeeId);

    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    expect(rows, 'absence_types row for "urlop" — drifted from the seed migration?').toHaveLength(1);
    vacationTypeId = rows[0].id;
  });

  afterEach(async () => {
    await db
      .delete(absences)
      .where(
        and(
          inArray(absences.employee_id, [employeeId, moderatorId, systemEmployeeId]),
          inArray(absences.date, SUITE_DATES),
        ),
      );
  });

  afterAll(async () => {
    // Undo the fixture flag before teardown — an orphaned row left with it set reads as a second
    // technical admin (rationale: holiday-balances/delete.test.ts:63-64).
    await db.update(employees).set({ is_system: false }).where(eq(employees.id, systemEmployeeId));
    await teardownTestEmployee(db, employeeId);
    await teardownTestEmployee(db, moderatorId);
    await teardownTestEmployee(db, systemEmployeeId);
    await db.$client.end();
  });

  describe.each(ROUTES)("$name", ({ write, dates }) => {
    it("refuses a moderator targeting the technical admin through employee_id", async () => {
      const res = await write(moderatorAuthId, dates.target, { employee_id: systemEmployeeId });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(FORBIDDEN);
      expect(
        await storedFor(systemEmployeeId, dates.target),
        "rejected POST must not have inserted a row",
      ).toHaveLength(0);
    });

    // The second entrance. The admin is a moderator, so with no employee_id it falls through to the
    // self path — which a guard placed inside the moderator-retarget branch would never see.
    it("refuses the technical admin writing its own column", async () => {
      const res = await write(systemAuthId, dates.self);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(FORBIDDEN);
      expect(await storedFor(systemEmployeeId, dates.self), "rejected POST must not have inserted a row").toHaveLength(
        0,
      );
    });

    // Previously reachable: substitute_employee_id was validated as a uuid and nothing else, so a
    // hand-crafted body could name the admin — which the dialog then renders as "Brak zastępstwa",
    // misrepresenting what is stored.
    it("refuses the technical admin as a substitute on an ordinary target", async () => {
      const res = await write(moderatorAuthId, dates.substitute, {
        employee_id: employeeId,
        substitute_employee_id: systemEmployeeId,
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(FORBIDDEN);
      expect(await storedFor(employeeId, dates.substitute), "rejected POST must not have inserted a row").toHaveLength(
        0,
      );
    });

    // Regression guard: the new gates must reject exactly the admin, not narrow the route. Uses an
    // ordinary substitute too, so the substitute lookup is proven to pass a non-admin row.
    it("still writes an ordinary target, with an ordinary substitute", async () => {
      const res = await write(moderatorAuthId, dates.control, {
        employee_id: employeeId,
        substitute_employee_id: moderatorId,
      });

      expect(res.status).toBe(201);
      const rows = await storedFor(employeeId, dates.control);
      expect(rows).toHaveLength(1);
      expect(rows[0].substitute_employee_id).toBe(moderatorId);
    });
  });
});
