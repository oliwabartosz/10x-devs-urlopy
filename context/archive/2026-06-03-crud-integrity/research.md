---
date: 2026-06-03T00:00:00+00:00
researcher: Claude Sonnet 4.6
git_commit: 47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb
branch: main
repository: 10x-devs-urlopy
topic: "Phase 1 — CRUD integrity: Vitest bootstrap, Drizzle CRUD integration tests, 409 duplicate unit test"
tags: [research, testing, vitest, drizzle, crud, absences, node-env]
status: complete
last_updated: 2026-06-03
last_updated_by: Claude Sonnet 4.6
---

# Research: Phase 1 — CRUD Integrity

**Date**: 2026-06-03  
**Researcher**: Claude Sonnet 4.6  
**Git Commit**: 47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb  
**Branch**: main  
**Repository**: oliwabartosz/10x-devs-urlopy

## Research Question

What exists in the codebase that Phase 1 of the test rollout (test-plan.md §3 row 1) needs to work with? Specifically: the CRUD handler entry points, the DB schema/client, the project config for Vitest bootstrapping, and any historical decisions relevant to CRUD integrity and error handling.

## Summary

- **No test runner is installed.** Vitest is not in package.json; there is no `vitest.config.*`. Phase 1 must install and configure it from scratch.
- **The project is ESM** (`"type": "module"`) with TypeScript strict mode and a `@/*` → `./src/*` path alias.
- **Astro uses Vite 7** (override `vite: ^7.3.2`) — Vitest version compatibility must be verified before install.
- **Handlers use `astro:env/server`** for `DATABASE_URL`, which is a Vite virtual module unavailable in a plain Node test env. Integration tests must bypass the handler layer and call `createDb(process.env.DATABASE_URL_DIRECT)` directly.
- **The 23505 duplicate → 409 pattern is already implemented correctly** in all three mutating handlers, using `e.code ?? e.cause?.code`. The unit test for Risk #6 is a regression guard, not a fix.
- **`DATABASE_URL_DIRECT`** (port 5432 direct connection) is available in `.env` for Node tooling and is the correct URL for test-env DB calls.
- **The `absences` table has a composite unique constraint** on `(employee_id, date)`, which is what triggers PG code 23505.

---

## Detailed Findings

### A. Project Config — What Vitest Bootstrap Needs

**Package.json** — no test-related packages installed:

- `devDependencies` (current): `drizzle-kit`, `typescript`, ESLint plugins, Prettier plugins, `wrangler`, `husky`, `lint-staged`
- Conspicuously absent: `vitest`, `@vitest/coverage-v8`, any test runner
- Astro version: **6.3.1**; Vite is overridden to **^7.3.2** (unusual — Vite 7 is pre-release territory; Vitest compatibility must be confirmed before install)
- [package.json](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/package.json)

**tsconfig.json:**

- Extends `astro/tsconfigs/strict`
- `baseUrl: "."`, path alias `"@/*": ["./src/*"]`
- JSX: `react-jsx` with `jsxImportSource: "react"`
- Must be mirrored in `vitest.config.ts` via `resolve.alias` so `@/*` imports resolve in test files
- [tsconfig.json](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/tsconfig.json)

**astro.config.mjs — env schema:**

- `DATABASE_URL` declared as `SECRET_STRING` (required) — served via `astro:env/server` virtual module
- `DATABASE_URL_DIRECT` is **NOT** in the Astro env schema — it is only used by `drizzle-kit` via `process.env` in Node.js
- [astro.config.mjs](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/astro.config.mjs)

**drizzle.config.ts:**

- Uses `process.env.DATABASE_URL_DIRECT!` — confirms the direct-connection URL is the right one for Node-env tooling
- [drizzle.config.ts](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/drizzle.config.ts)

**.env.example format for DATABASE_URL_DIRECT:**

```
DATABASE_URL_DIRECT=postgresql://postgres:[DB_PASSWORD]@db.[project-ref].supabase.co:5432/postgres
```

Tests will `createDb(process.env.DATABASE_URL_DIRECT!)` after loading `.env` via Vitest's `envFile` (or `dotenv/config`).

---

### B. The `astro:env/server` Blocker

Every absence handler imports `DATABASE_URL` from `astro:env/server`:

```ts
// src/pages/api/absences/index.ts — line 9 (approximate)
import { DATABASE_URL } from "astro:env/server";
```

`astro:env/server` is a Vite virtual module that Astro injects at build time. In a plain Node Vitest environment (no Vite transform), this import **throws `ERR_MODULE_NOT_FOUND`** at test startup.

**Consequence for Phase 1 plan**: Test files must not import the handler modules directly. The two viable test strategies are:

| Strategy | When to use | Trade-off |
|---|---|---|
| **Test the DB layer directly** — call `createDb(DATABASE_URL_DIRECT)` and run Drizzle operations without going through handlers | Risk #1 (CRUD correctness) | Does not exercise the handler parsing/validation layer; covers the query layer only |
| **Mock `astro:env/server` globally** in `vitest.config.ts` via `resolve.alias` pointing to a local stub file | Risk #6 (handler error path) | Allows calling exported handler functions; requires constructing a minimal `APIContext` mock |

For Risk #1 integration tests, the DB-layer strategy is strictly cheaper and still gives real signal — CRUD bugs live in the Drizzle queries, not in Astro's env binding.

For Risk #6, the cheapest option is to **extract the error-mapping logic to a pure function** (no framework deps), then test it directly. The current pattern appears three times and is a good extraction candidate.

---

### C. CRUD Handler Entry Points

**`src/pages/api/absences/index.ts`** — GET + POST:
- [GitHub](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/pages/api/absences/index.ts)

| Operation | Drizzle call | Key `.where()` clause |
|---|---|---|
| SELECT (GET) | `db.select({...}).from(absences).innerJoin(employees, cond).where(and(gte(date, from), lt(date, to)))` | Date range only; no employee_id filter — returns **all employees' absences** |
| INSERT (POST) | `db.insert(absences).values({employee_id: targetEmployeeId, ...}).returning({...})` | N/A |

`createDb(DATABASE_URL)` called at top of each handler body — per-request, not module-level.

**`src/pages/api/absences/[id].ts`** — PATCH + DELETE:
- [GitHub](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/pages/api/absences/%5Bid%5D.ts)

| Operation | Ownership guard in `.where()` |
|---|---|
| UPDATE (PATCH) | Moderator: `eq(absences.id, id)`; Employee: `and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id))` |
| DELETE | Same dual pattern as PATCH |

Zero rows returned → 404 (not 403) for employees attempting to modify another employee's absence.

---

### D. DB Schema — What Integration Tests Will Insert

**`src/db/schema.ts`:**
- [GitHub](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/db/schema.ts)

Key columns for test fixtures:

| Column | Drizzle type | Notes |
|---|---|---|
| `id` | `uuid().defaultRandom()` | Auto-generated; can omit on insert |
| `employee_id` | `uuid().notNull()` | FK → employees.id; test needs a real employee row |
| `absence_type_id` | `integer().notNull()` | FK → absence_types.id; static seed data, safe to use id=1 |
| `date` | `date().notNull()` | String format `YYYY-MM-DD` |
| `is_full_day` | `boolean().notNull().default(true)` | |
| `hours` | `numeric({precision:4,scale:2})` | Returns **string** from postgres-js — always cast with `::float` in SELECT/RETURNING |
| `created_at`, `updated_at` | timestamp with TZ | Auto-managed |

**Composite unique constraint** (`src/db/schema.ts:54`):
```ts
unique().on(table.employee_id, table.date)
```
Inserting two rows with the same `(employee_id, date)` raises PG `23505`.

---

### E. DB Client — `createDb` Factory

**`src/db/index.ts`:**
- [GitHub](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/db/index.ts)

```ts
export function createDb(databaseUrl: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  return drizzle(postgres(databaseUrl, { ssl: false, prepare: false }), { schema });
}
```

- `ssl: false` — works with DATABASE_URL_DIRECT (Supabase direct, port 5432)
- `prepare: false` — required for PgBouncer Transaction Mode (port 6543 pooler); harmless on direct connection
- Tests call `createDb(process.env.DATABASE_URL_DIRECT!)` — same signature, no Astro dependency

---

### F. Error Handling — Current State (Risk #6)

All three mutating handlers (POST INSERT, PATCH UPDATE, DELETE is partial) use the same dual-path pattern:

```ts
// src/pages/api/absences/index.ts (POST catch block, lines ~198-206)
// src/pages/api/absences/[id].ts (PATCH catch block, lines ~94-100)
const e = err as { code?: string; cause?: { code?: string } };
const code = e.code ?? e.cause?.code;
if (code === "23505") return json({ error: "You already have an absence entry for this day." }, 409);
```

**The `e.code ?? e.cause?.code` pattern is already correct.** Risk #6 describes the pre-fix state. The test protects against regression (someone later "simplifying" to `e.code` only).

DELETE's catch block only handles `42501`; it does not check for `23505`. This is acceptable — a date-conflict on DELETE is impossible — but worth noting.

**Error codes currently handled across mutating handlers:**

| PG code | Meaning | POST | PATCH | DELETE |
|---|---|---|---|---|
| `42501` | permission denied (RLS) | 403 | 403 | 403 |
| `23505` | unique violation (duplicate date) | 409 | 409 | — |
| `23503` | FK violation (substitute employee) | 422 | — | — |
| `23514` | CHECK violation (hours/is_full_day) | 400 | 400 | — |

---

## Code References

- [`src/pages/api/absences/index.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/pages/api/absences/index.ts) — GET + POST handlers
- [`src/pages/api/absences/[id].ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/pages/api/absences/%5Bid%5D.ts) — PATCH + DELETE handlers
- [`src/db/schema.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/db/schema.ts) — absences table with composite unique on `(employee_id, date)`
- [`src/db/index.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/src/db/index.ts) — `createDb` factory, `ssl: false, prepare: false`
- [`package.json`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/package.json) — no vitest; vite overridden to ^7.3.2
- [`drizzle.config.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/drizzle.config.ts) — uses `process.env.DATABASE_URL_DIRECT`
- [`astro.config.mjs`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/47cc472544bc4ea0bdd01bbc624f5eb3b9016dcb/astro.config.mjs) — `DATABASE_URL` in env schema; `DATABASE_URL_DIRECT` absent

---

## Architecture Insights

1. **Layer split for tests**: The handler layer (Astro route functions) is tightly coupled to `astro:env/server` virtual modules. Drizzle operations live below that boundary in pure TypeScript. Integration tests should operate at the Drizzle layer, not the handler layer — `createDb(process.env.DATABASE_URL_DIRECT)` is the test entry point.

2. **`prepare: false` on direct connection is fine**: The flag was added for PgBouncer compatibility but does not break direct-mode connections. Tests against Supabase port 5432 will work with the existing `createDb` factory as-is.

3. **Test fixtures require real FK rows**: `absences` has FKs on `employee_id` (→ employees) and `absence_type_id` (→ absence_types). Integration tests must either use pre-existing seed rows or insert/delete employee fixtures as part of test setup. The static `absence_types` seed (ids 1–6) are safe to reference without setup.

4. **NUMERIC string gotcha applies to test assertions too**: When asserting `hours` values in integration tests, a SELECT without `::float` cast returns `"2.00"` not `2`. Always cast, or compare as strings when the cast is absent.

5. **Risk #6 regression guard, not a fix**: The current implementation is correct. The unit test's value is preventing someone from "cleaning up" the dual `e.code ?? e.cause?.code` pattern back to `e.code` only.

---

## Historical Context (from prior changes)

- `context/changes/drizzle-migration/plan.md` — Documents the Supabase JS → Drizzle migration. Lines 199–264 show the original design of all absence CRUD routes including the `::float` cast and per-request `createDb` pattern.
- `context/changes/drizzle-migration/reviews/impl-review.md` — F9 (line 114): noted that `23503` FK violation was missing from POST catch block; now resolved in the live handler.
- `context/archive/2026-06-03-deactivated-employee-grid/plan.md` — documents the `isNull(employees.deleted_at)` JOIN filter bug (stripped historical absences). Highlights that JOIN conditions silently affect which rows appear — relevant to Risk #5 (query completeness), not Phase 1 directly.

---

## Open Questions

1. **Vitest version compatibility with Vite 7**: `package.json` overrides Vite to `^7.3.2`. Vitest 3.x targets Vite 5–6; Vitest 4.x may target Vite 7. Must verify via Context7 before adding `vitest` to devDependencies. If Vitest 4 is required, check for breaking config changes.

2. **`astro:env/server` mock strategy for Risk #6 unit test**: Two options remain open for the plan to decide:
   - **Option A**: Extract `mapDbError(err)` pure function from all three mutating handlers; test it directly (zero Astro deps; also improves DRY).
   - **Option B**: Add `resolve.alias: { 'astro:env/server': './src/__mocks__/astro-env.ts' }` to vitest config and construct a minimal `APIContext`; allows testing the full handler path.
   Option A is cheaper; Option B gives higher confidence that the handler actually wires up correctly.

3. **Test data isolation strategy**: Real Supabase DB tests need cleanup. Options:
   - `afterEach` DELETE by a known test marker (e.g., `comment = "__test__"`)
   - Dedicated test employee fixture created/deleted in `beforeAll`/`afterAll`
   - Confirm no rollback/transaction isolation available via PgBouncer Transaction Mode (it is not — each statement is its own transaction at the pooler level). With DATABASE_URL_DIRECT (direct connection), proper transactions ARE available for isolation.

4. **CI secret for DATABASE_URL_DIRECT**: Integration tests against a real DB need this available in GitHub Actions. The current CI workflow (`.github/workflows/ci.yml`) has `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — but not `DATABASE_URL_DIRECT`. Phase 4 (quality gates) will need to add it, but Phase 1 plan should call it out.
