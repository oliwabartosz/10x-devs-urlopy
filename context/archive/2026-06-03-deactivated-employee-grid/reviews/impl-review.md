<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deactivated Employee Grid

- **Plan**: `context/changes/deactivated-employee-grid/plan.md`
- **Scope**: Full plan (Phase 1 + Phase 2)
- **Date**: 2026-06-03
- **Verdict**: APPROVED (after triage fixes)
- **Findings**: 0 critical  1 warning  2 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — api/absences GET handler: role not selected, moderator join is dead code

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: src/pages/api/absences/index.ts:45–48
- **Detail**: The GET handler declared employeeRow as { id: string } and selected only employees.id. employeeRow.role was always undefined at runtime — the moderator join path was dead code. AbsenceDetailsSubcards' today/yearly lazy-fetches were unaffected by the Phase 1 fix. Compare to POST handler which correctly selected role.
- **Fix**: Added `role: employees.role` to the GET handler select and updated the type annotation to `{ id: string; role: "employee" | "moderator" }`.
- **Decision**: FIXED

### F2 — Stale comment in api/absences after role-conditional join

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/index.ts:96–99
- **Detail**: Original comment said "RLS policy intentionally allows all authenticated users to read all employees' absences." After the role-conditional join, regular employees only get active employees' absences.
- **Fix**: Updated comment to describe the moderator vs. regular employee split.
- **Decision**: FIXED

### F3 — Inline ternary vs. named variable (structural drift)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: dashboard.astro:101–104, api/absences/index.ts:102–105
- **Detail**: Plan specified named variables absencesJoin / joinCondition. Implementation inlined the ternaries. Logic identical.
- **Fix**: Extracted to named variables `absencesJoin` (dashboard.astro) and `joinCondition` (api/absences/index.ts) as the plan specified.
- **Decision**: FIXED

### F4 — deleted_at: Date|null type vs runtime string|null in React islands

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceGrid.tsx:65,98
- **Detail**: Employee.deleted_at typed Date|null but Astro serializes to string for client:load islands. The !!emp.deleted_at truthiness check is safe for both. Pre-existing pattern (EmployeeManagementSheet.tsx).
- **Decision**: SKIPPED — pre-existing codebase-wide pattern; no behavioral impact.
