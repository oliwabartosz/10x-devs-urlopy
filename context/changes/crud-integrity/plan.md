# CRUD Integrity — Phase 1 Test Rollout Implementation Plan

## Overview

Bootstrap Vitest in Node env, write integration tests proving Drizzle CRUD
correctness (Risk #1), extract and unit-test the PG error-code reader (Risk #6),
then fill in the §6 cookbook patterns in the test plan.

This is Phase 1 of the test rollout defined in
`context/foundation/test-plan.md` (§3 row 1). It covers Risks #1 and #6.

## Current State Analysis

No test runner is installed. The project has no `vitest` package, no
`vitest.config.*`, and no `npm test` script. Every quality signal comes from
lint and the TypeScript compiler.

**What exists:**

- `src/db/index.ts` — `createDb(url)` factory; accepts any PostgreSQL URL;
  `ssl: false, prepare: false` (safe for direct Supabase connection on port 5432)
- `src/db/schema.ts` — `employees`, `absence_types`, `absences` tables;
  `absences` has a composite unique constraint on `(employee_id, date)`;
  `hours` column is `numeric()` — postgres-js returns it as a **string**, not a number
- `src/pages/api/absences/index.ts` — GET + POST handlers; both import
  `DATABASE_URL` from `astro:env/server`, a Vite virtual module unavailable
  in plain Node env
- `src/pages/api/absences/[id].ts` — PATCH + DELETE handlers; same virtual
  module dependency
- `DATABASE_URL_DIRECT` — present in `.env` (port 5432 direct connection);
  used by `drizzle-kit`; the correct URL for Node-env integration tests
- All three mutating handlers already use `e.code ?? e.cause?.code` for PG
  error code extraction; the duplicate pattern is technically correct but
  duplicated across three catch blocks

**What's missing:**

- Test runner, config, scripts
- Test helpers (DB factory, fixture management)
- Any test files
- `src/lib/db-errors.ts` pure helper

## Desired End State

After this plan is complete:

- `npm run test:run` passes all integration and unit tests
- `npm run test:coverage` produces a coverage report
- A developer can follow the §6.1 and §6.2 cookbook patterns in
  `context/foundation/test-plan.md` to add new tests without guessing
  how to set up DB access or write fixtures

### Key Discoveries

- `astro:env/server` is a Vite virtual module — importing any handler file
  in a plain Node Vitest env throws `ERR_MODULE_NOT_FOUND`. Tests must
  bypass the handler layer and call `createDb(process.env.DATABASE_URL_DIRECT)`
  directly. (research.md §B)
- `hours` (NUMERIC) returns as a string from postgres-js — e.g. `"2.50"`, not
  `2.5`. Integration tests must account for this when asserting returned values.
  (research.md §D, AGENTS.md)
- `absences` FK to `employees.id` has no `ON DELETE CASCADE`. Teardown must
  delete absence rows before deleting the test employee. (schema.ts line 39–41)
- Vitest 3.2+ supports Vite 7 natively. No special compatibility flags needed.
  (web search 2026-06-04)
- `DATABASE_URL_DIRECT` is not in the CI secrets; it is added in Phase 4
  (quality gates). Integration tests must be guarded with
  `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` until then.

## What We're NOT Doing

- Testing handler functions directly — `astro:env/server` makes this expensive.
  The handler layer is covered by type-checking and lint; the Drizzle layer is
  covered by integration tests.
- End-to-end / browser tests — not justified for this internal app at MVP scale.
- Setting coverage thresholds — thresholds are wired in Phase 4 (quality gates).
- Testing absence type seed data — static seed, no app-level mutations, out of
  scope per §7 of the test plan.
- Mocking Drizzle internals — tests assert against a real Supabase DB via
  `DATABASE_URL_DIRECT`.

## Implementation Approach

Four sequential phases, each independently verifiable:

1. Bootstrap Vitest so any subsequent phase can run tests immediately.
2. Integration tests for the Drizzle CRUD layer (Risk #1) — the highest-priority
   risk, tests the layer that has no other automated signal.
3. Extract `extractPgErrorCode` pure function and unit-test it (Risk #6) — the
   smaller refactor that cleans up three duplicated catch blocks.
4. Update the cookbook in `context/foundation/test-plan.md` so future tests
   have a reference pattern.

## Critical Implementation Details

**ESM and `import.meta.dirname` in `vitest.config.ts`:**
The project is `"type": "module"`, so `__dirname` is unavailable. Use
`import.meta.dirname` (available in Node 22.14.0, which this project uses)
when resolving the `@/` alias path.

**Integration test CI guard:**
`DATABASE_URL_DIRECT` is absent from CI secrets until Phase 4. Every
integration test describe block must use
`describe.skipIf(!process.env.DATABASE_URL_DIRECT)(...)` so the CI job does
not fail with a missing-env error. The skipped tests produce a visible warning
in CI output, making the gap explicit.

**`afterAll` cleanup order:**
`absences.employee_id` has a FK constraint to `employees.id` with no
`ON DELETE CASCADE`. The `afterAll` teardown helper must delete all absence
rows for the test employee BEFORE deleting the employee row. Reversing the
order will throw PG error `23503` (FK violation).

---

## Phase 1: Vitest Bootstrap

### Overview

Install Vitest and coverage tooling; create `vitest.config.ts`; wire `npm test`,
`npm run test:run`, and `npm run test:coverage` scripts. No test files yet — the
goal is a working runner that subsequent phases can drop tests into.

### Changes Required

#### 1. Install test dependencies

**File**: `package.json`

**Intent**: Add `vitest`, `@vitest/coverage-v8`, and (if not already available
transitively) `@types/node` to `devDependencies`.

**Contract**: Install with `npm install --save-dev vitest @vitest/coverage-v8 @types/node`.
Vitest version will resolve to the latest 3.2+ release (3.2 is the minimum for
Vite 7 support; as of 2026-06-04 the latest is 4.x — accept whatever `npm latest`
resolves). Do not pin an exact version; the `^` range is sufficient.

#### 2. Add test scripts

**File**: `package.json`

**Intent**: Wire three scripts so developers and CI have consistent entry points.

**Contract**: Add to the `"scripts"` block:
- `"test"` → `"vitest"` (watch mode — for local development)
- `"test:run"` → `"vitest run"` (single pass — for CI and pre-commit)
- `"test:coverage"` → `"vitest run --coverage"` (produces `coverage/` report)

#### 3. Create Vitest config

**File**: `vitest.config.ts` (project root, new file)

**Intent**: Configure Vitest for Node environment, resolve the `@/` path alias,
and load `.env` so `DATABASE_URL_DIRECT` is available in integration tests.

**Contract**: The config must set `environment: 'node'`, include the glob
`src/tests/**/*.test.ts`, set `envFile: '.env'`, and add a `resolve.alias` entry
mapping `'@'` to `./src`. Use `import.meta.dirname` (not `__dirname`) for the
path resolution because the project is ESM. No coverage thresholds — leave
`coverage` config at defaults.

### Success Criteria

#### Automated Verification

- `npm run test:run` exits 0 with output containing "No test files found" (or
  "0 tests passed" — either is correct for an empty suite)
- `npm run test:coverage` exits 0 and produces a `coverage/` directory at the
  project root

#### Manual Verification

- Running `npm run test:run -- --reporter=verbose` shows Vitest version in the
  header and exits cleanly without "Cannot find module" or alias-resolution errors

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: CRUD Integration Tests (Risk #1)

### Overview

Write integration tests that connect to the real Supabase DB via
`DATABASE_URL_DIRECT` and assert that Drizzle INSERT/SELECT/UPDATE/DELETE
operations produce correct DB state. A dedicated test employee is created in
`beforeAll` and torn down in `afterAll`.

### Changes Required

#### 1. DB test helper

**File**: `src/tests/helpers/db.ts` (new file)

**Intent**: Provide a `getTestDb()` function that constructs a Drizzle client
using the test-env DB URL. Fail fast with a clear message if the URL is absent.

**Contract**: Export `getTestDb(): ReturnType<typeof createDb>`. Internally, read
`process.env.DATABASE_URL_DIRECT`; if missing, throw with the message
`"DATABASE_URL_DIRECT not set — cannot run DB integration tests. Add it to .env."`.
Call `createDb(url)` from `@/db/index.ts` and return the result.

#### 2. Fixture helpers

**File**: `src/tests/helpers/fixtures.ts` (new file)

**Intent**: Provide `createTestEmployee` and `teardownTestEmployee` helpers that
manage a dedicated test employee and its associated absence rows across a test
suite's `beforeAll` / `afterAll` lifecycle.

**Contract**:
- `createTestEmployee(db)` — inserts one employee with `role: 'employee'`,
  `first_name: 'Test'`, `last_name: 'Employee'`, and a `crypto.randomUUID()`
  value for `user_id` (must be unique per run). Returns the inserted employee's
  `id` (UUID string).
- `teardownTestEmployee(db, employeeId)` — first deletes all rows from `absences`
  where `employee_id = employeeId`, then deletes the employee row where
  `id = employeeId`. Order is mandatory due to the FK constraint (see Critical
  Implementation Details).

Both functions import their types from `@/db/schema.ts` and use the Drizzle
client signature `db.insert(...).values(...).returning(...)` /
`db.delete(...).where(...)`.

#### 3. CRUD integration test suite

**File**: `src/tests/api/absences/crud.test.ts` (new file)

**Intent**: Assert that absence rows inserted, updated, and deleted via the Drizzle
client surface the correct values from the DB; assert that `hours` behaves as
postgres-js returns it (string); assert that a duplicate `(employee_id, date)`
insert raises PG error `23505` readable from `cause.code`.

**Contract**: The file structure is:

```
describe.skipIf(!process.env.DATABASE_URL_DIRECT)('Absence CRUD — integration', () => {
  let db, testEmployeeId;

  beforeAll(async () => {
    db = getTestDb();
    testEmployeeId = await createTestEmployee(db);
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
  });

  it('INSERT — RETURNING contains submitted field values');
  it('INSERT — hours is returned as a string (postgres-js NUMERIC behavior)');
  it('SELECT — row is readable immediately after INSERT with correct columns');
  it('UPDATE (PATCH) — RETURNING contains updated field values');
  it('DELETE — SELECT returns zero rows after deletion');
  it('Duplicate INSERT — error has PG code 23505 accessible via cause.code');
});
```

Each test inserts its own absence row(s) using `absence_type_id: 1` (static seed,
safe to reference). The duplicate INSERT test verifies that the thrown error's
`cause.code` (not `code`) equals `'23505'` — this is a secondary assertion on the
same fact that Risk #6 guards, exercised here from the DB-layer perspective.

Use `2026-01-15` (or another past fixed date) as the test date in most tests to
avoid accidental conflicts with production data. Vary the date between tests as
needed to avoid the unique constraint across tests in the same suite.

### Success Criteria

#### Automated Verification

- `npm run test:run` passes all tests in `crud.test.ts`
- `npm run lint` passes on the new test files

#### Manual Verification

- Run with `DATABASE_URL_DIRECT` set in `.env`; confirm all assertions green
  against the real Supabase DB
- After the suite finishes, verify no orphaned test rows remain in `employees`
  or `absences` (the `afterAll` teardown cleaned up)

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Extract `extractPgErrorCode` + Unit Test (Risk #6)

### Overview

Pull the PG error-code reader out of three duplicated catch blocks into a
pure function in `src/lib/db-errors.ts`. Write a unit test proving the
`cause.code` fallback path works. This test is the regression guard against
someone "simplifying" `e.code ?? e.cause?.code` back to `e.code` alone.

### Changes Required

#### 1. Create `extractPgErrorCode` pure function

**File**: `src/lib/db-errors.ts` (new file)

**Intent**: Provide a single, testable function that reads the PostgreSQL error
code out of a DrizzleQueryError or any postgres-js error. The function is pure
(no I/O, no Astro deps) so it can be imported in Node test env without issues.

**Contract**: Export `extractPgErrorCode(err: unknown): string | undefined`.
The implementation reads `(err as { code?: string; cause?: { code?: string } })`,
then returns `e.code ?? e.cause?.code ?? undefined`. When both `code` and
`cause.code` are set, `code` wins (the `??` short-circuit). When neither is set,
returns `undefined`. Never throws.

#### 2. Refactor POST catch block

**File**: `src/pages/api/absences/index.ts`

**Intent**: Replace the inline `e.code ?? e.cause?.code` pattern in the POST
handler's catch block with a call to `extractPgErrorCode(err)`.

**Contract**: Import `extractPgErrorCode` from `@/lib/db-errors.ts`. Replace
the local `const e = err as ...` + `const code = e.code ?? e.cause?.code` lines
with `const code = extractPgErrorCode(err)`. The surrounding `if (code === "23505")`
and `if (code === "42501")` branches remain unchanged. The observable behavior
of the POST handler must not change.

#### 3. Refactor PATCH and DELETE catch blocks

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Same refactor as Phase 3.2, applied to the PATCH and DELETE catch
blocks in the `[id].ts` handler.

**Contract**: Import `extractPgErrorCode` from `@/lib/db-errors.ts`. Replace
both inline `e.code ?? e.cause?.code` patterns with `extractPgErrorCode(err)`.
Surrounding response logic is unchanged. Note: the DELETE catch only handles
`42501`; it does not check `23505` — that is intentional (a date-conflict on
DELETE is impossible) and should not be changed.

#### 4. Unit test for `extractPgErrorCode`

**File**: `src/tests/lib/db-errors.test.ts` (new file)

**Intent**: Prove that `extractPgErrorCode` reads `cause.code` when top-level
`code` is absent. This is the regression guard: if someone changes `e.code ??
e.cause?.code` to `e.code`, test case 2 fails.

**Contract**: Four test cases:

1. `{ code: '23505' }` → returns `'23505'` (top-level code is read)
2. `{ code: undefined, cause: { code: '23505' } }` → returns `'23505'`
   **(the critical case — cause.code fallback)**)
3. `{}` → returns `undefined`
4. Non-object input (`null`, `'string'`) → returns `undefined` without throwing

No mocking, no async, no external deps. Import `extractPgErrorCode` from
`@/lib/db-errors.ts`.

### Success Criteria

#### Automated Verification

- `npm run test:run` passes all tests including `db-errors.test.ts`
- `npm run lint` passes on modified handler files and the new helper

#### Manual Verification

- Code-read the refactored handlers to confirm the response logic is unchanged;
  the only diff is `extractPgErrorCode(err)` replacing the inline cast + expression

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Cookbook Update

### Overview

Fill in §6.1 and §6.2 of `context/foundation/test-plan.md` with the patterns
shipped in Phases 2 and 3, and update §4 (Stack) with the actual Vitest version
installed.

### Changes Required

#### 1. Update §6.1 — unit test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `§6.1 Adding a unit test` placeholder with a concrete
description of the pattern established in Phase 3.

**Contract**: The updated section should name: the test runner (`vitest`),
the include glob (`src/tests/**/*.test.ts`), the reference test file
(`src/tests/lib/db-errors.test.ts`), and the two rules derived from Phase 3:
(1) test files import only from `@/lib/*` or `@/db/*`, never from handlers or
pages; (2) no external deps or async needed for pure-function tests.

#### 2. Update §6.2 — DB integration test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `§6.2 Adding an integration test against the database`
placeholder with the concrete pattern from Phase 2.

**Contract**: The updated section should document: `getTestDb()` from
`src/tests/helpers/db.ts` as the DB entry point; `createTestEmployee` /
`teardownTestEmployee` from `src/tests/helpers/fixtures.ts` for FK-safe fixture
management; the `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` guard and
why it exists (CI missing secret until Phase 4); the `afterAll` cleanup order
(absences first, then employee); and the `hours`-as-string gotcha. Reference
`src/tests/api/absences/crud.test.ts` as the canonical example.

#### 3. Update §4 Stack with actual installed Vitest version

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "none yet" row in the §4 Stack table with the concrete
tool versions installed in Phase 1.

**Contract**: Update the `unit + integration` row to reflect the actual Vitest
version installed (read from `package.json` after Phase 1 completes) and the
`vitest.config.ts` config choices (`node` env, `envFile: .env`, `@/` alias).

### Success Criteria

#### Manual Verification

- A developer who has never seen this codebase can read §6.1 and know exactly
  how to add a new pure-function unit test
- A developer can read §6.2 and know how to add a new integration test against
  the Supabase DB without guessing at setup, aliases, or cleanup order

---

## Testing Strategy

### Unit Tests

- `src/tests/lib/db-errors.test.ts` — four cases for `extractPgErrorCode`; all
  synchronous, no external deps

### Integration Tests

- `src/tests/api/absences/crud.test.ts` — INSERT/SELECT/UPDATE/DELETE against
  real Supabase DB; guarded by `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`

### Manual Testing

1. Set `DATABASE_URL_DIRECT` in `.env` (copy from `.env.example`)
2. Run `npm run test:run` — all tests pass
3. Confirm no orphaned rows in `employees` or `absences` after the suite
4. Run `npm run test:coverage` — `coverage/` directory created at project root

## References

- Research: `context/changes/crud-integrity/research.md`
- DB schema: `src/db/schema.ts`
- DB client factory: `src/db/index.ts`
- Test plan (rollout context): `context/foundation/test-plan.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vitest Bootstrap

#### Automated

- [x] 1.1 `npm run test:run` exits 0 (empty suite — no test files yet) — 507435f
- [x] 1.2 `npm run test:coverage` exits 0 and produces `coverage/` directory — 507435f

#### Manual

- [x] 1.3 `npm run test:run -- --reporter=verbose` shows Vitest version and exits cleanly without module-resolution errors — 507435f

### Phase 2: CRUD Integration Tests (Risk #1)

#### Automated

- [x] 2.1 `npm run test:run` passes all tests in `crud.test.ts`
- [x] 2.2 `npm run lint` passes on new test helper and test files

#### Manual

- [x] 2.3 All assertions green against real Supabase DB with `DATABASE_URL_DIRECT` set
- [x] 2.4 No orphaned rows in `employees` or `absences` after suite completes

### Phase 3: Extract `extractPgErrorCode` + Unit Test (Risk #6)

#### Automated

- [ ] 3.1 `npm run test:run` passes all tests including `db-errors.test.ts`
- [ ] 3.2 `npm run lint` passes on modified handler files and new `db-errors.ts` helper

#### Manual

- [ ] 3.3 Code-read confirms handler response logic is unchanged; only the inline cast is replaced

### Phase 4: Cookbook Update

#### Manual

- [ ] 4.1 §6.1 of `test-plan.md` gives a developer enough to add a new unit test without setup guesswork
- [ ] 4.2 §6.2 of `test-plan.md` gives a developer enough to add a new DB integration test without setup guesswork
