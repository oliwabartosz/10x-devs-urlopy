# Restrict Partial-Day Hours to "szkolenie w miejscu pracy" (S-14) — Implementation Plan

## Overview

Narrow the partial-day hours feature introduced in S-09 so the time-range inputs are
available **only** when the selected absence type is **"szkolenie w miejscu pracy"**
(onsite training). Every other absence type is treated as full-day only. The rule is a
domain fact — not a permission — so it applies uniformly to employees and moderators, and
is enforced in both the form (controls hidden) and the API (invalid combinations rejected).

## Current State Analysis

Since S-09 (`absence-hours-range`), an absence is full-day or partial-day:

- **DB** (`src/db/schema.ts:38-60`): `absences` has `is_full_day BOOLEAN` (default `true`),
  `start_time TIME`, `end_time TIME`. A DB CHECK (`absences_time_check`,
  `supabase/migrations/20260605000001_absence_start_end_time.sql:25-30`) enforces the
  biconditional: full-day ⇒ both times null; partial-day ⇒ both set. Nothing ties time
  fields to the absence **type**.
- **Types** (`src/db/schema.ts:31-36`, `src/types.ts:5`): `absence_types` has only
  `id (serial)`, `name`, `color` — **no `code`/`slug`**. The onsite-training type is seeded
  as `('szkolenie w miejscu pracy', '#ffcc00')` at
  `supabase/migrations/20260526000002_seed_absence_types.sql:8` (id 3 by insert order).
- **Form** (`src/components/absence/AbsenceFormDialog.tsx`): holds `absenceTypeId`,
  `isFullDay` (default `true`), `startTime`, `endTime`. The "Cały dzień" checkbox
  (lines 141-156) and the two `<Input type="time">` fields (lines 158-187) render
  **unconditionally** — with no coupling to the selected type. `saveDisabled` (line 48)
  requires both times when `!isFullDay`. On save (lines 54-62) times are forced `null` when
  full-day. The form already receives `absenceTypes: AbsenceType[]`, so it can read the
  selected type's `name`.
- **API** (`src/pages/api/absences/index.ts:120-137` POST,
  `src/pages/api/absences/[id].ts:13-34` PATCH): zod schemas validate the
  `is_full_day`↔times biconditional via `.refine()`. The request body carries
  `absence_type_id` (a number) but **not** the type name. Zod refines are pure — they can't
  resolve the id to a name. No rule currently ties times to type.

## Desired End State

- In the form, the "Cały dzień" toggle and the time inputs appear **only** when the selected
  type is onsite training. For any other type the entry is implicitly full-day (no controls
  shown), and switching to an ineligible type clears any entered times and forces full-day.
- The POST and PATCH endpoints reject a partial-day entry (`is_full_day = false`) whose
  effective absence type is not onsite training, with a `400`.
- Onsite-training entries behave exactly as they do today (full-day by default, optionally
  partial-day with a time range).
- Integration tests cover: ineligible type + partial-day ⇒ 400; onsite training +
  partial-day ⇒ success; onsite training + full-day ⇒ success.

**Verification:** `npm run lint`, `npm run build`, and the absence CRUD integration suite
pass; manually, selecting a non-training type hides the time controls, and a crafted API
call setting a non-training type to partial-day returns 400.

### Key Discoveries:

- The eligibility key must be the **exact name string** — there is no stable code/slug
  (`src/db/schema.ts:31-36`). A single shared constant is the source of truth.
- API enforcement cannot live in the zod `.refine()` (body lacks the name); it is a
  **handler-level guard** that resolves the type name for the given `absence_type_id`.
- The form's `handleSave` always sends the full `sharedFields` set (both `absence_type_id`
  and `is_full_day`) for POST **and** PATCH (`AbsenceFormDialog.tsx:52-74`), so the app's
  own PATCH bodies are always complete — but the PATCH guard must still compute the
  *effective* type/full-day from body ∪ existing row to stay correct for partial API calls.
- No schema change, no migration, no DB CHECK — the decision is name-match at the
  application layer.

## What We're NOT Doing

- No `absence_types` schema change (no `allows_partial_day` flag column).
- No DB CHECK constraint tying `absence_type_id` to `is_full_day`.
- No data migration/backfill (pre-launch: no partial-day rows of any type exist in prod).
- No role-based exemption — moderators are bound by the same rule.
- No changes to grid/details/stats rendering — existing partial-day rows still render; this
  change only governs how new/edited entries are created.
- No new React component-test infrastructure (form gating verified manually).
- No changes to S-13 ("urlop planowany", not yet built) — it will simply be an ineligible,
  full-day-only type like the others.

## Implementation Approach

Single domain rule expressed once as a shared constant + helper, consumed by both the API
(server enforcement, the real boundary) and the form (UX). Build bottom-up: constant + API
guard + tests first (Phase 1), then the form gating (Phase 2), so the enforcement boundary
is proven before the UI relies on it.

## Critical Implementation Details

**PATCH effective-state resolution.** For POST the body always carries both
`absence_type_id` and `is_full_day`, so the guard reads them directly. For PATCH (a
`.partial()` schema), either field may be absent; the guard must resolve the *effective*
values — body value when present, otherwise the existing row's value — before applying the
rule. This requires reading the target absence row (respecting ownership) prior to (or as
part of) the update. Applying the guard to body-only values would let a partial patch that
changes only the type slip an existing partial-day range past the check.

## Phase 1: Domain constant + API enforcement + tests

### Overview

Introduce the single source of truth for partial-day eligibility and enforce it in both
write endpoints, with integration coverage.

### Changes Required:

#### 1. Shared eligibility constant + helper

**File**: `src/lib/absence-types.ts` (new)

**Intent**: Define the domain rule once so the form and both API routes agree. Export the
canonical onsite-training name and a predicate for "may this type be partial-day".

**Contract**: `export const ONSITE_TRAINING_TYPE_NAME = "szkolenie w miejscu pracy";` and
`export function typeAllowsPartialDay(typeName: string | null | undefined): boolean` returning
`typeName === ONSITE_TRAINING_TYPE_NAME`. No dependencies; safe to import from both React
islands and server routes.

#### 2. POST enforcement

**File**: `src/pages/api/absences/index.ts`

**Intent**: After zod parsing, reject a partial-day create whose absence type is not onsite
training. Reuse the existing employee/target-resolution flow; add one type-name resolution.

**Contract**: When `parsed.data.is_full_day === false`, resolve the name of the row in
`absence_types` matching `parsed.data.absence_type_id`; if it does not satisfy
`typeAllowsPartialDay(name)`, return `400` with a clear message (e.g. `"Godziny są dostępne
tylko dla typu: szkolenie w miejscu pracy"`). Keep the existing zod biconditional refine
unchanged. The lookup also covers a nonexistent `absence_type_id` (treat as ineligible →
400, or let the existing FK path handle it — resolve consistently). Place the check before
the `insert`.

#### 3. PATCH enforcement

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Apply the same rule to updates using the *effective* type and full-day state, so
a partial update can't leave an ineligible type in a partial-day state.

**Contract**: Resolve the effective `absence_type_id` and `is_full_day` from
`parsed.data` when present, else from the existing absence row (loaded with the same
ownership scoping already used by the UPDATE `WHERE`). If effective `is_full_day === false`
and the effective type's name fails `typeAllowsPartialDay`, return `400` before/instead of
the update. Return `404` if the target row does not exist / is not owned (preserve current
behavior). Keep the existing zod refine unchanged.

#### 4. Integration tests

**File**: `src/tests/api/absences/crud.test.ts`

**Intent**: Guard the server rule against regression, matching how S-09 added validation
tests.

**Contract**: Add cases: (a) POST onsite-training type + partial-day (both times) ⇒ success;
(b) POST a non-training type + partial-day ⇒ `400`; (c) POST non-training type + full-day ⇒
success (unchanged path); (d) PATCH an existing onsite-training partial-day entry changing
only the type to a non-training type ⇒ `400`. Reuse existing fixtures/type-id lookups in the
suite; reference the onsite-training type by `ONSITE_TRAINING_TYPE_NAME`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Absence CRUD integration tests pass (including the four new cases): `npm run test` (or the
  suite's configured command for `src/tests/api/absences/crud.test.ts`)

#### Manual Verification:

- A crafted POST with a non-training `absence_type_id` and `is_full_day: false` returns 400
  with the Polish message.
- A crafted PATCH changing an onsite-training partial-day entry's type to `urlop` returns 400.
- An onsite-training partial-day POST still succeeds and stores both times.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual
confirmation before starting Phase 2.

---

## Phase 2: Form UI gating

### Overview

Show the full-day toggle and time inputs only for onsite training; force full-day for every
other type, keeping form state consistent across type switches and edit initialization.

### Changes Required:

#### 1. Conditional rendering + state coupling in the form

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Derive eligibility from the selected type's name and gate the partial-day
controls on it; keep `isFullDay`/times consistent when the type changes or when opening an
existing entry, so the form can never submit a partial-day entry for an ineligible type.

**Contract**: Compute the selected `AbsenceType` from `absenceTypes` by `absenceTypeId`, and
`const canBePartialDay = typeAllowsPartialDay(selectedType?.name)` using the shared helper.
Render the "Cały dzień" checkbox block (currently lines 141-156) and the time-inputs block
(currently lines 158-187) only when `canBePartialDay`. In the type `Select`'s
`onValueChange` (line 124), when the newly selected type is not eligible, set
`isFullDay = true` and clear `startTime`/`endTime`. Initialize `isFullDay` so that an
existing entry whose type is ineligible opens as full-day (defensive; no such data expected).
`saveDisabled` (line 48) stays correct because ineligible types force `isFullDay = true`.
Import `typeAllowsPartialDay` from `@/lib/absence-types`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Selecting a non-training type hides the "Cały dzień" checkbox and time inputs.
- Selecting onsite training shows the checkbox; unchecking it reveals the two time inputs.
- Entering a time range for onsite training, then switching to another type, clears the
  times and the entry saves as full-day.
- Editing an existing onsite-training partial-day entry pre-fills its time range correctly.
- No regression: a normal full-day absence of any type saves as before.

**Implementation Note**: After Phase 2, pause for manual confirmation that the form behaves
as specified.

---

## Testing Strategy

### Integration Tests (Phase 1):

- POST onsite-training + partial-day ⇒ success (times stored).
- POST non-training + partial-day ⇒ 400.
- POST non-training + full-day ⇒ success.
- PATCH changing an onsite-training partial-day entry's type to a non-training type ⇒ 400.

### Manual Testing Steps:

1. Open the add-absence dialog; select `urlop` — confirm no full-day toggle / time inputs.
2. Select `szkolenie w miejscu pracy` — confirm the toggle appears; uncheck it — confirm two
   time inputs appear; enter `09:00`–`11:00`; save; confirm it appears in the grid/details.
3. Re-open that entry, switch the type to `choroba` — confirm times vanish and it's full-day;
   save; confirm success.
4. With dev tools / curl, POST `{ is_full_day: false, start_time, end_time }` for a `urlop`
   type ⇒ expect 400.

## Migration Notes

None — no schema change and no data migration. Pre-launch there are no partial-day rows of
any type, so no backfill is required.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-14, `hours-onsite-training-only`)
- Prior feature (S-09) this narrows: `context/changes/absence-hours-range/plan.md`,
  `context/changes/absence-hours-range/research.md`
- Onsite-training seed: `supabase/migrations/20260526000002_seed_absence_types.sql:8`
- Form: `src/components/absence/AbsenceFormDialog.tsx:141-187`
- POST schema/handler: `src/pages/api/absences/index.ts:120-137,194-197`
- PATCH schema/handler: `src/pages/api/absences/[id].ts:13-34,81-104`
- Tests: `src/tests/api/absences/crud.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain constant + API enforcement + tests

#### Automated

- [x] 1.1 Linting passes: `npm run lint`
- [x] 1.2 Build passes: `npm run build`
- [x] 1.3 Absence CRUD integration tests pass (including four new cases)

#### Manual

- [ ] 1.4 Crafted POST: non-training type + partial-day ⇒ 400 with Polish message
- [ ] 1.5 Crafted PATCH: onsite-training partial-day → non-training type ⇒ 400
- [ ] 1.6 Onsite-training partial-day POST still succeeds and stores both times

### Phase 2: Form UI gating

#### Automated

- [ ] 2.1 Linting passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 Non-training type hides the toggle and time inputs
- [ ] 2.4 Onsite training shows toggle; unchecking reveals time inputs
- [ ] 2.5 Switching away from onsite training clears times and saves as full-day
- [ ] 2.6 Editing an existing onsite-training partial-day entry pre-fills its time range
- [ ] 2.7 No regression: a normal full-day absence of any type saves as before
