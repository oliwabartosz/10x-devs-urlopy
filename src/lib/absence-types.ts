// Domain rule: which absence types may be entered as a partial-day (time-range) absence.
// Keyed off the exact seed name because `absence_types` has no stable code/slug column
// (see src/db/schema.ts). This is the single source of truth shared by the form (UX) and
// the API (enforcement). A rename of the seed row must be mirrored here.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
export const ONSITE_TRAINING_TYPE_NAME = "szkolenie w miejscu pracy";

/** True when an absence of this type may be a partial-day (time-range) entry. */
export function typeAllowsPartialDay(typeName: string | null | undefined): boolean {
  return typeName === ONSITE_TRAINING_TYPE_NAME;
}
