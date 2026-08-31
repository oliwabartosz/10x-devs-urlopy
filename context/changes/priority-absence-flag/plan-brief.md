# Priority-Absence Flag (`[P]`) — Plan Brief

> Full plan: `context/changes/priority-absence-flag/plan.md`
> Research: `context/changes/priority-absence-flag/research.md`

## What & Why

Moderators have no way to mark a leave request as priority. This adds an **informational** boolean
`absences.is_priority`, settable only for `urlop` and `urlop planowany`, rendered as a literal
`[P]` on the grid, in the details view, and in the XLSX export.

This is PRD **FR-008**, parked three times. Every time, the blocker was the unanswered question
*"what does priority do when two absences collide?"* The scope decision that unsticks it: **nothing**.
The flag carries no behaviour — no collision resolution, no balance effect, no statistics.

## Starting Point

`grep -rniE "priorit|priorytet|is_priority" src/` returns zero hits. But the change has an exact
template: `typeAllowsPartialDay()` in the dependency-free `src/lib/absence-types.ts`, plus its
DB-aware twin `isPartialDayViolation()`, already gate a feature on exact seed names across the form
and all three write routes. `absence_types.name` is UNIQUE on this branch, so name-keying is safe.
There is one migration on disk, and its `CREATE TABLE absences` carries a hand-written CHECK that
drizzle-kit does not know about.

## Desired End State

Picking `urlop` or `urlop planowany` in the absence dialog reveals a **"Priorytet"** checkbox;
picking anything else hides it and clears it. A flagged absence shows `[P]` in the grid chip's
right corner beside the comment marker, explained by a legend entry, with a `Priorytet: tak`
tooltip line and a `[P]` pill in the details view. The exported workbook prefixes `[P]` to the cell
text, carries the line in the cell note, and has a matching legend cell. Any API attempt to flag an
ineligible type is rejected 400 on all three write routes.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Does the flag do anything? | Informational only | Removes the blocker that parked FR-008 three times; `UNIQUE(employee_id,date)` already makes per-person collisions impossible | Requester scoping |
| Column name | `is_priority` | Matches `is_full_day` / `is_system`; the archive's `absences.priority` predates that convention | Plan |
| Marker glyph | Literal `[P]`, not `🅿️` | Requested; the archive spent a migration undoing a ZWJ emoji, and nothing has round-tripped an emoji through `hucre` into Excel | Plan (research-backed) |
| PATCH on type change away from eligible | **Reject 400** on effective values | Byte-identical to the partial-day guard's precedent; the client already clears on type switch, so no real user hits it | Plan |
| Grid marker placement | Grouped with `💬` in one absolute right-hand cluster | Both anchors were taken; the prototype's own answer; absolute positioning is mandatory or the 120px column widens | Plan (research-backed) |
| XLSX surfaces | Cell text **and** hover note | A note is invisible until hovered — a printed sheet needs the marker in the cell | Plan |
| Legends | Both grid and XLSX | `[P]` is meaningless without a key; costs one deliberate test-assertion update | Plan |
| Details view | Inline pill, not a sortable column | The type-chip stack is a flex column, so it costs no layout change; a sortable column would touch four sort structures | Plan |
| PRD / roadmap | Amend in-plan | Precedent: a PRD-pinned fact needs an explicit amendment, and stale docs are what got FR-008 re-litigated | Plan |

## Scope

**In scope:** schema column + migration, the name-keyed rule and its server guard, all three write
routes, all six hand-written column lists, the form checkbox, the grid chip / tooltip / legend, the
details-view pill, the XLSX cell / note / legend, tests, and the PRD + roadmap amendment.

**Out of scope:** collision logic, holiday-balance and statistics effects, a DB CHECK tying the flag
to the type, any new role guard, a sortable Priorytet column, a `code`/`slug` column on
`absence_types`, a new E2E spec (the E2E suite still writes to production).

## Architecture / Approach

One dependency-free rule module (`PRIORITY_TYPE_NAMES` + `typeAllowsPriority`) is the single source
of truth, imported by the React form for UX and — via a new `isPriorityViolation(db, …)` service —
by all three write routes for enforcement. It **cannot** be a zod `.refine()`: request bodies carry
`absence_type_id`, not the name, so resolving eligibility needs the DB. The guard runs *after*
`assertAbsenceTypeExists`, because an unknown id resolves to an undefined name and would be
reported as a 400 rule violation instead of a 422.

The work is wide but shallow, so the risk is **coverage, not design**. Two spots fail silently:
`bulk.ts`'s `onConflictDoUpdate.set` (the field would write on insert and go stale on overwrite,
with no type error), and `dashboard.astro`'s inline select, which is what actually feeds the grid —
not `absenceListColumns`, despite that module's doc comment.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | Column, migration, rule module + server guard, unit tests | drizzle-kit may pick the table-recreate path and silently drop the hand-written CHECK — the one step no test catches |
| 2. API | Three write routes guarded; all six column lists updated | The `onConflictDoUpdate.set` trap — stale flag on every bulk-overwritten day |
| 3. Form dialog | Type-gated "Priorytet" checkbox with reset | The reset must sit in `selectType`, or arrow-key selection bypasses it |
| 4. Grid + details | `[P]` in the chip cluster, tooltip, legend, details pill | An inline (non-absolute) marker widens the 120px column instead of clipping |
| 5. XLSX export | Cell prefix, note line, legend cell | Reverses two archived decisions; breaks a legend-length assertion that must be updated deliberately |
| 6. Docs | FR-008 de-parked in PRD + roadmap | None |

**Prerequisites:** none beyond a working local dev environment (Node 24, `DATABASE_PATH` set).
Phase 1's `AbsenceBulkCreateCommand` edit deliberately breaks the build until Phase 3 sends the
field — an ordering signal, not a bug.

**Estimated effort:** ~2–3 sessions across six phases; phases 1–2 carry most of the risk.

## Open Risks & Assumptions

- **The migration diff is the only unverifiable-by-test step.** If drizzle-kit recreates the table,
  `absences_time_check` and the `(employee_id, date)` unique index are dropped silently and must be
  hand-restored. Must be read line by line.
- **This is the third name-keyed type rule.** An eighth absence type that *ought* to be
  priority-eligible would silently not be, because nothing forces `absence-types.ts` to be revisited
  when the catalogue grows. The `code`/`slug` fix has been proposed and declined three times; a doc
  comment is the only mitigation in scope.
- **No visual-regression net exists** and none is planned (snapshot tests were ruled out as
  high-churn). The grid marker and the column-width regression are verifiable only by eye.
- **Assumption:** literal `[P]` renders acceptably in Excel and LibreOffice. It is plain ASCII, so
  this is low-risk, but it is confirmed by opening a generated workbook, not by a test.

## Success Criteria (Summary)

- A moderator can mark `urlop` / `urlop planowany` as priority and cannot mark anything else, from
  the UI *or* the API, on create, edit and drag-range alike.
- The `[P]` marker is visible and explained on the grid and in the exported workbook, and the grid
  column width is unchanged.
- Every rejection path is covered by a test that fails when its guard is removed — including the
  bulk overwrite path.
