<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Moderator Absence Management

- **Plan**: context/changes/moderator-absence-management/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical · 1 warning · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — employee_id sent in PATCH body (plan said POST only)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/absence/AbsenceFormDialog.tsx:53–61
- **Detail**: handleSave built one body object with `employee_id: targetEmployee.id` reused for both POST and PATCH. Plan specified PATCH does not need it. Server's AbsenceUpdateSchema excluded the field so it was silently ignored — no functional regression — but the unnecessary coupling was a risk if PATCH schema were extended.
- **Fix**: Separate POST and PATCH body objects; `employee_id` only in POST.
- **Decision**: FIXED

### F2 — z.uuid() used instead of z.string().uuid()

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/absences/index.ts:65
- **Detail**: Plan specified `z.string().uuid().optional()`; implementation uses `z.uuid().optional()` — the idiomatic Zod v4 form (project uses Zod 4.4.3). Functionally identical. Plan wording was Zod v3 style.
- **Fix**: Leave as-is; `z.uuid()` is correct for Zod v4.
- **Decision**: SKIPPED (intentional — implementation is more correct)

### F3 — PATCH/DELETE auth relies solely on RLS (deliberate design choice)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts
- **Detail**: Plan explicitly chose RLS-only auth for PATCH/DELETE. DB policies enforce ownership correctly. Added a comment so future maintainers know ownership enforcement is at the RLS layer.
- **Fix**: Added comment above PATCH handler documenting the RLS auth pattern.
- **Decision**: FIXED

### F4 — Topbar reads role from prop instead of Astro.locals

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Topbar.astro:3–6
- **Detail**: `user` is read from `Astro.locals` directly; `role` comes from an optional prop. If Topbar is reused without the prop, badge silently disappears. No current bug — dashboard.astro passes it correctly.
- **Fix**: Lesson recorded. Code left as-is per user decision.
- **Decision**: ACCEPTED-AS-RULE: Prop threading vs. self-contained component lookup
