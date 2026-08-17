# Database Schema and RLS — Plan Brief

> Full plan: `context/changes/data-schema-and-rls/plan.md`

## What & Why

Create the foundational database layer for Urlopy: three tables (`employees`, `absence_types`, `absences`), row-level security policies enforcing the employee/moderator access model, seeded absence types, and TypeScript entity interfaces. Without this, no application slice can be built — it is the explicit prerequisite for S-01, S-03, and S-04.

## Starting Point

The Supabase client and auth flow (signin/signup/signout) exist and work, but `supabase/migrations/` is empty and no application tables exist. The middleware attaches a raw Supabase `User` to `context.locals.user` but reads no role; there is no role system anywhere in the current code.

## Desired End State

Three tables exist with RLS enforced at the Postgres level. An employee can CRUD only their own absences; a moderator can CRUD all absences and manage employees; unauthenticated requests get zero rows. Six absence types are seeded with PRD-correct names and hex colors. `src/types.ts` exports `Employee`, `AbsenceType`, and `Absence` interfaces used by all subsequent slices.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|------------------|--------|
| Soft-delete strategy | `deleted_at TIMESTAMPTZ NULL` | Records when deletion happened, reversible, prevents FK-breaking hard deletes needed by S-04 | Plan |
| Role storage | `employees.role` ENUM column | Role is colocated with the user profile; avoids JWT/app_metadata complexity for an MVP | Plan |
| RLS role lookup | `SECURITY DEFINER` function `get_user_role()` | Prevents self-referential RLS recursion when policies on `employees` query the same table | Plan |
| Substitute person | FK to `employees` (nullable) | Referential integrity; substitute must be a registered team member | Plan |
| Hours representation | `is_full_day BOOLEAN` + `hours NUMERIC(4,2) NULL` | Semantically explicit; DB CHECK enforces they are set consistently | Plan |
| Absence type management | Static seed only, no UI CRUD | 6 types are fixed by PRD; adding types via migration is acceptable for a 10-person team | Plan |
| Access visibility | Authenticated-only on all tables | PRD Access Control: "niezalogowany — brak dostępu" | Plan |
| Role type | PostgreSQL ENUM `user_role` | DB-enforced constraint; invalid roles are impossible to INSERT | Plan |
| Migration files | 2 files (schema + seed) | Seed is clearly separable from DDL; easier to re-run seed independently | Plan |
| TypeScript types | `src/types.ts` (hand-written) | Project convention (CLAUDE.md); avoids `supabase gen types` setup friction for MVP | Plan |

## Scope

**In scope:** `employees`, `absence_types`, `absences` DDL; `get_user_role()` SECURITY DEFINER function; RLS policies for all three tables; seed data for 6 absence types; `src/types.ts` interfaces.

**Out of scope:** UI for any of these tables; Supabase generated types; moderator-managed absence types; any application-layer role enforcement (middleware changes); observability/logging.

## Architecture / Approach

Two migration files: `20260526000001_schema.sql` (ENUM + all three tables + helper function + RLS) and `20260526000002_seed_absence_types.sql` (6 INSERTs). RLS ownership in `absences` uses a subquery `employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL)` because `absences.employee_id` is not `auth.uid()` directly. The SECURITY DEFINER `get_user_role()` function is the pivot that makes role-aware policies on `employees` safe.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Schema Migration | DDL, RLS function, all policies | SECURITY DEFINER recursion bug if function is mis-specified; ownership predicate silently wrong if subquery is incorrect |
| 2. Seed Migration | 6 absence types with hex colors | Encoding of Polish characters (ś, ę, ó, ł) in migration file |
| 3. TypeScript Types | `src/types.ts` interfaces | Type drift from DB schema if schema changes later without updating types |

**Prerequisites:** Local Docker running (for `npx supabase start`); `SUPABASE_URL` and `SUPABASE_KEY` set in `.dev.vars` for local dev.
**Estimated effort:** ~1 session across 3 short phases.

## Open Risks & Assumptions

- One absence per employee per day is assumed (UNIQUE constraint on `employee_id, date`); if partial-day split absences are needed later, this constraint requires a migration to remove
- `get_user_role()` returns NULL for users who exist in `auth.users` but not yet in `employees`; such users will see zero rows everywhere — this is intentional (unadded user = no access)
- Remote Supabase project (production) needs `npx supabase db push` after local validation

## Success Criteria (Summary)

- `npx supabase db reset` applies both migrations cleanly, Studio shows all tables + 6 absence types
- Manual RLS smoke test: employee can only read/write their own absences; moderator can read/write all; anon gets zero rows
- `npm run build` succeeds with `src/types.ts` in place
