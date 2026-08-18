# Follow-ups from `/10x-impl-review` (2026-08-18)

Queued during triage of `reviews/impl-review.md`. Each item names the finding it came from.

---

## 1. Route-level tests for `POST /api/absences/bulk` (from F4)

**Why this is open:** the plan's Testing Strategy asserted *"There is no integration-test layer in
this repo"* and routed all bulk-route verification to manual checks. **That claim was false when
the plan was written.** `src/tests/api/` already held seven route-level suites across three route
families, each invoking the exported handler with a narrow `APIContext` stub against the real DB:

| Suite | Added |
|---|---|
| `src/tests/api/absences/crud.test.ts` | 2026-06-04 (`6232ea3`) |
| `src/tests/api/absences/partial-day-guard.test.ts` | 2026-07-22 (`3ae7a89`) |
| `src/tests/api/holiday-balances/korekta-gate.test.ts` | 2026-08-07 (`e2da254`) |

All predate the 2026-08-12 plan. So the highest-risk file in the change shipped untested on a
premise a two-minute check would have refuted. `change.md` records the coverage gap and names the
right harness; what it does not record is that the plan itself denied the harness existed.

**Weight:** the impl review found two real defects in the drag gesture (F2 stuck drag, F3
non-primary mouse button) — exactly the class of defect route-level tests catch. Both are now
fixed, but they shipped because nothing but a human eye was looking.

**What to write:** `src/tests/api/absences/bulk.test.ts`, modelled on
`partial-day-guard.test.ts` (same `APIContext` stub, same `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`
guard, `createTestEmployee()` from `src/tests/helpers/fixtures.ts` for the `role: "employee"`
account). E2E cannot reach any of these, because it can only send bodies the dialog can produce:

- **Weekday rule** (`bulk.ts:158`) — a Saturday in `dates` → 400 naming it, nothing written.
  E2E proves the *client* drops weekends, never that the server refuses one.
- **Partial-day guard** — a non-training type with `is_full_day: false` → 400.
- **Moderator-only `employee_id`** (`bulk.ts:137`) — the privilege-escalation gate. A regular
  employee sending a colleague's id must write to their **own** column. RLS does not backstop
  this (`AGENTS.md:62`).
- **zod bounds** — duplicate dates (would otherwise hit PG `21000`), the `MAX_BULK_DATES` cap,
  and an invalid calendar date such as `2026-02-31` (the reason `DateSchema` was chosen over the
  create route's raw regex).
- **Overwrite reporting** — `created_dates` / `overwritten_dates` correctness, now that the client
  actually consumes `overwritten_dates` (F1 fix).

**Also worth correcting:** the plan's Testing Strategy → Integration Tests paragraph, so the next
reader does not inherit the same false premise.

---

## 2. `isProtectedAdmin` on the absences write paths (from F5)

`src/lib/employees.ts:8-11` states the invariant: RLS is bypassed on the service-role connection,
so the technical-admin rule must be re-asserted in **every** write path via `isProtectedAdmin`.
Six paths honour it (`employees/[id].ts:93,:175`, `employees/[id]/restore.ts:66`,
`holiday-balances/[id].ts:75`, `holiday-balances/index.ts:174`, `employee-target-guard.ts:96`).

Both absence write paths skip it:

- `src/pages/api/absences/bulk.ts:138-154` — moderator target lookup selects only `{ id }` and
  filters only on `deleted_at`.
- `src/pages/api/absences/index.ts` — the same gap; **this is where it originated**, and the plan
  specified copying it verbatim ("exactly as `index.ts:204-219` does").

Effect: a moderator with a hand-crafted body can write absences onto the technical admin — up to
31 rows in one bulk call. Those rows are then filtered out of `GET /api/absences` by
`visibleEmployeesFilter()`, so they are invisible in the grid and not deletable through the UI.

**Fix both together** (they share a shape): add `is_system: employees.is_system` to the target
select and reject with 403, matching `holiday-balances/index.ts:173-176`. Consider routing both
through the existing `src/lib/employee-target-guard.ts` rather than a third copy.

While there: `substitute_employee_id` is validated only as a uuid on both routes (F6-adjacent),
so a soft-deleted or `is_system` employee can be set as substitute. The same guard closes it.
