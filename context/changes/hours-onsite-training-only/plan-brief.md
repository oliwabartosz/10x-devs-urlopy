# Restrict Hours to "szkolenie w miejscu pracy" (S-14) — Plan Brief

> Full plan: `context/changes/hours-onsite-training-only/plan.md`

## What & Why

Narrow the partial-day hours feature (S-09) so the time-range inputs are available **only**
for the absence type "szkolenie w miejscu pracy" (onsite training). Every other type is
full-day only. Hours-of-day are meaningful for onsite training but not for whole-day
absences like `urlop` or `choroba`, so the form should stop offering them.

## Starting Point

Since S-09, any absence can be full-day or partial-day: the form always shows a "Cały dzień"
toggle plus two `<input type="time">` fields, and the API validates only the
`is_full_day`↔times biconditional (zod refine + a DB CHECK). Nothing couples time entry to
the absence **type**. `absence_types` has just `id`, `name`, `color` — no stable code/slug.

## Desired End State

Selecting any non-onsite-training type hides the full-day toggle and time inputs (the entry
is implicitly full-day); switching away from onsite training clears any times. The POST and
PATCH endpoints reject a partial-day entry whose effective type isn't onsite training (400).
Onsite-training entries behave exactly as today.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Eligibility key | Exact name match via shared constant | No stable code/slug on `absence_types`; smallest diff, no schema change | Plan |
| Enforcement layer | UI + API (handler guard) | Server is the real boundary; matches codebase's server-validated pattern | Plan |
| Where the API check lives | Handler, not zod refine | Body carries `absence_type_id` (number), not the name; zod refines are pure | Plan (research) |
| Ineligible-type UX | Hide toggle + time inputs, treat as full-day | Cleanest UI; no dead controls; mirrors existing conditional rendering | Plan |
| Moderators | Same rule for everyone | It's a domain fact, not a permission; keeps validation uniform | Plan |
| Schema / migration | None | Name-match needs no column, no CHECK, no backfill (pre-launch) | Plan |
| Testing | API integration tests | Guards the enforcement boundary via the existing `crud.test.ts` harness | Plan |

## Scope

**In scope:**
- Shared constant `ONSITE_TRAINING_TYPE_NAME` + `typeAllowsPartialDay` helper in `src/lib/`
- POST + PATCH handler guards (reject partial-day for ineligible types; PATCH uses effective state)
- `AbsenceFormDialog` conditional rendering + type-switch/edit state coupling
- Integration tests in `crud.test.ts`

**Out of scope:**
- Any `absence_types` schema change or DB CHECK
- Data migration/backfill
- Role-based exemptions
- Grid/details/stats rendering changes
- React component-test infrastructure
- S-13 ("urlop planowany") — inherits full-day-only behavior automatically

## Architecture / Approach

One domain rule expressed once (constant + predicate), consumed by both the API (enforcement)
and the form (UX). Bottom-up: prove the API guard with tests first, then gate the UI on top.
The form derives eligibility from the selected type's `name` (already in props); the API
resolves the type name for the submitted `absence_type_id` and rejects invalid combinations.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Constant + API + tests | Shared rule, POST/PATCH guards, 4 integration cases | PATCH must use *effective* type/full-day (body ∪ existing row), not body-only |
| 2. Form UI gating | Toggle + time inputs shown only for onsite training | State consistency on type-switch and edit-initialization |

**Prerequisites:** S-09 (done). Integration tests run against a connected test DB; Drizzle
queries can't run under `wrangler dev` (test API routes against the deployment or test DB).
**Estimated effort:** ~1 focused session across 2 phases.

## Open Risks & Assumptions

- Eligibility is keyed off the exact seed name `"szkolenie w miejscu pracy"`; a rename would
  break the gate. Mitigated by the single shared constant (one place to update).
- No existing partial-day rows of other types (pre-launch), so no backfill is needed; if a
  staging DB has such rows they remain valid at rest but can't be re-saved as partial-day.

## Success Criteria (Summary)

- Non-training types show no hours controls in the form; onsite training still supports a time range.
- The API returns 400 for a partial-day entry of any non-training type (create or update).
- Onsite-training create/edit and all full-day flows work unchanged; integration suite passes.
