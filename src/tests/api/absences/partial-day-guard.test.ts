import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { isPartialDayViolation } from "@/lib/services/absence-partial-day";
import type { Db } from "@/db/index";
import { absences, absence_types, employees } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import { ONSITE_TRAINING_TYPE_NAME, OFFSITE_TRAINING_TYPE_NAME } from "@/lib/absence-types";
import { POST } from "@/pages/api/absences/index";
import { PATCH } from "@/pages/api/absences/[id]";

// The guard service is wrapped (not replaced) so it behaves exactly as normal by default;
// the TOCTOU test below overrides it for a single call to inject a competing write at the
// precise point the handler invokes it.
vi.mock("@/lib/services/absence-partial-day", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/absence-partial-day")>();
  return { isPartialDayViolation: vi.fn(actual.isPartialDayViolation) };
});

const guardHook = vi.mocked(isPartialDayViolation);

// Handler-level (route) coverage for the S-14 partial-day type restriction.
//
// `crud.test.ts` exercises the `isPartialDayViolation` service directly; these tests invoke
// the exported route handlers and assert the HTTP contract (status + body), so removing the
// guard call from either route fails here even though the service keeps working.
describe.skipIf(!process.env.DATABASE_URL_DIRECT)("Absence partial-day guard — route level", () => {
  let db!: Db;
  let testEmployeeId!: string;
  let authUserId!: string;
  let onsiteTypeId!: number;
  let offsiteTypeId!: number;
  let nonTrainingTypeId!: number;

  const typeIdByName = async (name: string): Promise<number> => {
    const rows = await db.select({ id: absence_types.id }).from(absence_types).where(eq(absence_types.name, name));
    expect(rows, `absence_types row for "${name}" — constant drifted from the seed migration?`).toHaveLength(1);
    return rows[0].id;
  };

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

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);
    authUserId = (
      await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, testEmployeeId))
    )[0].user_id;

    onsiteTypeId = await typeIdByName(ONSITE_TRAINING_TYPE_NAME);
    offsiteTypeId = await typeIdByName(OFFSITE_TRAINING_TYPE_NAME);
    nonTrainingTypeId = await typeIdByName("urlop");
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
    await db.$client.end();
  });

  const baseBody = (overrides: Record<string, unknown>) => ({
    date: "2026-03-02",
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    substitute_employee_id: null,
    ...overrides,
  });

  it("POST rejects a non-training type + partial-day with 400 and the Polish message", async () => {
    const res = await postRequest(
      baseBody({
        absence_type_id: nonTrainingTypeId,
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:00",
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Godziny są dostępne tylko dla typów");
    expect(body.error).toContain(ONSITE_TRAINING_TYPE_NAME);
    expect(body.error).toContain(OFFSITE_TRAINING_TYPE_NAME);

    const rows = await db.select().from(absences).where(eq(absences.employee_id, testEmployeeId));
    expect(rows, "rejected POST must not have inserted a row").toHaveLength(0);
  });

  it("POST accepts onsite training + partial-day and stores both times", async () => {
    const res = await postRequest(
      baseBody({
        absence_type_id: onsiteTypeId,
        date: "2026-03-03",
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:00",
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; start_time: string; end_time: string; is_full_day: boolean };
    expect(body.is_full_day).toBe(false);
    expect(body.start_time).toBe("09:00:00");
    expect(body.end_time).toBe("11:00:00");

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("POST accepts offsite training + partial-day (widened rule)", async () => {
    const res = await postRequest(
      baseBody({
        absence_type_id: offsiteTypeId,
        date: "2026-03-04",
        is_full_day: false,
        start_time: "13:00",
        end_time: "15:00",
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("POST accepts a non-training type + full-day (unchanged path)", async () => {
    const res = await postRequest(baseBody({ absence_type_id: nonTrainingTypeId, date: "2026-03-05" }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; is_full_day: boolean };
    expect(body.is_full_day).toBe(true);

    await db.delete(absences).where(eq(absences.id, body.id));
  });

  it("PATCH rejects changing ONLY the type of an onsite partial-day entry to a non-training type", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: onsiteTypeId,
        date: "2026-03-06",
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:00",
      })
      .returning({ id: absences.id });

    // Body omits `is_full_day` entirely — the guard must resolve it from the existing row.
    const res = await patchRequest(row.id, { absence_type_id: nonTrainingTypeId });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Godziny są dostępne tylko dla typów");

    const [after] = await db
      .select({ absence_type_id: absences.absence_type_id })
      .from(absences)
      .where(eq(absences.id, row.id));
    expect(after.absence_type_id, "rejected PATCH must not have applied the type change").toBe(onsiteTypeId);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("PATCH allows changing the type between the two eligible training types", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: onsiteTypeId,
        date: "2026-03-07",
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:00",
      })
      .returning({ id: absences.id });

    const res = await patchRequest(row.id, { absence_type_id: offsiteTypeId });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { absence_type_id: number };
    expect(body.absence_type_id).toBe(offsiteTypeId);

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  it("PATCH rejects turning a non-training full-day entry into a partial-day one", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: nonTrainingTypeId,
        date: "2026-03-08",
        is_full_day: true,
      })
      .returning({ id: absences.id });

    // Body omits `absence_type_id` — the guard must resolve the type from the existing row.
    const res = await patchRequest(row.id, {
      is_full_day: false,
      start_time: "09:00",
      end_time: "11:00",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Godziny są dostępne tylko dla typów");

    await db.delete(absences).where(eq(absences.id, row.id));
  });

  // Regression for the TOCTOU between the guard's read and the UPDATE.
  //
  // The interleaving is made deterministic by hooking `isPartialDayViolation`, which the
  // handler calls *after* reading the existing row and *before* issuing the UPDATE — exactly
  // the window a concurrent PATCH would commit in. The hook performs that competing write and
  // then answers "no violation", reproducing a handler that judged eligibility on a row state
  // that no longer exists.
  it("PATCH refuses to write on stale premises when the type changes underneath it", async () => {
    const [row] = await db
      .insert(absences)
      .values({
        employee_id: testEmployeeId,
        absence_type_id: onsiteTypeId,
        date: "2026-03-09",
        is_full_day: true,
      })
      .returning({ id: absences.id });

    guardHook.mockImplementationOnce(async () => {
      await db.update(absences).set({ absence_type_id: nonTrainingTypeId }).where(eq(absences.id, row.id));
      return false; // "eligible" — judged against the pre-write state the handler read
    });

    const res = await patchRequest(row.id, {
      is_full_day: false,
      start_time: "09:00",
      end_time: "11:00",
    });

    // 409: the UPDATE's compare-and-swap detected the row moved and refused to apply.
    expect(res.status).toBe(409);

    const [after] = await db
      .select({
        absence_type_id: absences.absence_type_id,
        is_full_day: absences.is_full_day,
        start_time: absences.start_time,
      })
      .from(absences)
      .where(eq(absences.id, row.id));
    expect(after.absence_type_id).toBe(nonTrainingTypeId);
    expect(after.is_full_day, "an ineligible type must never end up partial-day").toBe(true);
    expect(after.start_time).toBeNull();

    await db.delete(absences).where(eq(absences.id, row.id));
  });
});
