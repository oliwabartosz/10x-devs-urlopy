---
change_id: grid-multicheck
title: Drag-to-select absence grid cells, skipping non-clickable weekends
status: impl_reviewed
created: 2026-08-12
updated: 2026-08-18
archived_at: null
---

## Notes

now user must click separately on each cell, but for example urlop sometimes is 10 days (14 including weekends, but weekends shouldn't be clicable). So more UX convinent way is checking grid cells by dragging the mouse. Check @new-design/ - there is it

## Known gap (2026-08-18)

`src/pages/api/absences/bulk.ts` has **no route-level tests**. `grep -rn bulk src/tests/ tests/`
returns 0 hits; the only automated exercise of the route is `tests/e2e/absence-grid-range.spec.ts`,
which drives it through the UI.

That E2E coverage is real but structurally one-sided: it can only send bodies the dialog is
capable of producing, so it exercises the route's **happy path** (weekday-only dates, one shared
window, the overwrite confirmation) and never its **rejection paths**. Every guard the route
added is therefore unguarded by tests:

- the weekday rule (`bulk.ts:158`) — E2E proves the *client* drops weekends, never that the
  server refuses one
- the partial-day guard via `isPartialDayViolation`
- the moderator-only `employee_id` branch (`bulk.ts:137`) — the privilege-escalation gate, which
  RLS does not backstop (`AGENTS.md:62`)
- the zod bounds: duplicate dates (PG `21000`), the `MAX_BULK_DATES` cap, an invalid calendar
  date such as `2026-02-31`

All four were verified **once, by hand** against the deployed app (Progress 3.4–3.8, 2026-08-18)
and will regress silently on the next refactor.

The harness for closing this already exists and needs no new pattern:
`src/tests/api/absences/partial-day-guard.test.ts` calls the exported route handler directly with
a narrow `APIContext` stub against the real DB, and `src/tests/helpers/fixtures.ts`
`createTestEmployee()` creates a `role: "employee"` account — precisely the account type criterion
3.8 needed and that made it awkward to verify manually.

Deliberately not done in this change; recorded here so `/10x-impl-review` and any later reader
see the gap as known rather than overlooked.
