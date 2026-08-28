export const prerender = false;

import type { APIRoute } from "astro";
import { createDb } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { employees, absences } from "@/db/index";
import { eq, isNull, and, gte, lt, asc } from "drizzle-orm";
import { LIST_LIMIT, YearSchema, absenceListColumns, absenceEmployeeJoin, json, yearWindow } from "@/lib/absence-list";
import { reportError } from "@/lib/report";

// The yearly dataset behind the Statystyki tab, scoped by the caller's role on the server.
//
// `GET /api/absences` stays deliberately team-wide — the grid and the Szczegóły table need
// every employee's rows. This route is its scoped counterpart: a moderator gets the same
// team join, anyone else gets their own rows only. Scope is derived from the caller's
// `role` column, never from a request parameter, so the client cannot widen it.
//
// Response body and `X-Result-Truncated` semantics are identical to `GET /api/absences?year=`
// so the component parses one contract.
//
// Scope, not secrecy. This route narrows what the Statystyki tab *renders*; it is not a
// confidentiality boundary over absence data. The same non-moderator can still call
// `GET /api/absences?year=` and receive the whole team — deliberately, because the Siatka grid
// and the Szczegóły table need it (see index.ts). What this change removes is the ranked,
// comparative presentation, not access to the underlying days. Do not build a privacy guarantee
// on top of this route without narrowing that one too.

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Brak autoryzacji." }, 401);
  }

  // Statistics are always a calendar year — no from/to mode, unlike the list route.
  const yearParsed = YearSchema.safeParse(context.url.searchParams.get("year"));
  if (!yearParsed.success) {
    return json({ error: "Podaj year=YYYY." }, 400);
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
    reportError(err, { tags: { route: "GET /api/absences/stats" } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (!employeeRow) {
    return json({ error: "Nie znaleziono rekordu pracownika." }, 403);
  }

  const { from, to } = yearWindow(yearParsed.data);

  // The scope rule, and the whole point of this route. The moderator arm is byte-identical
  // to the list route's join — a moderator's yearly matrix includes deactivated employees'
  // historical rows, and losing them here would be a silent regression. The employee arm
  // adds the own-rows filter on top of the shared join; `callerId` comes from the row looked
  // up by `locals.user.id` above, so no query parameter reaches this decision.
  const joinCondition =
    employeeRow.role === "moderator"
      ? absenceEmployeeJoin(employeeRow.role)
      : and(absenceEmployeeJoin(employeeRow.role), eq(absences.employee_id, employeeRow.id));

  try {
    const data = await db
      .select(absenceListColumns)
      .from(absences)
      .innerJoin(employees, joinCondition)
      .where(and(gte(absences.date, from), lt(absences.date, to)))
      .orderBy(asc(absences.date))
      // Probe one past the cap so "exactly LIST_LIMIT rows" is distinguishable from
      // "there were more". Every yearly figure the tab renders is an AGGREGATE over this
      // list, so a silent truncation would make all of them wrong at once with no visible
      // cue — the extra row is what lets the tab say so instead.
      .limit(LIST_LIMIT + 1);
    const truncated = data.length > LIST_LIMIT;
    return json(truncated ? data.slice(0, LIST_LIMIT) : data, 200, {
      "X-Result-Truncated": truncated ? "1" : "0",
    });
  } catch (err) {
    reportError(err, { tags: { route: "GET /api/absences/stats" } });
    return json({ error: "Błąd bazy danych." }, 500);
  }
};
