# Details Subcards Implementation Plan

## Overview

Add three subcards — **Dzisiaj** (Today), **Miesięcznie** (Monthly), **Rocznie** (Yearly) — inside the existing Details tab. The Today subcard contains three temporal sections: today's absences, this week (Mon–Fri), and next week (Mon–Fri). Subcard switching is instant (no page reload); the active subcard is persisted in the URL (`?subcard=`) so it survives refresh and back-navigation.

## Current State Analysis

The Details tab (`?tab=details`) renders a single `AbsenceDetailsTable` React island with all monthly absences passed as SSR props. There is no subcard structure. The component is a pure display leaf: sortable rows, no data fetching of its own.

The existing `GET /api/absences` endpoint supports only `?year=YYYY`. It needs a second mode: `?from=YYYY-MM-DD&to=YYYY-MM-DD` to serve the 2-week window for the Today subcard. The Stats tab (`AbsenceStats`) demonstrates the lazy-fetch + `AbortController` pattern used for Yearly.

### Key Discoveries

- `src/pages/dashboard.astro:21-22` — `currentTab` parsed from `?tab=`; `?subcard=` follows the same pattern
- `src/pages/dashboard.astro:103-114` — all navigation URLs computed in frontmatter; month-nav and tab-nav URLs need subcard appended
- `src/pages/api/absences/index.ts` — GET handler currently validates only `?year=YYYY`; needs a second validation branch for `?from=&to=`
- `src/components/absence/AbsenceDetailsTable.tsx` — pure display component; kept unchanged, used as the leaf renderer for all three subcards
- `src/components/absence/AbsenceStats.tsx:135-155` — AbortController lazy-fetch pattern to copy for Yearly

## Desired End State

Opening the Details tab shows three subcard tabs: Dzisiaj, Miesięcznie, Rocznie. Dzisiaj is active by default. Switching subcards is instant (no page reload); the URL updates silently via `history.pushState`; F5 restores the same subcard.

The Today subcard independently fetches the 2-week window (Mon–Fri current + Mon–Fri next week) from `GET /api/absences?from=...&to=...` on first activation, then renders three sections: today's rows, this week's rows, next week's rows. Monthly uses the SSR-loaded data (instant). Yearly loads lazily on first activation via `GET /api/absences?year=YYYY`. `AbsenceDetailsTable` is the leaf renderer for all sections and subcards.

### Verification

- `?tab=details` (no subcard param) → Today subcard active, 2-week fetch fires
- `?tab=details&subcard=monthly` → Monthly subcard active, URL preserved on F5
- `?tab=details&subcard=yearly` → Yearly subcard active, year data loads from API
- Today subcard: rows under "Dzisiaj" are only today's date; rows under "Ten tydzień" span Mon–Fri of current week; "Następny tydzień" spans Mon–Fri of next week
- Month nav (prev/next) from Details → subcard param preserved in resulting URL
- Switching away from Today and back → no second 2-week fetch

## What We're NOT Doing

- No changes to `AbsenceDetailsTable`, `AbsenceStats`, or any other existing component
- No new API route — only extending the existing `GET /api/absences` handler
- No schema or migration changes
- No subcard structure on the Stats tab
- Today subcard data is always about the **real current date** (not the viewed month) — the viewed month only affects Monthly and Yearly

## Implementation Approach

Three phases in dependency order:

1. **Extend the API** — add `?from=YYYY-MM-DD&to=YYYY-MM-DD` mode to `GET /api/absences`
2. **Wire `dashboard.astro`** — parse `?subcard=`, update nav URLs, swap the island import
3. **Build `AbsenceDetailsSubcards.tsx`** — wrapper with three subcards, 2-week fetch for Today, lazy fetch for Yearly

## Critical Implementation Details

**URL sync without page reload:** Use `history.pushState` inside the subcard toggle handler. Build the URL by reading `window.location.search` and replacing only the `subcard` param via `URLSearchParams` — do not hardcode the full URL to avoid dropping `month` or `tab` params.

**Today fetch trigger:** The 2-week fetch for Today fires on first activation of the Today subcard (use a `useRef` "ever-fetched" guard identical to Yearly). Cancel with `AbortController` on unmount. Since this is the *default* subcard, the fetch will fire on component mount in the typical case — that is expected and correct.

**Week date computation:** Derive Monday of the current week using `getDay()` (0=Sunday, 1=Monday…6=Saturday). Sunday needs special handling: `daysFromMonday = (today.getDay() + 6) % 7`. Monday of this week = today − `daysFromMonday`; Friday of this week = Monday + 4; Monday of next week = Monday + 7; Friday of next week = Monday + 11. Construct ISO strings (`YYYY-MM-DD`) from these Date objects for the API call and for client-side filtering.

**API date range convention (half-open):** The GET handler uses a half-open interval consistent with the existing date filter: `.gte("date", from).lt("date", dayAfterTo)` where `dayAfterTo` is `to + 1 day`. The client passes the last inclusive date as `to`; the handler converts internally.

---

## Phase 1: Extend GET /api/absences with date-range mode

### Overview

Add a second validation branch to `GET /api/absences` that accepts `?from=YYYY-MM-DD&to=YYYY-MM-DD` and returns absences within that date range. The existing `?year=YYYY` branch is unchanged.

### Changes Required

#### 1. GET handler — second validation branch

**File:** `src/pages/api/absences/index.ts`

**Intent:** Support `?from=&to=` as an alternative to `?year=`. When `from` and `to` are present, validate their format and execute a half-open date range query. The auth guard and employee-record gate remain unchanged and apply to both modes.

**Contract:** New Zod schema for date-range mode — `from` and `to` as `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. Parse `year` first; if absent, parse `from`/`to`. If neither is valid, return 400. Date range query: `.gte("date", from).lt("date", dayAfterTo)` where `dayAfterTo` is computed by adding one day to the parsed `to` date. The `select` clause mirrors the existing year-mode query (same fields). Return the same `Absence[]` JSON shape.

### Success Criteria

#### Automated Verification

- TypeScript compile passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- `GET /api/absences?from=2026-06-01&to=2026-06-07` returns absences with dates in that range (test via browser or curl)
- `GET /api/absences?year=2026` still works unchanged
- `GET /api/absences` (no params) returns 400
- `GET /api/absences?from=2026-06-01` (missing `to`) returns 400
- Unauthenticated request returns 401

**Implementation Note:** After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: dashboard.astro — subcard param + navigation wiring

### Overview

Parse the new `?subcard=` URL param, update all computed navigation URLs to carry it, and swap the details island from `AbsenceDetailsTable` → `AbsenceDetailsSubcards`.

### Changes Required

#### 1. Subcard param parsing

**File:** `src/pages/dashboard.astro`

**Intent:** Parse `?subcard=today|monthly|yearly` immediately after `currentTab`. Mirrors the existing `tabParam` / `currentTab` pattern on lines 21-22.

**Contract:** New `const currentSubcard` of type `"today" | "monthly" | "yearly"`, defaulting to `"today"`. Any unrecognised value or absence → `"today"`.

#### 2. Navigation URL updates

**File:** `src/pages/dashboard.astro`

**Intent:** Month nav URLs preserve the active subcard when on the Details tab. The Details tab URL defaults to `?subcard=today` (always resets to Today when entering Details from another tab).

**Contract:** `prevMonthUrl`/`nextMonthUrl` conditionally append `&subcard=${currentSubcard}` when `currentTab === "details"`. `detailsTabUrl` becomes `?month=${monthStr}&tab=details&subcard=today`. Grid and stats tab URLs unchanged.

#### 3. Details island swap

**File:** `src/pages/dashboard.astro`

**Intent:** Replace `AbsenceDetailsTable` import and usage with `AbsenceDetailsSubcards`, passing the two additional props it needs.

**Contract:** Replace import line. New render call: `<AbsenceDetailsSubcards client:load absences={absences} employees={gridEmployees} absenceTypes={absenceTypes} year={year} month={month} initialSubcard={currentSubcard} />`

### Success Criteria

#### Automated Verification

- TypeScript compile passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- `?tab=details` (no subcard) renders with Today subcard active
- `?tab=details&subcard=monthly` renders with Monthly active, URL preserved on F5
- Month nav while on Details tab preserves subcard in the new URL
- Clicking Stats/Grid and returning to Details shows `?subcard=today`

**Implementation Note:** Pause for manual confirmation after phase completes.

---

## Phase 3: AbsenceDetailsSubcards component

### Overview

New React island owning subcard state, silent URL sync, the 2-week fetch for Today, and the Yearly lazy fetch. Delegates all row rendering to `AbsenceDetailsTable`.

### Changes Required

#### 1. New component file

**File:** `src/components/absence/AbsenceDetailsSubcards.tsx`

**Intent:** Implement the full subcard UX: three tab buttons, instant switching with URL sync, Today subcard with three temporal sections, and a Yearly lazy fetch.

**Contract:** Props interface:

```typescript
interface AbsenceDetailsSubcardsProps {
  absences: Absence[];          // SSR-loaded monthly absences (used for Monthly subcard)
  employees: Employee[];
  absenceTypes: AbsenceType[];
  year: number;
  month: number;
  initialSubcard: "today" | "monthly" | "yearly";
}
```

Internal structure:

**State & refs:**
- `activeSubcard` via `useState<"today" | "monthly" | "yearly">(initialSubcard)`
- `todayFetched = useRef(false)` — guard for 2-week fetch
- `yearlyFetched = useRef(false)` — guard for yearly fetch
- `weekAbsences: Absence[] | null`, `weekLoading`, `weekError` — for Today subcard
- `yearlyAbsences: Absence[] | null`, `yearlyLoading`, `yearlyError` — for Yearly subcard

**Week date computation** (module-level helper `getWeekRange()` returning `{ from: string; to: string; todayStr: string; thisWeekStart: string; thisWeekEnd: string; nextWeekStart: string; nextWeekEnd: string }`):
- Derive Monday of current week using `(today.getDay() + 6) % 7` formula
- Compute ISO strings for today, Mon/Fri of this week, Mon/Fri of next week

**URL sync** (helper `setSubcard(sub)`):
- Set state: `setActiveSubcard(sub)`
- Build new URL: `new URLSearchParams(window.location.search)`, set `subcard` to `sub`, call `history.pushState(null, "", "?" + params.toString())`

**Today subcard fetch trigger** (`useEffect` keyed on `activeSubcard`):
- When `activeSubcard === "today"` and `!todayFetched.current`: set guard, fetch `GET /api/absences?from={thisWeekMonday}&to={nextWeekFriday}`, `AbortController` cancel on cleanup. Update `weekAbsences` / `weekLoading` / `weekError`.

**Yearly fetch trigger** (`useEffect` keyed on `activeSubcard`):
- When `activeSubcard === "yearly"` and `!yearlyFetched.current`: set guard, fetch `GET /api/absences?year=${year}`, `AbortController`. Update `yearlyAbsences` / `yearlyLoading` / `yearlyError`. (Mirror `AbsenceStats.tsx:135-155` exactly.)

**Tab button rendering:**
- Three `<button type="button">` calling `setSubcard(...)`, styled with active/inactive state matching the top-level nav (`border-b-2 border-blue-600 text-blue-600` active; `text-gray-600 hover:text-gray-900` inactive)

**Today subcard content** (three sections, each with a heading and `AbsenceDetailsTable` or empty state):
- **Dzisiaj** — `weekAbsences` filtered to `date === todayStr`
- **Ten tydzień** (Mon–Fri) — `weekAbsences` filtered to `thisWeekStart <= date <= thisWeekEnd`, excluding today to avoid duplication; or include today per the heading "Ten tydzień" with today highlighted — **include today in this week's list** (today is part of the week; Dzisiaj section also shows it — duplication is acceptable for clarity)
- **Następny tydzień** (Mon–Fri) — `weekAbsences` filtered to `nextWeekStart <= date <= nextWeekEnd`
- While `weekLoading`: `<p>Ładowanie…</p>` (one placeholder for the whole Today subcard)
- On `weekError`: `<p className="text-red-600">{weekError}</p>`

**Monthly subcard content:** `<AbsenceDetailsTable absences={absences} employees={employees} absenceTypes={absenceTypes} />` — instant, no fetch

**Yearly subcard content:** same as AbsenceStats pattern — loading / error / `<AbsenceDetailsTable absences={yearlyAbsences ?? []} ... />`

### Success Criteria

#### Automated Verification

- TypeScript compile passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- **Today subcard:** Dzisiaj section shows only today's absences; Ten tydzień shows Mon–Fri of current week; Następny tydzień shows Mon–Fri of next week; boundary-spanning weeks show complete data from both months
- **Monthly subcard:** same rows as the old Details tab; sorting works; instant (no fetch)
- **Yearly subcard:** loading placeholder on first activation, then full-year rows; switching away and back does NOT re-fetch
- **Subcard switching:** instant (no visible navigation/reload)
- **URL sync:** address bar shows correct `?subcard=` after switching; F5 restores same subcard
- **No console warnings** on unmount while any fetch is in progress

**Implementation Note:** Pause for manual confirmation after phase completes.

---

## Testing Strategy

### Manual Testing Steps

1. Open Details tab → Today active, loading state briefly visible, then rows in three sections
2. Switch to Monthly → instant, URL updates, F5 returns to Monthly
3. Switch to Yearly → loading state, then full-year table; switch away and back → no second fetch
4. Switch to Today → no second 2-week fetch (guard worked)
5. Test at a week boundary (e.g. Thursday) → next week spans into next month, data is complete
6. Navigate months while on Details → subcard preserved; Today fetch does NOT re-fire (it's always about the real current date)
7. Navigate to Grid/Stats → come back to Details via tab nav → Today active, fetch fires again (new component mount)
8. Check browser console for no React warnings on mount/unmount cycle

## References

- Roadmap: `context/foundation/roadmap.md` (S-06 details-subcards)
- Yearly fetch pattern to copy: `src/components/absence/AbsenceStats.tsx:135-155`
- Tab URL construction pattern: `src/pages/dashboard.astro:103-114`
- Existing API handler: `src/pages/api/absences/index.ts`
- Pure display component: `src/components/absence/AbsenceDetailsTable.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extend GET /api/absences with date-range mode

#### Automated

- [x] 1.1 TypeScript compile passes: `npm run build` — 00a3e21
- [x] 1.2 Lint passes: `npm run lint` — 00a3e21

#### Manual

- [x] 1.3 `GET /api/absences?from=2026-06-01&to=2026-06-07` returns absences in that range — 00a3e21
- [x] 1.4 `GET /api/absences?year=2026` still works unchanged — 00a3e21
- [x] 1.5 `GET /api/absences` (no params) returns 400 — 00a3e21
- [x] 1.6 `GET /api/absences?from=2026-06-01` (missing `to`) returns 400 — 00a3e21
- [x] 1.7 Unauthenticated request returns 401 — 00a3e21

### Phase 2: dashboard.astro — subcard param + navigation wiring

#### Automated

- [x] 2.1 TypeScript compile passes: `npm run build` — 28e948b
- [x] 2.2 Lint passes: `npm run lint` — 28e948b

#### Manual

- [x] 2.3 `?tab=details` (no subcard) renders with Today subcard active — 28e948b
- [x] 2.4 `?tab=details&subcard=monthly` renders with Monthly active, URL preserved on F5 — 28e948b
- [x] 2.5 Month nav while on Details preserves subcard in new URL — 28e948b
- [x] 2.6 Clicking Stats/Grid and returning to Details shows `?subcard=today` — 28e948b

### Phase 3: AbsenceDetailsSubcards component

#### Automated

- [x] 3.1 TypeScript compile passes: `npm run build` — 52c3b61
- [x] 3.2 Lint passes: `npm run lint` — 52c3b61

#### Manual

- [x] 3.3 Dzisiaj section shows only today's absences; Ten tydzień and Następny tydzień show Mon–Fri rows — 52c3b61
- [x] 3.4 Boundary-spanning weeks show complete data from both months — 52c3b61
- [x] 3.5 Monthly subcard: same rows as old Details tab, sorting works — 52c3b61
- [x] 3.6 Yearly: loading placeholder on first activation, no re-fetch on return — 52c3b61
- [x] 3.7 Subcard switching instant; URL sync works; F5 restores correct subcard — 52c3b61
- [x] 3.8 No console warnings on unmount while fetch in progress — 52c3b61
