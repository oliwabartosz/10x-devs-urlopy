import { and, eq, isNull } from "drizzle-orm";
import { employees, absences } from "@/db/schema";
import { visibleEmployeesFilter } from "@/lib/employees";
import type { UserRole } from "@/types";

// The pieces `GET /api/absences` and `GET /api/absences/stats` both need, in one place.
//
// `bulk.ts` was created by copying `index.ts` verbatim and inherited a missing `is_system`
// guard that took months and a separate change to close (context/foundation/lessons.md).
// A second route over the same table composes from this module rather than copying the
// first one, so the join and the cap cannot drift apart again.
//
// Pure Drizzle fragments and plain values — no `createDb`, no `Response` — so both routes
// can import it and it stays unit-testable.

// Hard cap on a list response. Consumers that aggregate over the whole list (statistics,
// the Details yearly view) must know when they were handed a partial one, so GET reports
// truncation through the `X-Result-Truncated` header rather than silently returning short.
export const LIST_LIMIT = 5000;

/** The row shape both list routes return. Kept identical so consumers parse one contract. */
export const absenceListColumns = {
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

/**
 * Calendar-year window as a half-open `[from, to)` date pair.
 *
 * Half-open so the `gte`/`lt` pair below needs no leap-year or month-length reasoning:
 * `2026` → `["2026-01-01", "2027-01-01")`.
 */
export function yearWindow(year: string): { from: string; to: string } {
  return {
    from: `${year}-01-01`,
    to: `${(parseInt(year, 10) + 1).toString().padStart(4, "0")}-01-01`,
  };
}

/**
 * The absences→employees join condition, by caller role.
 *
 * `visibleEmployeesFilter()` on both arms: the Details table renders these rows raw, so an
 * is_system-owned absence would surface as an unnamed row carrying its date, type, hours and
 * comment. The employee lists are already scoped; this closes the same hole on the join
 * (context/changes/admin-bootstrap/plan.md).
 *
 * Regular employees: only active employees' absences (isNull guard on deleted_at).
 * Moderators: all absences including deactivated employees (historical data preservation).
 */
export function absenceEmployeeJoin(role: UserRole) {
  return role === "moderator"
    ? and(eq(absences.employee_id, employees.id), visibleEmployeesFilter())
    : and(eq(absences.employee_id, employees.id), isNull(employees.deleted_at), visibleEmployeesFilter());
}
