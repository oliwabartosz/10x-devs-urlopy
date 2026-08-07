// The hours-to-days divisor, in one place.
//
// It was duplicated between the balance service and the statistics island; the statistics
// matrix is now a third consumer, so it lives here and both former copies import it.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.

export const FULL_DAY_HOURS = 8;

/**
 * Convert absence hours to fractional days.
 *
 * Deliberately unrounded. `computeUsedDays` feeds this straight into the holiday balance,
 * where rounding here would move a figure users read off the balance card. Rounding is a
 * display decision — see `formatDayCount`.
 */
export function hoursToDays(hours: number): number {
  return hours / FULL_DAY_HOURS;
}

/**
 * Render a day count for display: Polish decimal comma, at most one fraction digit.
 *
 * This is where the rounding boundary lives. A 3h45m absence is 0.46875 days and reads
 * as "0,5", not "0,4".
 */
export function formatDayCount(days: number): string {
  return days.toLocaleString("pl-PL", { maximumFractionDigits: 1 });
}
