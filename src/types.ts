import { employees, absence_types, absences, holiday_balances } from "@/db/schema";

export type UserRole = "employee" | "moderator";
export type Employee = typeof employees.$inferSelect;
/**
 * An employee row as a `client:load` island may receive it: everything except `user_id`.
 *
 * Astro serializes island props into the page HTML, so anything in a prop is readable by every
 * signed-in browser. `user_id` is the Supabase Auth identifier and no component reads it, so it
 * must not travel — the same rule `GET /api/employees` already follows by omitting the column
 * from its select (employees/index.ts:35-43), and the one
 * `employee-management/reviews/impl-review-phases-2-4.md` F2 records.
 *
 * Use `Employee` on the server (routes, `src/lib/`) and `EmployeeListItem` for anything that
 * crosses into a component prop.
 */
export type EmployeeListItem = Omit<Employee, "user_id">;
export type AbsenceType = typeof absence_types.$inferSelect;
export type Absence = typeof absences.$inferSelect;

export type AbsenceInsert = typeof absences.$inferInsert;
export type AbsenceUpdate = Partial<Omit<AbsenceInsert, "employee_id">>;

// POST /api/absences/bulk — one employee, N dates, one set of shared fields. Every field
// except the date is genuinely shared across the days of one absence, which is what lets a
// range be collected once and written once.
export interface AbsenceBulkCreateCommand {
  /** Moderator-only; ignored for an employee, who always writes their own column. */
  employee_id?: string;
  /** `YYYY-MM-DD`, weekdays only, no duplicates, at most one rendered month's worth. */
  dates: string[];
  absence_type_id: number;
  is_full_day: boolean;
  start_time: string | null;
  end_time: string | null;
  comment: string | null;
  substitute_employee_id: string | null;
}

// The write is an upsert, so "what happened to each day" is not derivable from the status code
// alone — the two date lists are how a caller learns which days it replaced rather than created.
// The only other array-bodied route (PATCH /api/employees/order) reports no per-item outcome;
// this is that shape extended rather than copied.
export interface AbsenceBulkCreateResult {
  absences: Absence[];
  created_dates: string[];
  overwritten_dates: string[];
}

export type HolidayBalance = typeof holiday_balances.$inferSelect;

// API response shape: stored fields + computed Used + derived Left. When no row exists
// for (employee, year), the API synthesizes one with balance_id: null and zeroed entitlement
// so the dashboard card always renders.
export interface HolidayBalanceView {
  balance_id: string | null;
  employee_id: string;
  year: number;
  current_entitlement_days: number;
  carryover_days: number;
  used_adjustment_days: number;
  used_days: number;
  left_days: number;
}
