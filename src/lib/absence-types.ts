// Domain rules keyed off the exact absence-type seed names. This module now carries **three
// independent rules** — which types may be partial-day, which may be flagged as priority, and
// which carry a clarifying caption in the picker — and every one of them is keyed off the exact
// seed names because `absence_types` has no stable code/slug column (see src/db/schema.ts). Each
// is the single source of truth shared by the form (UX) and the API (enforcement). A rename of a
// seed row must be mirrored here, in **every** one of them.
//
// The reverse failure mode is the one to watch when the catalogue grows: an eighth absence type
// that ought to be partial-day-capable, priority-eligible or captioned is silently none of them,
// because nothing forces this file to be revisited when src/db/seed.ts gains a row. Adding a type
// is otherwise a pure data change — these name-keyed rules are the sanctioned exception.
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

// --- Picker captions -------------------------------------------------------------------------
// Name verbatim from src/db/seed.ts:28.
export const SICK_LEAVE_TYPE_NAME = "choroba";

/**
 * Short clarifications rendered under a type's name where the user picks one. `choroba` covers
 * both a sick note and care leave, which the bare label does not say. A type with no entry here
 * simply renders no caption — this is additive, not a label map: `type.name` remains the label.
 */
export const TYPE_CAPTIONS: Readonly<Record<string, string>> = {
  [SICK_LEAVE_TYPE_NAME]: "zwolnienie lub opieka",
};

/**
 * The caption for a type, or undefined when it has none.
 *
 * `Object.hasOwn` rather than a bare index: the argument is a database string, and a plain object
 * would happily answer `"constructor"` or `"toString"` with something that is not a caption.
 */
export function captionFor(typeName: string | null | undefined): string | undefined {
  return typeName != null && Object.hasOwn(TYPE_CAPTIONS, typeName) ? TYPE_CAPTIONS[typeName] : undefined;
}
