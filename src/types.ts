import { employees, absence_types, absences, holiday_balances } from "@/db/schema";

export type UserRole = "employee" | "moderator";
export type Employee = typeof employees.$inferSelect;
export type AbsenceType = typeof absence_types.$inferSelect;
export type Absence = typeof absences.$inferSelect;

export type AbsenceInsert = typeof absences.$inferInsert;
export type AbsenceUpdate = Partial<Omit<AbsenceInsert, "employee_id">>;

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
  valid_until: string | null;
  used_days: number;
  left_days: number;
}
