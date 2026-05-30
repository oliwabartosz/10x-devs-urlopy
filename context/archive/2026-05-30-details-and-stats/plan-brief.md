# Details Table & Statistics — Plan Brief

> Full plan: `context/changes/details-and-stats/plan.md`

## What & Why

Add two tabs to the existing `/dashboard` — **Szczegóły** (a sortable monthly absence table) and **Statystyki** (a per-employee × per-type matrix for monthly and yearly totals). This completes PRD FR-005 and FR-006, and closes the loop on US-01: "the absence is visible in the grid, the details table, and the statistics."

## Starting Point

S-01 is complete: `/dashboard` renders a full monthly absence grid with add/edit/delete. The SSR page already fetches employees, monthly absences, and absence types. Month navigation (`?month=`) works. No tab concept exists yet, and the monthly absences query omits `created_at`.

## Desired End State

A logged-in employee sees three tabs on the dashboard — Siatka (unchanged), Szczegóły (monthly sortable table), and Statystyki (per-employee × per-type counts). Switching tabs preserves the selected month; the month nav preserves the active tab. Yearly stats load lazily when the Statystyki tab is first visited.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Tab placement | Same page, URL param `?tab=` | Preserves month context and allows direct links; consistent with existing `?month=` pattern | Plan |
| Yearly data fetch | Lazy client-side GET /api/absences?year | Avoids SSR latency on every Grid tab load; yearly data only needed on the Stats tab | Plan |
| Stats granularity | Per-employee × per-type matrix + Total row/col | Mirrors the grid's employee-column mental model; answers "how many sick days per person" | Plan |
| Hours display in stats | Days count + hours sum separately | Honest — full-day (hours=NULL) and partial-day entries are structurally different; no assumed hours-per-day | Plan |
| Details table sorting | Client-side sortable columns, default by date | Covers the key moderator use case (group by employee/type) without requiring a new API | Plan |
| Month nav ownership | Extracted to `MonthNav.astro` | Must appear identically on all three tabs; decouples nav from the React grid | Plan |

## Scope

**In scope:** MonthNav.astro extraction, tab nav (URL-param-driven), AbsenceDetailsTable (sortable columns), AbsenceStats (monthly + yearly, lazy fetch), GET /api/absences?year endpoint, fix for missing `created_at` in the monthly absences select.

**Out of scope:** New DB migrations, filtering in the details table, export/print, moderator-only stats views, pagination, real-time updates.

## Architecture / Approach

`dashboard.astro` reads `?tab=` and conditionally renders one of three islands below a server-rendered MonthNav + tab nav bar. Monthly absences (SSR) are passed as props to both the Details and Stats islands. The Stats island triggers a client-side fetch for the yearly range on mount. All DB access stays server-side (SSR or API routes); no browser Supabase client.

```
dashboard.astro (SSR)
 ├── MonthNav.astro (server-rendered links)
 ├── Tab nav (server-rendered links)
 └── ?tab=grid    → <AbsenceGrid client:load />          (existing, unchanged logic)
     ?tab=details → <AbsenceDetailsTable client:load />  (new, data from SSR props)
     ?tab=stats   → <AbsenceStats client:load />         (new, monthly=SSR, yearly=lazy fetch)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data Layer | GET /api/absences endpoint + `created_at` fix | None — low-risk additive change |
| 2. Navigation Refactor | MonthNav extraction, tab nav, conditional rendering with placeholders | Removing props from AbsenceGrid must not break existing build |
| 3. Details Table | AbsenceDetailsTable with sortable columns wired under Szczegóły tab | Sort state + useMemo correctness |
| 4. Statistics | AbsenceStats with monthly + lazy yearly tables wired under Statystyki tab | Yearly fetch loading/error states; aggregation correctness |

**Prerequisites:** S-01 (monthly-grid-own-absence) fully implemented and deployed locally.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- Yearly stats assume test data is available for validation; the roadmap notes "seed data may be needed for verification."
- `AbsenceGrid.tsx` month nav removal: must verify no other component imports or calls `prevMonthUrl`/`nextMonthUrl` after refactor.

## Success Criteria (Summary)

- All three tabs render correctly and switching preserves month context
- Details table accurately reflects all absences for the month; sort works on all columns
- Monthly stats cells match the absences visible in the grid; yearly stats load without errors
