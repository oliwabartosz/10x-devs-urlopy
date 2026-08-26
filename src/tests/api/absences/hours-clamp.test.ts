import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { APIContext } from "astro";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { ONSITE_TRAINING_TYPE_NAME } from "@/lib/absence-types";
import { MIN_START_TIME } from "@/lib/absence-hours";
import { POST } from "@/pages/api/absences/index";
import { PATCH } from "@/pages/api/absences/[id]";

// Handler-level (route) coverage for the partial-day hours window.
//
// `src/tests/lib/absence-hours.test.ts` exercises `clampAbsenceHours` directly; these tests
// invoke the exported route handlers and assert the HTTP contract, so removing the clamp call
// from either route fails here even though the module keeps working.
//
// Every assertion is on the **response body**, not on a follow-up SELECT: the body is what
// makes silent server-side correction observable to a caller, and that visibility is the
// mitigation the frame required for clamping instead of rejecting.
describe("Absence hours clamp — route level", () => {
  let db!: Db;
  let testEmployeeId!: string;
  let authUserId!: string;
  let onsiteTypeId!: number;

  // Minimal stand-in for the Astro APIContext fields these handlers actually read:
  // `locals.user` (auth), `request` (body) and, for PATCH, `params.id`. Everything else on
  // APIContext is unused by these routes, hence the narrow cast.
  const makeContext = (method: string, path: string, body: unknown, params: Record<string, string> = {}): APIContext =>
    ({
      locals: { user: { id: authUserId } },
      params,
      request: new Request(`http://test.invalid${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL(`http://test.invalid${path}`),
    }) as unknown as APIContext;

  const postRequest = (body: unknown) => POST(makeContext("POST", "/api/absences", body));

  const patchRequest = (id: string, body: unknown) => PATCH(makeContext("PATCH", `/api/absences/${id}`, body, { id }));

  const partialDayBody = (overrides: Record<string, unknown>) => ({
    absence_type_id: onsiteTypeId,
    is_full_day: false,
    comment: null,
    substitute_employee_id: null,
    ...overrides,
  });

  // `absences` carries unique(employee_id, date), so every test needs its own date.
  const insertRow = async (date: string, startTime: string, endTime: string): Promise<string> => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: onsiteTypeId,
        date,
        is_full_day: false,
        start_time: startTime,
        end_time: endTime,
      })
      .returning({ id: absences.id });
    return row.id;
  };

  beforeAll(async () => {
    db = await getTestDb();
    testEmployeeId = await createTestEmployee(db);
    authUserId = (
      await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, testEmployeeId))
    )[0].user_id;

    const rows = await db
      .select({ id: absence_types.id })
      .from(absence_types)
      .where(eq(absence_types.name, ONSITE_TRAINING_TYPE_NAME));
    expect(
      rows,
      `absence_types row for "${ONSITE_TRAINING_TYPE_NAME}" — constant drifted from the seed migration?`,
    ).toHaveLength(1);
    onsiteTypeId = rows[0].id;
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
  });

  it("POST floors the start and then caps the duration, in that order", async () => {
    const res = await postRequest(partialDayBody({ date: "2026-04-02", start_time: "01:00", end_time: "22:00" }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; start_time: string; end_time: string };
    expect(body.start_time).toBe("06:00");
    // 14:00, not 09:00: capping before flooring would have produced a 3 h absence.
    expect(body.end_time).toBe("14:00");

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("POST rejects a range that flooring makes unrepairable, naming the boundary", async () => {
    const res = await postRequest(partialDayBody({ date: "2026-04-03", start_time: "01:00", end_time: "03:00" }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(MIN_START_TIME);
    expect(body.error, "must not fall back to the generic full-day combination message").not.toContain(
      "Dla całego dnia",
    );

    // Scoped to this test's own date, not to every row the employee has: a bare employee_id
    // filter would make this assertion fail whenever a test above it leaves a row behind, and
    // report the failure as if this POST had inserted one.
    const rows = await db
      .select()
      .from(absences)
      .where(and(eq(absences.employee_id, testEmployeeId), eq(absences.date, "2026-04-03")));
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  it("POST leaves an in-bounds range byte-identical", async () => {
    const res = await postRequest(partialDayBody({ date: "2026-04-04", start_time: "09:00", end_time: "17:00" }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; start_time: string; end_time: string };
    expect(body.start_time).toBe("09:00");
    expect(body.end_time).toBe("17:00");

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("PATCH clamps a range sent in full", async () => {
    const id = await insertRow("2026-04-05", "09:00", "11:00");

    const res = await patchRequest(id, { start_time: "04:00", end_time: "20:00" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { start_time: string; end_time: string };
    expect(body.start_time).toBe("06:00");
    expect(body.end_time).toBe("14:00");

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH clamps against the effective range when the body sends only end_time", async () => {
    const id = await insertRow("2026-04-06", "09:00", "11:00");

    const res = await patchRequest(id, { end_time: "23:00" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { start_time: string; end_time: string };
    // The stored 09:00 start is what the cap measures from — the widened SELECT is what makes
    // that possible; without it the route has nothing to clamp a partial PATCH against.
    expect(body.start_time).toBe("09:00");
    expect(body.end_time).toBe("17:00");

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH writes a floored start the body never sent", async () => {
    // A legacy out-of-window row, of the kind Phase 4 purges. Inserted directly, since the
    // route it would have to come through is exactly the one under test.
    const id = await insertRow("2026-04-07", "01:00", "10:00");

    const res = await patchRequest(id, { end_time: "23:00" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { start_time: string; end_time: string };
    // start_time was absent from the body and still had to reach the UPDATE's `set`.
    expect(body.start_time).toBe("06:00");
    expect(body.end_time).toBe("14:00");

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH rejects a range that flooring makes unrepairable", async () => {
    const id = await insertRow("2026-04-08", "09:00", "11:00");

    const res = await patchRequest(id, { start_time: "01:00", end_time: "03:00" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(MIN_START_TIME);

    const [after] = await db.select({ start_time: absences.start_time }).from(absences).where(eq(absences.id, id));
    expect(after.start_time, "rejected PATCH must not have applied the range").toBe("09:00");

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH naming only one time reports the ordering rule, not the floor", async () => {
    const id = await insertRow("2026-04-11", "09:00", "11:00");

    // `AbsenceUpdateSchemaRefined` short-circuits on `is_full_day === undefined`, so this body
    // never meets an `end > start` check and arrives at the clamp as 20:00–11:00:00. The floor
    // was never involved, and the error must not claim it was.
    const res = await patchRequest(id, { start_time: "20:00" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error, "must not blame the floor for a range that never went near it").not.toContain(MIN_START_TIME);
    expect(body.error).toContain("późniejsze niż rozpoczęcie");

    const [after] = await db.select({ start_time: absences.start_time }).from(absences).where(eq(absences.id, id));
    expect(after.start_time, "rejected PATCH must not have applied the start").toBe("09:00");

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH of an unrelated field leaves an in-bounds range untouched", async () => {
    const id = await insertRow("2026-04-09", "16:27", "17:27");

    const res = await patchRequest(id, { comment: "bez zmian godzin" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { start_time: string; end_time: string; comment: string };
    expect(body.comment).toBe("bez zmian godzin");
    expect(body.start_time).toBe("16:27");
    expect(body.end_time).toBe("17:27");

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH of an unrelated field on an unclampable legacy row still lands", async () => {
    // 01:22–03:22 is one of the rows the purge migration removed: it ends before the floor, so
    // no clamp can repair it. A body that patches neither time must not be blocked by it, or
    // the row's comment, substitute and date become unreachable in any environment that still
    // holds such a row. The stored range is left exactly as it was.
    const id = await insertRow("2026-04-12", "01:22", "03:22");

    const res = await patchRequest(id, { comment: "stary wpis, komentarz dodany" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { comment: string; start_time: string; end_time: string };
    expect(body.comment).toBe("stary wpis, komentarz dodany");
    expect(body.start_time, "an unclampable stored range must be left alone, not rewritten").toBe("01:22");
    expect(body.end_time).toBe("03:22");

    // Supplying a time the caller could have corrected still rejects.
    const rejected = await patchRequest(id, { start_time: "01:00", end_time: "03:00" });
    expect(rejected.status).toBe(400);

    await db.delete(absences).where(eq(absences.id, id));
  });

  it("PATCH clearing the range for a full-day switch is not clamped", async () => {
    const id = await insertRow("2026-04-10", "09:00", "11:00");

    // Both times are explicitly null here, not omitted — `??` on the effective values would
    // resolve them back to the stored range and clamp a row that no longer has one.
    const res = await patchRequest(id, { is_full_day: true, start_time: null, end_time: null });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_full_day: boolean; start_time: string | null; end_time: string | null };
    expect(body.is_full_day).toBe(true);
    expect(body.start_time).toBeNull();
    expect(body.end_time).toBeNull();

    await db.delete(absences).where(eq(absences.id, id));
  });
});
