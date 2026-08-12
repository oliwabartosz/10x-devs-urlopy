<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Employee Grid Order

- **Plan**: context/changes/employee-grid-order/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-09
- **Verdict**: NEEDS ATTENTION → APPROVED after triage
- **Findings**: 0 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Notes:** All 7 planned items MATCH. Unplanned file changes (Sentry integration across `.dev.vars.example`, `ci.yml`, `astro.config.mjs`, `sentry.*.config.ts`, `wrangler.jsonc`) are entirely orthogonal — no scope creep.

## Findings

### F1 — Non-atomic N+1 bulk UPDATE in order endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/order.ts:63–68
- **Detail**: `Promise.all` fired one UPDATE per employee — N round-trips and non-atomic. Partial DB state on mid-batch failure while the client correctly reverts UI.
- **Fix A ⭐ Recommended**: Replace with single UNNEST-based UPDATE
  - Strength: One round-trip regardless of team size; atomicity for free; consistent with `sql\`\`` pattern already used in dashboard.astro.
  - Tradeoff: Requires raw `sql\`\`` template.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Fix B**: Wrap Promise.all in `db.transaction()`
  - Strength: Minimal change; fixes atomicity immediately.
  - Tradeoff: Keeps the N+1, holds a DB connection for all round-trips.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — rewrote as `UNNEST(ARRAY[...])`-based single UPDATE

### F2 — Unbounded payload with no ID existence check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/order.ts:22–24
- **Detail**: Zod schema accepted an `order` array of any length. A moderator could POST thousands of UUIDs and force thousands of no-op UPDATEs. RLS blocks cross-tenant writes; resource-exhaustion concern only.
- **Fix**: Add `.max(500)` to the array schema.
- **Decision**: FIXED — added `.max(500)` to the order array Zod schema

### F3 — TOCTOU race on display_order assignment for new employees

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/index.ts:133–138
- **Detail**: Two simultaneous POST /api/employees requests could read the same `MAX(display_order)` and insert with duplicate `display_order` values. No UNIQUE constraint; secondary sort key handles ties. Concurrent hires are rare at app scale.
- **Fix**: Document as best-effort with a comment.
- **Decision**: FIXED — added comment documenting that duplicates are tolerated and resolved by the next moderator drag

### F4 — GET /api/employees omits display_order from column projection

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/employees/index.ts:32–53
- **Detail**: The `Employee` type (via `$inferSelect`) now includes `display_order`, but the GET handler's `cols` projection didn't expose it. No runtime breakage today (dashboard bypasses this endpoint), but future client consumers would silently receive `undefined`.
- **Fix**: Add `display_order: employees.display_order` to `cols`.
- **Decision**: FIXED — added `display_order` to the GET handler's column projection

### F5 — Optimistic rollback is a no-op if component unmounts

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceGrid.tsx:161–172
- **Detail**: If the user navigated away between the fetch and the `.catch()`, `setOrderedEmployees(prevOrder)` ran on an unmounted component — React 19 suppresses the warning but the rollback was silently skipped.
- **Fix**: Add `AbortController` + `useEffect` cleanup to cancel the in-flight fetch on unmount.
- **Decision**: FIXED — added `abortControllerRef` with `useEffect` cleanup; fetch now passes `signal`; `.catch()` ignores `AbortError`
