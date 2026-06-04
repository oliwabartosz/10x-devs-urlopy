<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CRUD Integrity — Phase 1 Test Rollout

- **Plan**: context/changes/crud-integrity/plan.md
- **Scope**: All 4 phases (full plan review)
- **Date**: 2026-06-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — test-plan.md §4 documents envFile but config uses loadEnv

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:97
- **Detail**: Phase 4 updated §4 Stack to read "envFile: '.env'" as the env-loading mechanism. But vitest.config.ts (Phase 1 drift) abandoned envFile in favour of loadEnv() + a custom .dev.vars parser. A developer following the cookbook will look at vitest.config.ts and find no envFile line — the §4 description is stale before the ink is dry.
- **Fix**: Update §4 Stack "Notes" cell to describe the actual mechanism: loadEnv("test", process.cwd(), "") + .dev.vars parser (vitest.config.ts lines 10–26), dropping the mention of envFile.
- **Decision**: FIXED — updated §4 Stack Notes to describe loadEnv + .dev.vars parser

### F2 — vitest.config.ts uses __dirname polyfill instead of import.meta.dirname

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts:7
- **Detail**: The plan explicitly required import.meta.dirname (available Node 22.14.0) to avoid __dirname in an ESM project. The implementation uses a fileURLToPath polyfill instead: `const __dirname = fileURLToPath(new URL(".", import.meta.url));`. Both produce the correct path, but the plan called this out specifically as the canonical ESM pattern.
- **Fix**: Replace vitest.config.ts:7 with `const dir = import.meta.dirname;` and update the resolve.alias reference from __dirname to dir.
- **Decision**: FIXED — switched to import.meta.dirname

### F3 — teardownTestEmployee propagates errors, can obscure test failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/tests/helpers/fixtures.ts:39
- **Detail**: teardownTestEmployee has no try/catch. If a DB delete or the Supabase admin deleteUser call throws, the afterAll hook throws and Vitest surfaces a teardown failure that buries the actual test assertion failures. createTestEmployee already has a compensating catch (lines 33–36); teardown has none.
- **Fix**: Wrap the body of teardownTestEmployee in try/catch; log failures with console.error rather than re-throwing.
- **Decision**: FIXED — added try/catch with console.error

### F4 — Plan said user_id = crypto.randomUUID() but fixtures create a real auth user

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/tests/helpers/fixtures.ts:13–19
- **Detail**: The plan assumed employees.user_id is a plain UUID column. In reality user_id has an FK to auth.users, so a synthetic UUID would violate the constraint. The implementation correctly creates a real Supabase Auth user via the admin API. No code fix needed.
- **Fix**: No action required. Note for future plan authors: employees.user_id is a FK to auth.users; fixture setup requires SUPABASE_SERVICE_KEY.
- **Decision**: SKIPPED — code is correct; plan was wrong about the FK

### F5 — undefined input not explicitly tested in db-errors.test.ts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/tests/lib/db-errors.test.ts:17
- **Detail**: The plan's test case 4 says "Non-object input (null, 'string') → returns undefined without throwing." undefined is not in the test. The implementation handles it correctly but it's not documented by a test case.
- **Fix**: Add `expect(extractPgErrorCode(undefined)).toBeUndefined();` to the existing non-object test case.
- **Decision**: FIXED — added undefined assertion

### F6 — employees/index.ts still uses inline PG error code extraction

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/employees/index.ts:144–145
- **Detail**: Phase 3 scoped refactoring to absences/ handlers only (by plan). employees/index.ts now contains the same inline e.code ?? e.cause?.code pattern that Phase 3 replaced elsewhere. Not a plan violation — a known gap.
- **Fix**: Migrate in a follow-up (one-liner import + replace). Not blocking.
- **Decision**: FIXED — migrated employees/index.ts to extractPgErrorCode
