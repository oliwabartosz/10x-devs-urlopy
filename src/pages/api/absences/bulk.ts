export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { eq, isNull, and, inArray } from "drizzle-orm";
import { DateSchema, TimeSchema } from "@/lib/validators";
import { extractDbErrorCode, SQLITE_CONSTRAINT_CHECK, SQLITE_CONSTRAINT_FOREIGNKEY } from "@/lib/db-errors";
import { PARTIAL_DAY_TYPE_NAMES } from "@/lib/absence-types";
import { isPartialDayViolation } from "@/lib/services/absence-partial-day";
import { clampAbsenceHours, clampRejectionMessage } from "@/lib/absence-hours";
import { isWeekendDateKey } from "@/lib/absence-range";
import { json } from "@/lib/absence-list";
import { assertAbsenceTypeExists, resolveAbsenceWriteTarget } from "@/lib/absence-write-target";
import type { AbsenceBulkCreateResult } from "@/types";

// Writes N days of one absence in a single atomic statement, overwriting whatever those days
// already held.
//
// Deliberately a separate route from POST /api/absences rather than an extension of it. The
// single-row path is the one every click-to-add goes through; it has its own E2E coverage and a
// singular 23505 -> 409 message that only makes sense for one date. Widening it to N dates would
// put that proven path at risk for a caller it never serves.
//
// **This route re-validates everything the gesture claims to have done** — weekday, calendar
// validity, partial-day eligibility, hour bounds. Not defensiveness for its own sake: no database
// policy backstops a hand-crafted body (RLS was already bypassed on the service-role connection
// and does not exist at all on SQLite), and the server has had no weekday rule at any layer until
// now.

/**
 * Ceiling on one request's date list.
 *
 * 31 is the natural cap rather than an arbitrary one: a selection is a vertical run inside a
 * single rendered month, so it cannot address more days than the longest month has. It exists so
 * one request cannot address an unbounded span.
 */
const MAX_BULK_DATES = 31;

const AbsenceBulkCreateSchema = z
  .object({
    employee_id: z.uuid().optional(),
    // DateSchema does real calendar validation, which the create route now shares — it used to
    // carry a bare `/^\d{4}-\d{2}-\d{2}$/` and lean on the Postgres `date` column to reject
    // 2026-02-31 as a 500-shaped failure. SQLite's TEXT column rejects nothing, so this is the
    // only layer that stands between an impossible day and a stored row.
    dates: z
      .array(DateSchema)
      .min(1, "Podaj co najmniej jeden dzień.")
      .max(MAX_BULK_DATES, `Zakres nie może obejmować więcej niż ${MAX_BULK_DATES.toString()} dni.`),
    absence_type_id: z.number().int().positive(),
    is_full_day: z.boolean(),
    start_time: TimeSchema.nullable(),
    end_time: TimeSchema.nullable(),
    comment: z.string().max(500).nullable(),
    substitute_employee_id: z.uuid().nullable(),
  })
  .refine(
    (d) =>
      d.is_full_day
        ? d.start_time === null && d.end_time === null
        : d.start_time !== null && d.end_time !== null && d.end_time > d.start_time, // string compare valid: TimeSchema guarantees HH:MM format
    {
      message:
        "Dla całego dnia godziny muszą pozostać puste; dla wpisu godzinowego podaj obie godziny, a zakończenie musi być późniejsze niż rozpoczęcie.",
    },
  )
  // Rejected, not de-duplicated. A repeated conflict target inside one ON CONFLICT statement is
  // rejected by the engine either way — Postgres raised 21000 ("cannot affect row a second time"),
  // SQLite raises a plain SQLITE_ERROR — so it has to be caught before the insert regardless, and
  // the gesture cannot produce a duplicate, so one arriving means a caller bug worth surfacing
  // rather than quietly papering over.
  .refine((d) => new Set(d.dates).size === d.dates.length, {
    message: "Lista dni zawiera duplikaty.",
  });

const RETURNED_COLUMNS = {
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
};

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Brak autoryzacji." }, 401);
  }

  const db = createDb(DATABASE_PATH);

  // `is_system` is selected for the write-target guard below: the technical admin is seeded as a
  // moderator, so the caller's own row is one of the two ways an admin absence could be written.
  let employeeRow: { id: string; role: "employee" | "moderator"; is_system: boolean } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role, is_system: employees.is_system })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/absences/bulk" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Nie znaleziono rekordu pracownika." }, 403);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania." }, 400);
  }

  const parsed = AbsenceBulkCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const { employee_id: requestedEmployeeId, dates: requestedDates, ...sharedFields } = parsed.data;

  // Sorted so the written rows, the two report lists and the insert order all read in calendar
  // order regardless of what order the caller listed them in.
  const dates = [...requestedDates].sort();

  // Who this write lands on, and whether it is allowed to — resolution, the target's existence,
  // the `is_system` invariant on both the target and the substitute. Shared with the single-row
  // route rather than copied from it: this block *was* a verbatim copy, and that is how it
  // inherited the missing admin check in the first place.
  const writeTarget = await resolveAbsenceWriteTarget(
    db,
    employeeRow,
    { employeeId: requestedEmployeeId, substituteEmployeeId: sharedFields.substitute_employee_id },
    "POST /api/absences/bulk",
  );
  if (writeTarget instanceof Response) {
    return writeTarget;
  }
  const { targetEmployeeId } = writeTarget;

  // The shared absence type must exist. Resolved here rather than left to the FK, which under
  // SQLite names neither constraint nor column and so cannot be told apart from an unknown
  // substitute. Once per request, not per row — every row carries the same type.
  const unknownType = await assertAbsenceTypeExists(db, sharedFields.absence_type_id, "POST /api/absences/bulk");
  if (unknownType) {
    return unknownType;
  }

  // 1. Weekday rule. The client drops weekends silently while building a range; a weekend date
  //    that still reaches here can only come from a client bug or a hand-crafted request, so it
  //    fails the whole request loudly and names the offending days rather than being dropped.
  const weekendDates = dates.filter(isWeekendDateKey);
  if (weekendDates.length > 0) {
    return json({ error: `Nieobecności nie można zapisać w weekend: ${weekendDates.join(", ")}.` }, 400);
  }

  // 2. Partial-day eligibility, once on the shared type rather than per row — via the shared
  //    server guard, not a re-implementation of it.
  let partialDayViolation: boolean;
  try {
    partialDayViolation = await isPartialDayViolation(db, sharedFields.absence_type_id, sharedFields.is_full_day);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/absences/bulk" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (partialDayViolation) {
    return json({ error: `Godziny są dostępne tylko dla typów: ${PARTIAL_DAY_TYPE_NAMES.join(", ")}` }, 400);
  }

  // 3. Hour clamp, once on the shared window. The clamped values are what every one of the N rows
  //    stores — running it per row would be identical work for an identical answer, but skipping
  //    it because "the client already clamped" is precisely the failure this route exists to
  //    prevent. The schema's refine guarantees both times are present when is_full_day is false.
  if (!sharedFields.is_full_day && sharedFields.start_time !== null && sharedFields.end_time !== null) {
    const clamped = clampAbsenceHours(sharedFields.start_time, sharedFields.end_time);
    if (!clamped.ok) {
      return json({ error: clampRejectionMessage(clamped.reason) }, 400);
    }
    sharedFields.start_time = clamped.startTime;
    sharedFields.end_time = clamped.endTime;
  }

  // Which days already hold an entry, asked *before* the upsert — afterwards every day looks
  // occupied. Two round trips rather than one, which buys the per-day reporting the client needs
  // and the single array-bodied precedent (PATCH /api/employees/order) conspicuously lacks.
  //
  // The gap between this read and the write is not protected. A concurrent write landing in it
  // would be reported as created when it was in fact overwritten — the report would be wrong, but
  // the write itself stays correct and atomic, and the alternative (locking, or a serializable
  // transaction) is a pattern this repo does not have and this feature does not need.
  let occupiedBefore: string[];
  try {
    occupiedBefore = await db
      .select({ date: absences.date })
      .from(absences)
      .where(and(eq(absences.employee_id, targetEmployeeId), inArray(absences.date, dates)))
      .then((rows) => rows.map((r) => r.date));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/absences/bulk" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  const overwritten = new Set(occupiedBefore);

  try {
    // 4. One multi-row INSERT ... ON CONFLICT DO UPDATE against (employee_id, date) — the unique
    //    constraint that makes one occupied day abort a plain multi-row INSERT is exactly what
    //    makes the overwrite expressible here. A single statement is already atomic, so there is
    //    deliberately no db.transaction(): the repo has no such pattern and does not need one.
    const rows = await db
      .insert(absences)
      .values(dates.map((date) => ({ employee_id: targetEmployeeId, date, ...sharedFields })))
      .onConflictDoUpdate({
        target: [absences.employee_id, absences.date],
        set: {
          absence_type_id: sharedFields.absence_type_id,
          is_full_day: sharedFields.is_full_day,
          start_time: sharedFields.start_time,
          end_time: sharedFields.end_time,
          comment: sharedFields.comment,
          substitute_employee_id: sharedFields.substitute_employee_id,
          updated_at: new Date(),
        },
      })
      .returning(RETURNED_COLUMNS);

    return json(
      {
        absences: rows,
        created_dates: dates.filter((d) => !overwritten.has(d)),
        overwritten_dates: dates.filter((d) => overwritten.has(d)),
      } satisfies AbsenceBulkCreateResult,
      201,
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/absences/bulk" } });
    const code = extractDbErrorCode(err);
    // Both references are resolved above, so a foreign-key error here means the row one of those
    // lookups found was deleted before this insert landed. SQLite names nothing in the error, so
    // which one is unknowable — one message rather than the pair the pre-flight checks return.
    if (code === SQLITE_CONSTRAINT_FOREIGNKEY) return json({ error: "Nie znaleziono powiązanego rekordu." }, 422);
    // No unique-violation arm: the upsert makes one on (employee_id, date) unreachable, which is
    // the whole point of this route. A duplicate *within* one body is caught by the schema.
    if (code === SQLITE_CONSTRAINT_CHECK)
      return json({ error: "Nieprawidłowa kombinacja godzin i trybu całodniowego." }, 400);
    return json({ error: "Błąd bazy danych." }, 500);
  }
};
