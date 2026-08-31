export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { and, eq, isNull } from "drizzle-orm";
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
import { assertAbsenceTypeExists, assertSubstituteAllowed } from "@/lib/absence-write-target";
import { reportError } from "@/lib/report";

const AbsenceUpdateSchema = z
  .object({
    absence_type_id: z.number().int().positive(),
    date: DateSchema,
    is_full_day: z.boolean(),
    start_time: TimeSchema.nullable(),
    end_time: TimeSchema.nullable(),
    comment: z.string().max(500).nullable(),
    is_priority: z.boolean(),
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

  const db = createDb(DATABASE_PATH);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    reportError(err, { tags: { route: "PATCH /api/absences/:id" } });
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
  //
  // `is_priority` is read for the same reason: a body that changes only the type must not leave
  // a stored flag on a now-ineligible type.
  let existing:
    | {
        absence_type_id: number;
        is_full_day: boolean;
        start_time: string | null;
        end_time: string | null;
        is_priority: boolean;
      }
    | undefined;
  try {
    existing = await db
      .select({
        absence_type_id: absences.absence_type_id,
        is_full_day: absences.is_full_day,
        start_time: absences.start_time,
        end_time: absences.end_time,
        is_priority: absences.is_priority,
      })
      .from(absences)
      .where(ownershipWhere)
      .then((r) => r[0]);
  } catch (err) {
    reportError(err, { tags: { route: "PATCH /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!existing) return json({ error: "Nie znaleziono." }, 404);

  // PATCH cannot retarget a row to another employee, so it cannot *create* an absence on the
  // technical admin — but it can name the admin as a substitute on a row it is allowed to edit,
  // which reaches the same forbidden state a POST would. Placed after the 404 above so a
  // nonexistent id is never answered "forbidden".
  const substituteRefusal = await assertSubstituteAllowed(
    db,
    parsed.data.substitute_employee_id,
    "PATCH /api/absences/:id",
  );
  if (substituteRefusal) return substituteRefusal;

  // A supplied absence type must exist — the other reference SQLite's foreign-key error can no
  // longer name. Only when the body supplies one: the stored value is already a valid reference.
  // Before the partial-day guard for the reason given in `assertAbsenceTypeExists`.
  const unknownType = await assertAbsenceTypeExists(db, parsed.data.absence_type_id, "PATCH /api/absences/:id");
  if (unknownType) return unknownType;

  // Captured before the clamp merges values into `parsed.data`: from here on, "the body
  // omitted this field" can no longer be read off `parsed.data`, and both the effective-value
  // resolution and the CAS pins below depend on it. Note `null` is a *supplied* value here
  // (it clears the range for a full-day switch), so `??` would resolve it wrongly.
  const omitted = {
    absence_type_id: parsed.data.absence_type_id === undefined,
    is_full_day: parsed.data.is_full_day === undefined,
    start_time: parsed.data.start_time === undefined,
    end_time: parsed.data.end_time === undefined,
    is_priority: parsed.data.is_priority === undefined,
  };

  const effectiveTypeId = parsed.data.absence_type_id ?? existing.absence_type_id;
  const effectiveIsFullDay = parsed.data.is_full_day ?? existing.is_full_day;
  const effectiveStartTime = omitted.start_time ? existing.start_time : (parsed.data.start_time ?? null);
  const effectiveEndTime = omitted.end_time ? existing.end_time : (parsed.data.end_time ?? null);
  const effectiveIsPriority = parsed.data.is_priority ?? existing.is_priority;

  let partialDayViolation: boolean;
  try {
    partialDayViolation = await isPartialDayViolation(db, effectiveTypeId, effectiveIsFullDay);
  } catch (err) {
    reportError(err, { tags: { route: "PATCH /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (partialDayViolation) {
    return json({ error: `Godziny są dostępne tylko dla typów: ${PARTIAL_DAY_TYPE_NAMES.join(", ")}` }, 400);
  }

  // Same shape, on the effective priority state. A body that changes only the type to an
  // ineligible one on a flagged row is rejected rather than silently clearing the flag: the
  // caller asked for something the rule forbids, and answering 400 is what makes that visible.
  let priorityViolation: boolean;
  try {
    priorityViolation = await isPriorityViolation(db, effectiveTypeId, effectiveIsPriority);
  } catch (err) {
    reportError(err, { tags: { route: "PATCH /api/absences/:id" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (priorityViolation) {
    return json({ error: `Priorytet jest dostępny tylko dla typów: ${PRIORITY_TYPE_NAMES.join(", ")}` }, 400);
  }

  // Same domain rule as POST, applied to the *effective* range.
  if (!effectiveIsFullDay && effectiveStartTime !== null && effectiveEndTime !== null) {
    const clamped = clampAbsenceHours(effectiveStartTime, effectiveEndTime);
    if (!clamped.ok) {
      // Rejecting is only meaningful when the caller supplied a time it can correct. When the
      // body patches neither, an unclampable range is pre-existing stored data — a legacy row
      // written before this rule, whose end sits at or before MIN_START_TIME so no floor can
      // repair it. Blocking here would put the row's comment, substitute and date permanently
      // out of reach of the API, which is the opposite of this change's premise that clamping
      // corrects rather than locks out. Leave the stored range as it is and let the rest of
      // the patch land; the CAS pins below still hold both columns to their read values.
      if (!omitted.start_time || !omitted.end_time) {
        return json({ error: clampRejectionMessage(clamped.reason) }, 400);
      }
    } else {
      // The clamped values are merged back into `parsed.data` so they reach the UPDATE's `set`
      // even for a column the body omitted — a body patching only `end_time` still corrects a
      // stored out-of-window start.
      parsed.data.start_time = clamped.startTime;
      parsed.data.end_time = clamped.endTime;
    }
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
    omitted.is_priority ? eq(absences.is_priority, existing.is_priority) : undefined,
  ].filter((c) => c !== undefined);
  const updateWhere = casConditions.length > 0 ? and(ownershipWhere, ...casConditions) : ownershipWhere;

  try {
    // `updated_at` is set explicitly. Postgres had an AFTER UPDATE trigger
    // (20260526000001_schema.sql:58-70) and this route was its only consumer; the trigger is not
    // ported, and `parsed.data` carries no `updated_at`, so without this the column would freeze
    // at insert time — silently, since it is still read back at `:210` and returned at `:222`.
    // `bulk.ts` and `holiday-balances/index.ts` already set it the same way.
    const rows = await db
      .update(absences)
      .set({ ...parsed.data, updated_at: new Date() })
      .where(updateWhere)
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
    reportError(err, { tags: { route: "PATCH /api/absences/:id" } });
    const code = extractDbErrorCode(err);
    // Both references are resolved above, so a foreign-key error here means the row one of those
    // lookups found was deleted before this UPDATE landed. SQLite names nothing in the error, so
    // which one is unknowable — one message rather than the pair the pre-flight checks return.
    if (code === SQLITE_CONSTRAINT_FOREIGNKEY) return json({ error: "Nie znaleziono powiązanego rekordu." }, 422);
    if (code === SQLITE_CONSTRAINT_UNIQUE) return json({ error: "Masz już wpis nieobecności na ten dzień." }, 409);
    if (code === SQLITE_CONSTRAINT_CHECK)
      return json({ error: "Nieprawidłowa kombinacja godzin i trybu całodniowego." }, 400);
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

  const db = createDb(DATABASE_PATH);

  let employeeRow: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    employeeRow = await db
      .select({ id: employees.id, role: employees.role })
      .from(employees)
      .where(and(eq(employees.user_id, context.locals.user.id), isNull(employees.deleted_at)))
      .then((r) => r[0]);
  } catch (err) {
    reportError(err, { tags: { route: "DELETE /api/absences/:id" } });
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
    reportError(err, { tags: { route: "DELETE /api/absences/:id" } });
    // No code discrimination left: the only arm here was Postgres `42501` (insufficient
    // privilege), which came from RLS. RLS never applied on the service-role connection and does
    // not exist on a local SQLite file, so every failure reaching here is a real server error.
    return json({ error: "Błąd bazy danych." }, 500);
  }
};
