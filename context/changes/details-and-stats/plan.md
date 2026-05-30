# Details Table & Statistics — Implementation Plan

## Overview

Implement S-02: add two tabs to the dashboard (Szczegóły and Statystyki) alongside the existing Siatka (Grid) tab. The Details tab shows a sortable monthly table of all absences (type, employee, substitute, hours, comment, date added). The Statistics tab shows a per-employee × per-type summary for the current month and for the full year.

## Current State Analysis

- `monthly-grid-own-absence` (S-01) is fully implemented: `/dashboard` renders `AbsenceGrid` with SSR data
- `dashboard.astro` fetches employees, monthly absences, and absence types via `Promise.all`; passes them as props to `<AbsenceGrid client:load />`
- The monthly absences SELECT (`dashboard.astro:55`) omits `created_at` — required by FR-006
- Month navigation (prev/next buttons) lives inside `AbsenceGrid.tsx:62–84` — must be extracted to appear on all tabs
- `src/pages/api/absences/index.ts` has a POST handler; no GET handler exists yet
- RLS: `20260529000001_fix_absences_select_rls.sql` grants SELECT on `absences` to all authenticated users — team-wide visibility already enforced at the DB level
- `AbsenceType.color` is available in the existing `absenceTypes` prop — no new types needed for the badge in the details table

## Desired End State

A logged-in employee opens `/dashboard`. Three tabs appear below the Topbar: Siatka (default), Szczegóły, Statystyki. Switching tabs preserves the selected month (`?month=` param) and updates `?tab=`. The month navigation (prev/next) appears above the tabs and always preserves the active tab.

**Szczegóły tab** — a sortable table listing every absence for the selected month across all employees. Columns: Data, Typ (colored badge), Pracownik, Zastępca, Godziny, Komentarz, Dodano. Default sort: by date ascending. Clicking any column header toggles sort direction.

**Statystyki tab** — a per-employee × per-type matrix. Each cell shows "N dni" (count of full-day entries) and/or "N godz." (sum of partial hours) for that combination. Two sections: Miesięczne (from already-loaded data) and Roczne (fetched lazily client-side). A Total row and Total column summarize across employees and types.

Verified by: PRD US-01 step "wpis jest widoczny w siatce, tabeli szczegółów i statystykach" — all three views reflect the same absence.

### Key Discoveries

- `dashboard.astro:55` — absences query must add `created_at` to the SELECT; without it, the Details column "Dodano" is undefined
- `AbsenceGrid.tsx:5–14` — `prevMonthUrl` and `nextMonthUrl` props exist purely to drive the month nav; removing them from AbsenceGrid cleans up the interface
- `AbsenceGrid.tsx:62–84` — month nav render block; extract verbatim to `MonthNav.astro`
- `20260529000001_fix_absences_select_rls.sql:7–9` — SELECT policy already allows any authenticated user to read all absences; yearly GET endpoint inherits this automatically
- `src/pages/api/absences/index.ts` — existing POST handler is the pattern; GET handler is added alongside it

## What We're NOT Doing

- No new DB migrations (RLS is already correct, schema is complete)
- No filtering UI in the details table (sort only per the decision above)
- No push notifications or real-time updates (page reload on absence save is unchanged)
- No moderator-specific view differences in stats (PRD: "no separate statistics visibility rules")
- No print/export of the details table or statistics
- No pagination of the details table (max ~310 rows / month for a 10-person team)

## Implementation Approach

Four sequential phases following the dependency order: (1) data layer — add the GET endpoint and fix the `created_at` select so subsequent phases have correct data; (2) navigation refactor — extract month nav and wire tab switching before any new tab content exists; (3) details table — new React component wired under the Szczegóły tab; (4) statistics — new React component with lazy yearly fetch wired under the Statystyki tab.

Tab state is stored in `?tab=grid|details|stats` URL param (default: grid when absent). Every navigation URL (month nav and tab nav links) preserves both params together: `?month=YYYY-MM&tab=<current>`.

## Critical Implementation Details

**`created_at` in the absences select** — the current SSR query uses an explicit column list that omits `created_at`. It must be added to both the monthly absences query in `dashboard.astro` and the GET endpoint response. Without it, the Details "Dodano" column silently shows `undefined`.

**Yearly fetch from `AbsenceStats`** — the component fetches `/api/absences?year={year}` on mount via `useEffect`. The auth cookie is sent automatically with the `fetch` call (same-origin, cookies included by default). No special headers needed; the server-side middleware resolves `context.locals.user` from the cookie.

**Tab URL construction** — both the month nav and the tab nav must embed both `?month=` and `?tab=` in every link. Omitting either causes the other to reset to its default. Compute all six URLs in the `dashboard.astro` frontmatter before rendering.

---

## Phase 1: Data Layer

### Overview

Add a GET handler to the existing absences API route for the yearly fetch, and fix the monthly absences SSR query to include `created_at`.

### Changes Required

#### 1. Add `created_at` to the monthly absences select

**File**: `src/pages/dashboard.astro`

**Intent**: The existing absences query omits `created_at`, which the Details table's "Dodano" column requires (FR-006). Add it to the column list.

**Contract**: Change the `.select(...)` call for absences from listing specific columns (without `created_at`) to include `created_at` at the end of the list. The `Absence` TypeScript interface already declares `created_at: string`, so no type change is needed.

#### 2. Add GET /api/absences handler

**File**: `src/pages/api/absences/index.ts`

**Intent**: The Statistics component needs all absences for a full calendar year, fetched lazily client-side. Add a `GET: APIRoute` export to the existing file alongside the POST handler.

**Contract**:
- Export `GET: APIRoute` in the same file as the existing `POST`
- Auth guard: `context.locals.user` → 401 JSON if null
- Required query param: `year` — validate with Zod as `z.string().regex(/^\d{4}$/)` → 400 JSON `{ error: "year param required (YYYY)" }` if missing or malformed
- Date range: `from = "${year}-01-01"`, `to = "${year}-12-31"` (inclusive upper bound, use `.lte("date", to)` not `.lt`)
- Select: `id, employee_id, absence_type_id, date, is_full_day, hours, comment, substitute_employee_id, created_at`
- Return: `Response(JSON.stringify(data ?? []), { status: 200, headers: { "Content-Type": "application/json" } })`
- On Supabase error: `Response(JSON.stringify({ error: error.message }), { status: 500, ... })`

### Success Criteria

#### Automated Verification

- `npm run build` passes with no TypeScript errors
- `npm run lint` passes

#### Manual Verification

- `GET /api/absences?year=2026` (authenticated) returns JSON array; each item includes `created_at`
- `GET /api/absences` (no year param) returns 400 with `{ error: "year param required (YYYY)" }`
- `GET /api/absences?year=2026` (unauthenticated) returns 401

---

## Phase 2: Navigation Refactor & Tab Wiring

### Overview

Extract the month navigation from `AbsenceGrid` into a new `MonthNav.astro` component, add tab navigation to `dashboard.astro`, and wire the conditional rendering for all three tabs. The Details and Statistics tabs are placeholders in this phase — actual components are added in Phases 3 and 4.

### Changes Required

#### 1. Create MonthNav.astro

**File**: `src/components/MonthNav.astro`

**Intent**: A reusable Astro component that renders the prev-month link, current month label, and next-month link. Decouples month navigation from the React grid so it appears identically on all three tabs.

**Contract**: Accept props `{ prevMonthUrl: string; nextMonthUrl: string; year: number; month: number }`. Render two anchor tags (not buttons) styled to match the current grid nav, with the Polish-locale month label computed server-side via `new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(year, month - 1))`. The label is `capitalize`d (first letter uppercase) to match the existing grid behavior.

#### 2. Remove month nav from AbsenceGrid.tsx

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: The month nav is now owned by `MonthNav.astro`; AbsenceGrid no longer needs `prevMonthUrl` / `nextMonthUrl` props or the nav render block.

**Contract**: Remove `prevMonthUrl` and `nextMonthUrl` from the `AbsenceGridProps` interface and the destructured function parameters. Remove the `<div className="mb-4 flex items-center gap-4">` block (lines 62–84) from the JSX. The outer `<div className="p-4">` stays; its first child becomes `<div className="overflow-x-auto ...">`.

#### 3. Add tab navigation and conditional rendering to dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Read `?tab=` param, compute all navigation URLs, render MonthNav + tab nav links, and conditionally render the correct island based on the active tab.

**Contract**:

The frontmatter additions (after the existing month-param parsing):
```ts
const tabParam = Astro.url.searchParams.get("tab");
const currentTab = tabParam === "details" || tabParam === "stats" ? tabParam : "grid";

// Month nav URLs now embed the active tab
const prevMonthUrl = `?month=${prevMonthDate}&tab=${currentTab}`;
const nextMonthUrl = `?month=${nextMonthDate}&tab=${currentTab}`;

// Tab nav URLs embed the current month
const monthStr = `${year}-${String(month).padStart(2, "0")}`;
const gridTabUrl    = `?month=${monthStr}&tab=grid`;
const detailsTabUrl = `?month=${monthStr}&tab=details`;
const statsTabUrl   = `?month=${monthStr}&tab=stats`;
```

The template (after Topbar, before conditional content) renders:
1. `<MonthNav>` — with the updated URLs that include tab param
2. A tab nav bar — three `<a>` elements for Grid / Szczegóły / Statystyki; the active tab gets a distinct style (e.g., `border-b-2 border-blue-600 font-semibold`)
3. Conditional content based on `currentTab`:
   - `grid` → `<AbsenceGrid client:load ... />` (remove `prevMonthUrl` and `nextMonthUrl` props here)
   - `details` → placeholder `<p>Szczegóły — wkrótce</p>` (replaced in Phase 3)
   - `stats` → placeholder `<p>Statystyki — wkrótce</p>` (replaced in Phase 4)

Remove `prevMonthUrl` and `nextMonthUrl` props from the `<AbsenceGrid>` usage in the template (they no longer exist in the component interface).

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- `/dashboard` (no tab param) shows the grid with month nav; tabs are visible
- Clicking "Szczegóły" tab navigates to `?tab=details` and shows the placeholder
- Clicking "Statystyki" tab navigates to `?tab=stats` and shows the placeholder
- Month prev/next navigation on the Szczegóły tab preserves `?tab=details` in the URL
- Refreshing any tab URL stays on that tab

---

## Phase 3: Absence Details Table

### Overview

Build `AbsenceDetailsTable.tsx` — a client React component that renders the monthly absences as a sortable table, and wire it into the Szczegóły tab replacing the placeholder.

### Changes Required

#### 1. Create AbsenceDetailsTable component

**File**: `src/components/absence/AbsenceDetailsTable.tsx`

**Intent**: Render the monthly absence list as a sortable table per FR-006. Columns: Data, Typ, Pracownik, Zastępca, Godziny, Komentarz, Dodano. Sorting is client-side only (data already loaded from SSR props).

**Contract**:

Props interface:
```ts
interface AbsenceDetailsTableProps {
  absences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
}
```

Sort state: `useState<{ column: SortColumn; direction: "asc" | "desc" }>({ column: "date", direction: "asc" })` where `SortColumn = "date" | "employee" | "type" | "created_at"`.

Sorted rows: `useMemo` that derives a sorted copy of `absences` based on sort state. Do not mutate the prop array.

Helper functions (module-level, not components):
- `resolveEmployee(id: string | null, employees: Employee[]): Employee | undefined` — finds by `id`
- `formatDate(isoDate: string): string` — converts `"YYYY-MM-DD"` to `"DD.MM.YYYY"` (split on `-`, reverse, join with `.`)
- `formatHours(absence: Absence): string` — returns `"Cały dzień"` when `is_full_day`, else `"${absence.hours} godz."`

Column header render: a `<button type="button">` that calls the sort toggle; shows ↑ / ↓ indicator on the active column (chevron or arrow character); inactive columns show no indicator (or neutral ↕).

Substitute column: `resolveEmployee(absence.substitute_employee_id, employees)?.first_name + " " + last_name`, or `"—"` if null.

Typ column: a small colored square `<span>` using `absenceType.color` as `backgroundColor`, followed by the type name.

No loading state needed — data comes from SSR props.

#### 2. Wire AbsenceDetailsTable into dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the `details` tab placeholder with the actual component.

**Contract**: Import `AbsenceDetailsTable` from `@/components/absence/AbsenceDetailsTable`. In the `details` tab branch, render `<AbsenceDetailsTable client:load absences={absences} employees={employees} absenceTypes={absenceTypes} />`.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Szczegóły tab shows a table with one row per absence entry for the month
- Default sort is by date ascending
- Clicking "Data" header toggles between ascending and descending sort
- Clicking "Pracownik" header sorts rows alphabetically by last name
- Typ column shows the colored square and type name
- Zastępca column shows the substitute's full name, or "—" when absent
- Godziny column shows "Cały dzień" for full-day entries and "N godz." for partial entries
- Dodano column shows the formatted creation date (not time)
- Switching to the Grid tab and adding an absence, then returning to Szczegóły, shows the new row

---

## Phase 4: Statistics

### Overview

Build `AbsenceStats.tsx` — a client React component that renders per-employee × per-type statistics for both the current month (from SSR props) and the full year (fetched lazily on mount via GET /api/absences). Wire it into the Statystyki tab.

### Changes Required

#### 1. Create AbsenceStats component

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Show two stats tables (monthly and yearly), each with employees as rows and absence types as columns. Each cell shows "N dni / N godz." for that (employee, type) combination. A Total row and Total column summarize across dimensions.

**Contract**:

Props interface:
```ts
interface AbsenceStatsProps {
  monthlyAbsences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  year: number;
  month: number;
}
```

State: `{ yearlyAbsences: Absence[] | null; loading: boolean; error: string | null }` — initial: `{ null, true, null }`.

Yearly fetch on mount:
```ts
useEffect(() => {
  fetch(`/api/absences?year=${year}`)
    .then((r) => r.ok ? r.json() : r.json().then((b: { error: string }) => Promise.reject(b.error)))
    .then((data: Absence[]) => setYearlyAbsences(data))
    .catch((msg: string) => setError(msg ?? "Błąd ładowania statystyk rocznych"))
    .finally(() => setLoading(false));
}, [year]);
```

Aggregation helper (module-level):
```ts
type StatsMatrix = Map<string, { days: number; hours: number }>; // key: `${employeeId}_${typeId}`
function buildMatrix(absences: Absence[]): StatsMatrix { ... }
```

For each absence: if `is_full_day`, increment `days` by 1; else increment `hours` by `absence.hours ?? 0`.

Cell render helper: given `{ days, hours }`, returns `"N dni"` (days > 0) + `" / N godz."` (hours > 0), or `"—"` if both zero.

Table structure (rendered twice — monthly then yearly):
- `<thead>` with `<th>` per absence type + "Łącznie" (Total) column
- One `<tbody>` row per employee: employee full name | per-type cell | total-across-types cell
- Footer `<tfoot>` "Łącznie" row: total per type | grand total

Monthly section title: `"Statystyki miesięczne — <Polish month> <year>"` (same `Intl.DateTimeFormat` pattern as `MonthNav.astro`).
Yearly section title: `"Statystyki roczne — <year>"`.

Yearly section while loading: `<p>Ładowanie statystyk rocznych…</p>` (no spinner component needed — plain text).
Yearly section on error: `<p className="text-red-600">{error}</p>`.

Absence type column headers: colored square + type name (same pattern as details table).

#### 2. Wire AbsenceStats into dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the `stats` tab placeholder with the actual component.

**Contract**: Import `AbsenceStats` from `@/components/absence/AbsenceStats`. In the `stats` tab branch, render `<AbsenceStats client:load monthlyAbsences={absences} employees={employees} absenceTypes={absenceTypes} year={year} month={month} />`.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Statystyki tab shows monthly stats table immediately (no loading state — data from SSR)
- Yearly stats section shows "Ładowanie…" briefly, then renders the table
- Monthly stats: a row per active employee, a column per absence type, "Łącznie" column and row
- Cells for employees with no absences of a type show "—"
- Cells with full-day absences show "N dni"; partial-day absences show "N godz."; both mixed show "N dni / N godz."
- Yearly totals match the sum of monthly totals when viewed in the month that contains all test data
- Error state: disconnecting network mid-load shows the error message (manual only)
- Adding an absence, then viewing stats, reflects the new entry in monthly totals without requiring a page reload (because the stats tab triggers a fresh SSR load when navigated to)

---

## Testing Strategy

### Manual Testing Steps

1. `npx supabase start` (local DB running)
2. `npm run build && npm run dev`
3. Sign in as a test employee
4. Open `/dashboard` — confirm Grid tab is active, month nav present
5. Click "Szczegóły" tab — confirm URL changes to `?tab=details`, month is preserved
6. Verify details table rows match absences visible in the grid
7. Sort by each column — confirm order changes correctly
8. Click "Statystyki" tab — confirm monthly stats render immediately, yearly stats load
9. Verify a known absence appears in both monthly and yearly counts correctly
10. Use month nav on the Szczegóły tab — confirm `?tab=details` is preserved in new URL
11. Refresh on `?tab=stats` — confirm stats tab is active after reload
12. Add a new absence (switch to Grid tab, add absence, return to Details) — confirm new row appears

### Automated Verification

- `npm run build` — TypeScript compilation gate across all phases
- `npm run lint` — ESLint + Prettier gate

## Performance Considerations

Monthly data (≤310 rows) is SSR-loaded and available instantly. The yearly fetch adds a single client-side request; for 10 employees × 365 days, the worst case is ~3 650 rows — well within Supabase's default response budget. Stats aggregation is pure in-memory iteration (O(n)) with negligible cost for this scale.

The `useMemo` in `AbsenceDetailsTable` ensures sort operations don't re-run on unrelated re-renders.

## Migration Notes

No new migrations. The RLS fix (`20260529000001_fix_absences_select_rls.sql`) already grants SELECT to all authenticated users, which is required for team-wide details and stats.

## References

- PRD: `context/foundation/prd.md` — FR-005, FR-006, US-01 acceptance criteria
- Roadmap: `context/foundation/roadmap.md` — S-02
- S-01 plan (patterns): `context/changes/monthly-grid-own-absence/plan.md`
- Schema: `supabase/migrations/20260526000001_schema.sql`
- RLS fix: `supabase/migrations/20260529000001_fix_absences_select_rls.sql`
- Types: `src/types.ts`
- Existing API route: `src/pages/api/absences/index.ts`
- Existing grid: `src/components/absence/AbsenceGrid.tsx`
- Dashboard: `src/pages/dashboard.astro`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Layer

#### Automated

- [x] 1.1 `npm run build` passes — 692d0fc
- [x] 1.2 `npm run lint` passes — 692d0fc

#### Manual

- [x] 1.3 GET /api/absences?year=2026 (authenticated) returns JSON array with `created_at` — 692d0fc
- [x] 1.4 GET /api/absences (no year param) returns 400 — 692d0fc
- [x] 1.5 GET /api/absences?year=2026 (unauthenticated) returns 401 — 692d0fc

### Phase 2: Navigation Refactor & Tab Wiring

#### Automated

- [x] 2.1 `npm run build` passes — 8dedf4b
- [x] 2.2 `npm run lint` passes — 8dedf4b

#### Manual

- [x] 2.3 `/dashboard` shows grid with month nav and tab nav visible — 8dedf4b
- [x] 2.4 Clicking "Szczegóły" tab navigates to `?tab=details` — 8dedf4b
- [x] 2.5 Clicking "Statystyki" tab navigates to `?tab=stats` — 8dedf4b
- [x] 2.6 Month prev/next on Szczegóły tab preserves `?tab=details` — 8dedf4b
- [x] 2.7 Refreshing `?tab=stats` stays on stats tab — 8dedf4b

### Phase 3: Absence Details Table

#### Automated

- [x] 3.1 `npm run build` passes — f5a6182
- [x] 3.2 `npm run lint` passes — f5a6182

#### Manual

- [x] 3.3 Details table shows one row per absence for the month — f5a6182
- [x] 3.4 Default sort is by date ascending — f5a6182
- [x] 3.5 Column header clicks toggle sort direction — f5a6182
- [x] 3.6 Typ column shows colored square + name — f5a6182
- [x] 3.7 Zastępca column shows substitute name or "—" — f5a6182
- [x] 3.8 Godziny column shows "Cały dzień" or "N godz." — f5a6182
- [x] 3.9 New absence added via Grid tab appears in Details table on return — f5a6182

### Phase 4: Statistics

#### Automated

- [x] 4.1 `npm run build` passes — 3bf503b
- [x] 4.2 `npm run lint` passes — 3bf503b

#### Manual

- [x] 4.3 Monthly stats table renders immediately (no loading) — 3bf503b
- [x] 4.4 Yearly stats section shows loading state then table — 3bf503b
- [x] 4.5 Cells show "N dni", "N godz.", "N dni / N godz.", or "—" correctly — 3bf503b
- [x] 4.6 Total row and column are correct — 3bf503b
- [x] 4.7 Yearly totals match monthly totals for a month with all test data — 3bf503b
- [x] 4.8 Stats reflect new absences when navigating to the tab after adding one — 3bf503b
