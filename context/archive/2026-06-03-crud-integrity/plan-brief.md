# CRUD Integrity — Plan Brief

> Full plan: `context/changes/crud-integrity/plan.md`
> Research: `context/changes/crud-integrity/research.md`

## What & Why

Bootstrap the test infrastructure from zero and prove that the two highest-priority
risks in Phase 1 of the test rollout are protected. Risk #1: after the Supabase JS
→ Drizzle migration, there is no automated signal that Drizzle CRUD operations
produce correct DB state. Risk #6: the duplicate-entry 409 path is implemented
correctly today but is three steps away from a regression if someone simplifies the
error-code extraction.

## Starting Point

No test runner is installed. The project has no `vitest`, no config, no scripts, and
no test files. Drizzle handler code exists and works but is tested only by the
TypeScript compiler and manual review. The one relevant infrastructure piece already
in place is `DATABASE_URL_DIRECT` in `.env`, which `drizzle-kit` uses for direct
Supabase connections — that URL is the integration-test entry point.

## Desired End State

`npm run test:run` passes a CRUD integration suite and a unit test for the error
helper. A developer can follow §6.1 and §6.2 of `context/foundation/test-plan.md`
to add new tests without needing to understand the Vitest config or fixture
management. The `e.cause?.code` fallback in the duplicate-entry handler is
protected by a regression test that names exactly what it guards.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Handler layer in tests | Bypass handlers; test Drizzle layer directly via `createDb(DATABASE_URL_DIRECT)` | `astro:env/server` is a Vite virtual module that throws `ERR_MODULE_NOT_FOUND` in plain Node env | Research |
| Risk #6 test approach | Extract `extractPgErrorCode()` pure function; unit-test it | Cheaper than mocking `astro:env/server`; also eliminates duplication across 3 catch blocks | Research + Plan |
| Test file location | `src/tests/` top-level directory | Single clear glob target in `vitest.config.ts`; avoids friction with Astro's file-based router in `src/pages/` | Plan |
| DB isolation | `beforeAll`/`afterAll` with a dedicated test employee; delete absences first, then employee | Simple and explicit; DATABASE_URL_DIRECT supports it; no transaction wrapper needed | Plan |
| Coverage | Install `@vitest/coverage-v8` in Phase 1; no threshold yet | Costs nothing extra; thresholds are wired in Phase 4 | Plan |
| CI integration guard | `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` on all integration suites | `DATABASE_URL_DIRECT` is not yet in CI secrets (added in Phase 4); skip prevents false CI failures | Research + Plan |

## Scope

**In scope:**
- Vitest bootstrap (`vitest.config.ts`, `npm test` / `npm run test:run` / `npm run test:coverage` scripts)
- `src/tests/helpers/db.ts` — `getTestDb()` factory
- `src/tests/helpers/fixtures.ts` — test employee create/teardown
- `src/tests/api/absences/crud.test.ts` — INSERT/SELECT/UPDATE/DELETE integration tests against real DB
- `src/lib/db-errors.ts` — `extractPgErrorCode()` pure function
- Refactor of the 3 handler catch blocks to call `extractPgErrorCode`
- `src/tests/lib/db-errors.test.ts` — 4 unit test cases
- §6.1, §6.2, and §4 updates in `context/foundation/test-plan.md`

**Out of scope:**
- Coverage thresholds (Phase 4)
- CI secret wiring for `DATABASE_URL_DIRECT` (Phase 4)
- Authorization / role-check tests (Phase 2 of the test rollout)
- Stats and query completeness tests (Phase 3 of the test rollout)

## Architecture / Approach

All integration tests bypass the Astro handler layer and call `createDb(url)` from
`src/db/index.ts` directly. The unit test for Risk #6 is a pure-function test with
no framework dependencies. The `@/` path alias is mirrored in `vitest.config.ts`
using `import.meta.dirname` (Node 22 ESM). The CI guard pattern
(`describe.skipIf(!process.env.DATABASE_URL_DIRECT)`) makes the missing-secret gap
visible as a skip warning rather than a failure.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Vitest Bootstrap | Working `npm test` with Node env, `@/` alias, `.env` loading | Vitest/Vite 7 compat (confirmed: Vitest 3.2+ supports Vite 7) |
| 2. CRUD Integration Tests | INSERT/SELECT/UPDATE/DELETE assertions + duplicate 23505 detection | Test employee FK cleanup order; `hours` string-type gotcha |
| 3. `extractPgErrorCode` + unit test | Regression guard for `cause.code` fallback; 3 handlers refactored | Handler behavior must not change after refactor |
| 4. Cookbook Update | §6.1 and §6.2 filled in `test-plan.md` | Only risk: content too vague to follow; addressed by referencing concrete example files |

**Prerequisites:** `DATABASE_URL_DIRECT` must be set in `.env` to run Phase 2 tests.
Not needed for Phase 1 or Phase 3.

**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- `@types/node` may already be available transitively (via wrangler). If it is,
  the explicit install in Phase 1 is a harmless no-op.
- The static `absence_types` seed (ids 1–6) is assumed to be present in the
  Supabase DB. If the DB was reset and seeds not re-applied, integration tests
  will fail with a FK violation on `absence_type_id`.
- `DATABASE_URL_DIRECT` must be the port 5432 direct connection URL, not the
  port 6543 PgBouncer pooler URL, for `afterAll` teardown to work correctly.

## Success Criteria (Summary)

- `npm run test:run` passes all integration and unit tests with `DATABASE_URL_DIRECT` set
- Test case 2 in `db-errors.test.ts` (`{ code: undefined, cause: { code: '23505' } } → '23505'`) catches any future removal of the `cause.code` fallback
- A developer can add a new unit or DB integration test using only the §6 cookbook patterns in `test-plan.md`
