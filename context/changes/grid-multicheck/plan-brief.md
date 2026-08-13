# Drag-to-select a day range in the absence grid — Plan Brief

> Full plan: `context/changes/grid-multicheck/plan.md`
> Frame brief: `context/changes/grid-multicheck/frame.md`
> Research: `context/changes/grid-multicheck/research.md`

## What & Why

An absence spanning N days has no representation at any layer — not in the selection, not in the
dialog, not in the request — so its cost multiplies by N at every one of them. A 10-working-day
`urlop` costs 10 clicks, 10 identical form fills, and 10 full page reloads. And because ranges
commonly cross existing entries, the range write is an **overwrite** that must be confirmed
before it destroys data.

## Starting Point

The grid is a real `<table>` with days as rows and employees as columns, so a range is a vertical
run at a fixed column index. Cell interaction is a single `onClick` on the `<td>`, gated by one
`clickable` predicate that already excludes weekends, other people's columns, and deactivated
employees. The column-reorder drag binds its dnd-kit listeners to the header grip **only**, so a
cell-level pointer gesture does not compete for events — the frame's biggest unknown, resolved
favourably. Downstream, everything is single-row: the create route inserts one row, the dialog
takes `day: Date`, and `UNIQUE (employee_id, date)` turns one occupied day into a whole-statement
failure surfaced as a 409 that cannot name which date collided.

## Desired End State

A user presses on a cell, drags across a run of days, and releases. Weekends inside the run are
never highlighted and never written. A dialog opens titled with the range, showing an empty form;
they pick a type once, optionally set one shared time window, add one comment and one substitute.
If the range crosses existing entries, a confirmation first lists each affected day with the type
and hours it currently holds. On confirm, one atomic request writes every day and the page
reloads once.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Range end to end, not the gesture alone | A gesture alone removes one of the three cost centres the user named. | Frame |
| Overlap policy | Overwrite, behind explicit confirmation | Collisions are the main path, not an edge case; the prototype's silent overwrite is not a specification. | Frame |
| Refresh | One `window.location.reload()` per range | Optimistic update stays out of scope, as in every prior plan. | Frame |
| Write path | New `POST /api/absences/bulk` | Leaves the proven single-row route's clamp, partial-day check and 409 mapping untouched, and can use the calendar-validating `DateSchema` the create route lacks. | Plan |
| Server weekend rule | Reject the whole request with 400 | A weekend date can only arrive from a client bug or a hand-crafted request, so it should fail loudly. | Plan |
| Confirmation detail | Each date plus its current type and hours | Overwriting a partial-day training entry destroys its hours; a count cannot convey that. | Plan |
| Range hours | Allowed, same rules as one day | A multi-day training with fixed daily hours is real; reusing the controls keeps `clampAbsenceHours` the one source of truth. | Plan |
| Dialog seeding | Blank form, no bulk delete | The prototype's seed-from-first-day silently inherits one arbitrary day into an N-day write. | Plan |
| Accidental drags | Commit on 2+ distinct days, no pixel threshold | A day-count rule stays unit-testable; pixel geometry is what `e2e-rules.md` says cannot be tested here. | Plan |
| Addressability | First `data-testid` scheme, documented | Without it nothing can assert "day 8 written, day 9 skipped" — the feature's core claim. | Plan |
| Sequencing | **After** `grid-adjustment-offsite-training` | Its premise changed: it is now mid-implementation against the same `<td>`, not "planned, zero code". | Plan |

## Scope

**In scope:** mouse-drag range selection anchored to one employee column; a pure, unit-tested
range module; a bulk upsert endpoint with per-day reporting and server-side weekday enforcement;
a range-capable dialog with an overwrite confirmation; the first cell testids; restored hint copy;
geometry-free E2E coverage.

**Out of scope:** touch and keyboard selection; two-dimensional selection; optimistic updates;
bulk delete; public holidays; entitlement blocking; seeding the form from an existing entry; the
prototype's priority flag; any change to the one-row-per-day data model.

## Architecture / Approach

Four layers, bottom-up so each is verifiable before the one above depends on it.

```
AbsenceGrid  ──(mousedown / mouseenter / window mouseup)──►  src/lib/absence-range.ts
   thin shell: state, styling, testids                        pure core: normalise, expand,
                                                              drop weekends, partition
        │ opens with range + occupied days
        ▼
AbsenceFormDialog (range mode)  ──form → confirm step──►  POST /api/absences/bulk
   blank form, shared window, lists what will be lost        one multi-row ON CONFLICT DO UPDATE
```

All arithmetic lives in the pure module — the repo's only viable way to test a pointer gesture
(`time-dial.ts` precedent). The bulk route re-validates everything the gesture claims: weekday,
calendar validity, partial-day eligibility, hour bounds — because the service-role connection
bypasses RLS and nothing else will backstop it. A single multi-row `INSERT` is atomic on its own,
so no `db.transaction()` is introduced.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Prerequisite | `grid-adjustment-offsite-training` P2–P4 landed | Blocks this change until another finishes |
| 2. Pure range module | All range arithmetic, exhaustively unit-tested | Local-vs-UTC date keys shifting a day |
| 3. Bulk endpoint | Atomic N-day upsert with overwrite reporting | New auth surface with no RLS backstop |
| 4. Range dialog | Range mode + overwrite confirmation | Regressing the single-day path |
| 5. The gesture | Drag, selection styling, testids, hint | Colliding with column drag-to-reorder |
| 6. E2E + docs | Geometry-free range spec, documented scheme | E2E has been red at the setup project |

**Prerequisites:** `grid-adjustment-offsite-training` Phases 2–4 committed and
`src/components/absence/AbsenceGrid.tsx` clean; a deployed target for API and E2E verification
(Drizzle cannot connect under `wrangler dev`).

**Estimated effort:** ~4–5 sessions across six phases, with Phase 1 being a wait rather than work.

## Open Risks & Assumptions

- **Phase 1 is a dependency on another change's schedule.** If `grid-adjustment-offsite-training`
  stalls, this plan either waits or reverts to the frame's original accept-the-conflict stance.
- **The gesture cannot be truly unit-tested.** Phase 2 covers the arithmetic and Phase 6 the wiring
  via synthesized events, but no test exercises a real pointer drag — the repo has no component-test
  infrastructure and vitest is node-only.
- **Overwrite is irreversible.** The confirmation is the only guard; there is no undo and no audit
  of what a range replaced.
- **Public holidays will still be written as absences.** Out of scope, and the first question a
  user is likely to ask once weekends are skipped.
- **Assumed:** a 31-day cap on `dates` is sufficient, since a selection cannot leave one rendered
  month.

## Success Criteria (Summary)

- A 10-working-day `urlop` takes one drag, one form fill, and one reload instead of 10 of each.
- A range crossing existing entries names each affected day and what it holds before replacing it.
- Weekends are never selected and never written, guarded independently in the client and the server.
- Column drag-to-reorder and single-cell click-to-add/edit behave exactly as they do today.
