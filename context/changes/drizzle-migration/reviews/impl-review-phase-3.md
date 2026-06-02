<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Drizzle Migration

- **Plan**: context/changes/drizzle-migration/plan.md
- **Scope**: Phase 3 of 5
- **Date**: 2026-06-02
- **Verdict**: APPROVED
- **Findings**: 0 critical  4 warnings  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — adminClient.auth.admin.createUser() not wrapped in try/catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/index.ts:116
- **Detail**: SDK call awaited bare. On SDK throw, Worker crashes and compensating deleteUser is bypassed, leaving orphaned auth user. Pre-existing gap.
- **Fix**: Wrap createUser in try/catch; call deleteUser in catch block.
  - Strength: Closes orphaned-user gap; compensation pattern already in same handler.
  - Tradeoff: ~5 lines; SDK throws are rare.
  - Confidence: HIGH
  - Blind spot: SDK may already swallow throws internally.
- **Decision**: FIXED via try/catch around createUser call

### F2 — Race window in DELETE: UPDATE WHERE has no isNull(deleted_at) guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id].ts:161
- **Detail**: Two concurrent DELETE requests can both pass the SELECT guard and both succeed on the UPDATE. idempotency guard bypassed; deleted_at timestamp clobbered. Pre-existing pattern (Supabase RLS was the guard before).
- **Fix**: Add isNull(employees.deleted_at) to UPDATE WHERE; if rows.length === 0, return 409.
  - Strength: Atomic check-and-write; standard optimistic-lock pattern.
  - Tradeoff: 1-line WHERE change.
  - Confidence: HIGH
  - Blind spot: Concurrent requests at this app's volume are unlikely.
- **Decision**: FIXED — added `and(eq(employees.id, id), isNull(employees.deleted_at))` to UPDATE WHERE

### F3 — Double import of @/db/index

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/employees/index.ts:5–6
- **Detail**: createDb and employees imported in two separate statements; Phase 2 baseline uses one combined import.
- **Fix**: Merge into `import { createDb, employees } from "@/db/index";`
- **Decision**: FIXED

### F4 — export const prerender = false placed at line 54 instead of top

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/employees/index.ts:54
- **Detail**: All other API route files declare prerender = false at line 1; index.ts had it after the GET handler.
- **Fix**: Move to line 1.
- **Decision**: FIXED

### F5 — DELETE soft-delete returns {success:true} 200; absences DELETE returns 204

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/employees/[id].ts:169
- **Detail**: Soft-delete is not a hard delete — returning a body is defensible. Pre-migration code also returned {success:true} 200.
- **Fix**: No action needed unless API contract is being formalized.
- **Decision**: SKIPPED
