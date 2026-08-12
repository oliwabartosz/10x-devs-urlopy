---
date: 2026-08-11T16:41:03+02:00
researcher: Bartosz Oliwa
git_commit: 202fa37553822c3e55282c90000127b56e01f1ba
branch: main
repository: 10xDevs
topic: "Grid too wide when a cell carries the offsite-training label plus HH:MM"
tags: [research, codebase, absence-grid, absence-types, layout, huge-ui-ux-improvement]
status: complete
last_updated: 2026-08-12
last_updated_by: Bartosz Oliwa
last_updated_note: "Added follow-up research widening the audit from offsite training to all seven absence types: per-type chip widths from real font metrics, the employee-name header as the true binding constraint, and per-type behaviour of options A-E. Corrected two numbers in the original body (chip leading, wrap-token fit)."
---

# Research: Grid too wide when a cell carries the offsite-training label plus HH:MM

**Date**: 2026-08-11T16:41:03+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: 202fa37553822c3e55282c90000127b56e01f1ba
**Branch**: main
**Repository**: 10xDevs

## Research Question

The monthly grid becomes too wide when a user sets `szkolenie/wyjście poza miejsce pracy` with an
`HH:MM` range. Proposed fix: render it as three lines — `szkolenie/wyjście` / `poza NBP` / `HH:MM`.

## Summary

The width blow-up is real, and its cause is narrower than "the label is long": **the type name was
never supposed to be in the cell at all.** The reference prototype, this change's own research doc,
and the PRD all define the cell chip as colour + icon + time range, with the name carried by the
legend and the hover tooltip. The shipped implementation renders `name + " " + range`. That is drift
introduced in `huge-ui-ux-improvement` phase 4, not a designed behaviour.

Three facts compound into the symptom:

1. The chip renders `{absenceType.name}{range && \` ${range}\`}` — `AbsenceGrid.tsx:333-336`.
2. The chip is `whitespace-nowrap` (`:326`), so the string's min-content width is its full unbroken
   width — roughly 290–310px for `szkolenie/wyjście poza miejsce pracy 08:00–16:00` at `text-[11px]`
   bold (estimate, not browser-measured).
3. The table is auto-layout — `<table className="w-full border-collapse text-sm">` at `:248`, no
   `table-fixed`. `min-w-[120px]` on the employee `<th>` (`:64`, `:255`) is a **floor, not a cap**.

In an auto-layout table a column is as wide as the widest min-content among *all* its cells. So **a
single offsite-training entry anywhere in the month widens that employee's column to ~300px for all
~30 rows**. The `truncate` at `:333` and `overflow-hidden` at `:326` are inert: they set
`overflow/text-overflow/white-space` but nothing bounds the width they would clip against.

This also means the review's overflow math was optimistic. `impl-review-2.md:176` reasons from
"132px + n×120px against the 1480px container, past ~11 employees". With one offsite cell per column
the real budget is ~1416px usable minus the 132px day column, so overflow starts around **4–5
employees**, not 11 — under the PRD's stated ceiling of "up to about 10 people"
(`context/foundation/prd.md:95`). Manual verification row 4.4, "ten columns fit at 1480px without
scroll" (`huge-ui-ux-improvement/plan.md:1121`), passed only because the month under test had no
offsite entry in a wide column.

On the proposed three-line fix specifically: it works mechanically but costs more than it looks.
Wrapping only shrinks a column to its longest unbreakable token — `szkolenie/wyjście` (browsers do
not break on `/` by default), 92–108px. **Corrected 2026-08-12:** that token does *not* fit inside
the 120px floor once the chip's own 39px of icon + gap + padding is counted (see the follow-up
section), so wrapping leaves offsite the widest column at ~130–150px. The cell is `h-[34px]`
(`:314`) and the chip sets `text-[11px]` with **no line-height**, inheriting `text-sm`'s leading from
the table — but that token is the *unitless* ratio `calc(1.25 / 0.875)` = 1.4286 in Tailwind 4.2.4
(`node_modules/tailwindcss/theme.css:350`), not `1.25rem`, so the chip's computed leading is
**15.71px, not 20px**. Three lines is ~47px, two lines ~31px — already past the 28px content box
inside a 34px row. So wrapping raises row height for **five of the seven types**, not just this one,
and it does so per-row rather than uniformly. Measured line counts and the vertical cost are in the
follow-up section.

Finally, a caution on the wording: `poza NBP` is a *display* change only. The type name is a de-facto
primary key — renaming the DB row breaks the partial-day gate.

## Detailed Findings

### The grid cell and its layout

- Cell chip JSX — [`AbsenceGrid.tsx:324-348`](src/components/absence/AbsenceGrid.tsx). Label span at
  `:333-336`; icon at `:331`; substitute badge `:337-342`; comment marker `:343-347`.
- `formatTime` `:29-31` (`HH:MM:SS` → `HH:MM`) and `timeRangeOf` `:33-36` (returns `""` for full-day,
  else `HH:MM–HH:MM` joined by U+2013 en dash, no spaces). Both are module-local to `AbsenceGrid`, not
  shared; a near-duplicate lives at `AbsenceDetailsTable.tsx:59-62`.
- Scroll wrapper `:247` `overflow-x-auto`; table `:248` `w-full border-collapse text-sm`.
- Employee headers `:64` and `:255` carry `min-w-[120px]`; day column is `w-[132px] min-w-[132px]`
  (`:251`, `:282-287`).
- The grid has **no min-width floor of its own**, unlike `AbsenceDetailsTable.tsx:160`
  (`min-w-[940px]`) and unlike the prototype's `min-width:900px`.
- Page container caps at `max-w-[1480px] px-8` — `src/pages/dashboard.astro:229`. The grid is mounted
  at `dashboard.astro:258-265`, only on `?tab=grid`.
- Tooltip `buildTooltip` `:134-148` already emits `Typ: ${type.name}` and
  `Godziny: ${range || "cały dzień"}`, so the name is never lost on hover.

### The prototype says: no name in the cell

The reference design builds the cell label as the *time*, never the type name:

```js
// new-design/10xUrlopy.dc.html:803
label: t ? (showTimes && time ? time : '') : '+',
```

Chip styling `:830-834` (`fontSize:'11px'`, `whiteSpace:'nowrap'`, `overflow:'hidden'`), columns
`flex:'1 1 0', minWidth:'120px'` (`:816`, `:822`), grid `min-width:900px` in an `overflow-x` wrapper
(`:105`). Because the prototype's columns are **flex**, not an auto-layout table, `flex: 1 1 0` makes
them share space equally and long content can never widen one — the same nowrap chip is safe there
and unsafe here. That structural difference, not the string length, is what changed.

The prototype also carries a per-type slug (`id: 'szkolenie_poza'`, `:601`) separate from its display
`label`, and keys its timed-type check off the slug (`:1276`) — it already decouples key from display
text. The database does not.

### Where the label text comes from

Rendered names come from the DB column `absence_types.name`, fetched once in
`dashboard.astro:149` and passed as props. Schema: `src/db/schema.ts:31-42` — columns `id, name,
color, icon, text_color, display_order`, with an explicit comment at `:36-38` that "Types stay data,
never a name-keyed code map". Notably `icon`, `text_color` and `display_order` were all added as
**presentation metadata columns**, which is a live precedent if a short label is wanted as data.

The constants in `src/lib/absence-types.ts` are *not* used for rendering. Their only job is the
partial-day gate: `OFFSITE_TRAINING_TYPE_NAME` at `:8`, `PARTIAL_DAY_TYPE_NAMES` at `:11`,
`typeAllowsPartialDay()` at `:14-16`. The file header states the contract — keyed off exact seed names
because there is no slug column, and "A rename of a seed row must be mirrored here."

Every surface rendering `type.name`:

| file:line | Surface |
|---|---|
| `AbsenceGrid.tsx:334` | Grid cell label — the reported bug |
| `AbsenceGrid.tsx:239` | Legend chip ("Typy nieobecności") — same raw source as the cell |
| `AbsenceGrid.tsx:142` | Cell tooltip `Typ:` line |
| `AbsenceDetailsTable.tsx:236` | Details table type badge |
| `AbsenceDetailsTable.tsx:123-124` | Sort comparator keys off `.name` — alphabetical order shifts on rename |
| `AbsenceDetailsSubcards.tsx:270,273` | Filter chips — name is the `title` and `aria-label` |
| `AbsenceStats.tsx:112,166,213` | Breakdown row label, matrix column `title`, stacked-bar segment `title` |
| `AbsenceFormDialog.tsx:221` | Type radio option label — the accessible name e2e locators use |

### Why a DB rename is the expensive path

A true rename of `szkolenie/wyjście poza miejsce pracy` must move in lockstep across five layers:

1. `src/lib/absence-types.ts:8` — else the partial-day gate silently stops matching.
2. A new `UPDATE absence_types SET name=...` migration; the existing name-keyed migration
   `supabase/migrations/20260807122840_faulty_hobgoblin.sql:32` matches on the literal, as does the
   original seed `20260526000002_seed_absence_types.sql:7`.
3. Server enforcement `src/lib/services/absence-partial-day.ts:20-30` plus the user-visible 400 text
   at `src/pages/api/absences/index.ts:232` and `[id].ts:145` (interpolated, so it follows for free).
4. Tests: `src/tests/api/absences/partial-day-guard.test.ts:101-102` asserts the 400 body contains
   both full literals; `crud.test.ts:25,31`; `hours-clamp.test.ts:81-84`. These carry a deliberate
   "constant drifted from the seed migration?" assertion message.
5. The PRD pins the catalogue names (`context/foundation/prd.md:105,112`), so a rename is a PRD
   amendment — the palette change already required one (`prd.md:107`).

Trap worth recording: `absence_types.name` has **no unique constraint**, so a partial rename silently
yields two rows; the tests' `toHaveLength(1)` is the only guard.

A display-only change touches none of this. No e2e asserts the offsite label today —
`tests/e2e/absence-form-dialog.spec.ts:34` hardcodes the *onsite* name only.

### Solution space

These are not mutually exclusive; (D) is arguably required regardless of which label option wins.

- **A — Drop the name from the cell (icon + range only).** Matches the prototype, this change's
  research (`huge-ui-ux-improvement/research.md:69`), and the PRD's "the icon, not the colour, is now
  the fast discriminator" (`prd.md:119`). Zero DB risk, smallest diff, restores the 120px column.
  Cost: the icon must actually be legible, and users learn the icons via the legend.
- **B — Display-only short label.** A presentation map in the component, or a `short_name` column
  following the `icon`/`text_color` precedent. Needs a keying decision (id vs name) and, if the legend
  keeps the long name, the legend becomes the glossary that explains the abbreviation.
- **C — The proposed three-line wrap.** Works, but requires row height 34 → ~46px *and* an explicit
  `leading-*` (see Summary), trading ~+360px vertical across the month.
- **D — Bound the width structurally.** `table-fixed` plus explicit column widths, or `min-w-0` on the
  flex item, so the existing `truncate` finally engages. Worth doing on its own merits: even without
  the training types, `stała nieobecność` + icon + padding is already slightly over the 120px floor.
- **E — DB rename to "poza NBP".** Five layers plus a PRD amendment. Not recommended as the fix for a
  layout problem.

## Code References

- `src/components/absence/AbsenceGrid.tsx:326` — `whitespace-nowrap` on the chip; the direct cause
- `src/components/absence/AbsenceGrid.tsx:333-336` — the label span rendering name + range
- `src/components/absence/AbsenceGrid.tsx:248` — auto-layout table, no `table-fixed`
- `src/components/absence/AbsenceGrid.tsx:314` — `h-[34px]` day cell, the vertical budget
- `src/components/absence/AbsenceGrid.tsx:64,255` — `min-w-[120px]` floor on employee columns
- `src/components/absence/AbsenceGrid.tsx:134-148` — tooltip already carries type and hours
- `src/components/absence/AbsenceGrid.tsx:226-245` — legend, same raw `type.name` source
- `src/lib/absence-types.ts:8,11,14-16` — the name-keyed partial-day gate
- `src/db/schema.ts:31-42` — `absence_types`; presentation-metadata precedent at `:36-40`
- `src/pages/dashboard.astro:229` — `max-w-[1480px]` page container
- `new-design/10xUrlopy.dc.html:803` — prototype renders time as the label, never the name
- `new-design/10xUrlopy.dc.html:816,822,105` — flex columns and the 900px grid floor
- `new-design/10xUrlopy.dc.html:598` — `rowHeight` design range 26–48px, default 34
- `supabase/migrations/20260526000002_seed_absence_types.sql:7` — the seeded literal

## Architecture Insights

- **Auto-layout tables make `truncate` a no-op.** Truncation is a clipping instruction, not a width
  constraint. Any Tailwind `truncate` inside an auto-layout table cell without a bounded ancestor is
  decorative. This is a reusable trap — the employee header at `:75` has the same latent issue.
- **The prototype's flex grid and the implementation's table are not interchangeable.** `flex: 1 1 0`
  forces equal shares and immunises against long content; `table-layout: auto` does the opposite.
  Porting the prototype's *styling* while changing its *layout primitive* silently dropped a
  guarantee. Worth a lesson entry.
- **The type name is an unenforced primary key.** The schema comment says types are data, not a
  name-keyed code map, yet `absence-types.ts`, a migration, a service and three test files all key off
  the literal string, with no unique constraint behind it. The prototype's slug (`szkolenie_poza`)
  shows the shape of the fix if this ever becomes painful again.
- **Presentation concerns already live in the DB.** `icon`, `text_color` and `display_order` set the
  precedent that a display-only attribute can be a column rather than a code map.

## Historical Context (from prior changes)

- `context/changes/absence-hours-range/plan-brief.md:8` (2026-06-05) — hours became a *range* because
  a bare "4h" "gives no scheduling information — you can't tell whether someone is away in the morning
  or afternoon."
- `context/changes/absence-hours-range/plan.md:250-265` (2026-06-05) — the original partial-day cell
  showed **only** the time range; the block was colour-only and carried no type name.
- `context/archive/2026-06-22-hours-onsite-training-only/plan-brief.md:8-10` — hours first restricted
  to onsite training; `:74-76` already logged the rename risk on the name-keyed gate.
- `context/archive/2026-06-22-hours-onsite-training-only/change.md:19-25` (2026-07-20) — reversed
  during manual testing: offsite training must also carry hours. That reversal is why this cell can
  hold a range at all.
- `context/changes/huge-ui-ux-improvement/research.md:69` (2026-08-07) — enumerates the chip's
  **four** signals; the type name is not among them.
- `context/changes/huge-ui-ux-improvement/plan.md:507-518` — the p4 contract. Its intent sentence
  lists colour, icon, time range and badges; the contract line then says "Chip content is icon +
  label" citing prototype `:801-842`, where `label` *is* the time. That ambiguity is the most likely
  origin of the drift.
- `context/changes/huge-ui-ux-improvement/plan.md:490` — rotated employee names were rejected in
  favour of horizontal, reversing `monthly-grid-own-absence/plan-brief.md:26`.
- `context/changes/huge-ui-ux-improvement/reviews/impl-review-2.md:167-180` — F6 restored the sticky
  day column, treating overflow as a fact of life past ~11 employees. It did not question why a
  column exceeds its 120px floor.
- `context/foundation/prd.md:95` — "readable for a workplace department of up to about 10 people";
  `:119` — "the icon, not the colour, is now the fast discriminator."

### In-flight state — read before editing

`huge-ui-ux-improvement` is `status: impl_reviewed` with all 80 progress rows ticked, but **the second
review's fixes are uncommitted** (`reviews/impl-review-2.md:8`). The working tree currently holds
uncommitted edits to `AbsenceGrid.tsx` (F6 sticky day column, F7 `#9a9a9a` → `text-muted-foreground`),
plus `type-filter.ts`, `AbsenceDetailsTable.tsx`, `AbsenceDetailsSubcards.tsx`, `AbsenceStats.tsx`,
`HolidayBalance*`, `api/absences/index.ts` and `dashboard.astro`. A separate in-flight change
`radial-timepicker-ux` adds `TimeRangeDial.tsx`, `ui/popover.tsx` and `lib/time-dial.ts`.

Neither uncommitted grid edit touches the cell chip or the label, so a label change will not conflict
textually — but any commit here must not clobber them.

## Related Research

- `context/changes/huge-ui-ux-improvement/research.md` — prototype teardown, incl. the cell-chip
  contract at `:69`
- `context/changes/absence-hours-range/plan.md` — the original partial-day cell rendering
- `context/changes/radial-timepicker-ux/plan.md` — in-flight, touches how ranges are *entered*

## Open Questions

1. **Which option?** The evidence points at (A) drop the name — it is what the prototype, the p4
   research and the PRD already specify, and it is the smallest change. The requested three-line wrap
   (C) is viable but buys horizontal space with vertical. Worth an explicit decision before planning.
2. **If a short label is kept (B): where does it live** — a component-level map, or a `short_name`
   column following the `icon`/`text_color` precedent? And is it keyed by id or by name?
3. **Does the legend change too?** If the cell says `poza NBP` and the legend says
   `szkolenie/wyjście poza miejsce pracy`, that divergence is arguably the point (legend as glossary).
   If both change, the PRD catalogue at `prd.md:105,112` needs an amendment.
4. **Is `poza NBP` the right user-facing wording?** It introduces an org abbreviation the PRD does not
   currently use in the type catalogue.
5. **Should (D) land regardless?** Bounding the column would make every future long label safe and fix
   the latent header-truncate issue, independent of the label decision.
6. **Where does this commit?** As its own change on top of the uncommitted review fixes, or folded
   into the `huge-ui-ux-improvement` commit that is still pending?
7. **Width numbers are estimates.** The ~300px chip and the 4–5-employee overflow threshold are
   computed, not browser-measured. Worth confirming against production before sizing columns.

---

## Follow-up Research 2026-08-12T14:25+02:00 — all seven types, not just offsite training

**Question.** The first pass treated `szkolenie/wyjście poza miejsce pracy` as *the* problem case.
Widen the lens: what does the width picture look like across all seven seeded types?

**Answer in one line.** The offsite label is the worst case but not a special case — **four of the
seven types already breach the 120px column floor with no `HH:MM` at all**, and for **five of the
seven the employee-name header, not the chip, is what actually sets the column width**. That reframes
the fix from "shorten one label" to "bound the column", and it retires option (E) outright.

### Method

Scoped as analytic (no browser measurement), so the numbers below are advance-width sums from real
font files rather than guesses at character widths. No custom font is loaded anywhere in the project —
no `@font-face`, no `--font-sans`, no typography tokens in `src/styles/global.css:60-99` — so the
effective stack is Tailwind 4.2.4's preflight default (`ui-sans-serif, system-ui, sans-serif, …`).
Two font files bracket what that resolves to:

- **low, "Arial-class"** — `LiberationSans-Bold.ttf`, metric-compatible with Arial/Helvetica and close
  to Segoe UI
- **high, "DejaVu-class"** — `DejaVuSans-Bold.ttf`, what a bare Linux `sans-serif` frequently resolves
  to
- emoji advance from `NotoColorEmoji.ttf`: 1.245 em → **14.9px at `text-[12px]`**

GPOS kerning is not applied (Chrome does apply it; the effect on these strings is under 1%). Every px
figure below is therefore a **band, not a measurement** — open question 7 still stands.

**Chip overhead before a single character**, from `AbsenceGrid.tsx`: td `p-[3px]` 6px + chip `px-1.5`
12px + icon 14.9px + `gap-[5px]` 5px + collapsed `border-r` 1px = **39px**. The substitute badge
(`:337-342`) and comment marker (`:343-347`) are `absolute` and contribute **zero**.

### The audit: per-type chip width

Chip min-content = 39px + label width at `text-[11px] font-bold`. Floor is `min-w-[120px]` (`:64`,
`:255`).

| `display_order` | type | icon | chars | label px | chip min-content | over the 120px floor by | can carry `HH:MM`? | chip **+ range** |
|---|---|---|---|---|---|---|---|---|
| 1 | `urlop` | 🌴 | 5 | 28–33 | 67–72 | — | no | — |
| 2 | `szkolenie/wyjście poza miejsce pracy` | 🏃🏼‍♂️‍➡️ | 36 | 196–230 | **235–269** | **+115…+149** | **yes** | **300–348** |
| 3 | `szkolenie w miejscu pracy` | 🎓 | 25 | 138–162 | **177–201** | **+57…+81** | **yes** | **242–280** |
| 4 | `choroba` | 🤒 | 7 | 43–50 | 82–89 | — | no | — |
| 5 | `wyjazd zagraniczny` | 🌍 | 18 | 102–121 | **141–160** | **+21…+40** | no | — |
| 6 | `stała nieobecność` | 🚫 | 17 | 95–112 | **134–151** | **+14…+31** | no | — |
| 7 | `urlop planowany` | 📅 | 15 | 87–103 | **126–142** | **+6…+22** | no | — |

Only `urlop` and `choroba` fit inside the floor. `szkolenie w miejscu pracy` at 177–201px full-day is
already a 1.5× column on its own — the widening symptom is reachable without ever touching the offsite
type. The instinct to widen the question was correct.

### The renderer is type-blind, so "can carry `HH:MM`" is not a width guarantee

The partial-day whitelist is exactly two names (`src/lib/absence-types.ts:7-11`), enforced by
`services/absence-partial-day.ts:20-30`, `api/absences/index.ts:224-233`, `api/absences/[id].ts:137-146`
and, client-side, `AbsenceFormDialog.tsx:64,231` — all four sharing one predicate, and PATCH
re-validates the *effective* type so a type swap cannot smuggle hours through
(`partial-day-guard.test.ts:154-181`, CAS pins at `[id].ts:172-180`).

But **nothing below the application layer knows about types**. `absences_time_check`
(`20260605000001_absence_start_end_time.sql:25-30`) ties times only to `is_full_day` and never
references `absence_type_id`; the only trigger on `absences` is `updated_at`. And the grid's own
`timeRangeOf` (`:33-36`) keys purely off `is_full_day` + both times — as do
`AbsenceDetailsTable.tsx:60-61` and `AbsenceStats.tsx:18-20`.

So a row reaching the DB by any non-route path renders `HH:MM` for **all seven** types. This is not
hypothetical:

- A `wyjazd zagraniczny` row with `01:22–03:22` existed in real data and was deleted by
  `20260811120000_purge_demo_partial_day_absences.sql:9-13,42-48` — an exact `date + both times`
  `DELETE`, and the migration itself notes that an un-purged copy in another environment stays
  editable. Its origin is the prototype seed `10xUrlopy.dc.html:646`
  (`put(0, 1, 'wyjazd', '01:22', '03:22')`), the same illegal combination the prototype's own modal
  rules forbid.
- The pre-guard backfill `20260605000001…:17-21` converted every `NOT is_full_day` row to
  `09:00 + hours` regardless of type.
- Three test files still create partial-day rows on non-whitelisted types via raw drizzle:
  `holiday-balances/used-computation.test.ts:63-75` (partial `urlop`), `absences/crud.test.ts:43-54`,
  `:110-127`, `:150-180`.

**Therefore the honest worst case per column is `name + " " + range` for every type — 300–348px — not
for two of them.** A width fix should not be justified by "only training types can be long". Adjacent
note, not a width issue: `services/holiday-balance.ts:42` already sums `end_time - start_time` for
partial-day `urlop`, i.e. the forbidden state has a live consumer.

### What actually sets column width today: the employee name

`min-w-[120px]` on both header variants is a floor, and both render the full `first_name last_name`
(`:76-78`, `:257-258`) in a `truncate` span, plus ` (nieakt.)` for inactive employees, `px-2.5` (20px),
and — for moderators — `GripVertical size-3.5` + `gap-1` (18px more). Measured at `text-[13px]
font-bold` against the only realistic Polish name set in the repo (`10xUrlopy.dc.html:610`):

| name | header text px | column min-content, moderator | non-moderator |
|---|---|---|---|
| `Chłop Mazur` / `Anna Nowak` | 78–91 | 117–130 | 99–112 |
| `Jan Kowalski` | 82–93 | 121–132 | 103–114 |
| `Bartosz Oliwa` | 86–101 | 125–140 | 107–122 |
| `Ewa Kamińska` | 91–105 | 130–144 | 112–126 |
| `Dominik Rażny` / `Marek Zieliński` | 93–112 | 132–151 | 114–133 |
| `Piotr Wiśniewski` | 103–122 | 142–161 | 124–143 |
| `Katarzyna Lewandowska` | 154–181 | **193–220** | 175–202 |
| the same, inactive (`+ " (nieakt.)"`) | 207–249 | **246–273** | 228–251 |

Two consequences the offsite framing hid:

1. **The 120px floor is almost never the operative number.** For a moderator, every one of those names
   meets or exceeds it. The PRD's "up to about 10 people" (`prd.md:95`) and the p4 acceptance
   criterion "ten columns fit without horizontal scroll at 1480px"
   (`huge-ui-ux-improvement/plan.md:549`) were **already unattainable on an empty grid**, before any
   chip is drawn. Manual verification row 4.4 (`plan.md:1121`) presumably passed on short test names.
2. **For five of seven types the chip is not the binding constraint.** `urlop` (67–72), `choroba`
   (82–89), `urlop planowany` (126–142), `stała nieobecność` (134–151) and `wyjazd zagraniczny`
   (141–160) all sit at or below a typical moderator header (117–161). Only the two `szkolenie` types
   clear every header; only offsite clears the worst-case one.

This is why shortening *only* the offsite label buys less than it looks: it moves offsite from "the
outlier" to "one of the ones that no longer matter", and promotes the header to the new ceiling.

### How many columns fit — the family of thresholds

Usable width at the 1480px container: 1480 − 64 (`px-8`, `dashboard.astro:229`) − 2 (card border,
`:225`) ≈ **1414px**; minus the day column 132 + 1 → **~1281px** for employee columns.

| if every column's widest cell is… | column px | columns that fit |
|---|---|---|
| nothing — floor only | 120 | 10 |
| a typical moderator header, no wide chip | 132 | 9 |
| `urlop planowany` | 126–142 | 9–10 |
| `stała nieobecność` | 134–151 | 8–9 |
| `wyjazd zagraniczny` | 141–160 | 8–9 |
| `szkolenie w miejscu pracy`, full-day | 177–201 | 6–7 |
| `szkolenie/wyjście…`, **full-day** | 235–269 | **4–5** |
| `szkolenie w miejscu pracy` + range | 242–280 | 4–5 |
| `szkolenie/wyjście…` + range | 300–348 | 3–4 |

This supersedes the original doc's single "4–5 employees" figure by showing it is a family. Note the
full-day offsite row: the grid collapses to 4–5 employees **with no hours involved at all** — the
earlier framing, which tied the blow-up to the `HH:MM` suffix, did not predict that.

### Wrapping (option C) across all seven types

There is no break opportunity today: `whitespace-nowrap` (`:326`) covers a single label span
(`:333-336`) holding name *and* range joined by one U+0020. Chrome breaks Latin text at spaces only —
not at `/`. Greedy line counts at the ~81px of text room a 120px column leaves after the 39px
overhead:

| type | lines, name only | lines, + range | widest line px | fits ~81px? |
|---|---|---|---|---|
| `urlop` | 1 | 2 | 28–33 | yes |
| `choroba` | 1 | 2 | 43–50 | yes |
| `urlop planowany` | 2 | 3 | 57–67 | yes |
| `wyjazd zagraniczny` | 2 | 3 | 63–74 | yes |
| `stała nieobecność` | 2 | 3 | 67–77 | yes |
| `szkolenie w miejscu pracy` | 2 | 3 | 73–86 | borderline |
| `szkolenie/wyjście poza miejsce pracy` | 3 | **4** | 92–108 | **no** |

At the corrected leading of **15.71px** (`text-sm`'s token is the unitless `calc(1.25 / 0.875)`,
`node_modules/tailwindcss/theme.css:350`, re-multiplied by the chip's own 11px — not `1.25rem`):
2 lines ≈ 31px, 3 ≈ 47px, 4 ≈ 63px, against a **28px content box** inside the `h-[34px]` cell (`:314`).
So:

- **Five of seven types need ≥2 lines and therefore a taller row** — not just offsite.
- The requested three-line offsite form is really a **four**-line form once `HH:MM` is present.
- Offsite cannot reach the 120px floor by wrapping at all: its unbreakable `szkolenie/wyjście` needs
  92–108 + 39 = **131–147px**. Introducing a break opportunity (`<wbr>`, `&shy;`, or
  `word-break`/`overflow-wrap`) inside that token is a **hard requirement** of this option, not a
  polish item.
- Because `h-[34px]` is a *minimum* in table layout, rows grow **individually**. A month where two
  people train on different days yields two tall rows and 28 short ones — ragged, not the uniform
  +19px/row the original doc assumed. Uniform behaviour means raising every row (34 → ~53px ≈ **+570px**
  over ~30 rows), and only a 3-line chip with tight leading stays inside the design's own 26–48px
  `rowHeight` range (`10xUrlopy.dc.html:598`).

### The options, re-scored for seven types

| | option | works for all 7? | cost / notes |
|---|---|---|---|
| **A** | drop the name from the cell (icon + range) | **yes, uniformly** | Chip becomes 39px full-day, 101–115px with a range — **every type back under the 120px floor**. Exactly what the prototype does: `10xUrlopy.dc.html:803` renders the *time* as `label`, and the type name appears in **zero of seven** cells, only in the `title` (`:807`). Icon-only is already shipped in three sibling surfaces (details filter chips `AbsenceDetailsSubcards.tsx:270-287`, both stats matrices `AbsenceStats.tsx:166`) with the F5 `aria-label` a11y fix as precedent (`impl-review-2.md:158-165`), and the grid tooltip already carries `Typ:` and `Godziny:` (`:134-148`). **But it does not reach 10 columns alone** — the header still binds at 117–161px. |
| **B** | short display label | needs **7 abbreviations, not 1** | Two prefix-colliding pairs (`urlop`/`urlop planowany`, and the two `szkolenie…`) so the scheme must actively disambiguate — the very problem icon-only already solved on the other three surfaces. No slug column exists; the gap is flagged as a known weakness twice (2026-06-22: `hours-onsite-training-only/plan-brief.md:17,74-75`, `urlop-balance/plan.md:15`) and the 2026-08-07 migration added `text_color`, `icon` and `display_order` while still skipping it. A name-keyed map would be a **fourth** name-keyed type rule. |
| **C** | wrap to 3 lines | partially | See above: 5/7 types need taller rows, offsite needs an explicit break opportunity and still lands at 131–147px, and rows grow raggedly. |
| **D** | bound the width structurally (`table-fixed` + explicit widths, or `min-w-0`) | **yes — and it is the only option that also bounds the header** | The header is the binding constraint for 5 of 7 types and **D is the only option that touches it**. Under `table-fixed` the existing `truncate` on both the chip label (`:333`) and the header name (`:75`, `:258`) finally engages — currently both are inert, for two different reasons (see finding 4). Makes 10 columns achievable and every future long label harmless, including a type-blind `HH:MM` leaking onto a non-whitelisted type. Also addresses the yearly-matrix width blind spot logged at `impl-review-2.md:103-105`. |
| **E** | DB rename to "poza NBP" | **no** | Under an all-types reading this is *seven* renames — or an admitted special case for one type — each across the five layers listed in the original doc, plus a PRD amendment. **Retired.** |

**Recommendation: A + D.** A restores prototype parity and removes the per-type variance at its
source; D delivers the PRD's ten columns, which A alone cannot, and immunises the grid against every
future long label. B and C both stay per-type fragile. E is out.

### New findings the offsite-only framing hid

1. **Icon width is not uniform across types.** Six icons are single code points (14.9px at
   `text-[12px]`). The offsite icon is the 8-code-point ZWJ sequence 🏃🏼‍♂️‍➡️
   (`20260807122840_faulty_hobgoblin.sql:30`), Emoji 15.1 "person running facing right". Where the
   sequence ligates it is one 14.9px glyph; where the font lacks it, it decomposes into 3–4 visible
   glyphs ≈ **41–55px**, adding ~26–40px to the already-widest column. Ligature support in the local
   `NotoColorEmoji.ttf` could not be confirmed (the file carries no `post` glyph names to inspect), so
   this is a condition to check on target browsers, not a settled number.
2. **One absence per cell is guaranteed** — `UNIQUE (employee_id, date)`
   (`20260526000001_schema.sql:51`) plus a `Map` keyed `` `${employee_id}_${date}` `` (`:114-117`,
   `:298`). Chip stacking is not a width vector for any type; that usefully bounds the problem.
3. **The overlay badges cost zero width.** Substitute badge (`:337-342`) and comment marker
   (`:343-347`) are `absolute`, so they never widen a column — but they sit *over* the label, which
   matters more once the label is truncated rather than expanded.
4. **`truncate` is inert for two independent reasons.** On the chip label it is a flex item whose
   `overflow:hidden` resolves `min-width:auto` to **0 — a floor, not a cap**; per Flexbox §9.9.1 the
   container's min-content is the sum of its items' contributions, and a `nowrap` label contributes
   its full string width. On the header the span is a block box, where `overflow:hidden` does not
   affect intrinsic sizing at all. **Nothing clips today for any of the seven types** — the columns
   widen instead, which is precisely the reported symptom. (A contrary reading, that six of seven
   names are silently clipped at 120px, surfaced during this pass and does not hold.)
5. **The prototype puts a type name in a cell for zero of seven types.** The p4 contract "Chip content
   is icon + label" (`huge-ui-ux-improvement/plan.md:514`) misread the prototype's `label` field,
   which holds the time range (`10xUrlopy.dc.html:803`); the same change's research read it correctly
   (`research.md:69`). The drift is one line and it applies to all seven types at once. The same plan
   never reconciled that content contract with its own 120px/1480px width contract
   (`plan.md:490-494,549`), and specified no truncation, wrapping or clamping for the cell name.
6. **The prototype's `min-width:900px` inner wrapper was specified and silently dropped**
   (`research.md:67`, `plan.md:490-494` vs `AbsenceGrid.tsx:247`, which has only `overflow-x-auto`).
   Behaviourally near-equivalent, but the same class of undocumented omission as F6.
7. **The prototype carries per-type slugs the DB lacks** — `urlop`, `szkolenie_poza`, `szkolenie_w`,
   `choroba`, `wyjazd`, `stala`, `urlop_plan` (`:599-607`) — and keys its timed-type rule off them
   (`:1276`, `:1476`, `:1482`), plus a second slug-keyed rule for priority (`:1470`). Its `label`
   values match the DB names byte-for-byte for all seven; it abbreviates only to icon-plus-tooltip,
   never to a shortened word. If option B is ever chosen, the slug is the missing piece — not the
   abbreviation.
8. **Full-day chips were colour-only by design until 2026-08-07.** `absence-hours-range/plan.md:254`
   decided "show the time range … for partial-day absences, leave full-day blocks unchanged", and
   `huge-ui-ux-improvement/plan.md:514` is the single change that ever put more than icon + colour in
   a full-day chip — for all seven types simultaneously. Its own acceptance criterion (`plan.md:552`)
   still distinguishes the two cases only by hours.
9. **Holes through which a non-whitelisted type can hold hours** (each renders `HH:MM` in the grid):
   any direct DB write, since no CHECK or trigger blocks it; legacy rows in environments the
   2026-08-11 purge never ran against; an `absence_types.name` rename, which silently moves
   eligibility because the predicate is an exact string match and `name` has no UNIQUE constraint; and
   the reverse failure — a new type that *should* allow hours being added without touching
   `absence-types.ts:11`, which is exactly how `urlop planowany` behaves today.

### Open questions (updated)

Replaces items 1, 4 and 5 of the original list; items 2, 3, 6 and 7 stand as written.

1. **A + D, or D alone?** A alone leaves the header binding (8–9 columns); D alone caps everything but
   leaves a 36-character name clipped to a prefix in every offsite cell. A + D is coherent, but it is
   two decisions — dropping the name is a UX call, bounding the table is a layout call — and they can
   ship in either order.
2. **What width does D pin?** `table-fixed` needs an explicit number. 120px matches the prototype and
   the PRD's ten-employee goal but truncates most employee names; ~128px fits ten columns only if the
   day column shrinks. Sizing this properly is what open question 7 (browser measurement) is for.
3. **Is truncating the employee name acceptable?** It is the header, the primary row/column identity,
   and there is no tooltip on it today (unlike the chip). If not acceptable, the ten-column target
   needs a different lever — shorter rendered names (initials for the surname?), a smaller header
   font, or accepting horizontal scroll as F6 already did.
4. **Does the offsite ZWJ icon ligate on the browsers actually in use?** If not, that type carries a
   ~26–40px icon penalty no other type has, and a single-code-point substitute (🏃 or 🚶) would remove
   it for free — a data-only `UPDATE`, no code change.
5. **Should the renderer stop being type-blind?** Gating `timeRangeOf` on `typeAllowsPartialDay` would
   make the worst-case cell width a property of two types rather than seven, and would stop legacy or
   hand-written rows from displaying hours the product forbids. It is a small change with a real
   caveat: it hides existing bad data rather than fixing it, and `holiday-balance.ts:42` would still
   count those hours.
