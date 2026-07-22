<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Restrict Partial-Day Hours to Training Types (S-14)

- **Plan**: `context/changes/hours-onsite-training-only/plan.md`
- **Scope**: Phases 1–2 of 2 (git range `971dba3..HEAD`)
- **Date**: 2026-07-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Triage state — COMPLETE (re-reviewed 2026-07-22)

- **Warnings (F1–F4)**: fixed in the prior session and **re-verified live** on 2026-07-22 —
  `npm run lint` 0 errors, `npm run test:run` 37/37 against a real DB (incl. the route-level
  guard tests and the TOCTOU→409 compare-and-swap test). The F3 CAS in `[id].ts:118-152` was
  re-traced across all PATCH interleavings and holds.
- **Observations (F5–F10)**: triaged 2026-07-22 —
  - F5 FIXED (3 comments reworded to reference `PARTIAL_DAY_TYPE_NAMES`).
  - F6 SKIPPED (read underpins CAS/404; micro-opt not worth added branching).
  - F7 FIXED via Fix A (both routes' user-reachable error bodies translated to Polish).
  - F8 FIXED (added `extractPgErrorConstraint`; 23503 now distinguishes the absence_type FK
    from the substitute FK — constraint names verified against the live DB).
  - F9 FIXED (both refine messages broadened to cover the full biconditional).
  - F10 ACCEPTED (unplanned service module is justified; keeps `absence-types.ts` client-safe).
- **F-A** (fix work uncommitted) — resolved: committed on 2026-07-22.

## Automated verification

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 10 warnings (all pre-existing in `packages/code-reviewer`) |
| `npm run build` | PASS — completes; Sentry sourcemap upload fails locally on missing auth token (not a build failure) |
| `npm test` | PASS — 29/29 at review time; **37/37 after the F1/F3 fixes** (6 files; +8 route-level guard tests) |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Verified clean

- Constants in `src/lib/absence-types.ts` match `supabase/migrations/20260526000002_seed_absence_types.sql:7-8` byte-for-byte, including diacritics.
- `ownershipWhere` (`[id].ts:83-86`) computed once and reused identically for the pre-read (`:96`) and the update (`:119`) — no tenancy bypass, moderator widening correct.
- POST guard placed after auth / employee lookup / moderator target resolution and before the insert (`index.ts:197-206`).
- Form edit-initialization defensively opens ineligible-type entries as full-day (`AbsenceFormDialog.tsx:32-45`); `AbsenceGrid.tsx:312` passes a remount `key`, so no stale-`useState` bug.
- Guard fails closed: nonexistent `absence_type_id` → undefined name → ineligible → 400.
- No schema change, no migration, no backfill, no role exemption, no grid/stats changes — "NOT doing" list respected.

## Findings

### F1 — New tests bypass the handlers; guard is unpinned

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: src/tests/api/absences/crud.test.ts:208-254
- **Detail**: Plan specified route-level cases ("POST … ⇒ 400", "PATCH … ⇒ 400"). All five tests call `isPartialDayViolation(db, …)` directly — none builds a `Request`, invokes `POST`/`PATCH`, or asserts a status code. The PATCH test (`:240-244`) re-implements the handler's effective-state resolution inline, a copy of `[id].ts:104-105`. Deleting the guard block at `[id].ts:107-116` leaves every test green. The POST guard (`index.ts:197-206`) has no coverage at all. Mitigating: this file has no HTTP harness anywhere — all existing tests are raw Drizzle.
- **Fix A ⭐ Recommended**: Add one handler-level test per route (import `POST`/`PATCH`, stub `context.locals.user`, assert status + body).
  - Strength: Pins the guard to the wire — the only thing that catches its removal.
  - Tradeoff: Introduces the first HTTP-invocation harness in this suite.
  - Confidence: HIGH — both routes export their handlers directly.
  - Blind spot: Haven't verified how cleanly locals/db stub for an Astro APIRoute here.
- **Fix B**: Keep service-level tests; document the gap.
  - Strength: Zero new infrastructure; matches file style.
  - Tradeoff: Enforcement boundary stays untested.
  - Confidence: MEDIUM — relies on review discipline.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added `src/tests/api/absences/partial-day-guard.test.ts` (8 route-level tests invoking the real POST/PATCH). Added an `astro:env/server` alias in `vitest.config.ts` + `src/tests/helpers/astro-env.ts` stub to make handlers importable. **Mutation-verified**: with the guard removed from both routes, all 13 `crud.test.ts` tests still passed while 3 of the new tests failed.

### F2 — Test suite runs nowhere; AGENTS.md contradicts it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: .github/workflows/ci.yml · AGENTS.md:9
- **Detail**: Criterion 1.3 is "integration tests pass" but nothing enforces it — CI runs only lint + build, no test step. The suite self-skips via `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` (`crud.test.ts:11`). `AGENTS.md:9` still states "No test runner is configured yet: there is no `npm test`… Do not invent test commands" — false since vitest landed, and actively misleading to the next agent.
- **Fix A ⭐ Recommended**: Add a `npm run test:run` step to the `ci` job with `DATABASE_URL_DIRECT` as a repo secret, and correct AGENTS.md:9.
  - Strength: Makes 1.3 a real gate; removes a stale hard rule.
  - Tradeoff: Needs a DB reachable from CI.
  - Confidence: HIGH — `test:run` already exists in package.json.
  - Blind spot: Haven't checked CI runner reachability to the Supabase direct endpoint.
- **Fix B**: Correct AGENTS.md:9 only; defer the CI step.
  - Strength: Removes the misleading rule immediately, no infra work.
  - Tradeoff: Tests still run only when someone remembers.
  - Confidence: HIGH — one-line doc edit.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added a `Test` step to the `ci` job running `npm run test:run`; corrected the stale hard rule at `AGENTS.md:9`. **Action required from you**: add repo secrets `DATABASE_URL_DIRECT` and `SUPABASE_SERVICE_KEY`. Until then the suite self-skips and the step is green-but-empty. These tests write to a real DB (create auth users + absence rows, then clean up) — point the secret at a test/branch database, not production.

### F3 — TOCTOU between the PATCH guard read and the update

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:93-119
- **Detail**: Read (`:93-101`), guard (`:109`) and update (`:119`) run outside a transaction. Two concurrent PATCHes can interleave: A (`{is_full_day: false, times}`) reads an eligible type and passes; B (`{absence_type_id: <ineligible>}`) commits between; A's update lands — final row is partial-day on an ineligible type. The DB CHECK `absences_time_check` constrains `is_full_day` against the time columns only, never against `absence_type_id`. Exposure is low (same user, same row, concurrent writes) but this is the one remaining way the invariant can be violated.
- **Fix A ⭐ Recommended**: Push the rule into the UPDATE's `WHERE` as a correlated `EXISTS` against `absence_types.name`; keep the JS guard only for the 400 message.
  - Strength: Atomic with the write at zero extra round-trips.
  - Tradeoff: Harder-to-read UPDATE.
  - Confidence: MEDIUM — no precedent for this shape in the repo.
  - Blind spot: Haven't drafted the Drizzle expression.
- **Fix B**: Wrap read+guard+update in `db.transaction` with `SELECT … FOR UPDATE`.
  - Strength: Textbook, easy to review.
  - Tradeoff: Adds a transaction and row lock to every PATCH; no other route uses `db.transaction`.
  - Confidence: MEDIUM — new pattern on Workers + postgres-js.
  - Blind spot: Transaction behavior under the Workers runtime unverified.
- **Decision**: FIXED via Fix A, realized as compare-and-swap. A correlated EXISTS on `absence_types` with a JS-constant type id would have been a tautology; the staleness lives in the fields defaulted from the read, so those are pinned in the UPDATE's WHERE (`[id].ts:118-127`). Zero-row now distinguishes 409 (moved under us) from 404 (gone). **Mutation-verified**: reverting to `ownershipWhere` makes the handler return 200 and write a time range onto an ineligible type.

### F4 — Phase 1 manual criteria still unchecked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md:276-278 · change.md status
- **Detail**: Items 1.4–1.6 (crafted POST ⇒ 400, crafted PATCH ⇒ 400, onsite partial-day POST stores both times) are `- [ ]` while all Phase 2 manual items are `- [x]`. `change.md` still reads `status: implementing`. These cover the actual enforcement boundary, and both 400 messages changed after Phase 1 (widened to list both types), so any earlier informal check is stale.
- **Fix**: Run the three crafted API calls against the deployed Worker, tick 1.4–1.6, set change.md status.
- **Decision**: FIXED — ticked plan.md 1.4-1.6 with a note that they were promoted from manual to automated coverage; set `change.md` status to `impl_reviewed`.

### F5 — Comments still say "onsite training" only

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/absence-partial-day.ts:13 · src/components/absence/AbsenceFormDialog.tsx:141 · src/pages/api/absences/index.ts:196
- **Detail**: After the approved widening to two types, three comments still describe the rule as onsite-training-only. Code correct; comments misstate the domain rule.
- **Fix**: Reword the three comments to reference both training types (or point at `PARTIAL_DAY_TYPE_NAMES`).
- **Decision**: FIXED (2026-07-22) — reworded absence-partial-day.ts, index.ts, AbsenceFormDialog.tsx.

### F6 — PATCH pre-SELECT runs on every request

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:93-97
- **Detail**: The existing-row read fires even for a PATCH touching only `comment` or `substitute_employee_id`, taking PATCH from 2 to 3–4 queries. Unnecessary when the body already pins effective state — notably `is_full_day === true`, where the guard early-returns. Its 404 role is redundant with `rows.length === 0` at `:132`. Partly moot if F3 Fix A lands.
- **Fix**: Skip the read when `parsed.data.is_full_day === true`.
- **Decision**: SKIPPED (2026-07-22) — read underpins CAS/404; not worth the branching.

### F7 — Mixed Polish/English error bodies reach the user

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/index.ts · src/pages/api/absences/[id].ts
- **Detail**: This change added Polish messages next to pre-existing English ones ("Database error", "Not found", "Unauthorized", "Invalid time/is_full_day combination"). `AbsenceFormDialog.tsx:93` renders `data.error` verbatim into `toast.error`, so users see Polish for the type rule and English for a DB error — the same defect class this change already fixed for the refine messages.
- **Fix A ⭐ Recommended**: Translate the remaining user-reachable messages in these two routes.
  - Strength: Finishes the Polish-facing direction already committed to.
  - Tradeoff: Slightly widens scope.
  - Confidence: HIGH — small contained string edits.
  - Blind spot: Some strings may be asserted in tests.
- **Fix B**: Split machine-readable `code` from human `message` in the response shape.
  - Strength: Proper long-term shape.
  - Tradeoff: Response-shape change touching every consumer.
  - Confidence: MEDIUM — needs a consumer sweep.
  - Blind spot: Haven't enumerated the consumers.
- **Decision**: FIXED via Fix A (2026-07-22) — user-reachable error bodies in both routes translated to Polish; no tests asserted on the English strings.

### F8 — FK violations all report "Substitute employee not found"

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:138 · src/pages/api/absences/index.ts:230
- **Detail**: Every `23503` maps to "Substitute employee not found." A nonexistent `absence_type_id` on a full-day write correctly skips the guard and fails the `absence_type_id` FK instead, surfacing the wrong message. Pre-existing, slightly more reachable now.
- **Fix**: Inspect `err.cause.constraint` to distinguish the two FKs.
- **Decision**: FIXED (2026-07-22) — added `extractPgErrorConstraint`; 23503 branches on `absences_absence_type_id_fkey` (name verified against the live DB).

### F9 — Refine message narrowed to one of two branches

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:138 · src/pages/api/absences/[id].ts:35
- **Detail**: The Polish translation reads "Godzina zakończenia musi być późniejsza niż godzina rozpoczęcia." but the refine covers a biconditional — it also fires when `is_full_day` is true and times are present, where the message is wrong. The replaced English message covered both branches. Not reachable from the form (it nulls times on full-day).
- **Fix**: Broaden the message to cover both branches, or split into two refines with a message each.
- **Decision**: FIXED (2026-07-22) — both refine messages broadened to cover the full biconditional.

### F10 — Unplanned service module (justified)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/services/absence-partial-day.ts
- **Detail**: Not in the plan, but implements plan items 2–3 rather than adding scope — and is why `absence-types.ts` can stay dependency-free as the plan's contract required (otherwise `AbsenceFormDialog`'s import pulls the Drizzle schema into the client bundle). Matches CLAUDE.md's `src/lib/services/` convention and removes query duplication between the two routes. Recommend accepting.
- **Fix**: Note the module in the plan's Phase 1 changes as an addendum.
- **Decision**: ACCEPTED (2026-07-22) — justified; keeps `absence-types.ts` client-safe.
