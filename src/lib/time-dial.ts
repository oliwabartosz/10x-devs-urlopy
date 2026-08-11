// Geometry for the 24-hour range dial.
//
// Every numeric decision the dial makes lives here: the mapping between clock angles and
// minutes-since-midnight, the quarter-hour grid, and the legal window each handle may occupy.
// `TimeRangeDial` renders and dispatches events; it asks this module what a position *means*.
// No React, no DOM, and no trigonometry anywhere else.
//
// **The bounds are derived, never restated.** The 06:00 floor comes from `MIN_START_TIME` and the
// duration cap from `FULL_DAY_HOURS` — the same two constants the API routes enforce through
// `clampAbsenceHours`. A literal `360` or `480` here would let the dial's hard stops drift away
// from what the server actually accepts, which is the one failure this whole change exists to
// prevent: a control that lets you reach a value it then silently rewrites.
//
// The face is 24-hour, not 12-hour. One revolution is a whole day, so a 06:00–23:59 domain needs
// no AM/PM disambiguation and the sub-06:00 region draws as a single contiguous dead zone.
//
// Dependency-free beyond the two domain constants: safe to import from a React island.

import { MIN_START_TIME } from "@/lib/absence-hours";
import { FULL_DAY_HOURS } from "@/lib/hours";

export const MINUTES_PER_DAY = 24 * 60;

/** The dial's grid. Quarter hours — 96 stops per revolution, 3.75° apart. */
export const STEP_MINUTES = 15;

/** 0.25° per minute. 12 o'clock is midnight and angles increase clockwise. */
export const DEGREES_PER_MINUTE = 360 / MINUTES_PER_DAY;

/** Earliest a handle may place the start. Derived from the shared domain rule, not restated. */
export const MIN_START_MINUTES = requireClockTime(MIN_START_TIME);

/** Longest span the dial may open. Derived from the shared domain rule, not restated. */
export const MAX_SPAN_MINUTES = FULL_DAY_HOURS * 60;

/**
 * Latest a handle may place the end — 23:59.
 *
 * `absences_time_check` forbids a range crossing midnight, so the dial never models wraparound:
 * the arc has a ceiling rather than continuing round the face.
 */
export const MAX_END_MINUTES = MINUTES_PER_DAY - 1;

export type DialHandle = "start" | "end";

/** The legal window a handle may occupy, in minutes since midnight. Both ends inclusive. */
export interface HandleBounds {
  min: number;
  max: number;
}

/**
 * The window `handle` may move within, given where the *other* handle currently sits.
 *
 * The opposite handle is the anchor — this is what stops a user widening past the cap by dragging
 * the side that isn't pinned. Dragging the end past `start + 8h` pins the end; dragging the start
 * more than 8h away from the end pins the start.
 *
 * Feeds `aria-valuemin` / `aria-valuemax` and the Home/End keys as well as the drag clamp, so the
 * announced range and the reachable range are the same range by construction.
 *
 * A window can be empty (`min > max`) when the current pair is already outside the domain — a row
 * saved before this rule existed, say. {@link constrainHandle} treats that as "cannot move" rather
 * than inventing a position.
 */
export function handleBounds(handle: DialHandle, startMinutes: number, endMinutes: number): HandleBounds {
  if (handle === "start") {
    return {
      min: Math.max(MIN_START_MINUTES, endMinutes - MAX_SPAN_MINUTES),
      max: endMinutes - STEP_MINUTES,
    };
  }
  return {
    min: startMinutes + STEP_MINUTES,
    max: Math.min(startMinutes + MAX_SPAN_MINUTES, MAX_END_MINUTES),
  };
}

/**
 * The position `handle` is permitted to take for a candidate the pointer or keyboard proposed.
 *
 * Prevention, not correction: the caller commits the *return value*, never the candidate. A dial
 * that committed an illegal value and let the blur clamp repair it would make the handle visibly
 * jump — the silent-rewrite behavior this change removes.
 *
 * The candidate is snapped to the quarter-hour grid first, then clamped into the handle's window.
 * A clamped result sits on the window edge, which is deliberately *not* snapped inward: the stop
 * belongs at the true boundary (23:59, or `start + 8h` for a start that is itself off-grid),
 * because a stop one step short of the limit reads as a bug rather than as a rule.
 *
 * Out-of-window candidates clamp to the *circularly* nearer edge, not the numerically nearer one.
 * Dragging the end clockwise past midnight produces a candidate near 00:15; numeric clamping would
 * fling the handle back to `start + 15min`, a three-quarter-turn jump. Circular clamping stops it
 * at 23:59, where the pointer actually is.
 */
export function constrainHandle({
  handle,
  candidateMinutes,
  startMinutes,
  endMinutes,
}: {
  handle: DialHandle;
  candidateMinutes: number;
  startMinutes: number;
  endMinutes: number;
}): number {
  const { min, max } = handleBounds(handle, startMinutes, endMinutes);
  if (min > max) return handle === "start" ? startMinutes : endMinutes;

  const snapped = snapToStep(candidateMinutes);
  if (snapped >= min && snapped <= max) return snapped;

  return circularDistance(snapped, min) <= circularDistance(snapped, max) ? min : max;
}

/** Nearest quarter hour, ties rounding up. `07:07` → `07:00`, `07:08` → `07:15`. */
export function snapToStep(minutes: number): number {
  const snapped = Math.round(normalizeMinutes(minutes) / STEP_MINUTES) * STEP_MINUTES;
  // 23:53 rounds to 1440, which is midnight *tomorrow*. Fold it back onto the same face.
  return snapped % MINUTES_PER_DAY;
}

/** Clock angle in degrees clockwise from 12 o'clock, in `[0, 360)`. */
export function minutesToAngle(minutes: number): number {
  return normalizeMinutes(minutes) * DEGREES_PER_MINUTE;
}

/**
 * Minutes since midnight for a clock angle, in `[0, 1440)`.
 *
 * Normalizing the angle first is the wraparound guard: an angle a hair past 12 o'clock reads as
 * `00:0x` today, never as a next-day value that arithmetic downstream would treat as legal.
 */
export function angleToMinutes(degrees: number): number {
  return Math.round(normalizeDegrees(degrees) / DEGREES_PER_MINUTE) % MINUTES_PER_DAY;
}

/** A point on the face, in SVG user units (y grows downward). */
export function polarToCartesian({
  cx,
  cy,
  radius,
  degrees,
}: {
  cx: number;
  cy: number;
  radius: number;
  degrees: number;
}): { x: number; y: number } {
  const radians = (normalizeDegrees(degrees) * Math.PI) / 180;
  return {
    x: cx + radius * Math.sin(radians),
    y: cy - radius * Math.cos(radians),
  };
}

/**
 * The clock angle of a point given as an offset from the face's centre, in the same SVG units.
 *
 * The inverse of {@link polarToCartesian}, and the half a drag handler needs: the component
 * measures `event.clientX/Y` against the face's bounding box and asks here what it points at.
 * Distance from the centre is ignored — only the direction carries a time.
 */
export function cartesianToAngle(dx: number, dy: number): number {
  return normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** Minutes since midnight for `"HH:MM"` or `"HH:MM:SS"`; null when the value is not a clock time. */
export function parseClockTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** `"HH:MM"` — the shape both `<input type="time">` and the `TIME` columns accept. */
export function formatClockTime(minutes: number): string {
  const normalized = normalizeMinutes(minutes);
  const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mm = String(normalized % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Shorter way round the face between two times, in minutes. */
function circularDistance(a: number, b: number): number {
  const direct = Math.abs(normalizeMinutes(a) - normalizeMinutes(b));
  return Math.min(direct, MINUTES_PER_DAY - direct);
}

function normalizeMinutes(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Parse a constant this module is built on, failing loudly if it stops being a clock time.
 *
 * Only ever called at module load with `MIN_START_TIME`. It exists so the floor can be *derived*
 * from the shared constant instead of hard-coded here — the throw is an invariant guard, not a
 * reachable error path.
 */
function requireClockTime(value: string): number {
  const minutes = parseClockTime(value);
  if (minutes === null) throw new Error(`time-dial: "${value}" is not a clock time`);
  return minutes;
}
