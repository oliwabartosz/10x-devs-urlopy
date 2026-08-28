import * as Sentry from "@sentry/astro";
import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absence_types, absences } from "@/db/schema";
import type { HolidayBalance, HolidayBalanceView } from "@/types";
import { hoursToDays } from "@/lib/hours";
import { getAbsenceHours } from "@/lib/absence-stats";

/**
 * Count Used vacation days for an employee in a calendar year.
 *
 * Used = full-day `urlop` count + hoursToDays(partial-day `urlop` hours) + used_adjustment_days.
 * The `urlop` type is resolved by name, which naturally excludes `urlop planowany` (S-13).
 * If no `urlop` type row exists, degrade to `used_adjustment_days` and Sentry-log — never throw.
 */
export async function computeUsedDays(
  db: Db,
  employeeId: string,
  year: number,
  usedAdjustmentDays: number,
): Promise<number> {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;

  const typeRow: { id: number } | undefined = await db
    .select({ id: absence_types.id })
    .from(absence_types)
    .where(eq(absence_types.name, "urlop"))
    .then((r) => r[0]);

  if (!typeRow) {
    Sentry.captureMessage("holiday-balance: no 'urlop' absence type found; degrading Used to adjustment only", {
      level: "warning",
      tags: { service: "holiday-balance" },
    });
    return usedAdjustmentDays;
  }

  // Aggregated in JS rather than in SQL. SQLite has no interval arithmetic, so the old
  // `extract(epoch from (end_time - start_time))` has no equivalent — and `start_time`/`end_time`
  // are now TEXT 'HH:MM', which is exactly what `getAbsenceHours` already parses for the
  // statistics matrix. The row set is bounded by one employee's absences of one type in one
  // year, so reading it costs nothing and both figures fall out of a single query.
  const rows = await db
    .select({
      is_full_day: absences.is_full_day,
      start_time: absences.start_time,
      end_time: absences.end_time,
    })
    .from(absences)
    .where(
      and(
        eq(absences.employee_id, employeeId),
        eq(absences.absence_type_id, typeRow.id),
        gte(absences.date, from),
        lt(absences.date, to),
      ),
    );

  // Whole days and partial hours stay separate all the way to the sum: `hoursToDays` is applied
  // only to the partial hours, as it was when Postgres computed the two columns.
  const fullDays = rows.filter((r) => r.is_full_day).length;
  const partialHours = rows.filter((r) => !r.is_full_day).reduce((total, r) => total + getAbsenceHours(r), 0);

  return fullDays + hoursToDays(partialHours) + usedAdjustmentDays;
}

/**
 * Build the API response shape from a stored balance row (or lack of one) plus computed Used.
 * When `row` is null the card still renders: zeroed entitlement, `balance_id: null`.
 * left = current_entitlement + carryover − used (used already includes used_adjustment_days).
 */
export async function buildBalanceView(
  db: Db,
  employeeId: string,
  year: number,
  row: HolidayBalance | null,
): Promise<HolidayBalanceView> {
  const usedAdjustmentDays = row?.used_adjustment_days ?? 0;
  const currentEntitlement = row?.current_entitlement_days ?? 0;
  const carryover = row?.carryover_days ?? 0;

  const usedDays = await computeUsedDays(db, employeeId, year, usedAdjustmentDays);
  const leftDays = currentEntitlement + carryover - usedDays;

  return {
    balance_id: row?.id ?? null,
    employee_id: employeeId,
    year,
    current_entitlement_days: currentEntitlement,
    carryover_days: carryover,
    used_adjustment_days: usedAdjustmentDays,
    used_days: usedDays,
    left_days: leftDays,
  };
}
