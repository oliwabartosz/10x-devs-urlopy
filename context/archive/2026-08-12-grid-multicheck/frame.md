---
date: 2026-08-12
framer: Bartosz Oliwa
change_id: grid-multicheck
status: complete
confidence: HIGH
---

# Frame Brief: Drag-to-select a day range in the absence grid

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Entering one absence takes one click per cell. A `urlop` is often 10 working days
(14 calendar days including weekends, which must stay non-clickable), so a single
absence costs 10 separate cell clicks.

## Initial Framing (preserved)

- **User's stated cause or approach**: cell-at-a-time entry is the wrong input
  modality for a range; the grid should support selecting a run of days by mouse
  drag, as the `new-design/` prototype does.
- **User's proposed direction**: port the prototype's drag-select gesture into
  `AbsenceGrid`, skipping weekends.
- **Pre-dispatch narrowing**: the cost lands on **all three** of — the repeated
  clicking, re-filling the form 10×, and the reload after each save. Ranges
  **commonly cross existing entries**. The target is **today's grid**, not the
  grid after the other in-flight changes land.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Selection modality** — the grid has no way to express "these N days"; a single
   `onClick` per `<td>` is the only input verb (`AbsenceGrid.tsx:316-322`). ← initial framing
2. **Dialog cardinality** — `AbsenceFormDialog` is structurally one-absence-per-day
   (`day: Date`, `:84`), so type, hours, comment and substitute are re-entered per day
   even though they are identical across the whole absence.
3. **Write-path cardinality** — `POST /api/absences` inserts exactly one row
   (`index.ts:252-267`). N days = N requests, no atomicity, and a 409 that cannot
   name which date collided (`:279`).
4. **Refresh strategy** — `window.location.reload()` fires per save
   (`AbsenceFormDialog.tsx:237`), so 10 days = 10 full page loads.
5. **Overlap semantics** — `UNIQUE (employee_id, date)` (`src/db/schema.ts:65`) is
   discovered reactively; one occupied day aborts a whole multi-row `INSERT`. Policy
   never decided (`huge-ui-ux-improvement/research.md:191`, `:296`).

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Selection modality is the bottleneck *(initial framing)* | Confirmed: one `onClick`, `clickable` gate at `AbsenceGrid.tsx:300`, weekend cells get `undefined`. dnd-kit listeners are on the header grip only (`:71`), so a cell gesture is unobstructed. | **STRONG — but partial** |
| 2. Dialog cardinality multiplies the cost | Confirmed: `day: Date` (`:84`); `handleSave` builds `sharedFields` with a single `date` (`:213`). Every field except the date is genuinely shared across an absence's days. | **STRONG** |
| 3. Write path cannot express N days | Confirmed: single-row `.insert().values({...})` (`index.ts:252`); no bulk create for any entity; the only array-bodied route (`employees/order.ts:67-85`) reports no per-item results. | **STRONG** |
| 4. Reload is a cost centre in its own right | Present (8 sites repo-wide, 6 components) but **ruled out by the user**: one reload per range is acceptable. Collapses into dimension 3. | **WEAK — out of scope** |
| 5. Overlap semantics decide whether the feature works | Confirmed and **elevated**: user reports collisions are common, so a plain multi-row `INSERT` fails on the *main* path, not an edge case. | **STRONG** |

## Narrowing Signals

- **The three named cost centres are 1, 2 and 4 — the proposed direction addresses only 1.**
  A drag gesture that still opens a single-date dialog per day, and still POSTs per day,
  removes the clicking and leaves the other two intact. This is the decisive signal.
- **Collisions are common, not exceptional.** This turns the never-decided overlap policy
  from an edge case into the feature's main path.
- **Overlap policy is now ANSWERED**: *overwrite, behind an explicit Polish confirmation*
  naming that previously-entered data will be replaced, with the option to continue or cancel.
  This is strictly more than the prototype, which overwrites **silently**
  (`new-design/10xUrlopy.dc.html:1371`) — the prototype is not a specification here.
- **One reload per range is fine.** Refresh strategy leaves the problem statement; optimistic
  update stays out of scope, as in every prior plan.
- **Today's grid is the target.** Building before `grid-adjustment-offsite-training` (planned,
  zero code, rewrites the same `<td>` region at `plan.md:277`, `:290`) is an accepted risk.

## Cross-System Convention

Both halves of the answered policy already have precedent, so neither needs a new pattern:

- **Overwrite** — `onConflictDoUpdate` against a composite unique target exists at
  `src/pages/api/holiday-balances/index.ts:187-199`, exactly the shape `(employee_id, date)` needs.
  A single multi-row `INSERT ... ON CONFLICT DO UPDATE` is atomic on its own; `db.transaction(`
  appears zero times in the repo and is not required.
- **Confirmation** — `DeleteConfirmDialog.tsx` is the established Polish confirm pattern
  (Dialog + "Czy na pewno chcesz…" + `Anuluj` / destructive action).
- **Knowing what to confirm is free.** `absenceMap` is built client-side from the `absences`
  prop, keyed `employee_id_date` (`AbsenceGrid.tsx:114-117`). At mouse-release the grid already
  knows exactly which days in the range are occupied — the confirmation needs **no pre-flight
  request**.

## Reframed Problem Statement

> **The actual problem to plan around is**: an absence spanning N days has no representation
> at any layer — not in the selection, not in the dialog, not in the request — so its cost
> multiplies by N at every one of them; and because ranges commonly cross existing entries,
> the range write is an *overwrite* that must be confirmed before it destroys data.

The initial framing is **necessary but not sufficient**. Drag-select is the right entry point
and the gesture research is sound, but a gesture alone removes one of the three cost centres
the user named. The other two dissolve only if the dialog accepts a range and the write path
accepts N days — at which point the reload cost falls from 10 to 1 for free. Independently,
the "commonly crosses entries" answer moves overlap from an open question to the main path:
the naive multi-row `INSERT` would fail on ordinary use, and the honest write is an upsert
gated by a confirmation the prototype never models.

## Confidence

**HIGH** — every dimension is confirmed by direct read with file:line; the blocking product
question (`huge-ui-ux-improvement/frame.md:125`) is now answered by the user; both halves of
that answer match existing repo convention; and the narrowing signals were decisive in both
directions (dimension 4 ruled out, dimension 5 ruled in and resolved).

## What Changes for /10x-plan

Plan the **range absence** end to end — gesture, range-capable dialog, single bulk write,
overwrite-with-confirmation — not the gesture alone. Three of the research's eight open
questions are now closed (#1 overlap → overwrite + confirm; #4 reload → stays, once per range;
#5 sequencing → build on today's grid). Still open for the plan: bulk endpoint shape (#2),
range dialog contents and title (#3), `data-testid` scheme (#6), and minimum drag distance (#7).
Public holidays (#8) remain out of scope.

Two consequences worth carrying in explicitly:

- **Overwrite destroys data.** A partial-day training entry with times, overwritten by a
  full-day `urlop`, loses its hours. The confirmation must name the affected days, not just
  their count.
- **Weekends need guarding at both ends.** The server has no weekday rule at any layer
  (verified sweep, `research.md` §5); the write path must not trust the gesture to have
  filtered correctly.

## References

- Research: `context/changes/grid-multicheck/research.md`
- Predecessor framing: `context/changes/huge-ui-ux-improvement/frame.md:93`, `:125`
- Verified directly during this frame: `AbsenceGrid.tsx:114-117`, `:270-325`;
  `AbsenceFormDialog.tsx:84`, `:213`, `:237`; `api/absences/index.ts:252-281`;
  `api/holiday-balances/index.ts:178-202`; `employee/DeleteConfirmDialog.tsx`;
  `src/lib/absence-types.ts`
- No investigation sub-agents were dispatched; the dimension map was verified by direct
  reads against the working tree.
