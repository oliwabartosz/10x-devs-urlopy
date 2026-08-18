# Absence write hardening — Implementation Plan

## Overview

Two absence routes can write rows onto the technical admin. `src/lib/employees.ts:4-12` states the
invariant they break: RLS is bypassed on the service-role connection, so "the admin is hidden and
immutable" must be re-asserted in **every read surface and every write path**. Six write paths
honour it; the two absence write paths do not.

This change closes that gap behind one shared guard and then does the thing whose absence let the
gap survive: it puts route-level tests on `bulk.ts`, which shipped with none.

The two halves are the same story told twice. `bulk.ts` inherited the hole by copying
`index.ts` verbatim under a plan instruction to do so; nothing tested either route's rejection
paths, so nothing objected.

## Current State Analysis

**The gap has two entrances, not one.** `change.md` describes the moderator-retarget branch
(`bulk.ts:138-154`, `index.ts:199-215`), where an `employee_id` from the request body selects the
target. But the technical admin is seeded as `role: moderator, is_system = true`
(`AGENTS.md:55`), so it is also a legitimate *caller*. On the self path,
`targetEmployeeId = employeeRow.id` (`index.ts:197`, `bulk.ts:137`) never enters the moderator
branch. A guard placed only in that branch leaves the admin free to write absences onto itself.

**Both routes resolve the caller without reading `is_system`.** The caller lookup selects
`{ id, role }` only (`index.ts:172`, `bulk.ts:103`), so the self path has no way to notice it is
the admin even if it wanted to.

**The moderator branch is a verbatim duplicate.** `bulk.ts:138-154` and `index.ts:199-215` differ
only in the Sentry `route` tag. The grid-multicheck plan created the second copy on purpose
(`archive/2026-08-12-grid-multicheck/plan.md:195-197`: "exactly as `index.ts:204-219` does").

**The read side is already closed** — and this is a correction to `change.md`'s framing.
`admin-bootstrap` deferred filtering the absence-list join with the trigger "revisit only if the
admin ever gets absence rows", but that deferral was discharged later: `visibleEmployeesFilter()`
now sits on **both** arms of the `GET /api/absences` join (`index.ts:100-101`, landed in
`63f7a38`). This change is write-side only. The read-side filter is also what makes the bug
consequential rather than cosmetic: an admin absence row is invisible in the grid and the Details
table, so it cannot be deleted through the UI.

**Nothing has exploited it.** A read-only probe of the production database (2026-08-18) found
1 `is_system` employee ("System Admin", `role: moderator`, not soft-deleted), **0** absence rows
on it, **0** absence rows whose substitute is `is_system` or soft-deleted, and 11 active
employees. No backfill, cleanup, or data migration is needed.

**`substitute_employee_id` is validated only as a uuid** on both routes (`index.ts:149`,
`bulk.ts:60`). The "not the admin" rule exists **only in the React picker**
(`archive/2026-08-07-huge-ui-ux-improvement/plan.md:905-907`). A hand-crafted body can set the
admin as substitute; the dialog then renders it as "Brak zastępstwa" because a substitute missing
from the picker list makes `findIndex` return `-1`
(`archive/2026-08-07-huge-ui-ux-improvement/reviews/impl-review-2.md:255-257`) — the form
misrepresents what is stored.

**`bulk.ts` has zero route-level tests.** `grep -rln "absences/bulk" src/tests tests` returns
nothing. The only automated exercise is `tests/e2e/absence-grid-range.spec.ts`, which can send
only bodies the dialog is capable of producing — so it covers the happy path and none of the
rejection paths.

**The claim that hid this is on record twice.** `src/tests/api/holiday-balances/is-system-guard.test.ts:10`
asserts "The balance upsert was the last mutation path in the codebase without an `is_system`
guard" — false when written; `POST /api/absences` lacked it then and still does. The
grid-multicheck plan asserted "There is no integration-test layer in this repo" — also false,
`src/tests/api/` held seven route-level suites at the time. Two confident repo-wide claims, neither
verified, each one directly responsible for a gap.

### Key Discoveries

- The admin is a moderator (`AGENTS.md:55`), so the self path is a second entrance — the single
  most important finding, and absent from `change.md`'s framing
- `resolveModeratorTarget` (`employee-target-guard.ts:42`) **does not fit**: it reads the target
  from `context.params.id`, hard-requires a moderator caller (403 otherwise), and its own scope
  note (`:13-17`) says it is deliberately not the shared guard. Absences need the opposite shape —
  an *optional* body field, with non-moderators silently falling through to their own column
- The `workers-data-edit` carve-out ("No shared auth-guard helper extraction", `plan.md:87`) names
  the five employees/holiday-balances routes and gives no rationale beyond "separate change" — it
  does not block a new absence-shaped helper
- `Promise<Response | T>` is the established guard contract (`employee-target-guard.ts:45`)
- Every test fixture this needs already exists: moderator via `createTestEmployee` + role flip
  (`korekta-gate.test.ts:66-67`), `is_system` via a third employee + flag, **unflipped before
  teardown** (`is-system-guard.test.ts:50-74`, rationale at `delete.test.ts:63-64`)
- May 2026 is an unclaimed test month with 21 weekdays; existing suites hold Jan/Feb/Mar/Apr
- `vitest.config.ts` sets `fileParallelism: false` and 60 s timeouts — remote Supabase round trips

## What We're NOT Doing

- **Not touching the read side.** Already closed at `index.ts:100-101`.
- **Not backfilling or cleaning data.** The probe found zero affected rows.
- **Not rejecting soft-deleted substitutes.** Only `is_system` is rejected. A soft-deleted
  substitute is plausible on a historical row, and rejecting it would break editing those rows —
  a live flow. Deliberately narrower than the F5 follow-up suggested.
- **Not guarding `PATCH`/`DELETE` on `absences/[id].ts`.** They cannot retarget an absence to
  another employee, so they cannot *create* an admin row. Once this change ships, no admin rows
  can exist to edit or delete.
- **Not refactoring the five pre-existing routes** onto the new helper. The `workers-data-edit`
  carve-out stands; this change adds a guard for the two absence routes only.
- **Not extending `employee-target-guard.ts`.** Its contract fits its two callers; bending it to
  accept a body-sourced optional id risks `email.ts`/`password.ts` for no gain.
- **Not adding E2E specs for the gesture guards** fixed in `1a2451b` (right-button drag,
  release-outside-document). Different domain; `change.md` item 3 stays open.
- **Not a full authorization sweep of `index.ts`.** `crud.test.ts` already covers its other paths.
- **Not fixing the other stale docs** — `test-plan.md:97`, its Phase 2 status, its `TBD` §6.3, and
  `is-system-guard.test.ts:10`. Named here so the next reader knows they are known.
- **Not changing the non-moderator contract.** An employee sending a colleague's `employee_id`
  still silently writes to their own column; that is the existing, deliberate behaviour.

## Implementation Approach

One guard module, called once per route, then two test suites split by concern rather than by
route.

The **guard** resolves the write target and validates the substitute in a single call, because
both questions are asked at the same point in both routes and both answers are "send this
`Response` instead". It returns `Response | { targetEmployeeId }`, matching the existing
`resolveModeratorTarget` contract. Putting the substitute check in the same call is what keeps the
call sites to one line each; splitting it would mean two guards, two error paths, and two chances
for the next route to remember one and forget the other.

The **caller's own `is_system`** is checked by widening the existing caller lookup to select
`is_system` — no extra query. The **target's** `is_system` is checked by widening the existing
target lookup the same way. The **substitute** needs one new query, issued only when a substitute
is actually supplied.

The **tests** split by what they prove, not by which route they call:
`bulk.test.ts` owns the six rejection paths E2E cannot reach; `is-system-guard.test.ts` owns the
new invariant across **both** routes, mirroring the `holiday-balances/is-system-guard.test.ts`
name that already exists for exactly this purpose.

## Critical Implementation Details

**Ordering: the `is_system` rejection must come after the not-found check, not before.** The five
existing routes establish `target lookup 404 → isProtectedAdmin 403 → mutate`
(`workers-data-edit/research.md:125`). Reversing it would answer 403 for a nonexistent id.

**The caller-self check must not fire for non-moderators sending someone else's id.** The existing
contract is that a regular employee's `employee_id` is silently ignored and they write their own
column. The self-path `is_system` check applies to the *resolved* target, so it must run after
resolution, not as an early return on the caller row.

**Test cleanup must unflip `is_system` before `teardownTestEmployee`.** Documented at
`delete.test.ts:63-64`: the invariant is app-enforced, so an orphaned row left with the flag set
looks like a second technical admin. Every suite that sets the flag unflips it in `afterAll`.

**Bulk tests need non-overlapping weekday runs.** `absences` carries `UNIQUE (employee_id, date)`
and `bulk.ts:159` rejects weekends outright, so each test needs its own run of Mon–Fri dates.
Scope existence assertions to the test's own dates rather than to `employee_id` alone
(`hours-clamp.test.ts:116-118`) — a bare employee filter reports a leftover row from an earlier
test as if this call had written it.

## Phase 1: Shared absence write-target guard

### Overview

One module that answers "which employee does this write land on, and is that allowed?", wired into
both absence write routes, closing both entrances and the substitute hole.

### Changes Required

#### 1. The guard module

**File**: `src/lib/absence-write-target.ts` (new)

**Intent**: Resolve the employee an absence write targets — the caller's own row, or a body-supplied
one when the caller is a moderator — and refuse when the resolved target or the supplied substitute
is the protected technical admin. Exists so the block that `bulk.ts` copied from `index.ts` has one
home instead of two, since that copy is what propagated the gap.

**Contract**: Exports one async function returning `Promise<Response | { targetEmployeeId: string }>`,
following `resolveModeratorTarget`'s existing convention (`employee-target-guard.ts:42-45`) — a
`Response` means "send this", anything else means "proceed". Parameters: the `Db`, the already-resolved
caller row (`{ id, role, is_system }`), the parsed optional `employee_id` and `substitute_employee_id`,
and the Sentry `route` tag string.

Order of gates, matching the five existing routes:

1. Target resolution — `employee_id` honoured **only** when `caller.role === "moderator"` and it is
   present; otherwise the target is the caller's own id. Unchanged behaviour: a non-moderator's
   `employee_id` is silently ignored, not rejected.
2. When the moderator branch is taken: target must exist and not be soft-deleted → else 404
   `"Pracownik nie został znaleziony."` The select must now also carry `is_system`.
3. Resolved target must not be the protected admin → 403 `"Nie można modyfikować tego konta."`,
   the exact string used at `holiday-balances/index.ts:174` and `employee-target-guard.ts:97`.
   This gate runs on the resolved target, so it covers the self path too — the admin writing its
   own column is refused by the same line that refuses a moderator retargeting it.
4. When `substitute_employee_id` is non-null: one lookup; if that row is the protected admin →
   403, same message. A nonexistent substitute is **not** checked here — the FK still maps it to
   422 via `extractPgErrorConstraint`, which is the existing contract. Soft-deleted substitutes
   remain allowed (see "What We're NOT Doing").

Every DB call wrapped, `Sentry.captureException` with the passed `route` tag, 503
`"Błąd bazy danych."` on failure — the shape both routes already use. The module owns its own
local `json()` helper, as `employee-target-guard.ts:19-23` does.

#### 2. Wire the single-row route

**File**: `src/pages/api/absences/index.ts`

**Intent**: Replace the inline moderator-target block with the shared guard, and give the caller
lookup the field the guard needs.

**Contract**: The caller select (`:172`) gains `is_system: employees.is_system`. The block at
`:199-215` is replaced by one guard call whose result is either returned directly (when it is a
`Response`) or destructured for `targetEmployeeId`. `substitute_employee_id` is passed from the
parsed body. Everything downstream — the partial-day guard, the clamp, the insert, the error
mapping — is untouched.

#### 3. Wire the bulk route

**File**: `src/pages/api/absences/bulk.ts`

**Intent**: The same replacement, so the two routes stop being two copies of one decision.

**Contract**: Identical to the above at `:103` (caller select) and `:137-154` (the block), with the
route tag `"POST /api/absences/bulk"`. The weekday rule, partial-day guard, clamp, occupancy
pre-read, upsert and error mapping are untouched.

### Success Criteria

#### Automated Verification

- Type checking and linting pass: `npm run lint` and `npx astro check`
- Production build succeeds: `npm run build`
- Existing suite still green, with DB suites actually running: `npm run test:run` reports 0 skipped

#### Manual Verification

- A moderator sending the admin's `employee_id` to `POST /api/absences` gets 403 with the shared
  message, and no row is written
- The same request to `/api/absences/bulk` behaves identically
- A moderator writing a normal colleague's absence still succeeds, single-row and bulk
- A regular employee sending a colleague's `employee_id` still silently writes their own column

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 2: Route-level coverage for bulk.ts

### Overview

The suite `bulk.ts` should have shipped with — every rejection path the E2E spec structurally
cannot reach.

### Changes Required

#### 1. The bulk route suite

**File**: `src/tests/api/absences/bulk.test.ts` (new)

**Intent**: Prove each guard in `bulk.ts` rejects what it claims to reject and writes nothing when
it does, so the next refactor of that route fails loudly rather than silently.

**Contract**: Follows `partial-day-guard.test.ts` in structure:
`describe.skipIf(!process.env.DATABASE_URL_DIRECT)`, a `makeContext(authUserId, body)` factory
parameterised by caller (merging `korekta-gate.test.ts:32-42`'s caller-varying form with
`email.test.ts:32-41`'s nullable-`locals` trick for the 401 case), `beforeAll` fixtures,
`afterEach` cleanup, and an `afterAll` ending with `db.$client.end()`.

Fixtures: one employee, one colleague, one moderator (`createTestEmployee` + role flip). Dates come
from **May 2026**, unclaimed by any existing suite, with a distinct weekday run per test.
`afterEach` deletes by `inArray(absences.date, …)` scoped to the fixture employees — the bulk suite
is the one absence suite where an `afterEach` earns its place, since a failed test leaves N rows.

Cases:

- **Weekday rule** — a body containing a Saturday returns 400 whose message names that date, and
  neither the Saturday nor the weekdays beside it are written
- **Partial-day guard** — a non-training type with `is_full_day: false` returns 400
- **Duplicate dates** — a repeated date returns 400 from the schema refine, never reaching the
  upsert (this is what would otherwise surface as PG `21000`)
- **Cap** — `MAX_BULK_DATES + 1` dates returns 400. Note `MAX_BULK_DATES` was made module-private
  in `1a2451b`, so the test asserts the boundary via a literal 32-date body rather than importing it
- **Invalid calendar date** — `2026-02-31` returns 400 from `DateSchema`, not a 500 from Postgres
- **Moderator-only `employee_id`** — a regular employee sending the colleague's id gets 201 with
  every returned row carrying the **caller's** id, and the colleague's column stays empty
- **Reporting** — a range over free days reports all dates in `created_dates` and none in
  `overwritten_dates`; a second write over the same range reports them all as `overwritten_dates`,
  with the stored rows reflecting the second write. Asserted against both the response body and the
  DB, since `bulk.ts:193-197` documents the report as independently falsifiable from the write
- **401** — no `locals.user` returns 401 `"Brak autoryzacji."`

Every rejection case asserts nothing was written, with the custom-message form the suites use
(`expect(rows, "rejected POST must not have inserted a row").toHaveLength(0)`).

### Success Criteria

#### Automated Verification

- The new suite passes: `npm run test:run` — and its case count is visible in the file total
- The suite genuinely ran rather than skipping: the run reports 0 skipped
- Type checking and linting pass: `npm run lint` and `npx astro check`

#### Manual Verification

- Temporarily removing the weekday check from `bulk.ts` turns the weekday test red — the suite
  fails for the right reason, not incidentally
- The suite leaves no rows behind: May 2026 is empty after a full run

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 3: is_system coverage on both routes, and the lesson

### Overview

Prove Phase 1's guard on both routes it touches, and record why this change existed at all.

### Changes Required

#### 1. The is_system guard suite

**File**: `src/tests/api/absences/is-system-guard.test.ts` (new)

**Intent**: Prove the technical admin cannot receive an absence through either write route, by
either entrance, or as a substitute. Named to mirror
`src/tests/api/holiday-balances/is-system-guard.test.ts`, which exists for exactly this invariant
on that route.

**Contract**: Same harness as that file, including its fixture discipline: a third
`createTestEmployee` flipped with `is_system: true`, **unflipped in `afterAll` before**
`teardownTestEmployee` (`is-system-guard.test.ts:66-70`). Fixtures: one employee, one moderator,
one system employee. Dates from May 2026, in a run distinct from Phase 2's.

Cases, each asserted against **both** routes:

- A moderator sending the system employee's `employee_id` gets 403
  `{ error: "Nie można modyfikować tego konta." }` and no row is stored for that employee
- The system employee **as caller**, writing its own column with no `employee_id`, gets the same
  403 — the self-path entrance, which a moderator-branch-only guard would miss
- A moderator setting the system employee as `substitute_employee_id` on an ordinary target gets
  403, and nothing is written
- Control: the same requests targeting an ordinary employee still succeed, so the guard is proven
  to reject the admin specifically rather than everything

Assertions use `toEqual` on the whole body for the fixed message, matching
`is-system-guard.test.ts:79`.

#### 2. The lesson

**File**: `context/foundation/lessons.md`

**Intent**: Record the failure mode that produced this change, since it has now occurred twice and
was recommended for capture once already (grid-multicheck F4, Fix B) without being carried out.

**Contract**: One new H2 section in the file's existing four-field shape
(`Context` / `Problem` / `Rule` / `Applies to`), citing both instances:
`is-system-guard.test.ts:10` ("the last mutation path in the codebase without an `is_system`
guard") and the grid-multicheck plan ("There is no integration-test layer in this repo"). The rule
concerns verifying repo-wide claims — "every X does Y", "there is no Z", "this is the last W" —
with a search before writing them into a plan or a comment, because such claims are load-bearing:
each of these two directly caused a gap.

### Success Criteria

#### Automated Verification

- The new suite passes: `npm run test:run`, 0 skipped
- Full suite green across all three phases: `npm run test:run`
- Type checking and linting pass: `npm run lint` and `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification

- Reverting Phase 1's guard turns every case in the new suite red
- `lessons.md` renders with the new section and its links resolve

---

## Testing Strategy

### Unit Tests

None. The guard's logic is inseparable from its DB lookups, so its natural test level is the route
— which is where Phases 2 and 3 put it. Extracting a pure core here would test the branching while
leaving the queries, which are the part that was wrong.

### Integration Tests

**There is a route-level integration layer in this repo, and this change uses it.** Stated
explicitly because the predecessor plan claimed the opposite and that claim is why `bulk.ts`
shipped untested. `src/tests/api/` holds seven suites that invoke exported handlers with a narrow
`APIContext` stub against the real database, gated on `DATABASE_URL_DIRECT`. Phases 2 and 3 add
two more.

Note `describe.skipIf` means a green run with `DATABASE_URL_DIRECT` unset is *skipped*, not
*passed* (`AGENTS.md:12`) — check the reported count, which is why "0 skipped" appears in the
success criteria rather than "tests pass".

### Manual Testing Steps

1. As a moderator, `POST /api/absences` with the admin's `employee_id`. Expect 403 and no row.
2. Same body to `/api/absences/bulk`. Expect 403 and no rows.
3. Sign in **as the admin** and add an absence to your own column through the grid. Expect refusal.
4. As a moderator, set the admin as substitute on an ordinary employee's absence. Expect 403.
5. As a moderator, write an ordinary colleague's absence, single-day and range. Both still work.
6. As a regular employee, drag a range in your own column. Still works.

## Performance Considerations

One additional query per write, and only when a substitute is supplied. Both routes already issue
2–5 queries per request, so a nullable sixth on a non-hot path is immaterial. The caller and target
`is_system` checks add **no** queries — they widen two selects that already run.

## Migration Notes

No schema change, no migration, no backfill. The production probe found zero rows in any state this
change would newly reject, so no existing row becomes unwritable or unreadable.

Rollback is a code revert: the guard is additive and the two call sites return to their inline
blocks. Nothing written under the guard is structurally different from what is written today.

## References

- Carrier for grid-multicheck findings F4 and F5:
  `context/archive/2026-08-12-grid-multicheck/reviews/impl-review.md`
- Queued follow-up text: `context/archive/2026-08-12-grid-multicheck/follow-ups/review-fixes.md`
- The invariant: `src/lib/employees.ts:4-12`; RLS bypass: `AGENTS.md:70`
- Guard-contract precedent: `src/lib/employee-target-guard.ts:42-101`
- Gate-order precedent: `src/pages/api/holiday-balances/index.ts:158-176`
- Test harness model: `src/tests/api/absences/partial-day-guard.test.ts`
- `is_system` fixture model: `src/tests/api/holiday-balances/is-system-guard.test.ts:50-74`
- Fixture-unflip rationale: `src/tests/api/holiday-balances/delete.test.ts:63-64`
- Assertion-scoping rationale: `src/tests/api/absences/hours-clamp.test.ts:116-118`
- Shared-guard carve-out this change does not breach: `context/changes/workers-data-edit/plan.md:87`
- Admin seeding (`role: moderator, is_system = true`): `AGENTS.md:55`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared absence write-target guard

#### Automated

- [x] 1.1 Type checking and linting pass: `npm run lint` and `npx astro check` — 9f68743
- [x] 1.2 Production build succeeds: `npm run build` — 9f68743
- [x] 1.3 Existing suite still green with 0 skipped: `npm run test:run` — 9f68743

#### Manual

- [ ] 1.4 A moderator sending the admin's `employee_id` to `POST /api/absences` gets 403 and writes nothing
- [ ] 1.5 The same request to `/api/absences/bulk` behaves identically
- [ ] 1.6 A moderator writing an ordinary colleague's absence still succeeds, single-row and bulk
- [ ] 1.7 A regular employee sending a colleague's `employee_id` still silently writes their own column

### Phase 2: Route-level coverage for bulk.ts

#### Automated

- [x] 2.1 The new bulk suite passes: `npm run test:run` — 9e1826c
- [x] 2.2 The suite genuinely ran rather than skipping: 0 skipped — 9e1826c
- [x] 2.3 Type checking and linting pass: `npm run lint` and `npx astro check` — 9e1826c

#### Manual

- [ ] 2.4 Temporarily removing the weekday check turns the weekday test red
- [ ] 2.5 The suite leaves no rows behind — May 2026 is empty after a full run

### Phase 3: is_system coverage on both routes, and the lesson

#### Automated

- [x] 3.1 The new is_system suite passes: `npm run test:run`, 0 skipped
- [x] 3.2 Full suite green across all three phases: `npm run test:run`
- [x] 3.3 Type checking and linting pass: `npm run lint` and `npx astro check`
- [x] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 Reverting Phase 1's guard turns every case in the new suite red
- [ ] 3.6 `lessons.md` renders with the new section and its links resolve
