import * as Sentry from "@sentry/cloudflare";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absence_types, absences } from "@/db/schema";
import type { HolidayBalance, HolidayBalanceView } from "@/types";

// Must equal FULL_DAY_HOURS in src/components/absence/AbsenceStats.tsx:12. A partial-day
// urlop absence contributes `hours / FULL_DAY_HOURS` days. If that constant ever changes,
// both must move together.
const FULL_DAY_HOURS = 8;

/**
 * Count Used vacation days for an employee in a calendar year.
 *
 * Used = full-day `urlop` count + (partial-day `urlop` hours / 8) + used_adjustment_days.
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

  // count()/sum() come back as strings from postgres-js (bigint/numeric) — cast to number below.
  const [agg] = await db
    .select({
      fullDays: sql<string>`count(*) filter (where ${absences.is_full_day})`,
      partialHours: sql<string>`coalesce(sum(extract(epoch from (${absences.end_time} - ${absences.start_time})) / 3600) filter (where not ${absences.is_full_day}), 0)`,
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

  // An aggregate query always returns exactly one row; count()/coalesce(sum()) are never null.
  const fullDays = Number(agg.fullDays);
  const partialHours = Number(agg.partialHours);

  return fullDays + partialHours / FULL_DAY_HOURS + usedAdjustmentDays;
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
    valid_until: row?.valid_until ?? null,
    used_days: usedDays,
    left_days: leftDays,
  };
}
