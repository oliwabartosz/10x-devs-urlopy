# Drag-to-select a day range in the absence grid — Implementation Plan

## Overview

Entering one absence today costs one click per cell. A `urlop` is often 10 working days, so a
single absence costs 10 clicks, 10 re-fills of an identical form, and 10 full page reloads.

This change gives a multi-day absence a representation at every layer it currently lacks one:
a mouse-drag gesture selects a run of days in one employee's column, a range-capable dialog
collects the shared fields once, and a single atomic bulk upsert writes N rows. Because ranges
commonly cross existing entries, the range write is an **overwrite**, gated behind an explicit
Polish confirmation that names each affected day and what it currently holds.

## Current State Analysis

**The gesture is unobstructed.** `useSortable`'s `listeners` are spread only onto the
`GripVertical` span in the header (`AbsenceGrid.tsx:71`), never onto a `<th>` or a body `<td>`.
dnd-kit sensors activate from the element carrying the listeners, so a `mousedown` on a `<td>`
is invisible to the `PointerSensor` mounted at `:110`. This was the largest unknown and it
resolves favourably. The handle-only binding is load-bearing for a different reason (a CSS
`transform` on a `<th>` detaches it in a table layout — S-07, `employee-grid-order/plan.md:16`)
and **must not** be "unified" with the cell gesture.

**Cell interaction is a single `onClick`** gated by one predicate:

```ts
const clickable = (isOwn || isModerator) && !isWeekend && !isInactive;   // :300
```

Non-actionable cells receive `onClick={undefined}` rather than a no-op handler, and the comment
at `:310-311` states the governing intent — "Hover only where a click does something — weekends
are excluded by `clickable`, so they never gain an affordance they cannot honour."

**Nothing in the grid is memoized.** Every render rebuilds `absenceMap`, `absenceTypeMap` and
`employeeNameMap` and constructs two `Intl.DateTimeFormat` instances (`:112-132`). A drag state
at grid level re-runs all of it on every `mouseenter`.

**The write path is single-row at every layer.** `POST /api/absences` inserts exactly one row
(`index.ts:252-254`); `AbsenceFormDialog` is structurally single-date (`day: Date`, `:86`);
`handleSave` builds `sharedFields` around a single `dateStr` (`:213-223`). The route's `date`
field is a raw regex (`:149`), **not** the calendar-validating `DateSchema` used by GET and
PATCH — so `2026-02-31` passes zod and is rejected only by Postgres.

**`UNIQUE (employee_id, date)`** (`schema.ts:65`, `schema.sql:51`) means one occupied day aborts
an entire multi-row `INSERT`. It surfaces reactively as PG `23505` → HTTP 409 with a singular
message that cannot name the offending date (`index.ts:279`).

**Weekend exclusion is UI-only.** `isWeekend` is computed at `AbsenceGrid.tsx:275`; a sweep
across `src/pages/api/`, `src/lib/` and `supabase/` finds no weekday rule at any server layer.
A direct POST of a Saturday is accepted and stored.

**Holiday balance is derived, not mutated.** `computeUsedDays` aggregates absence rows on read
(`holiday-balance.ts:15-59`), so writing N `urlop` rows needs no balance write and no
cross-table transaction. `db.transaction(` appears **zero times** in the repo, and a single
multi-row `INSERT` is atomic on its own — this feature needs no new transaction pattern.

**Verification is constrained.** vitest is `environment: "node"` with a `.ts`-only include
(`vitest.config.ts:12-13`), so component tests are unreachable without new dependencies. There
are 0 `data-testid` occurrences repo-wide, and `e2e-rules.md:71-73` documents a standing bias
against pixel-geometry pointer drags. The repo's escape hatch is the `radial-timepicker-ux`
precedent: extract the arithmetic into a pure module and unit-test that hard.

**Sequencing has moved since the frame was written.** `grid-adjustment-offsite-training` is no
longer "planned, zero code" — it is `status: implementing`, Phase 1 is committed (`23628c0`),
Phase 2 sits uncommitted in the working tree (`AbsenceGrid.tsx` +11/−11, extracting
`cellTimeRange` into `src/lib/absence-grid-cell.ts`), and Phases 3–4 still rewrite the cell's
content and switch the table to `table-fixed`. This plan therefore sequences **after** it.

## Desired End State

A moderator (or an employee in their own column) presses the mouse on a grid cell, drags down
or up across a run of days, and releases. Weekends inside the run are never highlighted and
never written. On release, a dialog opens titled with the range, showing an empty form. They
pick a type once, optionally set one shared time window, add one comment and one substitute,
and press `Zapisz`. If the range crosses existing entries, a confirmation step first lists each
affected day with the type and hours it currently holds; they continue or cancel. On confirm,
one request writes every day atomically and the page reloads once.

Verify by: dragging 12 August to 21 August in a column, confirming the two weekends are neither
highlighted nor written; dragging across a day that already holds a partial-day training entry
and confirming the dialog names that day, its type and its hours before overwriting it.

### Key Discoveries

- dnd-kit cannot see a `<td>` mousedown — `listeners` are on the grip only (`AbsenceGrid.tsx:71`)
- `clickable` (`:300`) is the single gate; withhold handlers rather than no-op them (`:316-322`)
- `onConflictDoUpdate` precedent with a composite target and `updated_at: new Date()` at
  `holiday-balances/index.ts:191-199` — exactly the shape `(employee_id, date)` needs
- `absenceMap` is already built client-side keyed `employee_id_date` (`:114-117`), so the grid
  knows which days are occupied at mouse-release — **the confirmation needs no pre-flight request**
- Unmemoized map construction at `:112-132` is the one concrete performance constraint
- `DateSchema` (`validators.ts:3-9`) exists and validates real calendar dates; the create route
  does not use it
- `clampAbsenceHours` (`absence-hours.ts`) and `isPartialDayViolation`
  (`services/absence-partial-day.ts`) are the shared rules the bulk route must also honour
- Pure-module test precedent: `src/lib/time-dial.ts` + `src/tests/lib/time-dial.test.ts`

## What We're NOT Doing

- **Touch and keyboard range selection.** Mouse drag only, as scoped before research.
- **Two-dimensional selection.** A range is anchored to one employee column, as in the prototype
  (`10xUrlopy.dc.html:731`).
- **Optimistic updates.** One `window.location.reload()` per range stays, consciously accepted.
  Out of scope in every prior plan.
- **Bulk delete.** Deletion stays per-cell; the prototype's delete loop is not ported.
- **Public holidays.** Unhandled at every layer today; a range will still write a row on a public
  holiday. The obvious follow-up, explicitly out of scope.
- **Entitlement blocking.** There is no entitlement check on create today (`left_days` simply goes
  negative, `holiday-balance.ts:77`); making a range blocking would be a new rule.
- **The prototype's priority flag and 🅿️ badge** — already rejected
  (`huge-ui-ux-improvement/plan.md:517`).
- **Seeding the range form from an existing entry.** The prototype seeds from `dayFrom` only
  (`:715`); we open blank.
- **Moving dnd-kit listeners onto `<th>`/`<td>`.** S-07 forbids it.
- **Overturning the one-row-per-day data model.** S-09 stands (`absence-hours-range/plan.md:41`);
  what changes is only how many rows one gesture creates.

## Implementation Approach

Four layers, built bottom-up so each is verifiable before the one above depends on it.

The **pure core** carries all the arithmetic — direction normalisation, date expansion, weekend
filtering, the commit-vs-click decision, and partitioning a range against existing entries. It
imports nothing from React and is unit-tested exhaustively. This follows the repo's only viable
strategy for testing a pointer gesture (`time-dial.ts`).

The **bulk endpoint** is a new route rather than an extension of `POST /api/absences`, so the
proven single-row path keeps its clamp, partial-day check and 409 mapping unchanged for
click-to-add. It re-validates everything the gesture claims to have done — weekday, calendar
validity, partial-day eligibility, hour bounds — because the service-role connection bypasses
RLS and nothing else will backstop it (`AGENTS.md:62`).

The **dialog** gains a range mode rather than a sibling component. The type picker, hours row
with dial, comment field and substitute grid are ~200 lines of JSX that must stay byte-identical
between the two modes; a sibling would either duplicate them or force a larger shared-form-body
refactor than range mode itself. Range mode is create-only, so the branching stays contained:
no `existingAbsence`, no delete button, a different title, a different save target, plus a
confirm step.

The **gesture** is the thinnest layer: three handlers, one piece of state, and styling. It
delegates every decision to the pure core.

## Critical Implementation Details

**`mouseup` must be bound to `window`, not the cell.** The prototype registers it in
`componentDidMount` and tears it down in `componentWillUnmount` (`10xUrlopy.dc.html:700-710`).
A release outside the grid — over the legend, the page margin, another column — must still
commit rather than strand the drag in a state where the highlight follows the cursor forever.

**Weekends must be guarded at both ends, and they are guarded differently at each.** The client
withholds handlers so a weekend cell is never a drag anchor or extension target; the server
*rejects* the whole request if a weekend date arrives. These are deliberately not the same
policy: client-side a weekend inside a range is ordinary and silently skipped, whereas a weekend
date reaching the API can only come from a client bug or a hand-crafted request, and failing
loudly surfaces it instead of hiding it.

**The confirmation is the second step of the range dialog, not a step before it.** Confirming
before the form is filled would ask the user to approve an overwrite whose replacement is not
yet decided. It also stays inside the same Radix `Dialog` (a `step` state swapping body and
footer) rather than opening a nested one, which avoids the focus-trap conflict two stacked
Radix dialogs produce.

**Ordering inside the bulk route matters.** The partial-day check and the hour clamp run **once**
on the shared window before the insert, not per row — but they must run, and the clamped values
are what get written to all N rows. Skipping either because "the client already did it" is the
failure this route exists to prevent.

**A single multi-row `INSERT ... ON CONFLICT DO UPDATE` is already atomic.** Do not wrap it in
`db.transaction()` — the repo has no such pattern and does not need one here.

## Phase 1: Prerequisite — settle the cell structure

### Overview

`grid-adjustment-offsite-training` is mid-implementation against the same `<td>` region. Its
Phases 3 and 4 rewrite the cell's content and switch the table to `table-fixed`, and its own
acceptance criteria 4.8 and 4.9 assert that drag-to-reorder and the hover highlight are
unchanged — far easier to verify before a second pointer gesture exists than after.

### Changes Required

No code in this repo's `src/` is written by this phase. It is a gate.

#### 1. Land the in-flight change

**Files**: `context/changes/grid-adjustment-offsite-training/plan.md` (its own Progress)

**Intent**: Drive that change's Phases 2, 3 and 4 to completion and commit them, so this plan
builds on a settled cell structure rather than rebasing a gesture onto a `table-fixed` rewrite.

**Contract**: Its Progress rows 2.1–4.9 are all `[x]`, and `git status` shows no uncommitted
changes to `src/components/absence/AbsenceGrid.tsx`.

### Success Criteria

#### Automated Verification

- `git status --short src/components/absence/AbsenceGrid.tsx` reports no modification
- Existing suite green: `npm run test:run`
- Linting passes: `npm run lint`

#### Manual Verification

- `grid-adjustment-offsite-training/plan.md` Progress rows 2.1 through 4.9 are all checked
- The grid renders with bounded, equal-width columns and icon-only full-day cells

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Pure range module

### Overview

All range arithmetic in one dependency-free module with an exhaustive unit suite. No UI, no
imports from React. This is the layer that makes the gesture testable at all.

### Changes Required

#### 1. The range module

**File**: `src/lib/absence-range.ts` (new)

**Intent**: Hold every decision a range makes, so the component that owns the mouse holds none
of them. Mirrors `src/lib/time-dial.ts` in role and `src/lib/absence-grid-cell.ts` in style —
a header comment stating why the logic lives here rather than inline.

**Contract**: Dependency-free apart from `@/types` and `@/lib/absence-types`, so it is importable
from both a React island and a server route (the same constraint `absence-hours.ts` and
`absence-types.ts` state explicitly). Exports:

- A date-key formatter matching the grid's existing local-time convention. The grid builds
  `dateStr` from `getFullYear`/`getMonth`/`getDate` (`AbsenceGrid.tsx:276`) — **not** from
  `toISOString`, which would shift the day in a positive UTC offset. This module must use the
  same construction, and it is the reason the formatter is exported rather than inlined twice.
- Direction normalisation: an anchor day index and a current day index in either order become an
  inclusive `[min, max]` span.
- The commit predicate: whether a completed gesture is a range (two or more **distinct** days) or
  falls through to the existing single-cell `onClick`. Deliberately a day-count rule, not a pixel
  distance — pixel geometry is what `e2e-rules.md:71-73` says cannot be tested here.
- Membership test for "is this day index inside the active selection", for the cell's highlight.
- Expansion of a span to the concrete non-weekend `Date`s (or date strings) it covers, weekends
  dropped. Weekend detection is `getDay() === 0 || getDay() === 6`, the grid's existing rule
  (`:275`).
- Partition of an expanded range against a caller-supplied lookup of existing entries, returning
  the free days and the occupied ones. The occupied side carries enough to render the
  confirmation — the date plus the existing absence — so the dialog needs no second lookup.

#### 2. Unit tests

**File**: `src/tests/lib/absence-range.test.ts` (new)

**Intent**: Cover the cases the gesture cannot be trusted to exercise by hand.

**Contract**: Follows the existing `src/tests/lib/*.test.ts` style. Must include: upward and
downward drags producing the same span; a single-day gesture failing the commit predicate; a
two-day gesture passing it; a span whose interior is entirely weekend (Fri→Mon yields two days);
a span that is *only* weekend, yielding an empty expansion; month boundaries; a positive-UTC-offset
date not shifting a day; and a partition where the range crosses a mix of free, full-day-occupied
and partial-day-occupied days.

### Success Criteria

#### Automated Verification

- New unit tests pass: `npm run test:run`
- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification

- The module imports nothing from `react` or `@/db` (verifiable by reading its imports)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Bulk write endpoint

### Overview

A new route that writes N days atomically as an upsert, re-validating every rule the gesture
claims to have satisfied and reporting which days it overwrote.

### Changes Required

#### 1. The bulk route

**File**: `src/pages/api/absences/bulk.ts` (new)

**Intent**: Accept one employee, a list of dates and one set of shared fields, and write them in
a single atomic statement whose conflict behaviour is overwrite. Deliberately separate from
`POST /api/absences` so the single-row path keeps its existing contract, its E2E coverage and
its singular 409 message untouched.

**Contract**: `export const prerender = false` and an uppercase `POST` export, per project
convention. Request body validated by zod:

- `employee_id` optional uuid — honoured **only** for moderators, exactly as `index.ts:204-219`
  does, including the "target exists and is not soft-deleted" lookup. RLS will not backstop this
  (`AGENTS.md:62`), so the check is repeated here in full rather than assumed.
- `dates` — a non-empty array of `DateSchema` (**not** the raw `/^\d{4}-\d{2}-\d{2}$/` regex the
  create route uses at `:149`; a bulk body is exactly where `2026-02-31` would otherwise slip
  through to Postgres). Bounded by a maximum length so one request cannot address an unbounded
  span; 31 is the natural cap since a selection cannot leave one rendered month. Duplicates
  rejected or de-duplicated — an upsert with a repeated conflict target inside one statement
  fails with PG `21000`, so this must be handled before the insert, not after.
- The same shared fields the create schema carries — `absence_type_id`, `is_full_day`,
  `start_time`, `end_time`, `comment`, `substitute_employee_id` — with the create route's
  `refine` on the full-day/hours combination reproduced.

Then, in order:

1. **Weekday validation.** Every date must be Monday–Friday; any weekend date fails the whole
   request with 400 and a Polish message naming the offending date(s). The server has no weekday
   rule today, and this route is where one is introduced.
2. **Partial-day eligibility**, once, via the existing `isPartialDayViolation(db, typeId, isFullDay)`
   — the shared server guard, not a re-implementation.
3. **Hour clamping**, once, via `clampAbsenceHours` on the shared window, mapping the
   `end-before-floor` rejection the same way `index.ts:242-246` does. The clamped values are what
   all N rows store.
4. **One multi-row upsert** — `.insert(absences).values([...])` with `.onConflictDoUpdate({ target: [absences.employee_id, absences.date], set: {...} })`,
   following `holiday-balances/index.ts:191-199` including `updated_at: new Date()`. Atomic on its
   own; **no** `db.transaction()`.

Response: 201 with the written rows (via `.returning(...)`, the same column list the create route
projects). Because the request already knows which dates it sent, per-day outcome is derivable by
the client from the returned rows; the response additionally reports which dates were
**overwritten** versus newly created, which is the reporting the only array-bodied precedent
(`employees/order.ts:67-85`) conspicuously lacks. Error mapping mirrors `index.ts:271-281`
(`42501`→403, `23503`→422 with the constraint-name discrimination, `23514`→400) minus `23505`,
which the upsert makes unreachable. `Sentry.captureException` with a `route` tag on every catch,
as every other route does.

#### 2. Types

**File**: `src/types.ts`

**Intent**: Declare the bulk request and response DTOs alongside the existing entity and DTO
types, so the dialog and the route agree on one shape.

**Contract**: Request and response types for the bulk create, exported from the shared module per
the project's "shared types go in `src/types.ts`" convention.

### Success Criteria

#### Automated Verification

- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`
- Existing suite still green: `npm run test:run`

#### Manual Verification

- Against the **deployed** app (Drizzle cannot connect under `wrangler dev`): a 3-date body writes
  3 rows and returns them
- A body containing a Saturday returns 400 naming that date, and writes nothing
- A body crossing an existing entry overwrites it, reports it as overwritten, and leaves the other
  days correct
- A partial-day body on a non-training type returns 400 from the shared partial-day guard
- A non-moderator sending another employee's `employee_id` writes to their **own** column, not the
  target's

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Range-capable dialog with overwrite confirmation

### Overview

The dialog learns to represent N days: one range title, a blank form, one shared time window,
and a confirmation step that names what an overwrite will destroy before it happens.

### Changes Required

#### 1. Range mode

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Accept a range as an alternative to a single day, keeping every form control
identical between the two modes. Range mode is always create-only, which is what keeps the
branching small.

**Contract**: The props gain a range alternative to `day: Date`. Model it as a discriminated
union rather than an optional second date, so a range can never be passed alongside an
`existingAbsence` — that combination has no meaning and the type system should say so. In range
mode:

- `existingAbsence` is absent, so the delete button's existing `existingAbsence &&` guard
  (`:502`) already hides it and the `handleDelete` path is unreachable. No new condition needed.
- The title reads as a range and the subheading names the span, following the prototype's
  `dayFrom–dayTo MONTH` shape (`10xUrlopy.dc.html:1389-1391`) in Polish. The target-employee line
  (`:275-279`) is unchanged.
- The form opens blank — no seeding from any day in the range.
- Hours behave exactly as in single-day mode: the `canBePartialDay` gate on the two training types
  (`absence-types.ts:11`), the same `clampTimesOnBlur`, the same single dial trigger. The window
  written is one window repeated per day.
- `saveDisabled` (`:135`) is unchanged — the same three conditions apply.

`handleSave` branches on mode: single-day keeps its exact current POST/PATCH behaviour, range
mode posts the shared fields plus the expanded date list to `/api/absences/bulk`. Both keep the
single `window.location.reload()` on success and the `toast.error` fallback.

#### 2. The confirmation step

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Before a range overwrites existing entries, show exactly what will be replaced. An
overwrite destroys data — a partial-day training entry with times, replaced by a full-day
`urlop`, loses its hours — so a count is not enough.

**Contract**: An internal step state (`"form" | "confirm"`) swapping the dialog body and footer
inside the **same** `Dialog`, not a nested one. Pressing `Zapisz` in range mode moves to the
confirm step **only when** the range crosses at least one existing entry; otherwise it writes
directly. The confirm body follows the `DeleteConfirmDialog` pattern — a "Czy na pewno…"
sentence, `Anuluj` returning to the form, and a confirming action — and lists **each** affected
day with the date, its current type name, and its current hours where it has them. The occupied
days arrive as a prop computed by the grid from `absenceMap`; no request is made to discover
them. A long list scrolls within the dialog rather than growing it past the viewport.

The confirming action reuses `isSubmitting` so a double-press cannot fire two bulk writes.

### Success Criteria

#### Automated Verification

- Type checking and linting pass: `npm run lint` (the discriminated union is what makes an
  invalid mode combination a compile error)
- Production build succeeds: `npm run build`
- Existing suite still green: `npm run test:run`

#### Manual Verification

- Single-day click-to-add and click-to-edit are completely unchanged, including delete
- A range over empty days writes them all and reloads once, with no confirmation step
- A range crossing an entry shows the confirmation, naming that date, its type and its hours
- `Anuluj` on the confirmation returns to the filled form with entries intact, writing nothing
- A range on a training type accepts one time window and applies it to every day
- Switching to a non-training type in range mode resets to full-day and clears the times
- The dial opens and sets both ends in range mode

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 5: The drag gesture

### Overview

The thinnest layer: three handlers, one piece of state, selection styling, and the addressability
the test suite needs. Every decision delegates to Phase 2's module.

### Changes Required

#### 1. Drag state and handlers

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Turn a press-drag-release across cells in one column into a committed range, leaving
a single-cell press to the existing `onClick`.

**Contract**: One state value holding the active drag — the anchored employee id plus the anchor
and current day indices — `null` when idle. Handlers are attached **only** where `clickable` is
true (`:300`), following the file's established `onClick={clickable ? … : undefined}` form at
`:316-322` and the intent stated at `:310-311`: a weekend cell gains no drag affordance it cannot
honour. `onMouseDown` anchors; `onMouseEnter` extends but only while a drag is active **and** the
cell belongs to the anchored employee, blocking horizontal spread as the prototype does at
`10xUrlopy.dc.html:731`.

Commit is a **window-level** `mouseup` listener registered in an effect and torn down on unmount,
matching the prototype's `componentDidMount`/`componentWillUnmount` pair (`:700-710`) — a release
outside the grid must commit rather than strand the drag. On commit: clear the drag state, and if
the module's commit predicate says it was a range, expand it, partition it against `absenceMap`,
and open the dialog in range mode with the occupied days. If not, do nothing — the browser's own
`click` fires and the existing single-cell path handles it.

Note the existing `key` on the dialog (`:376`) forces a fresh mount per selection; extend it so a
range selection also remounts, or a second range would inherit the first one's form state.

#### 2. Selection feedback and text-selection suppression

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Show which cells are selected during the drag, and stop the browser selecting day
numbers and weekday labels as text while the mouse is down.

**Contract**: Cells inside the active selection get a fill plus an inset ring, following the
prototype's `#d5ebf5` fill and `inset 0 0 0 2px #072143` ring (`:816-817`) — `#072143` is the
app's `--primary` navy, available as a Tailwind token, so use the token rather than the literal.
Selection styling must not apply to non-`clickable` cells. `userSelect: none` on the cells
(`:818` in the prototype) — the app's table has no such suppression today. The existing hover
tint `hover:bg-[#eef3f8]` (`:314`) and the weekend row background (`:279`) are unchanged.

#### 3. Bound the per-`mouseenter` cost

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Stop each `mouseenter` from rebuilding three `Map`s and two `Intl.DateTimeFormat`
instances (`:112-132`).

**Contract**: Wrap the derived maps and the two formatters in `useMemo` keyed on the props they
derive from. Note the frequency is bounded by row crossings, not pixels — a `mouseenter` fires
per cell entered, so a full-month drag is ~31 events, not thousands. This is the proportionate
fix; per-cell `React.memo` is not needed and is not part of this change. Do not disturb
`orderedEmployees`' existing seeded-once-from-props behaviour (`:94`) — pre-existing and out of
scope.

#### 4. Cell addressability

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Make a specific (employee, day) cell locatable. Today no `<td>` carries `data-*`,
`role`, `aria-*` or an accessible name, and the E2E suite finds cells by the literal `+` text
(`absence-form-dialog.spec.ts:33`) — so "day 8 was written and day 9 was skipped" is not
assertable.

**Contract**: A `data-testid` on each employee `<td>` encoding the employee id and the date key,
using the same `dateStr` construction the row already computes. This is the repo's **first**
testid (0 occurrences today); `e2e-rules.md:6` permits them where no accessible name exists,
which is exactly true here. The scheme is documented in Phase 6.

#### 5. Hint copy

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Tell the user the gesture exists. The prototype's hint was deliberately stripped by
the predecessor change pending this one (`huge-ui-ux-improvement/plan.md:498`).

**Contract**: Extend the legend footer's existing `Kliknij komórkę, aby dodać.` (`:243`) so both
verbs are stated, restoring the prototype's second half (`10xUrlopy.dc.html:101`). Same element,
same typography.

### Success Criteria

#### Automated Verification

- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`
- Existing suites still green: `npm run test:run`

#### Manual Verification

- Dragging down and dragging up across the same days both open the same range
- Weekends inside the drag are never highlighted and never written
- A single-cell press still opens the ordinary single-day dialog
- Releasing the mouse outside the grid still commits; the highlight never sticks after release
- Dragging horizontally does not extend the selection into another employee's column
- No text selection of day numbers or weekday labels occurs during a drag
- **Column drag-to-reorder still works from the header grip**, and a cell drag never reorders
- An employee dragging in another employee's column gets no selection at all
- A drag in a soft-deleted employee's column gets no selection
- A full-month drag stays visually smooth

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 6: E2E coverage and rules documentation

### Overview

Cover the range write end-to-end without a pixel drag, and record the testid scheme so it does
not spread inconsistently as the repo's first.

### Changes Required

#### 1. Range E2E spec

**File**: `tests/e2e/absence-grid-range.spec.ts` (new)

**Intent**: Assert the range actually writes the right days and skips the right ones — the core
claim of this feature — without depending on pixel geometry.

**Contract**: Drive the gesture **geometry-free** by dispatching `mousedown` on the anchor cell,
`mouseenter` on the target cell, and `mouseup` on the window, located by the Phase 5 testids.
This is the escape hatch that satisfies `e2e-rules.md:71-73` — the objection there is to
`page.mouse` pixel drags, not to synthesized events on addressed elements, and it is the same
reasoning that sent the dial's test down the keyboard path
(`absence-form-dialog.spec.ts:129-130`).

Cover: a range spanning a weekend writes only the weekdays; the confirmation appears when the
range crosses an entry and `Anuluj` writes nothing. Follow the suite's existing conventions —
accessible-name locators for the dialog, no `waitForTimeout`, and the `toPass()` wrapper the
rules recommend for island-hydration races.

#### 2. Rules documentation

**File**: `tests/e2e/e2e-rules.md`

**Intent**: Record the testid scheme and the geometry-free drag technique, so the next person
follows them rather than inventing a second convention.

**Contract**: Under "Project-specific locators", document the grid-cell testid format and note it
as the documented exception to the accessible-name-first rule. Add the synthesized-event drag
technique next to the existing anti-pixel-drag rule, stating why it is acceptable where a
`page.mouse` drag is not.

#### 3. Stale-claim fix

**File**: `AGENTS.md`

**Intent**: `AGENTS.md:9` claims "There is no Playwright/E2E setup — do not invent commands
beyond these", contradicted by `playwright.config.ts`, `tests/e2e/` and the `e2e` scripts in
`package.json`. This change adds an E2E spec, so leaving the claim in place actively misleads the
next agent.

**Contract**: Correct that line to reflect the real E2E setup and its commands. Documentation only.

### Success Criteria

#### Automated Verification

- New E2E spec passes against a deployed target: `npm run e2e`
- Existing E2E specs still pass: `npm run e2e`
- Linting passes: `npm run lint`

#### Manual Verification

- The new spec passes on a re-run without flaking
- `e2e-rules.md` states the testid scheme precisely enough to follow without reading the component
- `AGENTS.md:9` no longer denies the E2E setup exists

**Implementation Note**: The E2E suite runs against the deployed Workers app and has been red at
the setup project historically (`radial-timepicker-ux/change.md`). Confirm the suite is green
before attributing a failure to this change.

---

## Testing Strategy

### Unit Tests

`src/tests/lib/absence-range.test.ts` carries the weight, because it is the only layer that can
be tested cheaply and exhaustively:

- Direction: upward and downward drags over the same days produce one identical span
- Commit predicate: one distinct day is not a range; two are
- Weekend filtering: Fri→Mon yields two days; a Sat→Sun span yields none; a full-month span
  yields only weekdays
- Date keys: built from local getters, so a positive UTC offset does not shift a day
- Month boundaries: a span at the first and last day of a rendered month
- Partition: a range crossing free days, a full-day entry and a partial-day training entry
  separates them correctly and carries the existing entry through for the confirmation

### Integration Tests

There is no integration-test layer in this repo. The bulk route is verified manually against the
deployed app (Drizzle cannot connect under `wrangler dev` — workerd's TLS layer rejects Supabase's
certificate), and end-to-end through Phase 6's spec.

### Manual Testing Steps

1. Drag 12 → 21 August in your own column, pick `urlop`, save. Exactly the eight weekdays are
   written; both weekends are untouched.
2. Repeat over a range containing an existing partial-day training entry. The confirmation names
   that date, its type and its hours. Press `Anuluj` — nothing is written and the form is intact.
   Repeat and confirm — the day is overwritten and its hours are gone.
3. Single-click an empty cell, then an occupied one. Both behave exactly as before, delete included.
4. Drag upward, from a later day to an earlier one. Same range as the downward drag.
5. Press in a cell, drag outside the table, release. The range commits; no highlight remains.
6. Drag horizontally across two employees. The selection stays in the anchored column.
7. Drag the header grip to reorder a column. Reordering still works and no range opens.
8. As a non-moderator, attempt a drag in a colleague's column. Nothing highlights.
9. Pick a training type in range mode, set 09:00–13:00, save. Every day carries that window.
10. `POST /api/absences/bulk` with a Saturday in `dates`. 400, nothing written.

## Performance Considerations

The one real constraint is the unmemoized derivation at `AbsenceGrid.tsx:112-132` — three `Map`s
and two `Intl.DateTimeFormat` instances rebuilt per render. Phase 5 memoizes them.

The frequency is more forgiving than it first appears: `mouseenter` fires once per cell entered,
so a drag down a whole month is ~31 renders, not one per pixel. That is why `useMemo` on the
derived values is the proportionate fix and per-cell `React.memo` is out of scope. If a
full-month drag is visibly janky after memoization, the next step would be extracting a memoized
row component — but do not do that speculatively.

The bulk write replaces N round trips and N page loads with one of each, so the network and
render cost of a range falls sharply relative to today.

## Migration Notes

No schema change and no migration. `UNIQUE (employee_id, date)` stays exactly as it is — it is
what makes the grid's one-cell-one-day model true, and this change does not overturn S-09's
"no multi-day absence ranges" data-model ruling (`absence-hours-range/plan.md:41`). What changes
is only how many rows one gesture creates.

No backfill and no data transformation. Holiday balance is derived on read
(`holiday-balance.ts:15-59`), so no stored aggregate needs recomputing after a range write.

Rollback is a code revert: the new route and module are additive, and the grid and dialog changes
are behavioural. Nothing written by a range is structurally distinguishable from rows written
one-by-one today, so reverting leaves no orphaned or unreadable data.

## References

- Frame brief: `context/changes/grid-multicheck/frame.md`
- Research: `context/changes/grid-multicheck/research.md`
- Prototype drag model: `new-design/10xUrlopy.dc.html:693-738`, `:816-818`, `:839-841`,
  `:1364-1375`, `:1389-1391`
- Upsert precedent: `src/pages/api/holiday-balances/index.ts:191-199`
- Confirm-dialog precedent: `src/components/employee/DeleteConfirmDialog.tsx`
- Pure-module test precedent: `src/lib/time-dial.ts` + `src/tests/lib/time-dial.test.ts`
- Cell-helper style precedent: `src/lib/absence-grid-cell.ts`
- Shared domain rules: `src/lib/absence-hours.ts`, `src/lib/absence-types.ts`,
  `src/lib/services/absence-partial-day.ts`
- S-07 (no transform on `<th>`, listeners on the handle): `context/changes/employee-grid-order/plan.md:16`
- S-09 (one row per day): `context/changes/absence-hours-range/plan.md:41`
- Concurrent change this plan sequences after: `context/changes/grid-adjustment-offsite-training/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prerequisite — settle the cell structure

#### Automated

- [x] 1.1 `git status --short src/components/absence/AbsenceGrid.tsx` reports no modification — clean once the prerequisite's review-fix batch landed at `643eb49` — c35fd1c
- [x] 1.2 Existing suite green: `npm run test:run` — 18 files, 178/178 — c35fd1c
- [x] 1.3 Linting passes: `npm run lint` — 0 errors — c35fd1c

#### Manual

- [x] 1.4 `grid-adjustment-offsite-training/plan.md` Progress rows 2.1 through 4.9 are all checked — c35fd1c
- [x] 1.5 The grid renders with bounded, equal-width columns and icon-only full-day cells — c35fd1c

### Phase 2: Pure range module

#### Automated

- [ ] 2.1 New unit tests pass: `npm run test:run`
- [ ] 2.2 Type checking and linting pass: `npm run lint`
- [ ] 2.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 2.4 The module imports nothing from `react` or `@/db`

### Phase 3: Bulk write endpoint

#### Automated

- [ ] 3.1 Type checking and linting pass: `npm run lint`
- [ ] 3.2 Production build succeeds: `npm run build`
- [ ] 3.3 Existing suite still green: `npm run test:run`

#### Manual

- [ ] 3.4 A 3-date body writes 3 rows and returns them (deployed app)
- [ ] 3.5 A body containing a Saturday returns 400 naming that date, and writes nothing
- [ ] 3.6 A body crossing an existing entry overwrites it and reports it as overwritten
- [ ] 3.7 A partial-day body on a non-training type returns 400
- [ ] 3.8 A non-moderator sending another employee's `employee_id` writes to their own column

### Phase 4: Range-capable dialog with overwrite confirmation

#### Automated

- [ ] 4.1 Type checking and linting pass: `npm run lint`
- [ ] 4.2 Production build succeeds: `npm run build`
- [ ] 4.3 Existing suite still green: `npm run test:run`

#### Manual

- [ ] 4.4 Single-day click-to-add and click-to-edit are unchanged, including delete
- [ ] 4.5 A range over empty days writes them all and reloads once, with no confirmation
- [ ] 4.6 A range crossing an entry shows the confirmation naming that date, its type and its hours
- [ ] 4.7 `Anuluj` on the confirmation returns to the filled form and writes nothing
- [ ] 4.8 A range on a training type accepts one time window and applies it to every day
- [ ] 4.9 Switching to a non-training type in range mode resets to full-day and clears the times
- [ ] 4.10 The dial opens and sets both ends in range mode

### Phase 5: The drag gesture

#### Automated

- [ ] 5.1 Type checking and linting pass: `npm run lint`
- [ ] 5.2 Production build succeeds: `npm run build`
- [ ] 5.3 Existing suites still green: `npm run test:run`

#### Manual

- [ ] 5.4 Dragging down and dragging up across the same days open the same range
- [ ] 5.5 Weekends inside the drag are never highlighted and never written
- [ ] 5.6 A single-cell press still opens the ordinary single-day dialog
- [ ] 5.7 Releasing outside the grid still commits; the highlight never sticks
- [ ] 5.8 Dragging horizontally does not extend into another employee's column
- [ ] 5.9 No text selection of day numbers or weekday labels during a drag
- [ ] 5.10 Column drag-to-reorder still works from the grip; a cell drag never reorders
- [ ] 5.11 An employee dragging in another employee's column gets no selection
- [ ] 5.12 A drag in a soft-deleted employee's column gets no selection
- [ ] 5.13 A full-month drag stays visually smooth

### Phase 6: E2E coverage and rules documentation

#### Automated

- [ ] 6.1 New E2E spec passes against a deployed target: `npm run e2e`
- [ ] 6.2 Existing E2E specs still pass: `npm run e2e`
- [ ] 6.3 Linting passes: `npm run lint`

#### Manual

- [ ] 6.4 The new spec passes on a re-run without flaking
- [ ] 6.5 `e2e-rules.md` states the testid scheme precisely enough to follow without reading the component
- [ ] 6.6 `AGENTS.md:9` no longer denies the E2E setup exists
