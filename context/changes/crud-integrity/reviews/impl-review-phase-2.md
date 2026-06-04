<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CRUD Integrity — Phase 2

- **Plan**: context/changes/crud-integrity/plan.md
- **Scope**: Phase 2 of 4
- **Date**: 2026-06-04
- **Verdict**: APPROVED (all fixes applied during triage)
- **Findings**: 2 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS (fixed) |
| Success Criteria | PASS |

## Findings

### F1 — Orphaned auth user on employee-insert failure

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/tests/helpers/fixtures.ts:20–31
- **Detail**: createTestEmployee created a real Supabase auth user then inserted the employee. If the DB insert threw, the auth user was silently orphaned with no compensating delete.
- **Fix**: Wrapped db.insert in try/catch; added admin.auth.admin.deleteUser(data.user.id) in the catch block before re-throwing.
- **Decision**: FIXED

### F2 — afterAll runs with undefined employeeId if beforeAll fails

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/tests/api/absences/crud.test.ts:9–18
- **Detail**: testEmployeeId typed as `string` but only set in beforeAll. If beforeAll throws, afterAll calls teardown with undefined, causing UNDEFINED_VALUE Drizzle error.
- **Fix**: Changed declarations to `string | undefined`; added `if (!db || !employeeId) return;` guard at top of teardownTestEmployee.
- **Decision**: FIXED

### F3 — Duplicate-INSERT assertion accepts top-level code, weakening the plan's intent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/tests/api/absences/crud.test.ts:140
- **Detail**: Plan required checking cause.code === '23505' specifically, not top-level code. Implementation used `e.code === "23505" || e.cause?.code === "23505"` — the OR weakens the regression guard.
- **Fix A ⭐ Applied**: Tightened to `e.cause?.code === "23505"` only.
- **Decision**: FIXED via Fix A

### F4 — Scope: vitest.config.ts extended beyond Phase 2 plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: vitest.config.ts:13–26
- **Detail**: Plan made no mention of changing vitest.config.ts in Phase 2. The .dev.vars loader was added to make DATABASE_URL_DIRECT and SUPABASE_SERVICE_KEY available. Functionally necessary for the fixture adaptation.
- **Decision**: SKIPPED — benign and necessary

### F5 — Duplicate-INSERT test leaks first row to afterAll teardown

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/tests/api/absences/crud.test.ts:123–129
- **Detail**: All other tests cleaned up inline; duplicate-INSERT test relied on afterAll for its first row.
- **Fix**: Added `await db.delete(absences).where(eq(absences.employee_id, testEmployeeId))` after the rejects assertion.
- **Decision**: FIXED

### F6 — DB connection pool not closed in afterAll

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/tests/helpers/db.ts:8
- **Detail**: getTestDb() creates a postgres-js pool never explicitly closed. Not a real leak now (one pool per suite) but will accumulate if future suites call getTestDb() multiple times.
- **Fix**: Added `await db?.$client.end()` at the end of afterAll in crud.test.ts.
- **Decision**: FIXED

### F7 — absence_type_id: 1 seed dependency undocumented

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/tests/api/absences/crud.test.ts:27 (and repeated)
- **Detail**: All tests use absence_type_id: 1 without documenting the seed migration prerequisite. Failure on freshly migrated DB gives a confusing FK error 23503.
- **Fix**: Added comment at top of describe block: `// Requires: 20260526000002_seed_absence_types.sql applied`
- **Decision**: FIXED
