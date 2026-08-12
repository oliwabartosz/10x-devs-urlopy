// What time text a monthly-grid cell may display.
//
// The rule lives here rather than inline in AbsenceGrid so it is testable: vitest runs in a
// node environment with no jsdom and no @testing-library/react, so a React island's render
// output is not reachable from a test, but a pure function is.
//
// The gate: a cell shows HH:MM only for the types the product permits partial days on
// (src/lib/absence-types.ts). The previous inline helper keyed only off is_full_day plus the
// two times, never the type — and no database constraint ties the times to absence_type_id
// (20260605000001_absence_start_end_time.sql ties them only to is_full_day), so a row reaching
// the table outside the API routes rendered hours for any of the seven types. Such a row has
// existed in production before (see 20260811120000_purge_demo_partial_day_absences.sql).
//
// Deliberately NOT applied to the cell's tooltip: see the `Godziny:` line in
// AbsenceGrid.buildTooltip, which reports the stored hours ungated so an out-of-contract row
// stays visible to a moderator instead of being silently hidden.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
import type { Absence } from "@/types";
import { typeAllowsPartialDay } from "@/lib/absence-types";

/** `HH:MM:SS` (Postgres `time`) → `HH:MM`. Empty string for a missing value. */
export function formatTime(t: string | null | undefined): string {
  return t?.slice(0, 5) ?? "";
}

/**
 * The time range a grid cell may render for this absence, or `""` for none.
 *
 * `""` when the absence is full-day, when either time is missing, or when the type is not
 * on the partial-day whitelist. Otherwise `HH:MM–HH:MM` joined by U+2013 EN DASH with no
 * surrounding spaces — the cell is ~120px wide, so the spaces are not affordable.
 */
export function cellTimeRange(
  absence: Pick<Absence, "is_full_day" | "start_time" | "end_time">,
  typeName: string | null | undefined,
): string {
  if (absence.is_full_day || !absence.start_time || !absence.end_time) return "";
  if (!typeAllowsPartialDay(typeName)) return "";
  return `${formatTime(absence.start_time)}–${formatTime(absence.end_time)}`;
}
