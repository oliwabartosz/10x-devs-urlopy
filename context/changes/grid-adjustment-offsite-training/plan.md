# Bound the grid's column width and drop the type name from the cell — Implementation Plan

## Overview

The monthly grid widens because every cell chip renders the absence type's full name in a
`whitespace-nowrap` span inside an auto-layout table. This is not specific to
`szkolenie/wyjście poza miejsce pracy`: four of the seven seeded types breach the 120px column floor
with no `HH:MM` at all. This plan removes the type name from the cell — restoring the reference
prototype's contract, where the chip is icon + time range and the name lives in the legend and the
tooltip — and pins column widths with `table-fixed`, which is the only lever that also bounds the
employee-name header. Two adjacent findings ride along: a single-codepoint offsite icon, and gating
the cell's time range on the partial-day whitelist.

## Current State Analysis

- The chip renders `{absenceType.name}{range && ` ${range}`}` in one span
  (`src/components/absence/AbsenceGrid.tsx:333-336`), inside a container that is
  `whitespace-nowrap` (`:326`).
- The table is auto-layout — `<table className="w-full border-collapse text-sm">` (`:248`) — with no
  `table-fixed` and no `min-width`. In an auto-layout table a column is as wide as the widest
  min-content among all its cells, so one long chip anywhere in the month widens that employee's
  column for all ~30 rows.
- `truncate` is inert in both places it appears. On the chip label it is a flex item whose
  `overflow:hidden` resolves `min-width:auto` to **0 — a floor, not a cap**. On the employee-name
  header (`:75`, `:256`) the span is a block box, where `overflow:hidden` does not affect intrinsic
  sizing at all. Nothing clips today; the columns widen instead.
- `min-w-[120px]` on both header variants (`:64`, `:255`) is a floor, not a cap — and it is almost
  never the operative number, because both headers render the full `first_name last_name` nowrap.
  Realistic Polish names put a moderator's column at 117–161px before any chip is drawn, so the PRD's
  "up to about 10 people" (`context/foundation/prd.md:95`) was already unattainable on an empty grid.
- `timeRangeOf` (`:33-36`) is type-blind: it keys only off `is_full_day` plus both times, never the
  type. No database constraint references `absence_type_id`
  (`supabase/migrations/20260605000001_absence_start_end_time.sql:25-30` ties times only to
  `is_full_day`), so any row reaching the database outside the API routes renders `HH:MM` for all
  seven types.
- The offsite type's icon is an eight-codepoint ZWJ sequence
  (`supabase/migrations/20260807122840_faulty_hobgoblin.sql:30`), Emoji 15.1 "person running facing
  right". Where a font lacks the ligature it decomposes into three or four visible glyphs.
- There are **no component tests for this file**. `vitest.config.ts` is `environment: "node"` and
  includes only `src/tests/**/*.test.ts`; there is no jsdom/happy-dom and no
  `@testing-library/react`. The one spec touching the component is
  `tests/e2e/absence-form-dialog.spec.ts`, which never asserts a grid cell.

Full evidence, including the per-type width table and the font-metric method behind it, is in
`context/changes/grid-adjustment-offsite-training/research.md`.

## Desired End State

A grid cell is colour + icon + optional time range — never a type name. Employee columns are pinned
at 120px each and stretch to share leftover width when the team is small, so ten employees fit inside
the 1480px container without horizontal scroll, and no absence type can widen a column regardless of
its name's length. The type name remains discoverable in the legend and in the cell tooltip, and the
chip announces its type rather than its emoji. A cell shows `HH:MM` only for the two types the product
permits partial days on.

Verify by loading `/dashboard?tab=grid` with ten employees, at least one absence of each of the seven
types in the visible month, and at least one partial-day training entry: no horizontal scrollbar
appears, every column is the same width, and no cell contains Polish words.

### Key Discoveries:

- The prototype puts a type name in a cell for **zero of seven types** — its cell field is *named*
  `label` but holds the time range (`new-design/10xUrlopy.dc.html:803`). The p4 contract "Chip content
  is icon + label" (`context/changes/huge-ui-ux-improvement/plan.md:514`) misread that; the same
  change's own research read it correctly (`research.md:69`). This change reverts one line of drift.
- The prototype's columns are `flex: 1 1 0; min-width: 120px` (`:816`, `:822`) — equal shares that
  long content cannot widen. `table-layout: fixed` plus a computed table `min-width` is the table
  equivalent; `table-layout: auto` is the opposite, which is what silently dropped the guarantee.
- The tooltip already carries everything the cell is about to lose — `Typ: ${type.name}` and
  `Godziny: ${range || "cały dzień"}` (`AbsenceGrid.tsx:134-148`).
- Icon-only is already shipped on three sibling surfaces, and the accessibility fix it needed is
  recorded: `aria-label={type.name}` on the icon-only filter chips, because "text content beats
  `title` for the accessible name" (`AbsenceDetailsSubcards.tsx:265-289`,
  `reviews/impl-review-2.md:158-165`).
- `src/lib/type-filter.ts` with `src/tests/lib/type-filter.test.ts` is the precedent for extracting
  grid logic into a dependency-free module that the node-environment Vitest suite can test.
- Hand-authored data migrations in this repo are **not** registered in the drizzle journal. The last
  journal entry is `20260810112112_flippant_the_fury`;
  `20260811120000_purge_demo_partial_day_absences.sql` is absent from
  `supabase/migrations/meta/_journal.json` and is the template to follow, including its recorded
  reversal.
- Existing tests pin absence type **names** to the seed rows, never icons
  (`src/tests/api/absences/hours-clamp.test.ts:81-84`), so changing an icon breaks nothing.

## What We're NOT Doing

- **Not renaming any `absence_types.name` row.** Under an all-types reading that would be seven
  renames across five layers plus a PRD amendment. The requested `poza NBP` wording is not adopted.
- **Not wrapping the label onto multiple lines.** Five of seven types would need two or more lines,
  `szkolenie/wyjście` is unbreakable without an explicit break opportunity, and rows would grow
  individually rather than uniformly. See the research follow-up.
- **Not adding a `short_name` column or a slug.** No abbreviation scheme is introduced; two type-name
  pairs share prefixes, and the DB still has no stable code column.
- **Not restoring the prototype's 900px grid floor.** Explicitly declined — it would force horizontal
  scroll for a two-person team.
- **Not touching the details table or the stats matrices.** `AbsenceDetailsTable.tsx:59-62` and
  `AbsenceStats.tsx:18-20` keep their own type-blind range formatting; deduplicating them is a
  separate change.
- **Not repairing out-of-contract data.** The type gate stops the grid *displaying* hours the product
  forbids; it does not delete or normalise such rows, and `src/lib/services/holiday-balance.ts:42`
  still counts them.
- **Not building a tooltip component.** The native `title` attribute stays.
- **Not adding a component-test harness.** No jsdom, happy-dom or `@testing-library/react`.

## Implementation Approach

Four phases, ordered database → shared logic → cell content → layout, so each is independently
verifiable and revertable. Phase 1 makes the icon trustworthy before Phase 3 makes it the cell's only
discriminator. Phase 2 puts the one automatable piece of logic behind a tested pure function. Phases 3
and 4 are the two halves of the fix — dropping the name and bounding the column — kept apart because
one is a UX change and the other a layout change.

**Prerequisite, not a phase.** The working tree holds the uncommitted `huge-ui-ux-improvement` review
fixes, three hunks of which are in this very file (`:71` F7 colour token, `:251` and `:280-294` F6
sticky day column), plus edits to eight other files. Commit those as their own commit closing out
`huge-ui-ux-improvement` **before** starting Phase 1. None of them touch the chip or the label, so
there is no textual conflict — but committing them separately keeps the two changes reviewable and
revertable on their own.

## Critical Implementation Details

**`min-width` is not a sizing input under `table-fixed`, and a fixed-layout table's overflow behaviour
is not something to rely on.** Under `table-layout: fixed`, column widths come from the `width` of
the cells in the first row; a column with only `min-width` is unsized and shares leftover space
equally, which would let ten columns silently compress below 120px instead of overflowing. So the
header cells need an explicit `width`, and the table needs an explicit `min-width` computed from the
column count so overflow is deterministic rather than implementation-defined. `w-full` on top of that
`min-width` is what reproduces the prototype's `flex: 1 1 0` stretch when the team is small.

**The chip is a `div`, so `aria-label` alone is not enough.** `aria-label` on a generic element with
no role is ignored by several screen readers; the F5 precedent worked because it was applied to a
`<button>`. The chip needs `role="img"` alongside the label, which also stops the emoji being
announced as "palm tree" separately from the label.

**The type gate is applied to the cell but deliberately not to the tooltip.** A legacy row carrying
hours on a non-whitelisted type will render as a full-day chip while its tooltip still reports the
real `Godziny:` value. This asymmetry is intentional: the cell obeys the product rule, and the tooltip
stays the one surface where out-of-contract data is still visible to a moderator rather than silently
hidden.

---

## Phase 1: Single-codepoint offsite icon

### Overview

Replace the offsite type's eight-codepoint ZWJ emoji sequence with a single codepoint, so the icon
renders as exactly one glyph everywhere before Phase 3 makes it the cell's only discriminator.

### Changes Required:

#### 1. Data-only migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_offsite_training_single_codepoint_icon.sql`

**Intent**: Set the offsite type's `icon` to a single codepoint so it can never decompose into
multiple glyphs on a font lacking the Emoji 15.1 ligature, which would otherwise add roughly 26–40px
to the widest column and blur the primary type signal.

**Contract**: One `UPDATE absence_types SET icon = '🏃' WHERE name = 'szkolenie/wyjście poza miejsce
pracy';`. Follow `20260811120000_purge_demo_partial_day_absences.sql` as the template for a
hand-authored data migration: a header comment stating intent, and the **prior value recorded
verbatim** (`'🏃🏼‍♂️‍➡️'`, U+1F3C3 U+1F3FC U+200D U+2642 U+FE0F U+200D U+27A1 U+FE0F) so the change is
reversible by hand. Key on `name`, matching every prior catalogue migration. Do **not** add a journal
entry — this file is applied outside `drizzle-kit migrate`, exactly like the purge migration.

### Success Criteria:

#### Automated Verification:

- Existing suite still green: `npm run test:run` (no test asserts an icon value)
- Linting passes: `npm run lint`
- A query confirms the stored icon is one codepoint: `SELECT name, icon, length(icon) FROM absence_types WHERE display_order = 2;` returns `length = 1`

#### Manual Verification:

- The legend chip for the offsite type shows a single running-person glyph, not a runner followed by a gender sign and an arrow
- The other six legend icons are unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Extract and type-gate the cell range helper

### Overview

Move the cell's time-range formatting into a dependency-free module gated on the partial-day
whitelist, and cover it with unit tests. This is the only part of the change that can be verified
automatically, and it closes the type-blind renderer finding.

### Changes Required:

#### 1. New shared helper

**File**: `src/lib/absence-grid-cell.ts`

**Intent**: Own the decision of what time text a grid cell may display, so the rule lives in one
tested place instead of inline in a React island, and so a row carrying hours on a type the product
forbids renders as full-day.

**Contract**: Exports `formatTime(t: string | null | undefined): string` (`HH:MM:SS` → `HH:MM`) and
`cellTimeRange(absence: Pick<Absence, "is_full_day" | "start_time" | "end_time">, typeName: string | null | undefined): string`.
`cellTimeRange` returns `""` when the absence is full-day, when either time is missing, **or when
`typeAllowsPartialDay(typeName)` is false**; otherwise `HH:MM–HH:MM` joined by U+2013 with no
surrounding spaces. Reuse `typeAllowsPartialDay` from `src/lib/absence-types.ts` rather than
re-listing names. Keep the module free of React and server imports, following the "dependency-free on
purpose" note in `src/lib/type-filter.ts`.

#### 2. Unit tests

**File**: `src/tests/lib/absence-grid-cell.test.ts`

**Intent**: Pin the gate and the formatting so a future edit cannot quietly reintroduce a type-blind
range or a spaced dash.

**Contract**: Cover, per the seven seeded type names: both whitelisted training types return a range;
each of the other five returns `""` even with both times present; full-day returns `""`; a missing
`start_time` or `end_time` returns `""`; an unknown or `null` type name returns `""`; seconds are
stripped; the separator is U+2013. Mirror the structure of `src/tests/lib/type-filter.test.ts`.

#### 3. Grid switches to the helper

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Delete the local `formatTime` and `timeRangeOf` and call the shared helper, passing the
resolved type name so the gate applies.

**Contract**: Remove `:29-36`. At the cell site (`:301`) pass the already-resolved `absenceType?.name`
into `cellTimeRange`. `buildTooltip` (`:134-148`) keeps reporting the **ungated** range — it needs its
own local range computation for the `Godziny:` line, with a comment recording why the two disagree
(see Critical Implementation Details).

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `npm run test:run`
- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- A partial-day onsite or offsite training cell still shows its `HH:MM–HH:MM`
- The tooltip on that cell still shows the same hours on its `Godziny:` line

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 3: Cell content — icon and range, no type name

### Overview

Drop the type name from the chip so the cell carries colour, icon and optional time range, and give
the chip an accessible name so it does not announce as a bare emoji.

### Changes Required:

#### 1. The cell chip

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Render only the time range in the label span, matching the prototype and removing the
per-type width variance at its source.

**Contract**: The label span (`:333-336`) renders `range` alone — `absenceType.name` leaves the cell.
When `range` is empty the span renders nothing, leaving a centred icon. Keep `truncate` on the span
and the `gap-[5px]`, `px-1.5`, `text-[11px] font-bold` and `whitespace-nowrap` styling as-is; keep
`h-[34px]` on the `td` (`:313`) — the chip stays single-line, so no vertical change is needed. The
absolutely positioned substitute badge (`:337-342`) and comment marker (`:343-347`) are unchanged.

#### 2. Chip accessible name

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Preserve the type identity for assistive technology now that the cell has no text, and
stop the emoji being announced in place of the type.

**Contract**: The chip container (`:325-329`) gains `role="img"` and an `aria-label` naming the type
and, when present, the hours — for example `szkolenie w miejscu pracy, 08:00–16:00`. Keep the existing
`title` attribute for sighted hover. Add a short comment citing the same reasoning as
`AbsenceDetailsSubcards.tsx:265-289`, and noting that `role` is required here because the chip is a
`div`, not a `button`.

#### 3. Legend stays the glossary

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: No change to `:226-245`, recorded here so the reviewer knows it is deliberate — the legend
is now the only place the full names appear above the fold, which is what makes dropping them from the
cell acceptable.

**Contract**: None.

### Success Criteria:

#### Automated Verification:

- Linting and type checking pass: `npm run lint`
- Production build succeeds: `npm run build`
- Existing suites still green: `npm run test:run` and `npm run e2e`

#### Manual Verification:

- No grid cell contains Polish words for any of the seven types; full-day cells show a centred icon and partial-day training cells show icon plus `HH:MM–HH:MM`
- Hovering a cell still reveals type, date, hours, and any comment or substitute
- Every employee column has visibly narrowed, and a month containing an offsite entry is no longer wider than one without
- A screen reader announces the type name on a chip, not the emoji name
- The substitute badge and comment marker still sit correctly over the narrower chip

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 4: Bound the columns with `table-fixed`

### Overview

Pin every employee column to 120px, let the columns share leftover width when the team is small, and
make the employee-name header truncate with its full name available on hover — the half of the fix
that Phase 3 cannot deliver.

### Changes Required:

#### 1. Fixed table layout with a computed floor

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Switch the table to fixed layout so column widths are declared rather than derived from
content, and give it an explicit minimum so overflow past the container is deterministic instead of
compressing the columns.

**Contract**: The table (`:248`) gains `table-fixed` and an inline `minWidth` computed as
`132 + orderedEmployees.length * 120` px, keeping `w-full` so leftover space is distributed across the
columns. The existing `overflow-x-auto` wrapper (`:247`) is unchanged and remains the scroll container
for the sticky day column. Add a comment recording why the floor is computed rather than a literal:
the prototype's `flex: 1 1 0; min-width: 120px` guarantee has no direct table equivalent, and a
fixed-layout table's behaviour when declared widths exceed `width: 100%` is not something to depend
on.

#### 2. Explicit header widths

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Give every employee column the declared width that fixed layout reads, replacing a floor
that fixed layout ignores.

**Contract**: Both header variants — `SortableEmployeeHeader` (`:64`) and the self header (`:255`) —
replace `min-w-[120px]` with `w-[120px]`. The day header keeps `w-[132px]`; its `min-w-[132px]` is now
redundant but harmless. The two variants must stay in sync.

#### 3. Header name truncation and tooltip

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Now that the column is capped, the name will clip — make the full name recoverable, which
it is not today.

**Contract**: Both header name spans (`:75-78`, `:256-258`) gain a `title` carrying the full rendered
name including the ` (nieakt.)` suffix. The existing `truncate` needs no `min-w-0`: inside the flex
row `overflow:hidden` already resolves `min-width:auto` to 0, and the grip stays `shrink-0`.

### Success Criteria:

#### Automated Verification:

- Linting and type checking pass: `npm run lint`
- Production build succeeds: `npm run build`
- Existing suites still green: `npm run test:run` and `npm run e2e`

#### Manual Verification:

- Ten employees fit at a 1480px viewport with no horizontal scrollbar, and every column is the same width
- With three or four employees the columns stretch to fill the card instead of leaving dead space on the right
- Past ten employees a horizontal scrollbar appears and the day column stays pinned while scrolling
- A long name such as `Katarzyna Lewandowska` clips with an ellipsis and its full value appears on hover; an inactive employee's ` (nieakt.)` suffix is recoverable the same way
- Dragging a column header still reorders employees, and the drag overlay still shows the full name
- Weekend row shading, the pale `+` on empty cells, and the hover highlight are unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation. This is the last phase — confirm the whole feature before closing the change.

---

## Testing Strategy

### Unit Tests:

- `cellTimeRange` per type name: the two whitelisted training types produce a range; the other five
  produce `""` even with both times set
- Full-day, missing `start_time`, missing `end_time`, `null` type name, unknown type name → `""`
- `HH:MM:SS` seconds stripped; separator is U+2013 with no surrounding spaces
- `formatTime` on `null` and `undefined`

### Integration Tests:

- No new integration tests. The partial-day API contract is already covered end-to-end by
  `src/tests/api/absences/partial-day-guard.test.ts`; this change adds a display-side gate, not a
  second enforcement point.
- `npm run e2e` must stay green — `tests/e2e/absence-form-dialog.spec.ts` asserts the onsite type name
  in the form dialog, which this change does not touch.

### Manual Testing Steps:

1. Open `/dashboard?tab=grid` in a month containing at least one absence of each of the seven types,
   including one partial-day training entry with a substitute and one with a comment.
2. Confirm no cell contains words, that full-day cells are icon-only and training cells show
   `HH:MM–HH:MM`, and that the offsite icon is a single glyph.
3. Confirm every column has the same width and no horizontal scrollbar appears with ten employees at
   1480px; narrow the window and confirm the day column stays pinned.
4. With a small team, confirm columns stretch to fill the card.
5. Hover a cell for the tooltip, and hover a clipped employee name for its full value.
6. Drag a column to reorder, then reload and confirm the order persisted.
7. If any environment still holds a partial-day row on a non-training type, confirm the cell renders
   full-day while the tooltip still reports the real hours.

## Performance Considerations

`table-layout: fixed` is strictly cheaper than `auto` — the browser stops measuring content to size
columns, which for a 31-row by 10-column grid removes an intrinsic-sizing pass on every render. The
computed `minWidth` is a single arithmetic expression per render. No new dependencies.

## Migration Notes

The Phase 1 migration is data-only and idempotent in effect (re-running sets the same value). It is
**not** registered in `supabase/migrations/meta/_journal.json`, matching
`20260811120000_purge_demo_partial_day_absences.sql`, so it is applied outside `drizzle-kit migrate`.
The prior icon value is recorded in the file header, so reverting is a one-line hand-written `UPDATE`.
An environment that has not applied it still works — the icon simply renders as multiple glyphs, the
condition Phase 1 exists to remove.

No absence rows are read or written by this change.

## References

- Related research: `context/changes/grid-adjustment-offsite-training/research.md`
- Prototype cell contract: `new-design/10xUrlopy.dc.html:803`; column sizing `:816`, `:822`
- The p4 drift this reverts: `context/changes/huge-ui-ux-improvement/plan.md:514`
- Icon-only a11y precedent: `src/components/absence/AbsenceDetailsSubcards.tsx:265-289`,
  `context/changes/huge-ui-ux-improvement/reviews/impl-review-2.md:158-165`
- Extraction precedent: `src/lib/type-filter.ts`, `src/tests/lib/type-filter.test.ts`
- Hand-authored data migration template:
  `supabase/migrations/20260811120000_purge_demo_partial_day_absences.sql`
- Partial-day whitelist: `src/lib/absence-types.ts:7-15`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Prerequisite

- [x] 0.1 Commit the pending `huge-ui-ux-improvement` F6/F7 review fixes as their own commit — 63f7a38

### Phase 1: Single-codepoint offsite icon

#### Automated

- [x] 1.1 Existing suite still green: `npm run test:run` — 23628c0
- [x] 1.2 Linting passes: `npm run lint` — 23628c0
- [x] 1.3 Stored icon is one codepoint (`length(icon) = 1` for `display_order = 2`) — 23628c0

#### Manual

- [x] 1.4 Offsite legend chip shows a single running-person glyph — 23628c0
- [x] 1.5 The other six legend icons are unchanged — 23628c0

### Phase 2: Extract and type-gate the cell range helper

#### Automated

- [x] 2.1 New unit tests pass: `npm run test:run` — d9bcaa3
- [x] 2.2 Type checking and linting pass: `npm run lint` — d9bcaa3
- [x] 2.3 Production build succeeds: `npm run build` — d9bcaa3

#### Manual

- [x] 2.4 Partial-day training cell still shows its `HH:MM–HH:MM` — d9bcaa3
- [x] 2.5 Tooltip `Godziny:` line still shows the same hours — d9bcaa3

### Phase 3: Cell content — icon and range, no type name

#### Automated

- [x] 3.1 Linting and type checking pass: `npm run lint` — 6bd2f3d
- [x] 3.2 Production build succeeds: `npm run build` — 6bd2f3d
- [ ] 3.3 Existing suites still green: `npm run test:run` and `npm run e2e` — `test:run` green (17 files, 157/157); `e2e` targets the deployed Worker, so it can only run after this lands on `main`

#### Manual

- [x] 3.4 No cell contains Polish words; full-day cells icon-only, training cells icon plus range — 6bd2f3d
- [x] 3.5 Tooltip still reveals type, date, hours, comment and substitute — 6bd2f3d
- [x] 3.6 Columns visibly narrowed; a month with an offsite entry is no wider than one without — partial by design; the employee-name header still binds until Phase 4 — 6bd2f3d
- [x] 3.7 Screen reader announces the type name, not the emoji name — 6bd2f3d
- [x] 3.8 Substitute badge and comment marker still positioned correctly on the narrower chip — 6bd2f3d

### Phase 4: Bound the columns with `table-fixed`

#### Automated

- [x] 4.1 Linting and type checking pass: `npm run lint` — 4d9b2c5
- [x] 4.2 Production build succeeds: `npm run build` — 4d9b2c5
- [ ] 4.3 Existing suites still green: `npm run test:run` and `npm run e2e` — `test:run` green (17 files, 161/161); `e2e` targets the deployed Worker, so it can only run after this lands on `main`, together with 3.3

#### Manual

- [x] 4.4 Ten employees fit at 1480px with no horizontal scrollbar, all columns equal width — 4d9b2c5
- [x] 4.5 With three or four employees the columns stretch to fill the card — 4d9b2c5
- [x] 4.6 Past ten employees a scrollbar appears and the day column stays pinned — 4d9b2c5
- [x] 4.7 A long name clips with an ellipsis and its full value appears on hover, including ` (nieakt.)` — 4d9b2c5
- [x] 4.8 Drag-to-reorder still works and the overlay shows the full name — 4d9b2c5
- [x] 4.9 Weekend shading, the pale `+`, and the hover highlight are unchanged — 4d9b2c5
