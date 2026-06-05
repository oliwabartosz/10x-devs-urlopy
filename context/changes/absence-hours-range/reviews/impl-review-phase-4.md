<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Absence Hours → Start/End Time Range

- **Plan**: context/changes/absence-hours-range/plan.md
- **Scope**: Phase 4 of 5
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  2 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS (automated); manual pending |

## Findings

### F1 — Template literal emits the string "undefined" when times are null

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceDetailsTable.tsx:27
- **Detail**: `formatAbsenceTime` returned a bare optional-chain inside a template literal — `${absence.start_time?.slice(0, 5)}` — which coerces to the string "undefined" when the field is null. DB/API constraints prevent this in practice, but the TypeScript type permits it. The sibling `formatTime` helper in AbsenceGrid.tsx already used `?? ""`.
- **Fix**: Add `?? "?"` after each optional chain to match the sibling pattern.
- **Decision**: FIXED — applied `?? "?"` fallback to both fields in AbsenceDetailsTable.tsx:27.

### F2 — Yearly-absences fetch cast to Absence[] while GET endpoint omits updated_at

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceStats.tsx:148
- **Detail**: AbsenceStats casts the yearly-absences response as `Promise<Absence[]>`, but the GET /api/absences SELECT clause omitted `updated_at`, while `Absence` (= `typeof absences.$inferSelect`) includes `updated_at: Date`. The cast was a type lie — the runtime object was missing that field while TypeScript believed it was present. No crash today since nothing reads `updated_at` from yearly data, but GET and POST responses were inconsistent in shape.
- **Fix A ⭐ Recommended**: Add `updated_at: absences.updated_at` to the GET endpoint SELECT in src/pages/api/absences/index.ts.
  - Strength: Makes GET and POST responses consistent; the cast becomes accurate. Dashboard SSR query already selects updated_at.
  - Tradeoff: Adds one field to the list endpoint response (negligible size).
  - Confidence: HIGH — identical field present in PATCH response and dashboard.astro query.
  - Blind spot: Haven't verified whether test fixtures assert exact response shape.
- **Fix B**: Define a narrower `AbsenceListItem` type that omits `updated_at` and use it for the cast.
- **Decision**: FIXED via Fix A — added `updated_at: absences.updated_at` to GET endpoint SELECT.

### F3 — Inconsistent null-handling patterns across Phase 4 files

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/absence/AbsenceDetailsTable.tsx:27 and src/components/absence/AbsenceGrid.tsx:134
- **Detail**: Phase 4 introduced two different null-handling styles for the same time fields across two sibling files. Fixing F1 resolved the material part.
- **Fix**: Resolved by F1 fix.
- **Decision**: SKIPPED — covered by F1.

### F4 — textColorForBg silently propagates NaN for malformed hex

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceGrid.tsx:14
- **Detail**: `parseInt` on a malformed color string returns NaN; NaN > 128 is false, silently defaulting to "text-white". DB enforces `CHECK (color ~ '^#[0-9a-fA-F]{6}$')` so the path is unreachable with persisted data. The guard makes the intent explicit.
- **Fix**: Add `if (hex.length !== 6) return "text-white";` after the `replace("#", "")` call.
- **Decision**: FIXED — guard added at AbsenceGrid.tsx:16.

### F5 — Grid render gate checks start_time but not end_time

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceGrid.tsx:134
- **Detail**: The span render condition was `!absence.is_full_day && absence.start_time`, but `formatTime(absence.end_time)` ran unconditionally inside. If end_time were null while start_time was set (impossible per DB CHECK, permitted by the type), the cell would show "HH:MM–" with a trailing em-dash.
- **Fix**: Extend the gate to `&& absence.end_time`.
- **Decision**: FIXED — condition extended to `absence.start_time && absence.end_time`.
