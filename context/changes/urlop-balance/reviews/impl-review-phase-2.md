<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Urlop Balance Tracker

- **Plan**: context/changes/urlop-balance/plan.md
- **Scope**: Phase 2 of 3 (API + Used Computation)
- **Date**: 2026-07-13
- **Verdict**: APPROVED (1 warning worth deciding before Phase 3)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS (1 observation) |
| Success Criteria | PASS (2.3 manual pending) |

Automated criteria re-confirmed at review time: `npm run lint` → 0 errors; `npm run test:run` → 22/22 pass. Plan-drift agent: full MATCH, no drift, no scope creep (buildBalanceView is a plan-serving extra export, not creep).

## Findings

### F1 — POST upsert silently clobbers adjustment / valid_until on update

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: src/pages/api/holiday-balances/index.ts:111-112, 181-186
- **Detail**: `used_adjustment_days` is `.optional().default(0)` and `valid_until` is `.nullable().optional()` (applied as `valid_until ?? null`); both are written into the `onConflictDoUpdate` `set`. A POST that omits `used_adjustment_days` resets an existing reconciliation baseline to 0; one that omits `valid_until` wipes the "Do dnia" date to null — silent data loss. `current_entitlement_days`/`carryover_days` are required, so the asymmetry is the footgun. The plan itself wrote these body fields as optional (line 128) without considering the update-path clobber — a latent plan gap, not implementation drift. Phase 3's dialog will build against this contract, so this is the moment to lock it.
- **Fix A ⭐ Recommended**: Build the update `set` from only the keys present in the request body (true partial update); keep insert defaults for first-write.
  - Strength: Honors the plan's optional-body markers AND removes the clobber — omitting a field preserves the stored value.
  - Tradeoff: Slightly more code; create vs update paths diverge a bit.
  - Confidence: HIGH — single upsert call site, mechanical change.
  - Blind spot: None significant.
- **Fix B**: Make `used_adjustment_days` and `valid_until` required keys in the POST zod schema (`valid_until` still nullable) — explicit full replace.
  - Strength: Simplest; matches "last-write-wins"; the Phase 3 dialog sends all fields anyway.
  - Tradeoff: Contradicts the plan's `?`-optional body markers; any caller must send all fields or get a 400.
  - Confidence: HIGH — one-line schema change.
  - Blind spot: Future non-UI callers must know to send everything.
- **Decision**: PENDING

### F2 — POST returns 200 for both create and update

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/holiday-balances/index.ts:191
- **Detail**: Sibling absences POST returns 201 on create (absences/index.ts:211); this upsert returns 200 always. Defensible since create/update are indistinguishable in an upsert; minor REST-semantics nit.
- **Fix**: Leave as-is, or return 201 when the row was inserted (needs insert-vs-update detection on the upsert).
- **Decision**: PENDING

### F3 — Any authenticated employee can read any employee's balance

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (intended per plan)
- **Location**: src/pages/api/holiday-balances/index.ts:70-90
- **Detail**: GET `?employee_id=` exposes entitlement/used/left for any active employee. Consistent with the plan ("both can edit any", lines 34/129) and the existing model where all absences are visible to everyone. Entitlement numbers are slightly more sensitive than already-shared absence data — flagged only to confirm the read exposure is desired.
- **Fix**: Confirm intended (no change), or gate cross-employee GET to moderators.
- **Decision**: PENDING

### F4 — teardownTestEmployee doesn't delete holiday_balances (FK fragility)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria (test reliability)
- **Location**: src/tests/api/holiday-balances/used-computation.test.ts:49-53 + src/tests/helpers/fixtures.ts:39-54
- **Detail**: Cleanup relies on `afterEach` clearing `holiday_balances` before `afterAll` deletes the employee. Works today (afterEach always runs), but a leaked balance row → FK 23503 on the employee DELETE, swallowed by teardown's try/catch → orphaned employee + Supabase auth user. The `urlop planowany` absence_type cleanup is handled correctly (created-flag tracked; referencing absences cleared by afterEach first).
- **Fix**: Delete `holiday_balances` inside `teardownTestEmployee` (shared helper) so all balance-touching tests are FK-safe.
- **Decision**: PENDING
