# Absence write hardening — Plan Brief

> Full plan: `context/changes/absence-write-hardening/plan.md`

## What & Why

Two absence write routes can put rows onto the technical admin, which every other write path in the
codebase refuses. `src/lib/employees.ts:4-12` states why that matters: RLS is bypassed on the
service-role connection, so "the admin is hidden and immutable" is app-enforced only. Because the
read side *is* filtered, such a row is invisible in the grid and the Details table — and therefore
undeletable through the UI.

This change closes the gap behind one shared guard, then adds the route-level tests whose absence
let it survive: `bulk.ts` shipped with none.

## Starting Point

`POST /api/absences` has always lacked the `is_system` check; `POST /api/absences/bulk` inherited
it by copying that route verbatim, under a plan instruction to do so. Neither route has tests on
any rejection path — the E2E suite can only send bodies the dialog can produce. A production probe
(2026-08-18) found **0** affected rows, so this is hardening, not incident response.

## Desired End State

Neither absence route will write a row onto the technical admin — whether a moderator targets it via
`employee_id`, or the admin (itself a moderator) writes its own column, or anyone names it as a
substitute. All three refusals answer 403 with the message the other five guarded routes already
use. `bulk.ts` has a route-level suite covering every rejection path, and both routes have the
`is_system` invariant proven by test rather than by assertion.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Guard placement | New absence-shaped helper in `src/lib/` | A third copy of the block is exactly what propagated the bug; `employee-target-guard.ts` has the wrong contract (path param, moderator-required). | Plan |
| Invariant reach | Both entrances — body target **and** caller's own id | The admin is seeded `role: moderator`, so a moderator-branch-only guard misses it writing its own column. | Plan |
| `PATCH`/`DELETE` on `[id].ts` | Out | They cannot retarget a row, so they cannot create an admin row; after this change none can exist to edit. | Plan |
| Substitute validation | Reject `is_system` only, not soft-deleted | A soft-deleted substitute is plausible on a historical row; rejecting it would break editing those rows. | Plan |
| Error semantics | 403, reusing `"Nie można modyfikować tego konta."` | One message for one invariant across every route. | Plan |
| Test scope | `bulk.ts` fully, plus the new guard on both routes | Discharges F4 and F5 together and proves both halves of the guard. | Plan |
| Gesture E2E specs (F2/F3) | Out | Different domain; keeps this an authorization + coverage change. | Plan |
| Docs debt | `lessons.md` entry only | The one item that caused this change; the stale `test-plan.md` claims are named but deferred. | Plan |

## Scope

**In scope:**

- A shared guard resolving the absence write target and validating the substitute
- Wiring it into `POST /api/absences` and `POST /api/absences/bulk`
- `src/tests/api/absences/bulk.test.ts` — six rejection paths plus created/overwritten reporting
- `src/tests/api/absences/is-system-guard.test.ts` — the invariant across both routes
- One `lessons.md` entry on unverified repo-wide claims

**Out of scope:**

- The read side (already closed at `absences/index.ts:100-101` in `63f7a38`)
- Data backfill or cleanup (probe found zero affected rows)
- Soft-deleted substitutes; `PATCH`/`DELETE` on `absences/[id].ts`
- Refactoring the five pre-existing routes onto the new helper (`workers-data-edit` carve-out)
- Gesture E2E specs; the stale `test-plan.md` claims and `is-system-guard.test.ts:10`

## Architecture / Approach

One module, one call per route. `resolveAbsenceWriteTarget(db, caller, { requestedEmployeeId,
substituteEmployeeId }, route)` returns `Response | { targetEmployeeId }` — the contract
`resolveModeratorTarget` already established. It runs the gates in the order the five existing
routes use: resolve target (moderator-only body id, else caller's own) → 404 if missing or
soft-deleted → **403 if the resolved target is the admin** → 403 if the substitute is the admin.

Because gate three tests the *resolved* target, one line covers both entrances. The caller and
target `is_system` checks add no queries — they widen two selects that already run; only the
substitute check adds one, and only when a substitute is supplied.

Tests split by concern rather than by route: `bulk.test.ts` owns bulk's rejection paths,
`is-system-guard.test.ts` owns the invariant across both — mirroring the identically-named suite
that already exists for `holiday-balances`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared guard | The module plus both call sites; the gap is closed | Silently changing the non-moderator contract, where a stray `employee_id` must stay ignored rather than rejected |
| 2. `bulk.test.ts` | Six rejection paths + reporting, against a real DB | Date collisions — needs its own weekday runs in the unclaimed May 2026 |
| 3. `is-system-guard.test.ts` + lesson | Both entrances and the substitute proven; the lesson recorded | Fixture hygiene — the `is_system` flag must be unflipped before teardown or an orphan looks like a second admin |

**Prerequisites:** `DATABASE_URL_DIRECT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` in `.env` — the DB
suites self-skip on the first and fail loudly without the other two.

**Estimated effort:** ~2–3 sessions; Phase 1 is small, Phases 2–3 are most of the work.

## Open Risks & Assumptions

- **The admin is assumed to be a technical account that should never hold an absence.** If anyone
  uses it as a working login, Phase 1 blocks a real workflow. The probe (0 absence rows, 0 holiday
  balances) supports the assumption but does not prove intent.
- **Tests hit a real remote database**, so they are slower and more failure-prone than unit tests;
  `vitest.config.ts` already sets 60 s timeouts and disables file parallelism for this reason.
- **A skipped suite reads as a passing one.** `describe.skipIf(!DATABASE_URL_DIRECT)` means a green
  run proves nothing unless the reported count is checked — hence "0 skipped" in the criteria.
- **`MAX_BULK_DATES` is now module-private** (made so in `1a2451b`), so the cap test asserts the
  boundary with a literal 32-date body and will drift if the constant changes.

## Success Criteria (Summary)

- A moderator cannot write an absence onto the technical admin through either route, by either
  entrance, or as a substitute — each refused with 403 and nothing written
- Every rejection path in `bulk.ts` is covered by a test that fails when its guard is removed
- Ordinary absence writing — moderator-for-colleague, employee-for-self, single-day and range — is
  unchanged
