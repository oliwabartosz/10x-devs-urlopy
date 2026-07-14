# Urlop Balance Tracker — Plan Brief

> Full plan: `context/changes/urlop-balance/plan.md`

## What & Why

Employees have a statutory annual vacation ("urlop") entitlement from an external HR system, but the app does nothing with it — so they can't see how many days are left. This feature lets a user enter their entitlement (Bieżące + Zaległe) and the app computes the remaining balance by counting the `urlop` absences it already tracks: **Left = (Bieżące + Zaległe + adjustment) − Used**.

## Starting Point

The app tracks `urlop` absences but has no per-employee entitlement data (no config table exists — everything hangs off `employees` and `absences`). Day-counting already exists in `AbsenceStats.tsx` (full-day = 1 day, partial = hours/8). There is no UI for "days left".

## Desired End State

A per-year card on the dashboard (above the tabs) shows days left with the `Bieżące + Zaległe − Wykorzystane = Left` breakdown and the "Do dnia" HR date. A dialog lets any user edit the entitlement; Used is computed live from tracked `urlop` (excluding S-13's `urlop planowany`); negative balances show a warning.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Formula | Left = (Bieżące + Zaległe) − Used | Standard Polish HR math; entitlement entered, Used derived. | Plan (conversation) |
| Used source | App counts tracked `urlop` (not HR's Wykorzystane) | Single source of truth from data the app already holds. | Plan (conversation) |
| Mid-year undercount | Optional `used_adjustment_days` baseline | Keeps Left correct for pre-app usage without storing Wykorzystane or faking rows. | Plan (conversation) |
| Scope | Per calendar year (`unique(employee_id, year)`) | Entitlement is inherently annual; preserves history. | Plan (conversation) |
| Placement | Dashboard card above the tabs | Glanceable; server-fed so no loading flash. | Plan (conversation) |
| Editing | Both employees and moderators can edit any | Matches who holds the HR figures. | Plan (conversation) |
| Used computed | Server-side in the API | Card needs Used when Stats tab is closed; `urlop`-by-name lookup in one place. | Plan (research) |

## Scope

**In scope:** `holiday_balances` table + migration; `GET/POST /api/holiday-balances` with server-side Used aggregation + upsert; dashboard card + edit dialog; integration tests for the counting + exclusion.

**Out of scope:** storing HR's Wykorzystane; auto carryover rollover; counting `urlop planowany` or other types; DELETE endpoint; clamping negative Left; automated UI/E2E tests; RLS.

## Architecture / Approach

New table keyed by `(employee_id, year)`. A server-side helper resolves the `urlop` type by name and aggregates the employee's urlop absences for the year (full-days + partial-hours/8 + adjustment). The API returns stored entitlement + computed Used + derived Left; POST upserts. The dashboard server-fetches the balance and renders a React card above the tab nav; editing goes through a dialog mirroring `AbsenceFormDialog`, then reloads.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + migration | `holiday_balances` table + types | CHECK constraints must be hand-added to the generated migration |
| 2. API + Used computation | GET/POST with urlop aggregation + upsert | Miscount: divisor must match `FULL_DAY_HOURS=8`; exclude `urlop planowany` |
| 3. UI card + dialog | Dashboard card + edit dialog | Correct year wiring; negative/empty states |

**Prerequisites:** existing `employees`/`absences`/`absence_types` schema; an `urlop` type row; Cloudflare preview/prod for manual DB verification (Drizzle can't run in `wrangler dev`).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- "Count all urlop as used" is accurate only if a year's urlop is fully logged in-app — mitigated by `used_adjustment_days`, but a user who leaves it 0 on mid-year adoption will see Left overstated.
- The `/8` divisor is duplicated from `AbsenceStats.tsx`; consider extracting a shared constant.
- S-13 (`urlop planowany`) must never count toward Used — covered by exact-name match + an explicit regression test.
- Last-write-wins on concurrent edits (acceptable for this low-contention data).

## Success Criteria (Summary)

- A user sees correct "days left" for the year on the dashboard, with the breakdown and HR date.
- Editing entitlement persists and updates the balance; Used reflects only tracked `urlop` (not `urlop planowany`).
- Negative balances are surfaced, not hidden; per-year records are preserved.
