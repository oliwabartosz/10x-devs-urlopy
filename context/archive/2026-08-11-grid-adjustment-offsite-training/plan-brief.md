# Bound the grid's column width and drop the type name from the cell — Plan Brief

> Full plan: `context/changes/grid-adjustment-offsite-training/plan.md`
> Research: `context/changes/grid-adjustment-offsite-training/research.md`

## What & Why

The monthly grid widens badly when a cell carries a long absence type name plus an `HH:MM` range. The
reported case was `szkolenie/wyjście poza miejsce pracy`, but the research showed the problem is not
type-specific: **four of the seven seeded types breach the 120px column floor with no hours at all**,
and for five of seven the *employee-name header*, not the chip, is what actually sets column width. So
this change removes the type name from the cell entirely — restoring the reference prototype's
contract — and pins the columns, which is the only lever that also bounds the header.

## Starting Point

The chip renders `name + " " + range` in one `whitespace-nowrap` span
(`AbsenceGrid.tsx:333-336`) inside an auto-layout table (`:248`) with no `table-fixed` and no
`min-width`. `truncate` appears in two places and is inert in both, so nothing clips — the columns
widen instead. The prototype this UI was ported from used `flex: 1 1 0; min-width: 120px` columns,
which long content cannot widen; porting the styling while changing the layout primitive silently
dropped that guarantee.

## Desired End State

A grid cell is colour + icon + optional time range, never a type name. Employee columns are pinned at
120px and stretch to share leftover width when the team is small, so ten people fit inside the 1480px
container without horizontal scroll, and no absence type can widen a column however long its name.
Type names stay discoverable in the legend and the tooltip, the chip announces its type rather than its
emoji, and a cell shows `HH:MM` only for the two types the product permits partial days on.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Which options land | A + D — drop the name **and** bound the width | A alone leaves the header binding at 117–161px; D is the only lever that reaches ten columns | Plan |
| Type name discoverability | Legend + existing `title` + `aria-label` with `role="img"` | No new dependencies, and it repeats the F5 fix that rescued a11y on the icon-only filter chips | Plan |
| Pinned column width | 120px with `table-fixed` + `w-full`, stretching to fill | Reproduces the prototype's `flex: 1 1 0 / min-width 120px`; ten columns fit at 1480px | Plan |
| Clipped employee names | Truncate plus a `title` tooltip | The header has no tooltip today, so this is a net gain rather than a loss | Plan |
| Offsite icon | Replace the 8-codepoint ZWJ sequence with one codepoint | With the name gone the icon is the only discriminator, so decomposition becomes a correctness issue | Plan |
| Type-blind range | Gate the cell's range on the partial-day whitelist | Caps the worst-case cell at two types instead of seven; a real out-of-contract row once existed in production | Research + Plan |
| Tooltip vs cell on bad data | Gate the cell, **not** the tooltip | Keeps the one surface where out-of-contract data stays visible to a moderator | Plan |
| Rejected: wrap to 3 lines | No | Five of seven types would need 2+ lines, `szkolenie/wyjście` is unbreakable, and rows grow raggedly | Research |
| Rejected: DB rename to `poza NBP` | No | All-types reading makes it seven renames across five layers plus a PRD amendment | Research |
| Commit sequencing | Land the pending `huge-ui-ux-improvement` fixes first | Keeps the two changes separately reviewable; no textual conflict either way | Plan |

## Scope

**In scope:**
- Remove `absenceType.name` from the cell chip; add `role="img"` + `aria-label`
- `table-fixed` with a computed table `min-width`, `w-[120px]` on both header variants, `title` on header names
- New `src/lib/absence-grid-cell.ts` with `cellTimeRange` gated on `typeAllowsPartialDay`, plus unit tests
- Data-only migration replacing the offsite ZWJ icon with a single codepoint

**Out of scope:**
- Renaming any `absence_types.name`; no `short_name` column or slug
- Wrapping the label onto multiple lines
- The details table and stats matrices, which keep their own type-blind range formatting
- Repairing out-of-contract rows (the gate hides them from the grid; `holiday-balance.ts:42` still counts them)
- A tooltip component, the prototype's 900px grid floor, or a component-test harness

## Architecture / Approach

Four phases, ordered database → shared logic → cell content → layout. The icon migration lands first
so the icon is trustworthy before it becomes the cell's only signal. The range logic moves into a
dependency-free `src/lib` module — the only slice with genuine automated coverage, since
`vitest.config.ts` is node-environment with no jsdom and there are no component tests for this file.
The two halves of the visual fix stay in separate phases because one is a UX change (name leaves the
cell) and the other a layout change (columns get pinned), each independently revertable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Offsite icon migration | Offsite type renders as one glyph everywhere | Applied outside `drizzle-kit migrate`; not journal-registered, so easy to forget in an environment |
| 2. Extract + type-gate range | Tested `cellTimeRange`, hours only for whitelisted types | Legacy rows silently change appearance from partial-day to full-day |
| 3. Cell content | Cell is icon + range; chip announces its type | Users lose the at-a-glance name and must learn seven icons via the legend |
| 4. `table-fixed` at 120px | Ten equal columns at 1480px, names truncate with a tooltip | Fixed layout interacting with the sticky day column and dnd-kit header reorder |

**Prerequisites:** commit the uncommitted `huge-ui-ux-improvement` F6/F7 review fixes first (three
hunks sit in this same file, none near the chip). Manual verification needs a month containing all
seven types plus a partial-day training entry, and a browser at a 1480px viewport.

**Estimated effort:** ~1–2 sessions across four phases; Phases 3 and 4 are a handful of lines each,
Phase 2 carries most of the new code.

## Open Risks & Assumptions

- **Every px figure in the research is computed, not browser-measured** — font advance-width sums
  bracketed between Arial-class and DejaVu-class metrics. The 120px pin and the ten-column claim should
  be confirmed on screen in Phase 4 rather than trusted.
- **The ZWJ decomposition risk is unconfirmed.** Ligature support could not be verified in the local
  emoji font, so Phase 1 mitigates a risk that may not be present on the browsers actually in use. The
  cost is one line of SQL either way.
- **Dropping the name is a real UX regression for discoverability** until users learn the icons. The
  legend, the tooltip and the `aria-label` are the mitigations; three sibling surfaces already ship
  icon-only, so the pattern is not new to this app.
- **`table-fixed` has not been used in this grid before.** Its interaction with `sticky left-0` and
  dnd-kit's sortable headers is expected to be fine but is manual-verification-only.
- **Assumption:** ten employees remains the target ceiling (`prd.md:95`). Beyond that, horizontal
  scroll with the sticky day column stays the accepted behaviour, as F6 already decided.

## Success Criteria (Summary)

- A month containing all seven types shows no words in any cell, and no column is wider than another
- Ten employees fit at 1480px without horizontal scroll; a small team's columns stretch to fill the card
- The type of any cell is still recoverable — on hover, from the legend, and via a screen reader
