<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Monthly Grid — Own Absence CRUD (S-01)

- **Plan**: context/changes/monthly-grid-own-absence/plan.md
- **Scope**: All Phases (1–4 of 4)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical · 4 warnings · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — PGRST116 not distinguished in POST /api/absences employee lookup

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:36-43
- **Detail**: The employee lookup casts the error as `{ message: string } | null`, losing the `code` field. When a user has no employee record, Supabase .single() returns error.code = "PGRST116" (zero rows) — but since the error object is truthy, line 38 fires and returns 503 "Database error". The 403 branch at lines 41-43 is unreachable because .single() never returns null data without a non-null error. A non-onboarded user calling POST gets a misleading server error instead of a clear 403.
- **Fix**: Add `code` to the error type cast and check PGRST116 first. Replace lines 36-43 employee result handling with: cast includes `error: { code: string; message: string } | null`; check `employeeResult.error?.code === "PGRST116" || !employeeResult.data` → 403; then `employeeResult.error` → 503.
- **Decision**: FIXED

### F2 — Raw DB error messages returned to client in fallthrough branches

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:67, src/pages/api/absences/[id].ts:63, 95
- **Detail**: Three fallthrough error branches return `result.error.message` directly. PostgREST error messages include table names, column names, and constraint names — information-disclosure anti-pattern.
- **Fix**: Replace `result.error.message` with `"Database error"` in each of the three fallthrough branches. Keep specific-code branches (23505, 42501, PGRST116) as-is.
- **Decision**: FIXED

### F3 — select("*") on currentEmployee serializes user_id and deleted_at into browser props

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:29
- **Detail**: `currentEmployee` fetched with `.select("*")` — full row including `user_id`, `deleted_at`, `created_at` serialized as client:load prop. AbsenceGrid and AbsenceFormDialog only use `currentEmployee.id`.
- **Fix A ⭐ Recommended**: Change to `.select("id, first_name, last_name, role")`. Update type cast to `Pick<Employee, "id" | "first_name" | "last_name" | "role">`.
  - Strength: Matches employees list query (line 49); removes user_id from browser.
  - Tradeoff: Need to verify no client-side code accidentally uses other fields.
  - Confidence: HIGH — only `id` is used client-side for comparisons.
  - Blind spot: Future slices may need more currentEmployee fields in the island.
- **Fix B**: Accept for now, defer to moderator slice.
  - Strength: Zero effort; data is the user's own record.
  - Tradeoff: Leaks user_id into every page load.
  - Confidence: MEDIUM — acceptable for MVP, sets bad precedent.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

### F4 — Zod schemas accept is_full_day/hours combinations that violate the DB CHECK constraint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:6-13, src/pages/api/absences/[id].ts:6-15
- **Detail**: DB has biconditional CHECK: `(is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL)`. Neither Zod schema enforces this. Invalid combos pass Zod, hit DB, return 23514 check-violation, fall through to raw-message branch (F2). Client gets opaque DB constraint message.
- **Fix**: Add `.refine()` to both schemas enforcing the biconditional. Also add a `23514` handler in both routes returning 400 with a clean message.
  - Strength: Validates at API boundary; gives client a readable message.
  - Tradeoff: PATCH refinement must account for partial payloads where only one of the two fields is present.
  - Confidence: HIGH — plain translation of the DB constraint.
  - Blind spot: PATCH partial-update semantics make the refine slightly more complex.
- **Decision**: FIXED

### F5 — toLocaleDateString("sv") depends on ICU locale data in Workers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceFormDialog.tsx:38 (also AbsenceGrid.tsx:114)
- **Detail**: `toLocaleDateString("sv")` used as portable ISO YYYY-MM-DD formatter. Relies on runtime having full ICU data. Cloudflare Workers typically has it, but it's an undocumented convention. If ICU fails, date sent to API is wrong — silent Zod failure or wrong DB date.
- **Fix**: Replace with explicit formatter: `` `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}` `` in both AbsenceFormDialog.tsx:38 and AbsenceGrid.tsx:114.
- **Decision**: FIXED

### F6 — DELETE returns 404 for RLS-blocked records

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:98-100
- **Detail**: When RLS blocks a delete (not owner), Supabase returns empty array without error. Empty-array branch returns 404 instead of 403. Operation is still blocked — status-code accuracy issue only.
- **Fix**: Document as known limitation in a comment, or add a prior SELECT to distinguish.
- **Decision**: FIXED

### F7 — absences fetched with select("*") in dashboard.astro

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:53
- **Detail**: created_at and updated_at fetched and serialized as props but never used.
- **Fix**: Change to `select("id, employee_id, absence_type_id, date, is_full_day, hours, comment, substitute_employee_id")`.
- **Decision**: FIXED

### F8 — comment field has no max-length constraint in Zod schemas

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:11, src/pages/api/absences/[id].ts:12
- **Detail**: z.string().nullable() has no .max() — authenticated user could submit arbitrarily large comments.
- **Fix**: Add `.max(500)` to comment field in both schemas.
- **Decision**: FIXED

### F9 — AbsenceGrid absence map built with absence.date (DB string) vs date.toLocaleDateString("sv")

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/absence/AbsenceGrid.tsx:44-46
- **Detail**: Plan specified keying by toLocaleDateString("sv") from a Date object; implementation keys by absence.date (raw DB YYYY-MM-DD string). Lookup at line 126 uses toLocaleDateString("sv") on a local Date. Both produce identical strings — functionally benign drift.
- **Fix**: No action required. If F5 is fixed with explicit formatter, map construction could also switch for consistency.
- **Decision**: SKIPPED
