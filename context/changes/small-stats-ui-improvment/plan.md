# Split type breakdown into year + month, and rename Sign out to Wyloguj — Implementation Plan

## Overview

Two independent presentation-only changes to the Statystyki tab and the top bar:

1. The single **"Podział wg typu nieobecności"** card, which today summarises the browsed **month** only, becomes **two** cards — one for the chosen **year**, one for the chosen **month** — stacked full-width, year first, both above the matrix tables.
2. The top-bar **`Sign out`** button is relabelled **`Wyloguj`**.

Neither change touches the data layer. Both matrices the breakdowns need are already computed inside `AbsenceStats`.

## Current State Analysis

**The breakdown card.** `TypeBreakdown` (`src/components/absence/AbsenceStats.tsx:47-90`) is already a parameterised presentational component: it takes `absenceTypes`, `data: MatrixData`, and a `period: string` label, and renders one row per type with a share bar, a day count, and a percentage. It is rendered exactly once, at `:346`, with `monthlyData` and the capitalised month label. Nothing about it is month-specific — the month-ness lives entirely at the call site.

**The two matrices.** `AbsenceStats` already builds both aggregations it needs:

- `monthlyData` (`:302-305`) — `buildMatrix(monthlyAbsences, employees, absenceTypes)`, from server-rendered props narrowed in `dashboard.astro`.
- `yearlyData` (`:306-309`) — `buildMatrix(yearlyAbsences ?? [], yearlyEmployees, absenceTypes)`, from a client-side `fetch('/api/absences/stats?year=…')` in the effect at `:263-298`.

So the year breakdown needs **no new fetch, no new endpoint, and no change to `src/lib/absence-stats.ts`**. It is a second call site for a component that already exists, fed by a matrix that already exists.

**The asymmetry that shapes the work.** The month matrix is available on first paint; the year matrix is not. The yearly fetch drives three pieces of state — `loading`, `error`, `truncated` (`:256-260`) — and today exactly one region of the page reads them: the yearly matrix at `:360-378`, guarded by a `loading ? <p>Ładowanie statystyk rocznych…</p> : error ? <p>{error}</p> : <StatsMatrixCard …>` ternary. Adding a *second* yearly-backed region means a second consumer of that same guard.

Note the employee-scoping asymmetry, which is correct and must be preserved: the monthly matrix sums over `employees` (windowed to the browsed month for a moderator) while the yearly one sums over `yearlyEmployees` (everyone active at any point in the year) — see the prop comment at `:13-18`. Passing the right matrix to the right card carries this for free; the two cards will legitimately show different denominators.

**The top bar.** `src/components/Topbar.astro:28-32` renders the sign-out action as a native `<form method="POST" action="/api/auth/signout">` wrapping a `<button type="submit">` whose text node is `Sign out`. The label is a bare text node — no `aria-label`, no `data-*`, no id.

**Prior decision this overturns.** S-17 of the UI overhaul deliberately kept top-bar labels in **English** to match the design prototype: *"56px tall, email plus a gold uppercase role pill on the left, `Dashboard` and `Sign out` in white on the right"* (`context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:210-219`), restated in `context/archive/2026-08-12-workers-data-edit/plan.md:385`. This change knowingly departs from it for one label only.

**Test surface.** Searched for any assertion on either string:

```
grep -rn "Sign out\|Podział" --include="*.ts" --include="*.tsx" --include="*.astro" . --exclude-dir=node_modules
```

The only hits under `src/` are the two production lines being changed (`Topbar.astro:30`, `AbsenceStats.tsx:59`); every other hit is prose in `context/archive/**`. `src/tests/lib/absence-stats.test.ts` covers `buildMatrix` as a pure function and asserts nothing about rendering. The two Playwright specs (`tests/e2e/absence-form-dialog.spec.ts`, `tests/e2e/absence-grid-range.spec.ts`) touch neither string. There is **no React component-testing setup** in the repo — no `@testing-library/*` in `package.json`, and `src/tests/` holds only `api/`, `helpers/`, and `lib/`. So no existing test breaks, and no existing harness can assert the new rendering.

## Desired End State

On the Statystyki tab, between the KPI tiles and the monthly matrix table, there are **two** breakdown cards stacked full-width:

1. `Podział wg typu nieobecności` · `Rok 2026` — every absence type's share of the whole browsed year.
2. `Podział wg typu nieobecności` · `Sierpień 2026` — the same, for the browsed month (identical to today's single card).

While the yearly fetch is in flight, the first slot shows `Ładowanie statystyk rocznych…`; if it fails, it shows the error. Both roles see this: a moderator's cards aggregate the team, an employee's their own row, exactly as the matrices below already do.

The top bar's right-hand action reads **`Wyloguj`** and still posts to `/api/auth/signout`.

Verify by loading `/dashboard` → Statystyki as both a moderator and a regular employee, and by clicking `Wyloguj`.

### Key Discoveries:

- `TypeBreakdown` is already period-agnostic (`src/components/absence/AbsenceStats.tsx:47-90`) — the split is a second call site, not a new component.
- `yearlyData` is already built at `src/components/absence/AbsenceStats.tsx:306-309`; no fetch or aggregation work is needed.
- The yearly `loading`/`error` guard currently exists once, inline at `src/components/absence/AbsenceStats.tsx:360-378`; a second yearly-backed region needs it too.
- The `employees` vs `yearlyEmployees` split (`:13-18`) means the two cards legitimately aggregate over different employee sets — do not "fix" this.
- S-17 (`context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:210-219`) locked top-bar labels to English; Phase 2 departs from it deliberately and for one label only.
- No test, unit or E2E, asserts on either changed string; the repo has no React component-test harness.

## What We're NOT Doing

- **Not** adding a new endpoint, query, or aggregation function — `src/lib/absence-stats.ts` and `GET /api/absences/stats` are untouched.
- **Not** polonising the rest of the top bar. `Dashboard`, `Sign in`, and `Not signed in` stay English. The bar becomes mixed-language by design (see Open Risks in the brief).
- **Not** changing `TypeBreakdown`'s internal markup, grid template, colours, or rounding.
- **Not** introducing a React component-testing harness (`@testing-library/react`, jsdom) to assert on the new rendering — that is a separate, larger decision.
- **Not** adding a year/month toggle, a period picker, or a collapse control. Both cards are always rendered.
- **Not** changing where the `truncated` banner sits (it stays at the top of the tab, covering everything yearly).
- **Not** touching `dashboard.astro`, the props contract of `AbsenceStats`, or the month/year navigation.

## Implementation Approach

Phase 1 does three things in one file, in this order:

1. Extract the existing inline `loading`/`error` ternary into a small local wrapper component so two regions can share one definition of "what the page shows while the yearly fetch is pending".
2. Render `TypeBreakdown` twice at the current single call site — year (wrapped) then month (unwrapped) — keeping both above the matrices.
3. Point the yearly matrix at the same wrapper, so the pending copy lives in exactly one place in the source.

Phase 2 is a one-line text change plus a comment recording why the S-17 English-label decision no longer holds for this label.

## Critical Implementation Details

**Two loading lines on screen.** Because the year breakdown sits above the matrices and the yearly matrix stays at the bottom, both slots are pending at the same time and the string `Ładowanie statystyk rocznych…` will render **twice** during the fetch. This is a consequence of the chosen placement, not a bug — a single shared guard is only possible if the two yearly regions are adjacent. The wrapper removes the *code* duplication; the visual duplication is accepted for now and called out in Open Risks. Do not "solve" it by silently moving the cards.

## Phase 1: Year + month type breakdown

### Overview

Split the single monthly breakdown card into a year card and a month card, stacked full-width above the matrix tables, sharing one pending/error wrapper with the yearly matrix.

### Changes Required:

#### 1. Shared pending/error wrapper for yearly-backed regions

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: The yearly fetch now feeds two regions of the page instead of one. Extract the `loading ? … : error ? … : children` ternary that currently sits inline around the yearly matrix (`:360-378`) into a small local component so the pending copy and the error rendering are defined once, and add a short comment explaining that both consumers are driven by the single fetch in the effect at `:263-298`.

**Contract**: A module-local (not exported) component taking `loading: boolean`, `error: string | null`, and `children: ReactNode`. Renders `<p className="text-muted-foreground">Ładowanie statystyk rocznych…</p>` while loading, `<p className="text-destructive">{error}</p>` on error, and `children` otherwise — the exact three branches and class names that exist today at `:360-378`, unchanged. Declare it beside `KpiTile`/`TypeBreakdown`, above the default export.

#### 2. Render the year breakdown, then the month breakdown

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Replace the single `<TypeBreakdown … data={monthlyData} period={capitalizedMonth} />` call at `:346` with two calls in a stacked pair — year first, then month — leaving them in the same position in the flex column (after the KPI tile grid, before the monthly `StatsMatrixCard`). The year card goes inside the wrapper from change 1; the month card does not, since its data is server-rendered and always present.

**Contract**: Year card — `data={yearlyData}`, `period={\`Rok ${String(year)}\`}`, matching the label the self-view KPI tile already uses at `:341`. Month card — `data={monthlyData}`, `period={capitalizedMonth}`, i.e. identical to today's call. The `absenceTypes` prop is the same list for both. `TypeBreakdown`'s own signature and markup are unchanged. The parent stays `flex flex-col gap-5`, so the two cards inherit the existing card rhythm with no new spacing rules.

#### 3. Point the yearly matrix at the shared wrapper

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Replace the now-duplicated inline ternary around the yearly `StatsMatrixCard` (`:360-378`) with the wrapper from change 1, so the pending and error copy exist once in the source. Purely a refactor — the rendered output for this region is byte-identical to today's.

**Contract**: `<YearlyFetchSlot loading={loading} error={error}><StatsMatrixCard … /></YearlyFetchSlot>`, with every existing prop on `StatsMatrixCard` (`title`, `subtitle`, `employees={yearlyEmployees}`, `absenceTypes`, `data={yearlyData}`, `showMedals={isModerator}`, `hideTotalsRow={!isModerator}`) carried over verbatim.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run lint`
- Unit test suite passes with no regressions: `npm run test:run`
- Production build succeeds: `npm run build`

#### Manual Verification:

- As a **moderator** on Statystyki: two breakdown cards appear above the matrices, year first (`Rok <YYYY>`) then month (`<Miesiąc> <YYYY>`), and the month card's numbers are unchanged from before the change.
- The year card's per-type day counts match the `Łącznie` row of the yearly matrix below it, and its percentages sum to ~100%.
- As a **regular employee**: both cards render and show only that employee's own figures.
- During the yearly fetch the year card slot shows `Ładowanie statystyk rocznych…`; navigating to a year with no absences yields a card with all `—` and 0% rather than a crash or `NaN%`.
- Changing the browsed **month** updates only the month card; changing the **year** updates both.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Polish sign-out label

### Overview

Relabel the top-bar sign-out button from `Sign out` to `Wyloguj`, and record why this departs from the S-17 English-labels decision.

### Changes Required:

#### 1. Rename the button label

**File**: `src/components/Topbar.astro`

**Intent**: Change the button's text node at `:30` from `Sign out` to `Wyloguj`. Add a brief comment above the `<form>` noting that S-17 (`context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:210-219`) fixed top-bar labels to English to match the prototype, and that this one label is now Polish by explicit request while `Dashboard` / `Sign in` / `Not signed in` deliberately stay English — so a future reader does not "restore consistency" in either direction by accident.

**Contract**: The `<form method="POST" action="/api/auth/signout">` wrapper, the `<button type="submit">`, and its `hover:text-accent cursor-pointer transition-colors` classes are all unchanged. Only the text node differs. The signed-out branch (`:36-43`) is untouched.

### Success Criteria:

#### Automated Verification:

- Linting and formatting pass: `npm run lint`
- Production build succeeds: `npm run build`
- No stale references remain: `grep -rn "Sign out" src/` returns nothing

#### Manual Verification:

- The top bar's right-hand action reads `Wyloguj` on `/dashboard`.
- Clicking it still signs the user out and redirects to the sign-in page.
- The gold moderator pill, the account menu, and the `Dashboard` link are visually unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

No new unit tests. The aggregation both cards render is `buildMatrix`, already covered by `src/tests/lib/absence-stats.test.ts`; this change adds no new pure logic. The repo has no React component-testing harness (no `@testing-library/*` in `package.json`), and introducing one is explicitly out of scope — so the rendering delta is verified manually and by the existing type checker.

### Integration Tests:

None. No route, query, or response shape changes.

### Manual Testing Steps:

1. `npm run build` then `npm run dev`, sign in as a **moderator**, open `/dashboard` → Statystyki.
2. Confirm two breakdown cards above the matrices, in the order year (`Rok <YYYY>`) then month.
3. Cross-check the year card's per-type counts against the yearly matrix's `Łącznie` row; cross-check the month card against the monthly matrix's `Łącznie` row.
4. Navigate back a month — only the month card changes. Navigate back a year — both cards change and the year slot briefly shows the loading text.
5. Pick a year with no data (e.g. several years back) — the year card renders all `—` / 0%, no `NaN`.
6. Sign out via `Wyloguj`, sign back in as a **regular employee**, repeat steps 2-3 against that employee's own figures.
7. Throttle the network in devtools and reload — confirm the year slot's loading state resolves into the card without a layout crash.

## Performance Considerations

None. Both matrices are already computed and memoised (`:302-309`); the second `TypeBreakdown` iterates `absenceTypes` (a handful of rows) over an already-built `perType` array. No new fetch, no new aggregation pass.

## Migration Notes

Not applicable — no data, schema, or API contract changes. Both phases are revertible by reverting their commit.

## References

- Component being split: `src/components/absence/AbsenceStats.tsx:47-90` (`TypeBreakdown`), call site `:346`
- Yearly fetch and its state: `src/components/absence/AbsenceStats.tsx:255-298`
- Existing pending/error guard being extracted: `src/components/absence/AbsenceStats.tsx:360-378`
- Aggregation behind both cards: `src/lib/absence-stats.ts:35-71`
- Label being renamed: `src/components/Topbar.astro:28-32`
- S-17 English-labels decision this departs from: `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:210-219`
- Original breakdown-card spec: `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:706`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Year + month type breakdown

#### Automated

- [x] 1.1 Type checking and linting pass: `npm run lint` — e75a36b
- [x] 1.2 Unit test suite passes with no regressions: `npm run test:run` — e75a36b
- [x] 1.3 Production build succeeds: `npm run build` — e75a36b

#### Manual

- [x] 1.4 Moderator: two breakdown cards, year first, month figures unchanged — e75a36b
- [x] 1.5 Year card counts match the yearly matrix `Łącznie` row; shares sum to ~100% — e75a36b
- [x] 1.6 Regular employee: both cards render own figures only — e75a36b
- [x] 1.7 Loading state shows in the year slot; empty year renders `—` / 0% without `NaN` — e75a36b
- [x] 1.8 Month navigation updates only the month card; year navigation updates both — e75a36b

### Phase 2: Polish sign-out label

#### Automated

- [x] 2.1 Linting and formatting pass: `npm run lint`
- [x] 2.2 Production build succeeds: `npm run build`
- [x] 2.3 No stale references: `grep -rn "Sign out" src/` returns nothing

#### Manual

- [x] 2.4 Top bar reads `Wyloguj`
- [x] 2.5 Clicking it signs out and redirects to sign-in
- [x] 2.6 Moderator pill, account menu, and `Dashboard` link visually unchanged
