# Details Subcards — Plan Brief

> Full plan: `context/changes/details-subcards/plan.md`

## What & Why

The Details tab currently shows a flat monthly absence list with no temporal grouping. S-06 adds three subcards — **Dzisiaj** (Today), **Miesięcznie** (Monthly), **Rocznie** (Yearly) — so users can jump to what's relevant. The Today subcard goes further: it renders three sections (today / this week Mon–Fri / next week Mon–Fri) for a complete near-term view of the team's absences.

## Starting Point

`AbsenceDetailsTable` is a pure display component receiving SSR-loaded monthly absences as props. `GET /api/absences` supports `?year=YYYY` only. No subcard structure exists.

## Desired End State

Details tab opens on Today by default. Subcard switching is instant (no page reload); the active subcard is encoded in the URL (`?subcard=today|monthly|yearly`) and survives F5. Today always fetches the real current 2-week window (Mon–Fri this week + Mon–Fri next week) — including data that may cross a month boundary. Monthly uses the SSR-loaded data (instant). Yearly loads lazily via the existing yearly API. `AbsenceDetailsTable` is unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Default subcard | Dzisiaj (Today) | Most immediately actionable for daily workflow | Plan |
| Today data source | Fetch 2-week range (`?from=&to=`) | Complete data at month boundaries — truncation felt wrong for a week view | Plan |
| This Week / Next Week | Sections within the Today subcard | Adds near-term context without a new top-level subcard | User |
| Yearly format | Same sortable table (AbsenceDetailsTable) | No new component; avoids duplicating the Stats tab's yearly summary | Plan |
| Subcard state | URL param + `history.pushState` | Survives refresh and back-navigation without page reload | User |
| Yearly fetch trigger | Lazy on first activation | Avoids unnecessary API call when user only needs Today/Monthly | Plan |

## Scope

**In scope:**
- `GET /api/absences` extended with `?from=YYYY-MM-DD&to=YYYY-MM-DD` mode
- `AbsenceDetailsSubcards.tsx` — new wrapper (today/this-week/next-week fetch + yearly fetch + subcard state)
- `dashboard.astro` — subcard param parsing + nav URL updates

**Out of scope:**
- No changes to `AbsenceDetailsTable`, `AbsenceStats`, or Stats tab
- No schema/migration changes

## Architecture / Approach

`AbsenceDetailsSubcards` wraps `AbsenceDetailsTable`. It owns: subcard `useState` (initialised from `initialSubcard` prop), `history.pushState` URL sync, a `useRef` guard for the 2-week fetch (Today subcard), and a separate `useRef` guard for the yearly fetch. `AbsenceDetailsTable` is the leaf renderer for all sections and subcards. `dashboard.astro` reads `?subcard=` and passes `initialSubcard`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. API extension | `GET /api/absences?from=&to=` mode | Must not break existing `?year=` mode; half-open interval consistency |
| 2. dashboard.astro wiring | Subcard param, nav URLs, island swap | URL construction must not drop `month` or `tab` params |
| 3. AbsenceDetailsSubcards | Full subcard UX, Today/This Week/Next Week, Yearly lazy fetch | `history.pushState` must update only `subcard` param; week date math edge cases (Sunday) |

**Prerequisites:** S-02 done ✓ (AbsenceDetailsTable + yearly API endpoint exist)
**Estimated effort:** ~1-2 sessions across 3 phases

## Open Risks & Assumptions

- Yearly subcard data is keyed to the `year` of the *viewed month* URL param (consistent with how `AbsenceStats` already behaves)
- Today / This Week / Next Week always reflect the **real current date**, independent of which month is being viewed

## Success Criteria (Summary)

- Subcard switching is instant; URL updates; F5 restores correct subcard
- Today shows today's rows; This Week and Next Week show complete Mon–Fri data even across month boundaries
- `npm run build` and `npm run lint` pass with no new errors
