export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { and, eq, isNull } from "drizzle-orm";
import { DateSchema, TimeSchema } from "@/lib/validators";
import { extractPgErrorCode, extractPgErrorConstraint } from "@/lib/db-errors";
import { PARTIAL_DAY_TYPE_NAMES } from "@/lib/absence-types";
import { isPartialDayViolation } from "@/lib/services/absence-partial-day";
import { clampAbsenceHours, MIN_START_TIME } from "@/lib/absence-hours";

// Kept in step with the same message in `index.ts` — a clamp rejection is the same rule
// broken whichever route it arrives through.
const END_BEFORE_FLOOR_ERROR = `Wpis godzinowy zaczyna się najwcześniej o ${MIN_START_TIME}, więc musi kończyć się później niż ${MIN_START_TIME}.`;

const AbsenceUpdateSchema = z
  .object({
    absence_type_id: z.number().int().positive(),
    date: DateSchema,
    is_full_day: z.boolean(),
    start_time: TimeSchema.nullable(),
    end_time: TimeSchema.nullable(),
    comment: z.string().max(500).nullable(),
    substitute_employee_id: z.uuid().nullable(),
  })
  .partial();

const AbsenceUpdateSchemaRefined = AbsenceUpdateSchema.refine(
  (d) =>
    d.is_full_day === undefined ||
    // if neither time field is being patched, let DB constraint handle the check
    (d.start_time === undefined && d.end_time === undefined) ||
    (d.is_full_day
      ? d.start_time === null && d.end_time === null
      : d.start_time != null && d.end_time != null && d.end_time > d.start_time), // string compare valid: TimeSchema guarantees HH:MM format
  {
    message:
      "Dla całego dnia godziny muszą pozostać puste; dla wpisu godzinowego podaj obie godziny, a zakończenie musi być późniejsze niż rozpoczęcie.",
  },
);

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Brak autoryzacji." }, 401);
  }

  const id = context.params.id;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) {
    return json({ error: "Nieprawidłowy identyfikator." }, 400);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania." }, 400);
  }

  const parsed = AbsenceUpdateSchemaRefined.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const db = createDb(DATABASE_URL);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "PATCH /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Nie znaleziono rekordu pracownika." }, 403);
  }

  const ownershipWhere =
    employeeRow.role === "moderator"
      ? eq(absences.id, id)
      : and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id));

  // Load the existing row (ownership-scoped) to resolve the *effective* type/full-day state
  // for the partial-day guard: a PATCH may omit either field, and a body that changes only
  // the type must not leave an existing partial-day range on a now-ineligible type. The two
  // time columns are read for the same reason — the hours clamp below needs the effective
  // range, and a body that patches only one end must be clamped against the stored other end.
  let existing:
    | { absence_type_id: number; is_full_day: boolean; start_time: string | null; end_time: string | null }
    | undefined;
  try {
    existing = await db
      .select({
        absence_type_id: absences.absence_type_id,
        is_full_day: absences.is_full_day,
        start_time: absences.start_time,
        end_time: absences.end_time,
      })
      .from(absences)
      .where(ownershipWhere)
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "PATCH /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!existing) return json({ error: "Nie znaleziono." }, 404);

  // Captured before the clamp merges values into `parsed.data`: from here on, "the body
  // omitted this field" can no longer be read off `parsed.data`, and both the effective-value
  // resolution and the CAS pins below depend on it. Note `null` is a *supplied* value here
  // (it clears the range for a full-day switch), so `??` would resolve it wrongly.
  const omitted = {
    absence_type_id: parsed.data.absence_type_id === undefined,
    is_full_day: parsed.data.is_full_day === undefined,
    start_time: parsed.data.start_time === undefined,
    end_time: parsed.data.end_time === undefined,
  };

  const effectiveTypeId = parsed.data.absence_type_id ?? existing.absence_type_id;
  const effectiveIsFullDay = parsed.data.is_full_day ?? existing.is_full_day;
  const effectiveStartTime = omitted.start_time ? existing.start_time : (parsed.data.start_time ?? null);
  const effectiveEndTime = omitted.end_time ? existing.end_time : (parsed.data.end_time ?? null);

  let partialDayViolation: boolean;
  try {
    partialDayViolation = await isPartialDayViolation(db, effectiveTypeId, effectiveIsFullDay);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "PATCH /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (partialDayViolation) {
    return json({ error: `Godziny są dostępne tylko dla typów: ${PARTIAL_DAY_TYPE_NAMES.join(", ")}` }, 400);
  }

  // Same domain rule as POST, applied to the *effective* range. The clamped values are merged
  // back into `parsed.data` so they reach the UPDATE's `set` even for a column the body
  // omitted — a body patching only `end_time` still corrects a stored out-of-window start.
  if (!effectiveIsFullDay && effectiveStartTime !== null && effectiveEndTime !== null) {
    const clamped = clampAbsenceHours(effectiveStartTime, effectiveEndTime);
    if (!clamped.ok) {
      return json(
        { error: clamped.reason === "end-before-floor" ? END_BEFORE_FLOOR_ERROR : "Nieprawidłowy format godziny." },
        400,
      );
    }
    parsed.data.start_time = clamped.startTime;
    parsed.data.end_time = clamped.endTime;
  }

  // The guard above judged the *effective* state, which for any field the body omitted was
  // read from `existing` a moment ago. Pin exactly those fields in the UPDATE's WHERE so a
  // concurrent write that changes them makes this statement match zero rows instead of
  // landing on stale premises (e.g. another PATCH flips the type to an ineligible one after
  // we read it, and this UPDATE then writes a time range onto it).
  //
  // `start_time`/`end_time` are nullable — a full-day row holds NULL in both — so the pin for
  // an absent stored value must be `isNull()`. `eq(col, null)` does not compile to `IS NULL`
  // and would silently match zero rows, surfacing as a spurious 409.
  const timePin = (column: typeof absences.start_time | typeof absences.end_time, value: string | null) =>
    value === null ? isNull(column) : eq(column, value);
  const casConditions = [
    omitted.absence_type_id ? eq(absences.absence_type_id, existing.absence_type_id) : undefined,
    omitted.is_full_day ? eq(absences.is_full_day, existing.is_full_day) : undefined,
    omitted.start_time ? timePin(absences.start_time, existing.start_time) : undefined,
    omitted.end_time ? timePin(absences.end_time, existing.end_time) : undefined,
  ].filter((c) => c !== undefined);
  const updateWhere = casConditions.length > 0 ? and(ownershipWhere, ...casConditions) : ownershipWhere;

  try {
    const rows = await db.update(absences).set(parsed.data).where(updateWhere).returning({
      id: absences.id,
      employee_id: absences.employee_id,
      absence_type_id: absences.absence_type_id,
      date: absences.date,
      is_full_day: absences.is_full_day,
      start_time: absences.start_time,
      end_time: absences.end_time,
      comment: absences.comment,
      substitute_employee_id: absences.substitute_employee_id,
      created_at: absences.created_at,
      updated_at: absences.updated_at,
    });
    if (rows.length === 0) {
      // Zero rows means either the target is gone (404) or a concurrent write moved one of
      // the fields we pinned above (409). Only worth a second query on this rare path.
      const stillExists =
        casConditions.length > 0 &&
        (await db.select({ id: absences.id }).from(absences).where(ownershipWhere)).length > 0;
      return stillExists
        ? json({ error: "Wpis został w międzyczasie zmieniony. Odśwież stronę i spróbuj ponownie." }, 409)
        : json({ error: "Nie znaleziono." }, 404);
    }
    return json(rows[0], 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "PATCH /api/absences/:id" } });
    const code = extractPgErrorCode(err);
    if (code === "42501") return json({ error: "Brak dostępu." }, 403);
    if (code === "23503") {
      // 23503 can come from either FK on absences; name the right one.
      if (extractPgErrorConstraint(err) === "absences_absence_type_id_fkey")
        return json({ error: "Nie znaleziono wybranego typu nieobecności." }, 422);
      return json({ error: "Nie znaleziono pracownika na zastępstwo." }, 422);
    }
    if (code === "23505") return json({ error: "Masz już wpis nieobecności na ten dzień." }, 409);
    if (code === "23514") return json({ error: "Nieprawidłowa kombinacja godzin i trybu całodniowego." }, 400);
    return json({ error: "Błąd bazy danych." }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Brak autoryzacji." }, 401);
  }

  const id = context.params.id;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) {
    return json({ error: "Nieprawidłowy identyfikator." }, 400);
  }

  const db = createDb(DATABASE_URL);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "DELETE /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Nie znaleziono rekordu pracownika." }, 403);
  }

  try {
    const deleted = await db
      .delete(absences)
      .where(
        employeeRow.role === "moderator"
          ? eq(absences.id, id)
          : and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id)),
      )
      .returning({ id: absences.id });
    if (deleted.length === 0) return json({ error: "Nie znaleziono." }, 404);
    return new Response(null, { status: 204 });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "DELETE /api/absences/:id" } });
    const code = extractPgErrorCode(err);
    if (code === "42501") return json({ error: "Brak dostępu." }, 403);
    return json({ error: "Błąd bazy danych." }, 500);
  }
};
