// Domain rules keyed off the exact absence-type seed names. This module now carries **two
// independent rules** — which types may be partial-day, and which may be flagged as priority —
// and every one of them is keyed off the exact seed names because `absence_types` has no stable
// code/slug column (see src/db/schema.ts). Each is the single source of truth shared by the form
// (UX) and the API (enforcement). A rename of a seed row must be mirrored here, in **both** lists.
//
// The reverse failure mode is the one to watch when the catalogue grows: an eighth absence type
// that ought to be partial-day-capable or priority-eligible is silently neither, because nothing
// forces this file to be revisited when src/db/seed.ts gains a row. Adding a type is otherwise a
// pure data change — these name-keyed rules are the sanctioned exception.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
export const ONSITE_TRAINING_TYPE_NAME = "szkolenie w miejscu pracy";
export const OFFSITE_TRAINING_TYPE_NAME = "szkolenie/wyjście poza miejsce pracy";

/** Absence types that may carry a time range; every other type is full-day only. */
export const PARTIAL_DAY_TYPE_NAMES: readonly string[] = [ONSITE_TRAINING_TYPE_NAME, OFFSITE_TRAINING_TYPE_NAME];

/** True when an absence of this type may be a partial-day (time-range) entry. */
export function typeAllowsPartialDay(typeName: string | null | undefined): boolean {
  return typeName != null && PARTIAL_DAY_TYPE_NAMES.includes(typeName);
}

// --- Priority marker -------------------------------------------------------------------------
// Names verbatim from src/db/seed.ts:19,31.
export const LEAVE_TYPE_NAME = "urlop";
export const PLANNED_LEAVE_TYPE_NAME = "urlop planowany";

/** Absence types that may carry the informational `[P]` priority marker. */
export const PRIORITY_TYPE_NAMES: readonly string[] = [LEAVE_TYPE_NAME, PLANNED_LEAVE_TYPE_NAME];

/** True when an absence of this type may be flagged as priority. */
export function typeAllowsPriority(typeName: string | null | undefined): boolean {
  return typeName != null && PRIORITY_TYPE_NAMES.includes(typeName);
}
