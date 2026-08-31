export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { eq, isNull, and, gte, lt, asc } from "drizzle-orm";
import { LIST_LIMIT, YearSchema, absenceListColumns, absenceEmployeeJoin, json, yearWindow } from "@/lib/absence-list";
import { DateSchema, TimeSchema } from "@/lib/validators";
import {
  extractDbErrorCode,
  SQLITE_CONSTRAINT_CHECK,
  SQLITE_CONSTRAINT_FOREIGNKEY,
  SQLITE_CONSTRAINT_UNIQUE,
} from "@/lib/db-errors";
import { PARTIAL_DAY_TYPE_NAMES, PRIORITY_TYPE_NAMES } from "@/lib/absence-types";
import { isPartialDayViolation } from "@/lib/services/absence-partial-day";
import { isPriorityViolation } from "@/lib/services/absence-priority";
import { clampAbsenceHours, clampRejectionMessage } from "@/lib/absence-hours";
import { assertAbsenceTypeExists, resolveAbsenceWriteTarget } from "@/lib/absence-write-target";
import { reportError } from "@/lib/report";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Brak autoryzacji." }, 401);
  }

  const yearParam = context.url.searchParams.get("year");
  const fromParam = context.url.searchParams.get("from");
  const toParam = context.url.searchParams.get("to");

  const yearParsed = YearSchema.safeParse(yearParam);
  const fromParsed = DateSchema.safeParse(fromParam);
  const toParsed = DateSchema.safeParse(toParam);

  if (yearParam !== null && (fromParam !== null || toParam !== null)) {
    return json({ error: "Podaj year=YYYY albo from=YYYY-MM-DD&to=YYYY-MM-DD, nie oba naraz." }, 400);
  }

  const useYearMode = yearParsed.success;
  const useDateRangeMode = !useYearMode && fromParsed.success && toParsed.success;

  if (!useYearMode && !useDateRangeMode) {
    return json({ error: "Podaj year=YYYY albo from=YYYY-MM-DD&to=YYYY-MM-DD." }, 400);
  }

  const db = createDb(DATABASE_PATH);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    reportError(err, { tags: { route: "GET /api/absences" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Nie znaleziono rekordu pracownika." }, 403);
  }

  let from: string;
  let to: string;

  if (useYearMode) {
    ({ from, to } = yearWindow(yearParsed.data));
  } else if (fromParsed.success && toParsed.success) {
    from = fromParsed.data;
    if (new Date(from + "T00:00:00Z") > new Date(toParsed.data + "T00:00:00Z")) {
      return json({ error: "Parametr from musi być wcześniejszy lub równy to." }, 400);
    }
    const toDate = new Date(toParsed.data + "T00:00:00Z");
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    to = toDate.toISOString().slice(0, 10);
    const spanMs = new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime();
    if (spanMs > 90 * 24 * 60 * 60 * 1000) {
      return json({ error: "Zakres dat przekracza maksimum 90 dni." }, 400);
    }
  } else {
    return json({ error: "Podaj year=YYYY albo from=YYYY-MM-DD&to=YYYY-MM-DD." }, 400);
  }

  // Shared with `GET /api/absences/stats` — see `@/lib/absence-list` for why both
  // arms carry `visibleEmployeesFilter()` and only the employee arm guards `deleted_at`.
  const joinCondition = absenceEmployeeJoin(employeeRow.role);

  try {
    const data = await db
      .select(absenceListColumns)
      .from(absences)
      // No employee_id filter: the team grid shows all employees' absences to every user.
      // `GET /api/absences/stats` is the scoped counterpart for the Statystyki tab.
      .innerJoin(employees, joinCondition)
      .where(and(gte(absences.date, from), lt(absences.date, to)))
      .orderBy(asc(absences.date))
      // Probe one past the cap so "exactly LIST_LIMIT rows" is distinguishable from
      // "there were more". Statistics and the Details yearly view render AGGREGATES over
      // this list, so a silent truncation would make their totals wrong with no visible
      // cue — the extra row is what lets them say so instead.
      .limit(LIST_LIMIT + 1);
    const truncated = data.length > LIST_LIMIT;
    return json(truncated ? data.slice(0, LIST_LIMIT) : data, 200, {
      "X-Result-Truncated": truncated ? "1" : "0",
    });
  } catch (err) {
    reportError(err, { tags: { route: "GET /api/absences" } });
    return json({ error: "Błąd bazy danych." }, 500);
  }
};

const AbsenceCreateSchema = z
  .object({
    employee_id: z.uuid().optional(),
    absence_type_id: z.number().int().positive(),
    // DateSchema, not a bare `/^\d{4}-\d{2}-\d{2}$/`: that regex accepts 2026-02-31, which used to
    // be rejected by the Postgres `date` column and surfaced as a 500. SQLite stores dates as TEXT
    // and accepts anything, so the impossible day would be *stored* and then render as a phantom
    // cell. `bulk.ts` has validated this way since it was written.
    date: DateSchema,
    is_full_day: z.boolean(),
    start_time: TimeSchema.nullable(),
    end_time: TimeSchema.nullable(),
    comment: z.string().max(500).nullable(),
    // Informational marker, allowed only on the leave types in PRIORITY_TYPE_NAMES — enforced by
    // the handler-level guard below, since the rule is keyed off the type *name* and the body
    // carries only an id. Defaulted so a client that predates the flag keeps writing valid rows.
    is_priority: z.boolean().optional().default(false),
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
  );

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
    reportError(err, { tags: { route: "POST /api/absences" } });
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

  const parsed = AbsenceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const { employee_id: requestedEmployeeId, ...absenceData } = parsed.data;

  // Who this write lands on, and whether it is allowed to — resolution, the target's existence,
  // the `is_system` invariant on both the target and the substitute, in one call shared with
  // `absences/bulk.ts` so the two routes cannot drift apart again.
  const writeTarget = await resolveAbsenceWriteTarget(
    db,
    employeeRow,
    { employeeId: requestedEmployeeId, substituteEmployeeId: absenceData.substitute_employee_id },
    "POST /api/absences",
  );
  if (writeTarget instanceof Response) {
    return writeTarget;
  }
  const { targetEmployeeId } = writeTarget;

  // The absence type must exist. Resolved here rather than left to the FK: SQLite names neither
  // constraint nor column in a foreign-key error, so the catch below can no longer tell this case
  // apart from an unknown substitute. Runs before the partial-day guard, whose own
  // nonexistent-type fallback would answer 400 "hours are only available for these types" — the
  // wrong problem — for a full-day write it never even queries.
  const unknownType = await assertAbsenceTypeExists(db, absenceData.absence_type_id, "POST /api/absences");
  if (unknownType) {
    return unknownType;
  }

  // Domain rule: partial-day (time-range) entries are allowed only for the training types
  // in PARTIAL_DAY_TYPE_NAMES; every other type is full-day only.
  let partialDayViolation: boolean;
  try {
    partialDayViolation = await isPartialDayViolation(db, absenceData.absence_type_id, absenceData.is_full_day);
  } catch (err) {
    reportError(err, { tags: { route: "POST /api/absences" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (partialDayViolation) {
    return json({ error: `Godziny są dostępne tylko dla typów: ${PARTIAL_DAY_TYPE_NAMES.join(", ")}` }, 400);
  }

  // Domain rule: the informational priority marker is allowed only for the leave types in
  // PRIORITY_TYPE_NAMES. Same shape and same position as the partial-day guard — after
  // `assertAbsenceTypeExists`, whose 422 would otherwise be masked by this guard's
  // undefined-name fallback.
  let priorityViolation: boolean;
  try {
    priorityViolation = await isPriorityViolation(db, absenceData.absence_type_id, absenceData.is_priority);
  } catch (err) {
    reportError(err, { tags: { route: "POST /api/absences" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (priorityViolation) {
    return json({ error: `Priorytet jest dostępny tylko dla typów: ${PRIORITY_TYPE_NAMES.join(", ")}` }, 400);
  }

  // Domain rule: a partial-day range starts no earlier than MIN_START_TIME and runs no longer
  // than one working day. Clamped rather than rejected — the stored row goes back in the 201
  // body (`.returning(...)` below), so a corrected range is visible to the caller.
  // The schema's refine above guarantees both times are present when is_full_day is false.
  if (!absenceData.is_full_day && absenceData.start_time !== null && absenceData.end_time !== null) {
    const clamped = clampAbsenceHours(absenceData.start_time, absenceData.end_time);
    if (!clamped.ok) {
      return json({ error: clampRejectionMessage(clamped.reason) }, 400);
    }
    absenceData.start_time = clamped.startTime;
    absenceData.end_time = clamped.endTime;
  }

  try {
    const [absenceRow] = await db
      .insert(absences)
      .values({ employee_id: targetEmployeeId, ...absenceData })
      .returning({
        id: absences.id,
        employee_id: absences.employee_id,
        absence_type_id: absences.absence_type_id,
        date: absences.date,
        is_full_day: absences.is_full_day,
        start_time: absences.start_time,
        end_time: absences.end_time,
        comment: absences.comment,
        is_priority: absences.is_priority,
        substitute_employee_id: absences.substitute_employee_id,
        created_at: absences.created_at,
        updated_at: absences.updated_at,
      });
    return json(absenceRow, 201);
  } catch (err) {
    reportError(err, { tags: { route: "POST /api/absences" } });
    const code = extractDbErrorCode(err);
    // Both references are resolved above, so a foreign-key error surviving to here means the row
    // one of them found was deleted between that lookup and this insert. SQLite names nothing in
    // the error, so which one is unknowable — hence one message rather than the pair the
    // pre-flight checks return. 422 because retrying with a fresh selection is the caller's fix.
    if (code === SQLITE_CONSTRAINT_FOREIGNKEY) return json({ error: "Nie znaleziono powiązanego rekordu." }, 422);
    if (code === SQLITE_CONSTRAINT_UNIQUE) return json({ error: "Masz już wpis nieobecności na ten dzień." }, 409);
    if (code === SQLITE_CONSTRAINT_CHECK)
      return json({ error: "Nieprawidłowa kombinacja godzin i trybu całodniowego." }, 400);
    return json({ error: "Błąd bazy danych." }, 500);
  }
};
