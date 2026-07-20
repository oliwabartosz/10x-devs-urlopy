// Domain rule: which absence types may be entered as a partial-day (time-range) absence.
// Keyed off the exact seed names because `absence_types` has no stable code/slug column
// (see src/db/schema.ts). This is the single source of truth shared by the form (UX) and
// the API (enforcement). A rename of a seed row must be mirrored here.
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
