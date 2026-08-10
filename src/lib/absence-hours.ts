// Domain rule: the bounds a partial-day (time-range) absence must fall within.
//
// Two rules, both auto-correcting rather than rejecting:
//   1. the range may not start before MIN_START_TIME
//   2. the range may not run longer than one working day (FULL_DAY_HOURS)
//
// Why 06:00? It is a plausibility floor **chosen by the team** — the earliest hour at which a
// work-related partial-day absence is credible. It is NOT a building-access or regulatory
// figure. The original proposal (07:15) was justified by building-access hours, and that
// rationale stopped matching once the figure moved to 06:00 — see
// `context/changes/absence-hours-window/frame.md`. Do not re-derive it from an external
// schedule; change it by team decision.
//
// The duration cap is the load-bearing rule. `absences`' unique(employee_id, date), the
// statistics island and the holiday balance all assume one date is worth at most one day,
// yet partial-day hours are divided by FULL_DAY_HOURS with no ceiling — so an unbounded
// range could make a single date contribute nearly three days to the balance.
//
// This is the single source of truth shared by the form (UX) and the API (enforcement),
// mirroring `@/lib/absence-types`. Dependency-free on purpose: safe to import from both
// React islands and server routes.

import { FULL_DAY_HOURS } from "@/lib/hours";

const MIN_START_MINUTES = 6 * 60;
const MAX_DURATION_MINUTES = FULL_DAY_HOURS * 60;

/** Earliest a partial-day absence may start, as "HH:MM". */
export const MIN_START_TIME = toTimeString(MIN_START_MINUTES);

export type ClampAbsenceHoursResult =
  | { ok: true; startTime: string; endTime: string }
  /**
   * `end-before-floor`: flooring the start left `end <= start`, which no clamp can repair
   * and `absences_time_check` forbids. Reaching it requires `start < MIN_START_TIME &&
   * end <= MIN_START_TIME`, so a message may honestly name MIN_START_TIME as the boundary.
   * `invalid-time`: the input was not a well-formed clock value. Unreachable from the API
   * (TimeSchema) and from `<input type="time">`; present so bad input can never be
   * silently arithmetic'd into a plausible-looking wrong range.
   */
  | { ok: false; reason: "end-before-floor" | "invalid-time" };

/**
 * Correct a partial-day range so it starts no earlier than {@link MIN_START_TIME} and runs
 * no longer than `FULL_DAY_HOURS`.
 *
 * Accepts `"HH:MM"` (request bodies, form state) and `"HH:MM:SS"` (Postgres `TIME`
 * round-trips); always returns `"HH:MM"`, which the `TIME` columns accept as-is. Seconds
 * are ignored, not rounded.
 *
 * **The ordering is the contract and it is not the obvious one:** floor the start first,
 * then cap the duration, with the reject test between them. `01:00–23:00` floors to
 * `06:00–23:00` and caps to `06:00–14:00`; capping first would give `01:00–09:00` and then
 * floor to `06:00–09:00` — a 3 h absence from the same input.
 *
 * A late start needs no special case: `min(end, start + 8h)` with `end <= 23:59` already
 * makes the cap implicitly `min(8h, 23:59 − start)`.
 */
export function clampAbsenceHours(startTime: string, endTime: string): ClampAbsenceHoursResult {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return { ok: false, reason: "invalid-time" };

  const flooredStart = Math.max(start, MIN_START_MINUTES);

  // Between the two clamps on purpose: a range only becomes unclampable *because* the start
  // was floored. When `start >= MIN_START_TIME`, `flooredStart === start` and the callers'
  // existing `end > start` check already makes this branch unreachable.
  if (end <= flooredStart) return { ok: false, reason: "end-before-floor" };

  const cappedEnd = Math.min(end, flooredStart + MAX_DURATION_MINUTES);

  return { ok: true, startTime: toTimeString(flooredStart), endTime: toTimeString(cappedEnd) };
}

/** Minutes since midnight, or null when the value is not a real clock time. */
function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toTimeString(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
