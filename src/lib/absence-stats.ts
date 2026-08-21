import type { Absence, EmployeeListItem, AbsenceType } from "@/types";
import { FULL_DAY_HOURS, hoursToDays } from "@/lib/hours";

// The absence → matrix aggregation behind the Statystyki tab, independent of rendering —
// matching how `@/lib/medals` and `@/lib/hours` already sit behind that component.
//
// It lives here so it can be unit-tested, which is what makes the single-employee case the
// role-scoped self view always produces provable rather than eyeballed.
//
// Dependency-light on purpose: safe to import from both React islands and server routes.

/** Absence duration in hours: a full day is FULL_DAY_HOURS, a partial day its time span. */
export function getAbsenceHours(a: Absence): number {
  if (a.is_full_day) return FULL_DAY_HOURS;
  const [sh, sm] = (a.start_time ?? "00:00").slice(0, 5).split(":").map(Number);
  const [eh, em] = (a.end_time ?? "00:00").slice(0, 5).split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

export interface MatrixData {
  /** `${employeeId}_${typeId}` → day count (partial days folded in as fractions). */
  cells: Map<string, number>;
  /** Parallel to `employees`. */
  perEmployee: number[];
  /** Parallel to `absenceTypes`. */
  perType: number[];
  grand: number;
  maxEmployeeTotal: number;
  employeesWithAbsence: number;
}

// The split between whole days and partial hours is still needed to convert correctly —
// only the *display* collapses to one figure (reverses S-02's separate-units decision,
// context/archive/2026-05-30-details-and-stats/plan-brief.md:24).
export function buildMatrix(
  absences: Absence[],
  employees: EmployeeListItem[],
  absenceTypes: AbsenceType[],
): MatrixData {
  const raw = new Map<string, { days: number; hours: number }>();
  for (const absence of absences) {
    const key = `${absence.employee_id}_${absence.absence_type_id}`;
    const current = raw.get(key) ?? { days: 0, hours: 0 };
    if (absence.is_full_day) current.days += 1;
    else current.hours += getAbsenceHours(absence);
    raw.set(key, current);
  }

  const cells = new Map<string, number>();
  for (const [key, { days, hours }] of raw) {
    cells.set(key, days + hoursToDays(hours));
  }

  const perEmployee = employees.map((emp) =>
    absenceTypes.reduce((sum, type) => sum + (cells.get(`${emp.id}_${type.id}`) ?? 0), 0),
  );
  const perType = absenceTypes.map((type) =>
    employees.reduce((sum, emp) => sum + (cells.get(`${emp.id}_${type.id}`) ?? 0), 0),
  );

  return {
    cells,
    perEmployee,
    perType,
    grand: perType.reduce((a, b) => a + b, 0),
    // A divisor for the per-row stacked bar — never 0, so an all-zero matrix does not
    // produce NaN widths.
    maxEmployeeTotal: Math.max(1, ...perEmployee),
    employeesWithAbsence: perEmployee.filter((t) => t > 0).length,
  };
}
