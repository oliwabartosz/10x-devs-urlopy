// Every decision a drag-selected day range makes.
//
// The component that owns the mouse owns none of the arithmetic: AbsenceGrid tracks three DOM
// events and asks this module what they mean. That split is not stylistic. vitest runs in a node
// environment with no jsdom and no @testing-library/react (vitest.config.ts), so a React island's
// pointer behaviour is unreachable from a test while a pure function is exhaustively testable —
// the same reasoning, and the same shape, as src/lib/time-dial.ts.
//
// Dependency-free beyond the shared entity types: safe to import from both a React island and a
// server route, as src/lib/absence-grid-cell.ts and src/lib/absence-types.ts also are.

import type { Absence } from "@/types";

/**
 * `YYYY-MM-DD` for a Date, built from the *local* getters.
 *
 * Deliberately not `toISOString().slice(0, 10)`. The grid builds its days as
 * `new Date(year, month - 1, d)` — local midnight — so in any positive UTC offset the ISO form
 * reports the day *before* the one the user clicked, and Warsaw is UTC+1/+2 all year.
 *
 * AbsenceGrid already composes its `dateStr` exactly this way, and its `absenceMap` keys depend
 * on it. Exporting the construction rather than writing it twice is what stops the range's keys
 * and the grid's keys drifting apart — a drift that would silently look like "the day is free".
 */
export function dateKey(date: Date): string {
  return `${date.getFullYear().toString()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Saturday or Sunday — the grid's existing rule, and the days a range silently drops. */
export function isWeekend(date: Date): boolean {
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6;
}

/** An inclusive run of day indices into the rendered month, always `start <= end`. */
export interface DaySpan {
  start: number;
  end: number;
}

/**
 * A drag in progress: the column it is anchored to, and the two ends in the order they happened.
 *
 * `anchorIndex` is where the mouse went down and `currentIndex` where it currently is, so the
 * pair is *not* normalised — an upward drag has `currentIndex < anchorIndex`. Normalisation is
 * {@link selectionSpan}'s job, deliberately kept out of the state so the component never has to
 * decide which end is which.
 */
export interface DragSelection {
  employeeId: string;
  anchorIndex: number;
  currentIndex: number;
}

type SelectionEnds = Pick<DragSelection, "anchorIndex" | "currentIndex">;

/** The inclusive `[min, max]` span a drag covers, whichever direction it was made in. */
export function selectionSpan({ anchorIndex, currentIndex }: SelectionEnds): DaySpan {
  return anchorIndex <= currentIndex
    ? { start: anchorIndex, end: currentIndex }
    : { start: currentIndex, end: anchorIndex };
}

/**
 * Whether a completed gesture is a range, or falls through to the existing single-cell `onClick`.
 *
 * A **day count**, never a pixel distance. Two distinct day indices commit a range; one does not,
 * and the browser's own `click` then reaches the cell handler unchanged. Pixel geometry is
 * precisely what tests/e2e/e2e-rules.md says cannot be verified in this repo, so a threshold
 * expressed in pixels would be a rule no test could hold us to.
 *
 * Note this asks about the *gesture*, not about what the gesture will write. A span that is
 * entirely weekend passes here and then expands to nothing — but weekend cells never receive
 * drag handlers, so neither end of a real selection can be a weekend and that case is
 * unreachable from the UI. {@link expandSpanToWeekdays} still handles it rather than assuming it.
 */
export function isRangeGesture({ anchorIndex, currentIndex }: SelectionEnds): boolean {
  return anchorIndex !== currentIndex;
}

/**
 * Whether one grid cell sits inside the active selection, for its highlight.
 *
 * Both halves of the answer live here: the column must be the anchored one — this is what stops
 * a drag spreading horizontally into a colleague's column — and the day must be within the span.
 */
export function isCellSelected(selection: DragSelection | null, employeeId: string, dayIndex: number): boolean {
  if (selection?.employeeId !== employeeId) return false;
  const { start, end } = selectionSpan(selection);
  return dayIndex >= start && dayIndex <= end;
}

/**
 * The concrete days a span covers, weekends dropped.
 *
 * Indices are into the caller's rendered month, so they are clamped to it: the function is total
 * for any pair of numbers rather than trusting the caller to have bounded them. The ends are
 * re-normalised too, so an un-normalised `(anchor, current)` pair works as well as a `DaySpan`.
 *
 * Returns `Date` objects from the caller's own array — never copies — so identity comparisons
 * against the rendered days keep working.
 */
export function expandSpanToWeekdays(days: readonly Date[], span: DaySpan): Date[] {
  const start = Math.max(0, Math.min(span.start, span.end));
  const end = Math.min(days.length - 1, Math.max(span.start, span.end));

  const expanded: Date[] = [];
  for (let index = start; index <= end; index++) {
    const date = days[index];
    if (!isWeekend(date)) expanded.push(date);
  }
  return expanded;
}

/** One day of an expanded range, carrying the key the API and the absence lookup both use. */
export interface RangeDay {
  date: Date;
  key: string;
}

/** A day of the range that already holds an entry — the entry comes along for the confirmation. */
export interface OccupiedRangeDay extends RangeDay {
  absence: Absence;
}

export interface RangePartition {
  free: RangeDay[];
  occupied: OccupiedRangeDay[];
}

/**
 * Split an expanded range into the days that are free and the days that already hold an entry.
 *
 * `findAbsence` is supplied by the caller rather than a map being passed in, because the grid's
 * `absenceMap` is keyed by the *composite* `employeeId_date` and this module has no business
 * knowing that format. The grid closes over the employee; this module only ever speaks in dates.
 *
 * The occupied side carries the whole existing `Absence`, which is what lets the overwrite
 * confirmation name each day's current type and hours **without a pre-flight request** — the grid
 * already holds every absence it renders.
 */
export function partitionRange(
  dates: readonly Date[],
  findAbsence: (key: string) => Absence | undefined,
): RangePartition {
  const free: RangeDay[] = [];
  const occupied: OccupiedRangeDay[] = [];

  for (const date of dates) {
    const key = dateKey(date);
    const absence = findAbsence(key);
    if (absence) occupied.push({ date, key, absence });
    else free.push({ date, key });
  }

  return { free, occupied };
}
