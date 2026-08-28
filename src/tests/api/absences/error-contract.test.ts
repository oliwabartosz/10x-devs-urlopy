import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { APIContext } from "astro";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { ONSITE_TRAINING_TYPE_NAME } from "@/lib/absence-types";
import { POST as POST_SINGLE } from "@/pages/api/absences/index";
import { POST as POST_BULK } from "@/pages/api/absences/bulk";
import { PATCH } from "@/pages/api/absences/[id]";

// The status codes a failed absence write answers with — asserted at the route boundary rather
// than on the helper that classifies the error.
//
// This suite exists because of how the SQLite port could go wrong: the routes used to compare
// Postgres SQLSTATEs (`23505`, `23503`, `23514`), and under SQLite those strings simply stop
// matching. Nothing throws and nothing fails to type-check — every 409/422/400 quietly becomes a
// 500. A helper-level test cannot see that, because a correct helper wired to the wrong constant
// still passes. Only the boundary can.
//
// The two 422s are the sharpest case. Postgres named the violated foreign key in its error and the
// catch block read that name to choose between "unknown absence type" and "unknown substitute";
// SQLite names nothing at all, so both are now resolved by pre-flight lookups
// (`@/lib/absence-write-target`) and both messages have to survive that move.
describe("Absence write error contract — statuses at the route boundary", () => {
  const UNKNOWN_TYPE_ID = 999_999;

  let db!: Db;
  let employeeId!: string;
  let authId!: string;
  let vacationTypeId!: number;
  let onsiteTypeId!: number;

  // July 2026, all weekdays — the bulk route rejects weekends outright. One date per case so no
  // two cases can collide on the unique (employee_id, date) index and explain each other's result.
  const DATES = {
    duplicate: "2026-07-01",
    unknownTypeSingle: "2026-07-02",
    unknownTypeBulk: "2026-07-03",
    unknownSubstitute: "2026-07-06",
    checkViolation: "2026-07-07",
    patchTarget: "2026-07-08",
    impossibleDate: "2026-07-09",
  };
  const SUITE_DATES = Object.values(DATES);

  const makeContext = (path: string, body: unknown, params: Record<string, string> = {}): APIContext =>
    ({
      locals: { user: { id: authId } },
      params,
      request: new Request(`http://test.invalid${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL(`http://test.invalid${path}`),
    }) as unknown as APIContext;

  const fullDayFields = (overrides: Record<string, unknown> = {}) => ({
    absence_type_id: vacationTypeId,
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    substitute_employee_id: null,
    ...overrides,
  });

  const postSingle = (body: Record<string, unknown>) => POST_SINGLE(makeContext("/api/absences", body));
  const postBulk = (body: Record<string, unknown>) => POST_BULK(makeContext("/api/absences/bulk", body));
  const patch = (id: string, body: Record<string, unknown>) => PATCH(makeContext(`/api/absences/${id}`, body, { id }));

  const storedFor = (date: string) =>
    db
      .select({ id: absences.id })
      .from(absences)
      .where(and(eq(absences.employee_id, employeeId), eq(absences.date, date)));

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    authId = (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, employeeId)))[0]
      .user_id;

    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, "urlop"));
    expect(rows, 'absence_types row for "urlop" — drifted from the seed?').toHaveLength(1);
    vacationTypeId = rows[0].id;

    const onsite = await db
      .select({ id: absence_types.id })
      .from(absence_types)
      .where(eq(absence_types.name, ONSITE_TRAINING_TYPE_NAME));
    expect(onsite, "absence_types row for the onsite-training type — drifted from the seed?").toHaveLength(1);
    onsiteTypeId = onsite[0].id;

    // The id the "unknown type" cases lean on must genuinely be absent, or they would pass for the
    // wrong reason — a 422 that a *seeded* row happened to produce proves nothing.
    const collision = await db
      .select({ id: absence_types.id })
      .from(absence_types)
      .where(eq(absence_types.id, UNKNOWN_TYPE_ID));
    expect(collision, "UNKNOWN_TYPE_ID must not exist").toHaveLength(0);
  });

  afterEach(async () => {
    await db.delete(absences).where(and(eq(absences.employee_id, employeeId), inArray(absences.date, SUITE_DATES)));
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
  });

  it("409 — a second absence on a date already taken", async () => {
    const first = await postSingle(fullDayFields({ date: DATES.duplicate }));
    expect(first.status).toBe(201);

    const second = await postSingle(fullDayFields({ date: DATES.duplicate }));

    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Masz już wpis nieobecności na ten dzień." });
    expect(await storedFor(DATES.duplicate), "the rejected POST must not have added a second row").toHaveLength(1);
  });

  it("422 — POST naming an absence type that does not exist", async () => {
    const res = await postSingle(fullDayFields({ date: DATES.unknownTypeSingle, absence_type_id: UNKNOWN_TYPE_ID }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Nie znaleziono wybranego typu nieobecności." });
    expect(await storedFor(DATES.unknownTypeSingle)).toHaveLength(0);
  });

  it("422 — bulk POST naming an absence type that does not exist", async () => {
    const res = await postBulk(fullDayFields({ dates: [DATES.unknownTypeBulk], absence_type_id: UNKNOWN_TYPE_ID }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Nie znaleziono wybranego typu nieobecności." });
    expect(await storedFor(DATES.unknownTypeBulk)).toHaveLength(0);
  });

  it("422 — POST naming a substitute employee that does not exist", async () => {
    const res = await postSingle(
      fullDayFields({ date: DATES.unknownSubstitute, substitute_employee_id: crypto.randomUUID() }),
    );

    expect(res.status).toBe(422);
    // Distinct from the unknown-type message above, and that distinction is the point: it is what
    // the Postgres FK-name discrimination used to buy and what the pre-flight lookups restore.
    expect(await res.json()).toEqual({ error: "Nie znaleziono pracownika na zastępstwo." });
    expect(await storedFor(DATES.unknownSubstitute)).toHaveLength(0);
  });

  it("422 — PATCH naming an absence type that does not exist", async () => {
    const created = await postSingle(fullDayFields({ date: DATES.patchTarget }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await patch(id, { absence_type_id: UNKNOWN_TYPE_ID });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Nie znaleziono wybranego typu nieobecności." });
    const stored = await db
      .select({ absence_type_id: absences.absence_type_id })
      .from(absences)
      .where(eq(absences.id, id));
    expect(stored[0].absence_type_id, "the rejected PATCH must not have written the type").toBe(vacationTypeId);
  });

  it("400 — a body that only the DB CHECK can reject", async () => {
    // The one write the zod refines deliberately let through: patching `is_full_day` alone leaves
    // both time columns untouched ("if neither time field is being patched, let DB constraint
    // handle the check"), so a full-day row flipped to partial-day arrives at `absences_time_check`
    // with two NULL times. It is the only path that reaches a CHECK violation through a route, and
    // therefore the only thing that can prove the CHECK arm is still wired to a live code.
    //
    // On a *training* type, because the partial-day guard runs first and would answer 400 with its
    // own message ("hours are only available for these types") for any other type — a 400 for the
    // wrong reason, which would leave the CHECK arm unproven while looking green.
    const created = await postSingle(fullDayFields({ date: DATES.checkViolation, absence_type_id: onsiteTypeId }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await patch(id, { is_full_day: false });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nieprawidłowa kombinacja godzin i trybu całodniowego." });
    const stored = await db.select({ is_full_day: absences.is_full_day }).from(absences).where(eq(absences.id, id));
    expect(stored[0].is_full_day, "the rejected PATCH must have left the row full-day").toBe(true);
  });

  it("400 — an impossible calendar date is rejected rather than stored", async () => {
    // Postgres' `date` column used to reject 2026-02-31; a SQLite TEXT column stores it verbatim,
    // and a phantom 31st of February would then render in the grid. `DateSchema` is now the only
    // thing standing in the way, so the create route has to be using it.
    const res = await postSingle(fullDayFields({ date: "2026-02-31" }));

    expect(res.status).toBe(400);
    const stored = await db
      .select({ id: absences.id })
      .from(absences)
      .where(and(eq(absences.employee_id, employeeId), eq(absences.date, "2026-02-31")));
    expect(stored, "an impossible date must never reach the table").toHaveLength(0);
  });

  it("400 — an impossible calendar date is rejected by the bulk route too", async () => {
    const res = await postBulk(fullDayFields({ dates: ["2026-02-31"] }));

    expect(res.status).toBe(400);
    const stored = await db
      .select({ id: absences.id })
      .from(absences)
      .where(and(eq(absences.employee_id, employeeId), eq(absences.date, "2026-02-31")));
    expect(stored).toHaveLength(0);
  });
});
