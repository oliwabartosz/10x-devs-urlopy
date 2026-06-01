<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Drizzle Migration

- **Plan**: context/changes/drizzle-migration/plan.md
- **Scope**: Phase 1 of 5
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Drizzle schema incomplete vs. live DB

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/db/schema.ts:27–51
- **Detail**: Three gaps between schema.ts and the authoritative DB schema: (a) `absences.updated_at` declared `.notNull()` without `.defaultNow()` — DB has `DEFAULT NOW()` plus trigger, so runtime INSERTs work, but `$inferInsert.updated_at` will be required in TypeScript, causing Phase 5 type issues. (b) `absence_types.color` — DB has `CHECK (color ~ '^#[0-9a-fA-F]{6}$')`, no `.check()` in Drizzle. (c) `absences.hours` — DB has `CHECK (is_full_day OR hours IS NOT NULL)`, no Drizzle equivalent. Risk: future `db:generate` will silently omit these constraints.
- **Fix A ⭐ Recommended**: Add `.defaultNow()` to `updated_at`; add comments above color/hours columns noting the DB-level CHECK constraints.
  - Strength: Fixes $inferInsert type issue immediately; paper trail prevents silent constraint drop.
  - Tradeoff: `.defaultNow()` doesn't replicate trigger semantics on UPDATE (but DB trigger still fires).
  - Confidence: HIGH — standard Drizzle pattern.
  - Blind spot: Verify drizzle-orm supports `sql` inside `.check()` for this version before adding checks.
- **Fix B**: Leave schema as-is; document that `db:generate` must always be manually reviewed.
  - Strength: No code change.
  - Tradeoff: $inferInsert issue remains and will cause TS errors in Phase 5.
  - Confidence: LOW.
  - Blind spot: Relies on documentation discipline with no guardrail.
- **Decision**: FIXED via Fix A

### F2 — drizzle.config.ts has 7 lint errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: drizzle.config.ts:1,3–8
- **Detail**: `npm run lint` on drizzle.config.ts reports 7 errors: 5x `prettier/prettier` (single-quote strings, auto-fixable), 1x `@typescript-eslint/no-unsafe-call` (`defineConfig` unresolved type), 1x `@typescript-eslint/no-non-null-assertion` (`process.env.DATABASE_URL_DIRECT!`). `src/db/schema.ts` and `src/db/index.ts` pass cleanly. Project-wide lint fails.
- **Fix**: Run `npm run lint:fix` for prettier errors; add eslint-disable comment for the two TS violations (drizzle-kit config is Node-only tooling, not deployed code).
- **Decision**: FIXED

### F3 — DATABASE_URL declared required before any code uses it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: astro.config.mjs:22
- **Detail**: `DATABASE_URL` declared without `optional: true`, unlike all Supabase env vars. No Phase 1 code imports `DATABASE_URL` yet. Any teammate without the var in `.dev.vars` hits an Astro env-validation error on `npm run dev`.
- **Fix**: Add `optional: true` now; remove it (flip to required) once Phase 2 lands and a route actually imports it.
- **Decision**: FIXED

### F4 — createDb accepts raw string with no null/empty guard

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/db/index.ts:9
- **Detail**: Both Supabase client factories guard on missing env vars. `createDb` passes the raw string directly to `neon()`. An empty or invalid string gives an opaque Neon error. In practice `DATABASE_URL` comes from a required Astro env field, so this won't be empty at runtime — but the calling convention diverges.
- **Fix**: Add `if (!databaseUrl) throw new Error("DATABASE_URL is required")` at top of `createDb`.
- **Decision**: FIXED

### F5 — drizzle-kit@0.18.1 may be incompatible with drizzle-orm@0.45.2

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: package.json
- **Detail**: drizzle-kit (0.18.1) is significantly behind drizzle-orm (0.45.2). Incompatible versions would cause `db:studio` and `db:generate` to fail silently or crash.
- **Fix**: `npm ls drizzle-kit drizzle-orm` to verify, then check drizzle-kit changelog for minimum drizzle-orm version; upgrade if needed.
- **Decision**: FIXED — upgraded drizzle-kit to 0.31.10

### F6 — db:generate → supabase/migrations is a footgun with no warning

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: drizzle.config.ts:6
- **Detail**: `out: './supabase/migrations'` routes generated files into the same directory as hand-authored Supabase migrations. Accidental `npm run db:generate && npm run db:migrate` would generate a migration dropping the check constraints (F1), alongside existing Supabase files. No comment warns about this.
- **Fix**: Add a comment above `out` noting generated migrations must be manually reviewed and never applied blindly — Supabase CLI migrations remain the schema authority.
- **Decision**: FIXED — covered by comment added in F2 fix
