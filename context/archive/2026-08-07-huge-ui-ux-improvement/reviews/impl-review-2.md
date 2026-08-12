<!-- IMPL-REVIEW-REPORT -->

# Implementation Review (second pass): Adopt the new-design prototype

- **Plan**: `context/changes/huge-ui-ux-improvement/plan.md`
- **Scope**: Full plan — Phases 1–8 of 8
- **Date**: 2026-08-11
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged and FIXED on 2026-08-11 (not yet committed or deployed)
- **Findings**: 0 critical, 8 warnings, 2 observations
- **Prior review**: `reviews/impl-review.md` (10 findings, all FIXED in `a117273`). This pass
  reviews the implementation as it stands _after_ those fixes and reports only what that pass
  missed. Later changes `holiday-balance-valid-until` and `absence-hours-window` shipped on top
  and their edits are excluded from attribution.

## Automated verification (re-run 2026-08-11)

| Check                                                      | Result                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                             | PASS — 0 errors (10 pre-existing warnings in `packages/code-reviewer`)                                                                       |
| `npm run test:run`                                         | PASS — 15 files, 108/108                                                                                                                     |
| `npm run build`                                            | PASS                                                                                                                                         |
| `grep -rn "textColorForBg" src/`                           | empty ✅                                                                                                                                     |
| `grep -rn "bg-cosmic" src/`                                | only `.scaffold` paths ✅                                                                                                                    |
| `grep -rn "FULL_DAY_HOURS\s*=" src/`                       | exactly one hit (`src/lib/hours.ts:8`) ✅                                                                                                    |
| `/ 8` divisor in `AbsenceStats.tsx` / `holiday-balance.ts` | empty ✅                                                                                                                                     |
| Migration `20260807122840_faulty_hobgoblin.sql`            | 3 `ADD COLUMN` + 7 name-keyed `UPDATE`s, no `DROP`, no `ALTER COLUMN`, CHECK untouched, catalogue matches `plan.md:416-421` byte-for-byte ✅ |

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Verified clean: all twelve "What We're NOT Doing" guardrails held; the Korekta gate is
implemented by column omission on both the `values()` and `onConflictDoUpdate.set()` arms with
`caller.role` resolved server-side (no bypass); the substitute list excludes the _target_
employee; column DnD constraints preserved; zero `dangerouslySetInnerHTML` / `set:html` /
`sql.raw`; `is_system` excluded from all four employee-derived UI surfaces; no NaN path to the
DB; `plural` / `medals` / `initials` / `type-filter` / `avatar` survived independent edge-case
re-derivation.

## Findings

### F1 — "Wyczyść filtry" hides every type — the exact semantics the plan forbade

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/type-filter.ts:25-41`, `src/components/absence/AbsenceDetailsSubcards.tsx:291-303`
- **Detail**: `plan.md:584-588` is explicit and names the prototype line: "do not port the
  prototype's… `Wyczyść filtry` sets it to **empty** (everything visible). The prototype's
  `clearFilters` (`:1321`) sets it to every type id, hiding everything." Shipped: with nothing
  hidden the button reads `✕ Wyczyść filtry` and calls `hideAll(absenceTypes.map(t => t.id))`,
  hiding all seven types; restoring is only reachable on a second click via a relabelled
  `✓ Zaznacz wszystkie`. `change.md`'s closing note defends this as an improvement because the
  plan's rule "left the all-hidden state unescapable" — that reasoning does not hold, since
  under the plan's rule the clear control is active whenever anything is hidden. Progress row
  5.3 (`plan.md:1139`) is ticked as "`Wyczyść filtry` restores all types" against `8b25781`,
  the commit that removed that behaviour.
- **Fix A ⭐ Recommended**: Restore the plan's one-way semantics — the control always calls
  `clearHidden()`, rendered active only while `isFilterActive()` is true.
  - Strength: `clearHidden()` and `isFilterActive()` already exist and are already tested
    (`type-filter.test.ts:28`); this deletes `hideAll()` and the `toggleAction` branch.
  - Tradeoff: Loses "hide everything" as a one-click action.
  - Confidence: HIGH — the plan states the rule verbatim and the helpers are in the file.
  - Blind spot: Whether the two-state toggle was a live product decision during the manual pass.
- **Fix B**: Keep the toggle but relabel the first arm (`Ukryj wszystkie` / `Zaznacz wszystkie`)
  and amend `plan.md:584-588` plus row 5.3's text.
  - Strength: Preserves shipped, manually-verified behaviour; the confusion is in the word
    "Wyczyść", which the relabel removes.
  - Tradeoff: Amends a contract the plan defended by name and line number.
  - Confidence: MEDIUM — resolves the UX defect but not the drift.
  - Blind spot: Polish copy review — "Ukryj wszystkie" is a proposal, not the prototype's.
- **Decision**: FIXED via Fix A — `hideAll()` / `filterToggleAction()` deleted; the control always calls `clearHidden()` and is active only while `isFilterActive()`. Tests updated: the all-hidden state's escapability is now locked by a `clearHidden()` case instead of a toggle round-trip.

### F2 — Balance card and statistics matrix print different day counts for the same absence

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/lib/hours.ts:27-29` vs `HolidayBalanceCard.tsx:15-17`, `HolidayBalanceDialog.tsx:21-23`
- **Detail**: `plan.md:677` required "Decide the rounding rule in one place — the matrices
  display it and the balance service computes with it, and they must not disagree."
  `hours.ts:24` declares itself that place (`maximumFractionDigits: 1`). Both holiday components
  kept a private duplicate at two digits. Both render the same `computeUsedDays` output, so a
  3h45m `urlop` (0.46875 d) reads `0,5` in Statystyki and `0,47` on the balance card — on the
  same screen. Also 1h → 0,1 vs 0,13; 7h → 0,9 vs 0,88. The extraction satisfied the greps while
  leaving the rule it was extracted to unify still forked.
- **Fix A ⭐ Recommended**: Delete both `formatDays` copies; import `formatDayCount` from
  `@/lib/hours` in the card and the dialog.
  - Strength: Makes `hours.ts` actually load-bearing, which was Phase 6's stated point.
  - Tradeoff: Balance figures lose a decimal (0,47 → 0,5); manual row 6.7 was verified against
    the 2-digit output, so this moves a number a user has already seen.
  - Confidence: HIGH — one exported function, two call sites.
  - Blind spot: Whether 1 digit is enough for a figure reconciled against payroll.
- **Fix B**: Move the 2-digit rule into `hours.ts` as the single rule; the matrices use it too.
  - Strength: Keeps balance precision; still collapses to one definition.
  - Tradeoff: Contradicts `hours.ts:26-27`'s documented example and widens matrix columns.
  - Confidence: MEDIUM — correct mechanically; matrix display consequence unverified.
  - Blind spot: Column width in the yearly matrix at 7 types + Łącznie.
- **Decision**: FIXED via Fix A — both private `formatDays` copies deleted; `HolidayBalanceCard` and `HolidayBalanceDialog` import `formatDayCount` from `@/lib/hours`. `grep -rn "formatDays" src/` is empty.

### F3 — Details rows became mouse-only and lost table semantics

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceDetailsTable.tsx:150-201`
- **Detail**: `plan.md:613-631` asked for a restyle. The implementation replaced the real
  `<table>/<thead>/<th>/<tbody>/<tr>/<td>` (confirmed at `da6172d:…:140-186`) with nested
  `<div>`s on `gridTemplateColumns`, and in the same change made rows clickable — with no
  `role`, no `tabIndex`, no `onKeyDown`. Szczegóły is the only surface where a row opens the
  edit dialog, so a keyboard-only user cannot edit an absence there at all. Headers are
  `<button>`s in a plain `<div>` with no `role="columnheader"` and no `aria-sort`, so the
  ↕/↑/↓ state is visual only. It slipped lint because `jsx-a11y` is mounted only for Astro files
  (`eslint.config.js:88`, `flat/jsx-a11y-recommended`, scoped `**/*.astro`) — no `.tsx` in the
  repo is a11y-linted, so `click-events-have-key-events` never fired.
- **Fix A ⭐ Recommended**: Add `role="button"`, `tabIndex={editable ? 0 : -1}` and an
  Enter/Space `onKeyDown` to editable rows; add `aria-sort` to the six header buttons.
  - Strength: Contained to one file; matches the fix shape already accepted for the pickers.
  - Tradeoff: Leaves the grid without row/column association for screen readers.
  - Confidence: HIGH — the `editable` predicate already exists at `:180`.
  - Blind spot: Not tested with a real screen reader.
- **Fix B**: Restore `<table>` markup with `display:grid` on `<tr>`, keeping the visual design.
  - Strength: Recovers full semantics and sort announcement, not just operability.
  - Tradeoff: Larger rewrite of a file that shipped and was manually verified.
  - Confidence: MEDIUM — the visual result needs re-verification.
  - Blind spot: Whether the 940px min-width layout survives.
- **Decision**: FIXED via Fix A — editable rows gain `role="button"`, `tabIndex={0}`, an Enter/Space `onKeyDown` and a `focus-visible` ring; the six header buttons carry the sort state on their accessible name via a new `sortLabel()` (`aria-sort` has no valid host in a div grid).

### F4 — A transient fetch failure locks the Details sub-tab on a stale error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceDetailsSubcards.tsx:138-164` and `:166-191`
- **Detail**: The prior review's F1 fixed the _loading_ lock by moving `todayFetched.current =
true` into the success handler. Neither effect clears its error state on retry, and the render
  guard (`:307-311`, `:329-333`) checks `weekError` _before_ the data branch. One 503 → switch
  away and back → the refetch succeeds and populates `weekAbsences`, but `weekError` is still
  set, so the panel shows the stale error permanently with the data unrendered and
  `todayFetched` now blocking further attempts. Only a reload recovers. Yearly is identical.
- **Fix**: Add `setWeekError(null)` / `setYearlyError(null)` alongside the `setLoading(true)` at
  the top of each effect.
- **Decision**: FIXED — `setWeekError(null)` / `setYearlyError(null)` now run alongside `setLoading(true)` at the top of each effect.

### F5 — Type-filter chips announce as their emoji, not the absence type

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceDetailsSubcards.tsx:270-289`
- **Detail**: The chips carry `title={type.name}` and `aria-pressed`, but their only content is
  the colour dot and `{type.icon}`. Per accname, text content wins over `title`, so the seven
  chips announce as "palm tree, pressed", "graduation cap, pressed", etc. The prior review's F3
  added an explicit `aria-label` to the substitute avatars for exactly this reason and did not
  apply it here.
- **Fix**: `aria-label={type.name}` on each chip; wrap the group in `role="group"`
  `aria-label="Filtruj wg typu"`.
- **Decision**: FIXED — `aria-label={type.name}` on each chip; the seven are wrapped in `role="group" aria-label="Filtruj wg typu nieobecności"`.

### F6 — The grid's sticky day column was silently dropped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/absence/AbsenceGrid.tsx:251`, `:280`
- **Detail**: Before the change the `Dzień` header carried `sticky left-0 z-20` and each day cell
  `sticky left-0 z-10` (`da6172d:…:205`, `:238`). Both are gone; only `overflow-x-auto` remains
  at `:247`. `plan.md:490-494` specifies the day column's width and content but never asks for
  stickiness to be removed. At 132px + n×120px against the 1480px container, past ~11 employees
  the date labels scroll out of view. Manual row 4.4 only covers the ten-column case.
- **Fix**: Restore `sticky left-0 z-20` on the day header and `sticky left-0 z-10` on the day
  cells, keeping the new background classes.
- **Decision**: FIXED — `sticky left-0 z-20` restored on the `Dzień` header and `sticky left-0 z-10` on the day cells, with the row's `bg-surface`/`bg-white` moved onto the cell so content cannot scroll under it.

### F7 — `#9a9a9a` fails WCAG AA in seven places where the token already passes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `AbsenceStats.tsx:80,121` · `AbsenceGrid.tsx:71,283` · `AbsenceDetailsTable.tsx:147` · `AbsenceDetailsSubcards.tsx:280` · `EmployeeManagementSheet.tsx:50`
- **Detail**: The prior review's F9 swept eight token bypasses; `#9a9a9a` was not among them.
  Measured `#9a9a9a` on white = 2.81:1, against the 4.5:1 needed for the `text-xs` /
  `text-[13px]` it styles. The token it bypasses, `--muted-foreground` (`#6f6f6f`,
  `global.css:22`), measures 5.02:1 — it passes. Affected: KPI tile note, percentage column,
  empty-state label, weekend weekday label, off-state filter chip, inactive-employee initials.
  Also measured: `avatar.ts:7` colours `#58873e` (4.24:1) and `#cc654e` (3.79:1) fail against the
  white 11px-bold initials; the other three pass.
- **Fix**: Replace `text-[#9a9a9a]` with `text-muted-foreground` at all seven sites.
- **Decision**: FIXED — all seven `text-[#9a9a9a]` sites converted to `text-muted-foreground`. `avatar.ts:10`'s `#9a9a9a` is left: it is a background fill for the unknown-employee chip, not text.

### F8 — Phase 2 rewrote the auth pages with raw brand hex, in the change that created the tokens

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/pages/auth/signin.astro:12,16,20,21,24,28,29,33` · `src/pages/auth/confirm-email.astro:22,25,28,29,30`
- **Detail**: `plan.md:190-192` states Phase 1's intent as flipping every call site to brand
  "without touching those files", and `plan.md:110` sets the ordering rationale: "tokens first,
  so every later phase consumes names rather than hex." Both files were rewritten by `f748ba5`
  — a later phase of this same change — and landed carrying `bg-[#072143]` and
  `hover:text-[#c5ac75]`, which are `--primary` and `--accent` verbatim (`global.css:17`, `:23`),
  plus `bg-slate-50`, `text-slate-900`, `text-slate-500`, `border-slate-100`, `shadow-slate-200`,
  `text-slate-400`. `index.astro` carries the same markup but predates this change
  (`main-page-redesign`, `8d6f3f0`); `signin.astro` is a deliberate near-copy of it
  (comment at `:6-7`), so a token migration has to be done in both.
- **Fix**: Convert to `bg-primary` / `text-primary` / `hover:text-accent` and `bg-surface` /
  `text-muted-foreground` / `border-line` across all three login surfaces, including
  `index.astro` so they cannot drift.
- **Decision**: FIXED — converted across all three login surfaces (`index.astro`, `auth/signin.astro`, `auth/confirm-email.astro`): `bg-primary`, `text-primary`, `hover:text-accent`, `bg-surface`, `text-muted-foreground`, `border-line`. Two residuals left deliberately: `shadow-slate-200` (no shadow-tint token exists) and `LoginCardForm.tsx`'s own hexes (it predates this change).

### F9 — The regression F10 was fixed for is not covered by its own test suite

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/tests/api/holiday-balances/korekta-gate.test.ts:151-163`
- **Detail**: Six cases cover moderator and non-moderator, insert and update — all sending an
  explicit `used_adjustment_days`. The prior review's F10 dropped `.default(0)` so that a
  moderator _omitting_ the field means leave-unchanged. That case is never exercised. The
  closest test ("moderator saving an unchanged adjustment does not zero it") sends
  `used_adjustment_days: 7` explicitly, which passes identically under the old code — the suite
  would not fail if F10 regressed.
- **Fix**: Seed `used_adjustment_days: 5`, then POST as moderator with the field omitted via
  `payload({ used_adjustment_days: undefined })`; assert the stored value stays 5.
- **Decision**: FIXED — two cases added: moderator omitting `used_adjustment_days` on update leaves the stored value, and on insert takes the column default. `DATABASE_URL_DIRECT` is set locally, so the suite ran for real: 8/8 pass.

### F10 — `is_system` is excluded from every employee list but from no absence query

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/absences/index.ts:122` · `src/pages/dashboard.astro:99-102`
- **Detail**: All four employee-derived surfaces the plan named are correctly fed from
  `visibleEmployeesFilter()`-scoped arrays. The absence joins are not scoped. Aggregates are safe
  by construction (`buildMatrix` only sums over the passed `employees`), but the Details table
  renders raw rows: an absence owned by the `is_system` admin would resolve to `undefined`,
  render as an unnamed `—` row with the grey `avatarColor(-1)` chip — exposing its date, type,
  hours and comment — and be counted in `entryCountLabel(rows.length)`. Not reachable today (the
  seeded admin has no absences; `POST /api/absences` is the only creation path). Defence-in-depth.
- **Fix**: Add `visibleEmployeesFilter()` to `joinCondition` in `api/absences/index.ts` and to
  `absencesJoin` in `dashboard.astro:99-102`.
- **Decision**: FIXED — `visibleEmployeesFilter()` added to both arms of `joinCondition` (`api/absences/index.ts`) and `absencesJoin` (`dashboard.astro`).

## Also noted, not filed

- `EmployeeManagementSheet.tsx:126-128` — comment claims avatar colours match Details/Statistics,
  but the sheet gets `allEmployees` while those get the shorter `gridEmployees`, so indices shift
  for moderators viewing an old month. Cosmetic; the comment is what's wrong.
- `AbsenceFormDialog.tsx:111-115` — a substitute not present in `otherEmployees` makes
  `findIndex` return `-1`, so `-1 + 1 = 0` silently resolves to the "Brak zastępstwa" slot with
  no `aria-checked` radio anywhere. No data loss; the form misrepresents what is stored.
- `src/pages/index.astro.scaffold:2` imports `@/components/Welcome.astro`, deleted by this
  change. Inert (scaffolds are neither built nor linted) but now dangling.
- `dashboard.astro:218` `text-red-600` and `:286` `text-gray-600` — the two palette classes the
  change converted everywhere else.
- `AbsenceGrid.tsx:112-132` builds three Maps and two `Intl` formatters in the render body with
  no `useMemo`, re-running on every drag and dialog toggle; `AbsenceDetailsTable.tsx:82-88`
  memoises the equivalent work. React Compiler is lint-only here (`astro.config.mjs:21` has no
  babel plugin). Negligible at ~10 employees.
- `AbsenceGrid.tsx:77` changed `(nakt.)` → `(nieakt.)` in `8b25781` — the same commit that ticked
  Progress row 4.11, whose text still says `(nakt.)`. Benign typo fix; the criterion text is now
  literally false.
- Progress rows 5.3 and 7.6 are documented as superseded in `change.md`'s closing notes, so the
  criteria are not rubber-stamped — but 5.3's stated rationale is the one F1 disputes.
