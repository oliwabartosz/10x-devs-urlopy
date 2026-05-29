<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Monthly Grid — Own Absence CRUD (S-01)

- **Plan**: `context/changes/monthly-grid-own-absence/plan.md`
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict**: SOUND (post-triage)
- **Findings**: 1 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | WARNING → PASS (F3 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F4, F6 fixed) |
| Plan Completeness | FAIL → PASS (F1, F2, F5 fixed) |

## Grounding

5/5 paths ✓ · 3/3 symbols ✓ · zod NOT FOUND (flagged as F1) · Topbar.astro confirmed ✓ · biconditional CHECK confirmed ✓ · brief↔plan ✓

## Findings

### F1 — Zod used in Phase 2 but not installed

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — API Routes
- **Detail**: Phase 2 uses z.number(), z.boolean() etc. but zod is not in package.json. Build would fail.
- **Fix**: Added `npm install zod` as a Prerequisites step at the top of Phase 2.
- **Decision**: FIXED

### F2 — Key Discoveries cites the old (superseded) hours CHECK

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries bullet
- **Detail**: Cited `CHECK (is_full_day OR hours IS NOT NULL)` — the old unidirectional constraint. Actual (after 20260527 migration): biconditional `CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))`.
- **Fix**: Updated Key Discoveries to cite the biconditional and migration file.
- **Decision**: FIXED

### F3 — Dashboard rewrite omits Topbar — no sign-out after Phase 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3 — dashboard.astro Contract
- **Detail**: Topbar.astro (auth-aware nav with sign-out) not mentioned in Phase 3's Contract. After rewrite users have no sign-out button.
- **Fix**: Added Topbar import + render to Phase 3 Contract item 1.
- **Decision**: FIXED

### F4 — No DTO types planned; TypeScript strict will bite

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 (API routes) and Phase 4 (AbsenceFormDialog)
- **Detail**: src/types.ts has read-model interfaces only. API routes need AbsenceInsert/AbsenceUpdate for Supabase generics under strict mode.
- **Fix A ⭐**: Added Phase 2 §0 to create `AbsenceInsert` + `AbsenceUpdate` types in src/types.ts.
- **Decision**: FIXED via Fix A

### F5 — Auth guard makes a redundant Supabase round-trip

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Critical Implementation Details + Phase 2 §1
- **Detail**: Plan said to call supabase.auth.getUser() — middleware already resolves context.locals.user.
- **Fix**: Updated Critical Implementation Details and Phase 2 §1 to use context.locals.user.
- **Decision**: FIXED

### F6 — PATCH '0 rows' maps to wrong status code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 — PATCH contract
- **Detail**: Plan mapped both RLS violation and not-found to 403. RLS error (42501) → 403; empty data + no error → 404.
- **Fix**: Updated PATCH contract to distinguish the two cases.
- **Decision**: FIXED
