# Role-Scoped Statistics — Plan Brief

> Full plan: `context/changes/statistics-for-moderators/plan.md`

## What & Why

The **Statystyki** tab currently shows every employee's absence totals to every employee, ranked, with 🥇🥈🥉 medals for "most days taken" per absence type. This change splits it by role: a moderator keeps the full team view; everyone else sees only their own figures. The scoping is enforced on the server, so a non-moderator's yearly data is their own — not filtered in the browser.

## Starting Point

`dashboard.astro:239` hands `AbsenceStats` the full employee list with no role branch, and the yearly half of the tab fetches from `GET /api/absences?year=`, a route that deliberately returns all employees' absences to any authenticated caller (`api/absences/index.ts:117`). That route also feeds the Szczegóły tab, which genuinely needs team-wide rows, so it cannot be narrowed in place. Both foundation documents currently say this feature will *not* be built: `prd.md:135` (Non-Goal) and `roadmap.md:438` (Parked).

## Desired End State

A moderator sees exactly what they see today. A non-moderator opening Statystyki sees one row — themselves — in both the monthly and yearly matrices, no medals, no grand-total footer, and a "Dni nieobecności w tym roku" tile where the team counter used to be. Reading the network tab confirms the yearly response contains only their own rows.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Privacy boundary | Statystyki tab only (presentation + API) | Removes the ranked, comparative view without breaking the shared team calendar the product is built around (PRD:42, US-01) | Plan |
| Self view content | Own row only, no team figures | One row is a degenerate case of the existing matrix — no anonymous aggregate, which in a team this size is close to identifying | Plan |
| Yearly data source | New `GET /api/absences/stats?year=`, scope derived from role server-side | The client cannot widen its own scope, and the shared list endpoint stays team-wide so the grid and Szczegóły can't regress | Plan |
| Shared query logic | Extract into `src/lib/services/absence-list.ts` | `bulk.ts` was created by copying `index.ts` and inherited a missing guard for months; a second route over the same table must compose, not copy | Plan |
| Second KPI tile | Year-to-date own days | "Pracownicy z nieobecnością — N / M" is meaningless at N=1; YTD reuses data already fetched for the yearly matrix | Plan |
| Moderator self-toggle | None — role alone decides | Matches every other role branch in the app; no URL state to preserve across month navigation | Plan |
| Testing | Route integration tests + unit tests, manual UI check | Puts automated coverage on the server, where the boundary actually is | Plan |
| Foundation docs | Amend both PRD and roadmap in this change | A stale Non-Goal actively argues against shipped work in every future planning session | Plan |

## Scope

**In scope:** new scoped stats endpoint + route tests; extraction of the matrix aggregation into `src/lib/absence-stats.ts` + unit tests; role branch in `dashboard.astro` and `AbsenceStats.tsx`; PRD and roadmap amendments.

**Out of scope:** the Siatka and Szczegóły tabs (stay team-wide); narrowing the existing list endpoint; a moderator team/self toggle; anonymised team aggregates; any DB migration or RLS change; E2E coverage of the role split.

## Architecture / Approach

Server-first: the scoping lands on a new route before anything depends on it, then the component is pointed at it.

```
dashboard.astro (SSR)
 ├── statsEmployees  = moderator ? gridEmployees : [own full Employee row]
 ├── statsAbsences   = moderator ? absences      : absences.filter(own)
 └── <AbsenceStats isModerator={...} employees={statsEmployees} monthlyAbsences={statsAbsences} />
        └── lazy fetch → GET /api/absences/stats?year=      (NEW, role-scoped server-side)
                            └── src/lib/services/absence-list.ts  (shared with /api/absences)

AbsenceGrid + AbsenceDetailsSubcards keep gridEmployees / absences — unchanged.
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scoped stats endpoint | `GET /api/absences/stats?year=` + shared query module + route tests | Refactoring `index.ts` onto the shared module could regress the grid and Szczegóły; the existing eleven route suites are the guard |
| 2. Extract stats math | `src/lib/absence-stats.ts` + unit tests | Pure move — risk is an accidental behaviour change slipping in during the lift |
| 3. Role-scoped view | `dashboard.astro` scoping + `isModerator` branch in `AbsenceStats` | Silently regressing the moderator path, which nobody is watching during this change (esp. deactivated employees' historical rows) |
| 4. Foundation documents | PRD Non-Goal rewritten as an access rule; roadmap un-parked as S-23 | Writing a blanket privacy rule the app does not actually implement |

**Prerequisites:** S-02 (`details-and-stats`) shipped — it is. Route-level tests need `DATABASE_URL_DIRECT`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`; two accounts (one moderator, one employee) are needed for the manual pass.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- **This is not a full privacy boundary, and the plan says so.** A non-moderator can still read the same absence days from the Siatka and Szczegóły tabs. What is removed is the ranked, comparative presentation — the medals and the who-took-most matrix. If the intent is that colleagues' absences become genuinely unreadable, that is a larger change touching the grid, and the PRD wording in Phase 4 must not overclaim.
- Drizzle queries fail under `wrangler dev` (CLAUDE.md), so route-level manual checks run against the production deployment; the automated suites use `DATABASE_URL_DIRECT` directly.
- Phases must land in order — Phase 3 points the component at the Phase 1 route.

## Success Criteria (Summary)

- A moderator's Statystyki tab is indistinguishable from before the change.
- A non-moderator sees only their own row, with no medals or team totals, and the yearly network response confirms it.
- No stale statement in `prd.md` or `roadmap.md` contradicts what shipped.
