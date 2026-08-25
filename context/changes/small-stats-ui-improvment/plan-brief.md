# Split type breakdown into year + month, and rename Sign out to Wyloguj — Plan Brief

> Full plan: `context/changes/small-stats-ui-improvment/plan.md`

## What & Why

The Statystyki tab's **"Podział wg typu nieobecności"** card only ever shows the browsed **month**, so there is no way to see how absence types split across the whole **year** — even though the yearly matrix right below it is built from exactly that data. This plan renders the breakdown twice, once per period. Separately, the top bar's `Sign out` button is relabelled `Wyloguj` to match the otherwise-Polish UI.

## Starting Point

`TypeBreakdown` (`src/components/absence/AbsenceStats.tsx:47-90`) is already period-agnostic — it takes a `MatrixData` and a period label — but is called exactly once, with `monthlyData`. The component already computes `yearlyData` too (`:306-309`), fed by a client-side `fetch('/api/absences/stats?year=…')` whose `loading`/`error` state is currently consumed by one region only: the yearly matrix at `:360-378`. The sign-out label is a bare text node at `src/components/Topbar.astro:30`.

## Desired End State

Between the KPI tiles and the matrix tables sit two stacked full-width cards with the same heading, distinguished by their period label: `Rok 2026` and `Sierpień 2026`. Both respect existing role scoping — a moderator sees the team, an employee sees themselves. The top bar's right-hand action reads `Wyloguj` and still posts to `/api/auth/signout`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Card layout | Stacked full-width | Preserves the 280px type-name column and wide share bars that make small percentages readable; a half-width column would need a new grid template. |
| Card order | Year first, then month | Matches the order in the request, and the broad figure sets context for the detail. |
| Placement | Both together, above the matrices | Keeps the two breakdowns adjacent so year-vs-month is a direct visual comparison. |
| Year card pending state | Reuse the existing `Ładowanie statystyk rocznych…` / error text | One consistent pending idiom for everything yearly; no new component and no risk of zeroed bars reading as real data. |
| Card headings | Same heading, period label distinguishes | The period span is already how this tab marks scope (same idiom as the KPI tiles); no new title style. |
| Rename scope | `Sign out` → `Wyloguj` only | Exactly what was asked; `Dashboard` / `Sign in` / `Not signed in` stay English. |

## Scope

**In scope:**
- Second `TypeBreakdown` call site over `yearlyData` in `src/components/absence/AbsenceStats.tsx`
- Extracting the yearly `loading`/`error` ternary into one shared local wrapper (two consumers now)
- `Sign out` → `Wyloguj` in `src/components/Topbar.astro`, plus a comment recording the departure from S-17

**Out of scope:**
- Any new endpoint, query, or change to `src/lib/absence-stats.ts` — both matrices already exist
- Polonising the rest of the top bar
- A React component-test harness (`@testing-library/react`) to assert the new rendering
- Any year/month toggle, period picker, or collapse control

## Architecture / Approach

Pure render-layer change in one React island plus a one-line label edit in one Astro component. `AbsenceStats` already holds both aggregations (`monthlyData` from server-rendered props, `yearlyData` from a client fetch), so the work is: extract the pending/error guard → call `TypeBreakdown` twice at the existing call site → point the yearly matrix at the same guard. No props, endpoints, or data shapes change.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Year + month type breakdown | Two stacked breakdown cards above the matrices, sharing one pending/error wrapper | The year card must be fed `yearlyEmployees`-scoped data, not the month-windowed `employees` list — mixing them would silently drop mid-year hires from the yearly totals |
| 2. Polish sign-out label | Top bar reads `Wyloguj` | Trivially low; only that the departure from S-17 is recorded so it is not "fixed" back later |

**Prerequisites:** None — working tree is clean on `main`, no migrations, no new dependencies.
**Estimated effort:** One session; Phase 1 is a focused edit to one file, Phase 2 a one-liner.

## Open Risks & Assumptions

- **Two loading lines on screen.** With the breakdowns above the matrices and the yearly matrix keeping its own guard, `Ładowanie statystyk rocznych…` renders **twice** during the yearly fetch. The wrapper removes the code duplication; the visual duplication is a consequence of the chosen placement and is accepted pending a look at the real thing. A single shared guard would require the two yearly regions to be adjacent.
- **Mixed-language top bar.** `Wyloguj` sits next to English `Dashboard`, which is a visible inconsistency and a deliberate departure from S-17 (`context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:210-219`). Recorded in a code comment so it is not silently reverted.
- **No automated coverage of the delta.** The repo has no React component-test harness, so "two cards render, with the right periods" is verified manually and by the type checker only. Assumption: acceptable at this size.
- **Different denominators are correct, not a bug.** The month card aggregates over the month-windowed `employees`, the year card over `yearlyEmployees`. A reviewer may read the mismatch as an error.

## Success Criteria (Summary)

- A user on Statystyki can see the absence-type split for the whole chosen year and for the chosen month, side by side in the same scroll region, without opening the matrix tables.
- Month navigation changes only the month card; year navigation changes both — and the year card's figures reconcile with the yearly matrix's `Łącznie` row.
- The top bar's sign-out action reads `Wyloguj` and still signs the user out.
