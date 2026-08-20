---
change_id: absence-write-hardening
title: Close the is_system gap on both absence write paths and cover bulk.ts with route tests
status: impl_reviewed
created: 2026-08-18
updated: 2026-08-20
archived_at: null
---

## Notes

Carried forward from `/10x-impl-review grid-multicheck` (2026-08-18), findings F4 and F5. The
full write-up lives in `context/archive/2026-08-12-grid-multicheck/follow-ups/review-fixes.md`
once that change is archived; the essentials are restated here so this change stands alone.

### 1. `isProtectedAdmin` is missing on both absence write paths (was F5)

`src/lib/employees.ts:8-11` states the invariant: RLS is bypassed on the service-role Drizzle
connection, so the technical-admin (`is_system`) rule must be re-asserted in **every** read
surface and **every** write path. Six write paths honour it — `employees/[id].ts:93,:175`,
`employees/[id]/restore.ts:66`, `holiday-balances/[id].ts:75`, `holiday-balances/index.ts:174`,
and the shared `lib/employee-target-guard.ts:96`.

Both absence write paths skip it:

- `src/pages/api/absences/index.ts` — the moderator `employee_id` branch. **This is where the
  gap originated.**
- `src/pages/api/absences/bulk.ts:138-154` — copied verbatim, because the grid-multicheck plan
  specified "exactly as `index.ts:204-219` does".

Effect: a moderator with a hand-crafted body can write absences onto the technical admin — up to
31 rows in one bulk call. Those rows are then filtered out of `GET /api/absences` by
`visibleEmployeesFilter()`, so they are invisible in the grid and not deletable through the UI.

Fix both together; consider routing them through the existing `lib/employee-target-guard.ts`
rather than adding a third copy of the lookup. While there: `substitute_employee_id` is validated
only as a uuid on both routes, so a soft-deleted or `is_system` employee can be set as
substitute — the same guard closes it.

### 2. `bulk.ts` has no route-level tests (was F4)

The grid-multicheck plan asserted *"There is no integration-test layer in this repo"* and routed
all bulk-route verification to manual checks. **That claim was false when it was written** —
`src/tests/api/` already held seven route-level suites, each invoking the exported handler with a
narrow `APIContext` stub against the real DB: `absences/crud.test.ts` (2026-06-04),
`absences/partial-day-guard.test.ts` (2026-07-22), `holiday-balances/korekta-gate.test.ts`
(2026-08-07). All predate the 2026-08-12 plan.

So the highest-risk file in that change shipped untested. E2E cannot substitute: it only sends
bodies the dialog can produce, so it covers the happy path and none of the rejection paths.

Write `src/tests/api/absences/bulk.test.ts` on the `partial-day-guard.test.ts` harness (same
`APIContext` stub, same `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` guard,
`createTestEmployee()` for the `role: "employee"` account). Cover:

- the weekday rule (`bulk.ts:158`) — a Saturday → 400 naming it, nothing written
- the partial-day guard — a non-training type with `is_full_day: false` → 400
- the moderator-only `employee_id` branch (`bulk.ts:137`) — the privilege-escalation gate; a
  regular employee sending a colleague's id must write to their **own** column
- zod bounds — duplicate dates (would hit PG `21000`), the `MAX_BULK_DATES` cap, and an invalid
  calendar date such as `2026-02-31`
- `created_dates` / `overwritten_dates` correctness, now that the client consumes
  `overwritten_dates`
- the `is_system` rejection from item 1, once it exists

### 3. Two uncovered gesture behaviours (from F2/F3, lower priority)

The grid-multicheck review fixed two drag defects in `AbsenceGrid.tsx` (commit `1a2451b`) that
were proven non-regressive by E2E but whose *positive* behaviour no test exercises:

- releasing the mouse outside the document abandons the selection (`buttons === 0` guard + window
  `blur`)
- a right- or middle-button drag does nothing (`button === 0` guard)

Worth a spec if the E2E suite can drive them; otherwise a documented manual check.
