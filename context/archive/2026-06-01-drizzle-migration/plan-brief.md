# Drizzle Migration — Plan Brief

> Full plan: `context/changes/drizzle-migration/plan.md`
> Research: `context/changes/drizzle-migration/research.md`

## What & Why

Replace 46 Supabase JS data queries across 5 files with Drizzle ORM (`drizzle-orm/neon-http` via `@neondatabase/serverless`). The motivation is typesafe queries and a code-first schema that serves as the single source of truth — replacing hand-maintained TypeScript interfaces with Drizzle-inferred types. No user-visible change.

## Starting Point

The codebase has two Supabase JS clients (`createClient` for RLS-scoped queries, `createAdminClient` for service-role admin ops). Both remain for auth. All 46 data queries are fully mapped in research. `nodejs_compat` is already in `wrangler.jsonc`; no Workers config changes are needed.

## Desired End State

`src/db/schema.ts` is the canonical schema definition. All 5 migrated files import from `@/db/index` instead of `@/lib/supabase`. `src/types.ts` re-exports Drizzle-inferred types. `drizzle-kit` is available for future schema migrations (outputs to `supabase/migrations/`). `npm run build` passes and all CRUD flows smoke-test clean.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-----------------|--------|
| RLS strategy | Service role only (Option A) | App-level auth checks are already solid in every handler; adding JWT forwarding would double connection complexity for no regression coverage gain | Plan |
| Timestamp types | `Date` objects (Drizzle default) | Idiomatic Drizzle; slightly wider blast radius than `mode: 'string'` but keeps types honest | Plan |
| Property naming | snake_case in schema | Matches existing TypeScript convention; avoids renaming every property access across 5 files in one slice | Plan |
| `src/types.ts` | Replace with `$inferSelect` | Eliminates drift between DB schema and TypeScript — the main long-term benefit of Drizzle | Plan |
| Future migrations | `drizzle-kit generate` → `supabase/migrations/` | Single migration history, unified naming convention | Plan |
| Driver | `neon-http` via `@neondatabase/serverless` | Only driver that works over HTTP in Cloudflare Workers without raw TCP | Research |
| Cadence | Phase per file group | Isolates regressions; each phase can be independently smoke-tested | Plan |
| drizzle-zod | Out of scope | Existing Zod schemas are correct; expanding scope adds risk with no user-visible benefit | Plan |

## Scope

**In scope:**
- Install `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`
- `src/db/schema.ts` — Drizzle table definitions
- `src/db/index.ts` — `createDb()` factory
- `drizzle.config.ts` — drizzle-kit config
- Migrate: `api/absences/index.ts`, `api/absences/[id].ts`, `api/employees/index.ts`, `api/employees/[id].ts`, `api/employees/[id]/restore.ts`, `dashboard.astro`
- Replace `src/types.ts` with `$inferSelect` re-exports
- Update timestamp call sites (`Date` objects, not strings)

**Out of scope:**
- Auth routes (signin, signup, signout, middleware) — stay on Supabase JS
- `auth.admin.createUser` / `deleteUser` — stay on Supabase JS
- JWT forwarding / RLS at DB level (Option B) — deferred
- `drizzle-zod` validation schema generation
- New automated tests
- camelCase property rename

## Architecture / Approach

One `neon-http` Drizzle client with the service role database password (Transaction Mode pooler, port 6543). Created per request via `createDb(DATABASE_URL)` — cheap because `neon-http` is stateless (each query = one HTTP call). `supabase.ts` and `supabase-admin.ts` remain for auth operations. The dual-path `adminClient != null` fallback in `dashboard.astro` and `employees/index.ts` collapses to a single Drizzle path.

Two notable translation gotchas: (1) `numeric()` columns return strings from the Postgres wire protocol — `absences.hours` is cast `::float` in every SELECT to preserve numeric behavior; (2) `.single()` returning `undefined` replaces Supabase's `PGRST116` error code — `if (!row)` branches replace `if (error?.code === 'PGRST116')`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Scaffold | `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, env wiring | Schema column types don't match live DB exactly |
| 2. Absences routes | 7 queries migrated, `hours` cast pattern established | `numeric` → `number` behavior regression |
| 3. Employees routes | 15 queries migrated, count query + compensating transaction | Count query semantic difference; compensation pattern breaks |
| 4. Dashboard | 4 queries migrated, dual-path collapsed | `deleted_at` Date comparison in grid filter |
| 5. Types cleanup | `src/types.ts` → `$inferSelect`; timestamp call sites updated | Unfound `string` → `Date` call sites cause runtime errors |

**Prerequisites:** `DATABASE_URL` (Transaction Mode pooler, service role password) and `DATABASE_URL_DIRECT` (direct connection) available from Supabase dashboard.  
**Estimated effort:** ~3-4 focused sessions across 5 phases.

## Open Risks & Assumptions

- `neon-http` behavior with Cloudflare Workers `nodejs_compat` is assumed compatible per research (not run-tested yet — Phase 1 manual verification is the smoke test).
- `drizzle-kit studio` connecting to the live Supabase DB requires `DATABASE_URL_DIRECT` in `.env` (local only, never committed).
- Phase 5 timestamp call sites: there may be React island prop boundaries where Astro serializes `Date` objects to ISO strings for hydration, but TypeScript types say `Date`. These cause no runtime errors (Astro handles serialization) but may need explicit `.toISOString()` to satisfy TS strict mode.

## Success Criteria (Summary)

- `npm run build` passes with zero type errors after Phase 5
- All CRUD flows smoke-test clean: add/edit/delete absences, manage employees (create/soft-delete/restore), dashboard grid renders correctly for both employee and moderator roles
- `src/lib/supabase.ts` and `src/lib/supabase-admin.ts` still present and used by auth flows
