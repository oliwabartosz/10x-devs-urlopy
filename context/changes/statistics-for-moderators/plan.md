# Role-Scoped Statistics Implementation Plan

## Overview

Split the **Statystyki** tab by role. A moderator keeps today's full team view — the employee × type matrix, the 🥇🥈🥉 medals, the team KPIs. Everyone else sees only their own figures: one row, no medals, no team totals, and a year-to-date tile in place of the "Pracownicy z nieobecnością" counter. The scoping is enforced on the server, not in React, so the yearly figures a non-moderator can reach are their own.

## Current State Analysis

The Statystyki tab is team-wide for every authenticated user, deliberately:

- `src/pages/dashboard.astro:239-247` renders `<AbsenceStats>` with `employees={gridEmployees}` and `monthlyAbsences={absences}` — no role branch anywhere in the call.
- `src/components/absence/AbsenceStats.tsx` is built around cross-employee comparison: `StatsMatrixCard` renders one row per employee, `medalRanks` awards 🥇🥈🥉 for "most days in the column" (`AbsenceStats.tsx:145-152`), and the second KPI tile reads "Pracownicy z nieobecnością — N / M" (`AbsenceStats.tsx:333-340`).
- The yearly half of the tab is fetched client-side from `GET /api/absences?year=` (`AbsenceStats.tsx:274`). That route returns every visible employee's absences to any authenticated caller, by design, and says so: *"No employee_id filter: the team grid shows all employees' absences to every user"* (`src/pages/api/absences/index.ts:117-120`).
- The same endpoint feeds the Szczegóły tab's weekly and yearly subcards (`AbsenceDetailsSubcards.tsx:139,169`), which genuinely need team-wide rows. It therefore cannot be narrowed in place.

Both foundation documents currently argue *against* this change and must be amended as part of it:

- `context/foundation/prd.md:135` — Non-Goal: *"No separate statistics visibility rules for employees and moderators; statistics are general for everyone."*
- `context/foundation/roadmap.md:438` — Parked: *"Osobne reguły widoczności statystyk dla pracownika i moderatora — Why parked: PRD §Non-Goals."*

The archived S-02 brief lists "moderator-only stats views" as explicitly out of scope (`context/archive/2026-05-30-details-and-stats/plan-brief.md`), so this is the deliberate follow-up to that slice, not a correction of it.

## Desired End State

A moderator opening `?tab=stats` sees exactly what they see today — nothing about the moderator path changes visually.

A non-moderator opening the same tab sees:

- KPI row: "Dni nieobecności" for the browsed month (own days only) and "Dni nieobecności w tym roku" (own year-to-date).
- "Podział wg typu nieobecności" — their own month split by type.
- A monthly matrix with a single row (themselves), no grand-total footer.
- A yearly matrix with a single row, **no medals**.

And, critically: opening devtools and reading the network tab shows the yearly response contains only their own absence rows. `GET /api/absences/stats?year=` returns own-scoped data for a non-moderator regardless of any parameter the client sends.

Verified by: the Phase 1 route integration suite (moderator sees other employees' rows, employee does not), the Phase 2 unit suite over the extracted aggregation, and a manual two-account walkthrough in Phase 4.

### Key Discoveries:

- `bulk.ts` already sits beside `[id].ts` in `src/pages/api/absences/` and resolves correctly, so a sibling `stats.ts` is an established pattern — Astro prioritises the static segment.
- `bulk.ts` was created by copying `index.ts` verbatim and inherited a missing `is_system` guard that took months and a separate change to close (`src/tests/api/absences/is-system-guard.test.ts:11-22`, `context/foundation/lessons.md`). A second route over the same table must share the query construction, not duplicate it.
- `buildMatrix` and `getAbsenceHours` are module-private inside `AbsenceStats.tsx:17-67` — not exported, so not unit-testable today. `src/lib/medals.ts` ← `src/tests/lib/medals.test.ts` is the repo's pattern for exactly this kind of pure aggregation logic.
- `dashboard.astro:59` holds `currentEmployee` as `Pick<Employee, "id" | "first_name" | "last_name" | "role">`, which does **not** satisfy the `Employee` prop the matrix needs. The full row must come out of `employeesResult`.
- `visibleEmployeesFilter()` (`src/lib/employees.ts`) must appear on the new route's join for the same reason it appears on the existing two: RLS is bypassed on the service-role Drizzle connection, so the `is_system` invariant is app-enforced only.
- `src/tests/api/` holds eleven route-level suites with a `helpers/db.ts` + `helpers/fixtures.ts` harness; `createTestEmployee` seeds `role: "employee"`, and `is-system-guard.test.ts:116` promotes a fixture to moderator with a direct `db.update`.
- The `X-Result-Truncated` header contract exists because every yearly figure is an aggregate over the returned list; a silent cut would skew all of them at once (`api/absences/index.ts:24-27`). The new route must preserve it.

## What We're NOT Doing

- **Not touching the Siatka or Szczegóły tabs.** They stay team-wide. This is a deliberate, acknowledged consequence: a non-moderator can still read the same underlying absence days from the grid. This change removes the *ranked, comparative* presentation, not access to the raw calendar. See "Open Risks & Assumptions" in the brief.
- Not narrowing `GET /api/absences?year=` / `?from=&to=` — the grid and Szczegóły depend on its team-wide behaviour.
- No toggle letting a moderator switch to a self-only view. Role alone decides.
- No anonymised team aggregate (average, team total) in the self view — in a team this size, "total minus mine" is close to identifying.
- No new DB migration, no schema change, no RLS change.
- No E2E test for the role split (would require a second seeded auth state; `tests/e2e/setup/auth.setup.ts` provisions one user today).
- Not touching `HolidayBalanceCard` — the holiday balance stays where it is.

## Implementation Approach

Four phases, server-first so the boundary lands before anything depends on it:

1. **Server.** Extract the year-window + list-query + truncation logic that `index.ts` owns into a shared module, then add `GET /api/absences/stats?year=` on top of it. The new route derives scope from the caller's `role` column — moderator gets the team join, anyone else gets the same join plus `eq(absences.employee_id, callerId)`. Route tests prove both directions.
2. **Pure logic.** Lift `buildMatrix`/`getAbsenceHours` out of the component into `src/lib/absence-stats.ts` and unit-test them. This is what makes the self-scoped aggregation provable rather than eyeballed, and it is a pure move — no behaviour change.
3. **UI.** `dashboard.astro` computes a stats-scoped employee list and monthly absence list; `AbsenceStats` takes an `isModerator` flag and branches on it for the medals, the footer row, the second KPI tile, and the fetch target.
4. **Docs.** Amend the PRD Non-Goal and the roadmap, then verify both roles by hand.

## Critical Implementation Details

**Ordering.** Phase 3 changes the component's fetch target to the Phase 1 route. If Phase 3 lands first the yearly matrix 404s, so the phases must go in order.

**The moderator path must stay byte-identical.** The new endpoint's moderator branch has to reproduce `index.ts`'s existing join exactly — including `visibleEmployeesFilter()` on both arms and the `isNull(employees.deleted_at)` guard that only the non-moderator arm carries. A moderator's yearly matrix currently includes deactivated employees' historical rows; losing them would be a silent regression in the one path nobody is watching during this change.

---

## Phase 1: Scoped Stats Endpoint

### Overview

Add a server-scoped source for the yearly statistics, sharing its query construction with the existing list route so the two cannot drift.

### Changes Required:

#### 1. Shared absence-list query logic

**File**: `src/lib/services/absence-list.ts` (new)

**Intent**: Hold the pieces `GET /api/absences` and the new stats route both need, so the second route is composed from the first rather than copied from it — the failure mode `bulk.ts` already demonstrated in this repo.

**Contract**: Exports the row-selection shape used by both routes, the `LIST_LIMIT` constant (5000), the year-window derivation (`year` → `[YYYY-01-01, YYYY+1-01-01)`), and a join-condition builder taking the caller's role and returning the existing moderator / non-moderator `and(...)` fragment including `visibleEmployeesFilter()`. Pure Drizzle fragments and plain values — no `createDb`, no `Response`, so it stays unit-testable and importable from both routes.

#### 2. Rewire the existing list route onto the shared module

**File**: `src/pages/api/absences/index.ts`

**Intent**: Consume the extracted helpers in `GET` so there is one definition of the join and the cap. Behaviour must be unchanged — this is a refactor, and the existing suites are the guard.

**Contract**: `GET` keeps its current request contract exactly: same query params, same validation errors, same 401/403 bodies, same `X-Result-Truncated` header semantics, same ordering. `POST` is untouched.

#### 3. The scoped stats route

**File**: `src/pages/api/absences/stats.ts` (new)

**Intent**: Serve the yearly dataset the Statystyki tab aggregates over, scoped by the caller's role on the server so the client cannot widen it.

**Contract**: `export const prerender = false;` and `export const GET: APIRoute`. Accepts `year=YYYY` only — no `from`/`to` mode, since statistics are always a calendar year. Resolves the caller's employee row the way `index.ts:59-70` does (401 with `{ error: "Brak autoryzacji." }` when `locals.user` is absent, 403 `"Nie znaleziono rekordu pracownika."` when no row, 503 `"Błąd bazy danych."` on lookup failure). Response body and `X-Result-Truncated` header are identical in shape to `GET /api/absences?year=` so the component's parsing is unchanged.

Scope rule — the whole point of the route:

- `role === "moderator"` → the shared moderator join, unchanged from `index.ts`.
- otherwise → the shared non-moderator join **and** `eq(absences.employee_id, callerEmployeeId)`, where `callerEmployeeId` comes from the row looked up by `locals.user.id`. No request parameter influences this.

Sentry tag `{ route: "GET /api/absences/stats" }` on both catch blocks, matching the convention in the sibling routes.

#### 4. Route integration tests

**File**: `src/tests/api/absences/stats-scope.test.ts` (new)

**Intent**: Pin the access boundary, since it is the only thing in this change that is a boundary rather than a presentation.

**Contract**: Follows `is-system-guard.test.ts` — `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`, `getTestDb()`, `createTestEmployee` / `teardownTestEmployee`, a fixture promoted with `db.update(employees).set({ role: "moderator" })`, and a hand-built `APIContext` carrying `locals.user.id`. Seeds absences for two employees in one year, on dates in a range no other suite in `src/tests/api/absences/` claims. Cases:

- moderator caller → response contains rows for both fixture employees
- employee caller → response contains only own `employee_id`; the other employee's row is absent
- employee caller cannot widen scope — an added `employee_id=<other>` (or equivalent) query param changes nothing
- missing/invalid `year` → 400
- no `locals.user` → 401
- authenticated user with no employee row → 403
- an `is_system` employee's absences are excluded for both roles

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- New route suite passes: `npm run test:run -- src/tests/api/absences/stats-scope.test.ts`
- Pre-existing absence suites still pass after the refactor: `npm run test:run -- src/tests/api/absences`
- Full unit + integration suite passes: `npm run test:run`

#### Manual Verification:

- `GET /api/absences?year=` on the deployed app still returns team-wide rows (the grid and Szczegóły are unaffected by the refactor)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Note that Drizzle queries fail under `wrangler dev` (CLAUDE.md), so route-level manual checks run against the production deployment; the automated suites use `DATABASE_URL_DIRECT`.

---

## Phase 2: Extract the Statistics Aggregation

### Overview

Move the matrix maths out of the React component into `src/lib/` so it can be unit-tested — including the single-employee case this change introduces. Pure move, no behaviour change.

### Changes Required:

#### 1. The aggregation module

**File**: `src/lib/absence-stats.ts` (new)

**Intent**: Own the absence → matrix aggregation independently of rendering, matching how `src/lib/medals.ts` and `src/lib/hours.ts` already sit behind this component.

**Contract**: Exports `getAbsenceHours(absence)` and `buildMatrix(absences, employees, absenceTypes)` returning the existing `MatrixData` shape (`cells`, `perEmployee`, `perType`, `grand`, `maxEmployeeTotal`, `employeesWithAbsence`), plus the `MatrixData` type itself. Logic is lifted verbatim from `AbsenceStats.tsx:17-67`; keep the existing explanatory comment about days-vs-hours conversion, which records a reversal of an S-02 decision. Dependency-light — imports only `@/lib/hours` and types — so it stays importable from both islands and server routes.

#### 2. Component consumes the module

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Delete the now-duplicated local definitions and import them instead.

**Contract**: `buildMatrix`, `getAbsenceHours` and the `MatrixData` interface are removed from the file and imported from `@/lib/absence-stats`. The two `useMemo` call sites are otherwise unchanged. Rendered output is identical.

#### 3. Unit tests

**File**: `src/tests/lib/absence-stats.test.ts` (new)

**Intent**: Cover the aggregation, with the single-employee case explicit — that is the shape the self view will always hand it.

**Contract**: Plain `vitest`, mock row objects, no DB — matching `src/tests/lib/medals.test.ts`. Cases: full-day rows count as 1; partial-day rows convert via hours-to-days; the two mix inside one cell; `perEmployee`/`perType`/`grand` agree with each other; `maxEmployeeTotal` never returns 0 (it is a divisor); an employee with no absences yields 0 rather than `undefined`; a single-employee list produces `perEmployee.length === 1` and `grand === perEmployee[0]`; an empty absence list produces an all-zero matrix.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- New unit suite passes: `npm run test:run -- src/tests/lib/absence-stats.test.ts`
- Full suite passes: `npm run test:run`

#### Manual Verification:

- The Statystyki tab renders exactly as before this phase for a moderator — same numbers, same medals, same totals

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Role-Scoped Statistics View

### Overview

Branch the tab on role: scope the server-rendered monthly data, point the yearly fetch at the new route, and adjust the parts of the view that only make sense across multiple employees.

### Changes Required:

#### 1. Stats-scoped SSR data

**File**: `src/pages/dashboard.astro`

**Intent**: Hand `AbsenceStats` a monthly dataset and employee list already narrowed to what the caller may see, so the self view never receives another employee's rows even as props.

**Contract**: Two new derived values alongside `gridEmployees`, used only by the stats tab:

- `statsEmployees` — for a moderator, `gridEmployees` unchanged; otherwise a single-element array holding the caller's own **full** `Employee` row taken from `employeesResult` (matched on `currentEmployee.id`). `currentEmployee` itself is a `Pick<...>` and does not satisfy the `Employee` prop type. If the row is somehow absent from `employeesResult`, fall back to an empty array — the component already renders an empty matrix without error.
- `statsAbsences` — for a moderator, `absences` unchanged; otherwise `absences` filtered to `employee_id === currentEmployee.id`.

`<AbsenceStats>` is passed `employees={statsEmployees}`, `monthlyAbsences={statsAbsences}` and a new `isModerator={currentEmployee.role === "moderator"}`. `AbsenceGrid` and `AbsenceDetailsSubcards` keep receiving `gridEmployees` / `absences` untouched.

#### 2. The role branch in the component

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Render the moderator's team view unchanged, and a self view that drops every element whose meaning depends on there being other employees in it.

**Contract**: New required prop `isModerator: boolean` on `AbsenceStatsProps`. Behaviour keyed off it:

- **Fetch target** — both roles now fetch `/api/absences/stats?year=${year}` instead of `/api/absences?year=${year}`. Response parsing, the `AbortController`, the error path and the `X-Result-Truncated` handling are unchanged.
- **Second KPI tile** — moderator keeps "Pracownicy z nieobecnością — N / M". Otherwise the tile becomes label "Dni nieobecności", value `cellText(yearlyData.grand)`, note `Rok ${year}`. Because it depends on the yearly fetch, it must render a placeholder (`—`) while `loading` is true and the existing error string when the fetch failed — the month tile beside it stays instant either way.
- **Medals** — `showMedals` is passed to the yearly `StatsMatrixCard` only when `isModerator`. The yearly card's `subtitle` drops the "🥇🥈🥉 najwięcej dni w kolumnie" clause in the self view; "narastająco od stycznia" stays.
- **Grand-total footer row** — `StatsMatrixCard` gains a flag to omit its bottom `Łącznie` band, set in the self view where that row is a verbatim copy of the single data row above it. The per-row `Łącznie` column stays in both views.
- **Titles** — self view reads "Moje statystyki miesięczne – {month}" and "Moje statystyki roczne – Rok {year}"; moderator titles are unchanged.

The truncation banner, `TypeBreakdown`, and the per-row stacked bar are unchanged in both views — with one row the bar is simply full-width, which is correct.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Full suite passes: `npm run test:run`

#### Manual Verification:

- Signed in as a **moderator**: the Statystyki tab is visually identical to before this change — all employees listed, medals present on the yearly matrix, "Pracownicy z nieobecnością" tile intact, grand-total footer present
- Signed in as a **non-moderator**: exactly one row (own name) in both matrices, no medals, no footer total, second tile reads own year-to-date days
- As a non-moderator, the devtools network tab shows `/api/absences/stats?year=` returning only own `employee_id` rows
- As a non-moderator, the Siatka and Szczegóły tabs still show the whole team (unchanged by design)
- Month navigation from the Statystyki tab preserves `?tab=stats` and both roles keep their correct view after navigating
- Yearly loading and error states render sensibly in the self view (the KPI tile shows a placeholder, not `NaN` or `0`, while loading)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Foundation Documents

### Overview

The PRD and roadmap currently state that this feature will not be built. Leave them and the next planning session argues against work already shipped — both files are re-read at the start of every 10x skill.

### Changes Required:

#### 1. PRD Non-Goal → access-control rule

**File**: `context/foundation/prd.md`

**Intent**: Remove the contradiction and record the rule in the section that owns it.

**Contract**: Delete the Non-Goals bullet *"No separate statistics visibility rules for employees and moderators; statistics are general for everyone."* (`prd.md:135`) and add a bullet to **§Access Control** stating, in the section's Polish: a moderator sees the statistics of all employees; a non-moderator sees only their own statistics. Note there that the monthly grid and details table remain team-wide — otherwise the new bullet reads as a blanket privacy rule the app does not implement.

#### 2. Roadmap — un-park and record the slice

**File**: `context/foundation/roadmap.md`

**Intent**: Move the item from Parked into the delivered work, and give it a slice id consistent with the table.

**Contract**: Remove the Parked bullet *"Osobne reguły widoczności statystyk dla pracownika i moderatora"* (`roadmap.md:438`). Add row **S-23 / `statistics-for-moderators`** to the slice table with outcome "(moderator) zobaczyć statystyki wszystkich pracowników; pracownik widzi wyłącznie własne statystyki", prerequisites `S-02`, PRD refs `FR-005, FR-006`, status `planned`. Highest existing id is S-22, so S-23 is next.

#### 3. Change record

**File**: `context/changes/statistics-for-moderators/change.md`

**Intent**: Reflect that the change is planned.

**Contract**: `status: planned`, `updated: 2026-08-21`.

### Success Criteria:

#### Automated Verification:

- Prettier is clean on the edited markdown: `npx prettier --check context/foundation/prd.md context/foundation/roadmap.md context/changes/statistics-for-moderators/change.md`
- No stale reference remains: `grep -rn "statystyk są ogólne\|statistics are general for everyone" context/foundation/` returns nothing

#### Manual Verification:

- Reading `prd.md` §Access Control end to end, the statistics rule and the team-wide grid rule do not contradict each other
- The roadmap Parked list no longer mentions statistics visibility, and S-23 appears in the slice table

---

## Testing Strategy

### Unit Tests:

- `src/tests/lib/absence-stats.test.ts` — the extracted aggregation, with the single-employee and empty-list cases explicit, plus the full-day / partial-day mix and the `maxEmployeeTotal` divisor guard.

### Integration Tests:

- `src/tests/api/absences/stats-scope.test.ts` — the access boundary on the new route: moderator sees other employees' rows, employee sees only their own, no client parameter widens scope, `is_system` rows excluded for both, and the 400/401/403 paths.
- The existing eleven suites under `src/tests/api/` act as the regression guard for the Phase 1 refactor of `index.ts`; they must pass unchanged.

### Manual Testing Steps:

1. Sign in as a moderator, open `?tab=stats`, and compare against a screenshot taken before the change — employees, medals, both KPI tiles and the footer total must match.
2. Sign in as a non-moderator: confirm one row in both matrices, no medals, no footer total, and the year-to-date tile.
3. With devtools open as the non-moderator, confirm `/api/absences/stats?year=` returns only own rows.
4. As the non-moderator, replay that request with an added `employee_id` of a colleague and confirm the response is unchanged.
5. Confirm the Siatka and Szczegóły tabs still show the whole team for the non-moderator.
6. Navigate months from within the Statystyki tab and confirm the tab and the role-correct view both persist.
7. Throttle the network and confirm the year-to-date tile shows a placeholder rather than a wrong number while the yearly fetch is in flight.

## Performance Considerations

The self view queries and aggregates strictly less data than today — one employee's rows instead of the team's. The moderator path is unchanged in cost. The `useMemo` wrappers around both `buildMatrix` calls stay as they are.

The Phase 1 extraction adds one module hop and no queries. `LIST_LIMIT` (5000) and the probe-one-past-the-cap technique carry over verbatim; a single employee will not approach that cap, but the truncation banner stays wired because the moderator path can.

## Migration Notes

None. No schema change, no migration, no data backfill. Rollback is a redeploy of the previous Worker version (CLAUDE.md §Rollback) — nothing persisted changes shape, so reverting restores the prior behaviour with no cleanup.

## References

- Prior slice this extends: `context/archive/2026-05-30-details-and-stats/plan-brief.md` (lists "moderator-only stats views" as out of scope)
- Route-test pattern: `src/tests/api/absences/is-system-guard.test.ts`
- Pure-logic-module pattern: `src/lib/medals.ts` ← `src/tests/lib/medals.test.ts`
- Copy-a-route drift precedent: `context/foundation/lessons.md`, "Repo-wide claims are load-bearing"
- Visibility invariant: `src/lib/employees.ts` (`visibleEmployeesFilter`, `isProtectedAdmin`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scoped Stats Endpoint

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 4c26b77
- [x] 1.2 Linting passes: `npm run lint` — 4c26b77
- [x] 1.3 New route suite passes: `npm run test:run -- src/tests/api/absences/stats-scope.test.ts` — 4c26b77
- [x] 1.4 Pre-existing absence suites still pass after the refactor: `npm run test:run -- src/tests/api/absences` — 4c26b77
- [x] 1.5 Full unit + integration suite passes: `npm run test:run` — 4c26b77

#### Manual

- [ ] 1.6 `GET /api/absences?year=` still returns team-wide rows (grid and Szczegóły unaffected)

### Phase 2: Extract the Statistics Aggregation

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — e377daf
- [x] 2.2 Linting passes: `npm run lint` — e377daf
- [x] 2.3 New unit suite passes: `npm run test:run -- src/tests/lib/absence-stats.test.ts` — e377daf
- [x] 2.4 Full suite passes: `npm run test:run` — e377daf

#### Manual

- [ ] 2.5 Statystyki tab renders exactly as before for a moderator — same numbers, medals, totals

### Phase 3: Role-Scoped Statistics View

#### Automated

- [x] 3.1 Type checking passes: `npm run build` — 16d841c
- [x] 3.2 Linting passes: `npm run lint` — 16d841c
- [x] 3.3 Full suite passes: `npm run test:run` — 16d841c

#### Manual

- [ ] 3.4 Moderator view visually identical to before the change
- [ ] 3.5 Non-moderator sees one row, no medals, no footer total, own year-to-date tile
- [ ] 3.6 `/api/absences/stats?year=` returns only own rows for a non-moderator
- [ ] 3.7 Siatka and Szczegóły still show the whole team for a non-moderator
- [ ] 3.8 Month navigation preserves `?tab=stats` and the role-correct view
- [ ] 3.9 Yearly loading and error states render sensibly in the self view

### Phase 4: Foundation Documents

#### Automated

- [x] 4.1 Prettier clean on the edited markdown — d89f325
- [x] 4.2 No stale "statistics are general for everyone" reference remains in `context/foundation/` — d89f325

#### Manual

- [ ] 4.3 `prd.md` §Access Control reads consistently — statistics rule does not contradict the team-wide grid
- [ ] 4.4 Roadmap Parked list no longer mentions statistics visibility; S-23 appears in the slice table
