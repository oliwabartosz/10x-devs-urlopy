<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Monthly Grid — Own Absence CRUD

- **Plan**: context/changes/monthly-grid-own-absence/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION (resolved during triage)
- **Findings**: 1 critical · 4 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL (fixed) |

## Findings

### F1 — Lint crash: no-misused-promises on return Astro.redirect()

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/dashboard.astro:16,21
- **Detail**: `npm run lint` crashed with "Non-null Assertion Failed: Expected node to have a parent" on the `@typescript-eslint/no-misused-promises` rule. Root cause: `astro-eslint-parser` doesn't wire up parent nodes for ReturnStatement nodes in Astro frontmatter. The two `return Astro.redirect()` calls triggered it. CI runs `npm run lint` on every push to main.
- **Fix Applied**: Added `"@typescript-eslint/no-misused-promises": "off"` to the `astroConfig` block in `eslint.config.js` (scoped to `**/*.astro` only). Standard workaround for this parser/rule incompatibility.
- **Decision**: FIXED via Fix A

### F2 — monthParam not validated before parseInt

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:11–12
- **Detail**: `?month=abc` → `split("-")[1]` is undefined → `month = NaN`. NaN propagates into the Supabase date range query, silently returning zero rows. Grid renders empty instead of falling back to the current month.
- **Fix Applied**: Replaced `isValidMonth` + `!` approach with `validMonthParam` variable (`monthParam != null && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : null`). TypeScript narrows to string in ternary branches, no non-null assertion needed.
- **Decision**: FIXED

### F3 — currentEmployee DB error silently treated as "no record"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:24–29
- **Detail**: The `error` from `.single()` was discarded. DB failures (network, 5xx, RLS) were treated the same as the "zero rows" case (PGRST116), showing "contact moderator" instead of a server error.
- **Fix Applied**: Restored type cast with `as unknown as { data: Employee | null; error: DbError }`. Destructures and checks `employeeError.code !== "PGRST116"` to differentiate DB errors from the expected not-found case. Added `employeeDbError` flag used in template.
- **Decision**: FIXED

### F4 — Parallel query errors silently swallowed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:47–49
- **Detail**: `data ?? []` on all three parallel query results — any query failure silently renders an empty grid. Most silent: if `absence_types` fails, Phase 4's type selector and cell colors break without error.
- **Fix Applied**: Added `gridDbError` flag. After Promise.all, checks `employeesResult.error || absencesResult.error || typesResult.error` and sets `gridDbError = true`. Template shows error message when `employeeDbError || gridDbError`.
- **Decision**: FIXED

### F5 — Absence/employee queries rely entirely on RLS for scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:44–46
- **Detail**: Verified RLS policies in `supabase/migrations/20260526000001_schema.sql`. The `employees` SELECT and `absence_types` SELECT policies are correct (all authenticated users). The `absences_select` policy is OWN-ONLY for regular employees (`employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())`). This means Phase 4's grid will show all employee columns but only the logged-in user's cells will be colored. Colleagues' cells will be empty. This is a F-01 schema bug, not Phase 3 regression.
- **Decision**: FIXED — `supabase/migrations/20260529000001_fix_absences_select_rls.sql` drops the old own-only policy and replaces it with `USING (auth.uid() IS NOT NULL)`. INSERT/UPDATE/DELETE policies unchanged (still own-only for employees).

### F6 — Plan drift: template branch instead of frontmatter early return

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:63–82
- **Detail**: Plan said "if currentEmployee is null → stop rendering the grid." Implementation uses a ternary in the template instead of an early return in the frontmatter. Behavior is identical.
- **Decision**: SKIPPED — behavior equivalent, no action needed.

### F7 — select("*") on bulk employees list

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/pages/dashboard.astro:44
- **Detail**: `select("*")` on bulk employees passes user_id, deleted_at, created_at as serialized props to React island.
- **Fix Applied**: Changed to `select("id, first_name, last_name, role")`. Typed via `as unknown as` tuple cast on Promise.all result to maintain type safety without `no-unsafe-assignment` violations.
- **Decision**: FIXED
