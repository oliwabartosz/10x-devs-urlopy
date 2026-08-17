<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Details Subcards Implementation Plan

- **Plan**: context/changes/details-subcards/plan.md
- **Scope**: Phase 1 of 3
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION (all findings fixed during triage)
- **Findings**: 0 critical  3 warnings  2 observations

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

### F1 — Missing export const prerender = false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/index.ts (whole file)
- **Note**: PRE-EXISTING — absent before Phase 1.
- **Detail**: CLAUDE.md requires all API routes to export const prerender = false. All three employee routes carry it; absences/index.ts was the only route missing it.
- **Fix**: Added `export const prerender = false;` at top of file.
- **Decision**: FIXED

### F2 — Unbounded date-range query; no max span enforced

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:60–76
- **Detail**: New date-range mode accepted any from/to pair. A caller could request decades of data in one shot. The only intended consumer (Today subcard) uses a 2-week window.
- **Fix A ⭐ Applied**: Validate max span (90 days), return 400 if exceeded.
  - Strength: Matches intended use case; easy to relax later.
  - Tradeoff: Hard-codes a policy.
  - Confidence: HIGH — only consumer needs 2 weeks.
  - Blind spot: No other callers checked.
- **Decision**: FIXED via Fix A

### F3 — Raw Supabase error message forwarded to client

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:81
- **Note**: PRE-EXISTING — present before Phase 1.
- **Detail**: `return json({ error: result.error.message }, 500)` leaked raw PostgreSQL/Supabase error text. All other 500 paths use opaque strings.
- **Fix**: Replaced with `return json({ error: "Database error" }, 500)`.
- **Decision**: FIXED

### F4 — from > to not rejected; silently returns empty result

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:62–64
- **Detail**: Inverted date range (from > to) was accepted and queried, returning 200 []. No error signal for the caller.
- **Fix**: Added `if (new Date(from) > new Date(toParsed.data)) return json({ error: "from must be ≤ to" }, 400);`
- **Decision**: FIXED

### F5 — Regex accepts invalid calendar dates; V8 silently auto-corrects

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:13
- **Detail**: DateSchema regex `/^\d{4}-\d{2}-\d{2}$/` accepted 2026-02-31 or 2026-13-99. V8 silently rolls over invalid dates, shifting the query window.
- **Fix**: Added `.refine()` to DateSchema that validates the date round-trips through `new Date()` back to the same string.
- **Decision**: FIXED
