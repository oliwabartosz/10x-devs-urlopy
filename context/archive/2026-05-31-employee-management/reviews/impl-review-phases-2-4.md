<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Employee Management

- **Plan**: context/changes/employee-management/plan.md
- **Scope**: Phases 2–4 of 4
- **Date**: 2026-05-31
- **Verdict**: APPROVED (all findings triaged and resolved)
- **Findings**: 2 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS (fixed) |
| Success Criteria | PASS |

## Findings

### F1 — Orphaned auth user on employee insert failure

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/index.ts:85–93
- **Detail**: Auth user created before employees row. DB insert failure → orphaned auth user; email permanently locked.
- **Fix**: Compensating `adminClient.auth.admin.deleteUser(authData.user.id).catch(() => undefined)` in insert-error branch.
- **Decision**: FIXED via Fix A

### F2 — user_id of every employee serialized into browser HTML

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:57–58
- **Detail**: `select("*")` included `user_id` (Supabase Auth UUID) in the `allEmployees` prop passed to `client:load` island.
- **Fix**: Changed to `select("id, first_name, last_name, role, deleted_at, created_at")`.
- **Decision**: FIXED

### F3 — DELETE returns 404 for already-deactivated instead of 409

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id].ts:154–156
- **Detail**: Already-soft-deleted branch returned 404; restore.ts uses 409 for the symmetric case.
- **Fix**: Changed to 409.
- **Decision**: FIXED

### F4 — Fragile duplicate-email detection via string match

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/index.ts:79
- **Detail**: `authError.message.includes("already")` is unstable. `authError.status === 422` already covers this.
- **Fix**: Removed the string-match; relies solely on `status === 422`.
- **Decision**: FIXED

### F5 — EditEmployeeDialog state stale on rapid employee switch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/components/employee/EmployeeManagementSheet.tsx:140
- **Detail**: `useState` from prop ignores subsequent prop changes; stale values shown if `editTarget` changes.
- **Fix**: Added `key={editTarget.id}` to `<EditEmployeeDialog>`.
- **Decision**: FIXED

### F6 — No guard against demoting the last moderator

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id].ts:89–91
- **Detail**: PATCH could leave zero active moderators.
- **Fix**: Added count check before applying a moderator→employee role downgrade; returns 409 if only one moderator remains.
- **Decision**: FIXED via Fix A

### F7 — No GET /api/employees endpoint

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/employees/index.ts
- **Detail**: Employee list was SSR-only; absences API exports GET + POST.
- **Fix**: Added GET handler — returns all employees (incl. deleted) for moderators, active-only for non-moderators.
- **Decision**: FIXED

### F8 — Client-side password min-length guard duplicates server Zod

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/components/employee/AddEmployeeDialog.tsx:130
- **Detail**: `password.length < 8` in disabled condition redundant with `z.string().min(8)` on server.
- **Fix**: Removed the length check from the button disabled condition.
- **Decision**: FIXED

### F9 — Three sequential DB round-trips per PATCH/DELETE

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id].ts:36–44, 114–132
- **Detail**: fetch caller role → fetch target state → mutate. Acceptable at current scale.
- **Decision**: SKIPPED
