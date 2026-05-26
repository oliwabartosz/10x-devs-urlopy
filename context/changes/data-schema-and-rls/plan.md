# Database Schema and RLS — Implementation Plan

## Overview

Create the foundational database layer for Urlopy: three tables (`employees`, `absence_types`, `absences`), a PostgreSQL ENUM, a SECURITY DEFINER helper function for role-aware RLS, row-level security policies, seeded absence types, and TypeScript entity interfaces. This unblocks every subsequent slice (S-01, S-03, S-04).

## Current State Analysis

- **No migrations** — `supabase/migrations/` is empty; no application tables exist
- **No role system** — auth is plain email/password; `src/middleware.ts` attaches `User | null` to `context.locals.user` but reads no role field
- **No TypeScript types** — `src/types.ts` does not exist; entity types will be created here
- **Supabase client** — `src/lib/supabase.ts` uses `@supabase/ssr` cookie-based sessions; no changes needed to the client itself
- **Supabase local config** — `supabase/config.toml` targets PostgreSQL 17, Studio on port 54323, email confirmations disabled in dev

## Desired End State

Three application tables exist with RLS enforced at the database level:
- Any authenticated user can read active employees and all absence types
- An employee can create, read, update, and delete only their own absences
- A moderator can create, read, update, and delete absences for all employees, and can add/update employees
- Unauthenticated requests return zero rows on all three tables
- The six canonical absence types are seeded with correct names and hex colors
- TypeScript interfaces in `src/types.ts` match the schema exactly

Verified by: `npx supabase db reset` applies both migrations cleanly, Studio shows correct tables + policies, manual RLS smoke test passes.

### Key Discoveries

- `src/middleware.ts:10-13` — `supabase.auth.getUser()` attaches the raw Supabase `User` to `context.locals.user`; no role information flows through at this layer
- `src/pages/api/auth/signup.ts:13` — `signUp({ email, password })` sets no `user_metadata`; role must live in `employees.role`, not auth metadata
- `supabase/config.toml` — project id is `10x-astro-starter`; Studio is at `localhost:54323`
- Supabase migration naming convention (from `CLAUDE.md`): `YYYYMMDDHHmmss_short_description.sql`

## What We're NOT Doing

- No Supabase generated types (`supabase gen types`) — hand-written interfaces are sufficient for MVP
- No moderator UI for managing absence types — the 6 types are static seed data; adding new types requires a migration
- No DELETE RLS policy on `employees` — hard deletes are blocked by omission; soft-delete is via `UPDATE employees SET deleted_at = NOW()`
- No public/anon read on any table — the app is fully private per PRD Access Control section
- No trigger-based `updated_at` auto-management on `employees` — only `absences` has an `updated_at` field that needs it

## Implementation Approach

**Two migration files** keep schema DDL separate from seed data. A `SECURITY DEFINER` helper function (`get_user_role()`) reads `employees.role` for `auth.uid()` and is called from RLS policies — this is the canonical way to avoid self-referential RLS recursion on the `employees` table.

Phase 1 creates the full schema + policies. Phase 2 seeds absence types. Phase 3 adds TypeScript interfaces.

## Critical Implementation Details

**RLS self-reference avoidance** — RLS policies on `employees` cannot directly call a SECURITY INVOKER function that queries `employees`, because that triggers the policy again infinitely. `get_user_role()` must be `SECURITY DEFINER` with `SET search_path = public` so it bypasses RLS when querying the employees table internally. This is non-negotiable; omitting `SECURITY DEFINER` produces an infinite recursion error at query time.

**Ownership check in absences policies** — The `absences` table links to `employees.id` (UUID), not directly to `auth.uid()`. The ownership predicate must therefore be a subquery: `employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL)` — not a direct equality `employee_id = auth.uid()`.

**Hours constraint** — When `is_full_day = false`, `hours` must not be NULL. Enforce this at the DB level: `CHECK (is_full_day OR hours IS NOT NULL)`. Application code must set `is_full_day = true` and `hours = NULL` together, or `is_full_day = false` and `hours = <value>` together.

---

## Phase 1: Schema Migration

### Overview

Create the `user_role` ENUM, all three tables, the `get_user_role()` SECURITY DEFINER function, enable RLS on all tables, and define all RLS policies. Produces one migration file.

### Changes Required

#### 1. Schema migration file

**File**: `supabase/migrations/20260526000001_schema.sql`

**Intent**: Establish the full DDL — ENUM, tables, helper function, RLS enable, and all policies — in a single atomic migration.

**Contract**: The file must contain, in order:

1. `CREATE TYPE user_role AS ENUM ('employee', 'moderator');`

2. `employees` table:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE`
   - `role user_role NOT NULL`
   - `first_name TEXT NOT NULL`
   - `last_name TEXT NOT NULL`
   - `deleted_at TIMESTAMPTZ NULL` — NULL means active; soft-delete sets this to NOW()
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

3. `absence_types` table:
   - `id SERIAL PRIMARY KEY`
   - `name TEXT NOT NULL`
   - `color TEXT NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$')` — enforces hex format

4. `absences` table:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `employee_id UUID NOT NULL REFERENCES employees(id)`
   - `absence_type_id INTEGER NOT NULL REFERENCES absence_types(id)`
   - `date DATE NOT NULL`
   - `is_full_day BOOLEAN NOT NULL DEFAULT TRUE`
   - `hours NUMERIC(4,2) NULL CHECK (is_full_day OR hours IS NOT NULL)`
   - `comment TEXT NULL`
   - `substitute_employee_id UUID NULL REFERENCES employees(id)`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `UNIQUE (employee_id, date)` — one absence per employee per day (matches the grid's one-cell model)

5. `updated_at` trigger for `absences`:
   ```sql
   CREATE OR REPLACE FUNCTION update_updated_at()
   RETURNS TRIGGER LANGUAGE plpgsql AS $$
   BEGIN
     NEW.updated_at = NOW();
     RETURN NEW;
   END;
   $$;
   
   CREATE TRIGGER absences_updated_at
     BEFORE UPDATE ON absences
     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
   ```

6. `get_user_role()` helper:
   ```sql
   CREATE OR REPLACE FUNCTION get_user_role()
   RETURNS user_role
   LANGUAGE sql
   SECURITY DEFINER
   STABLE
   SET search_path = public
   AS $$
     SELECT role FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
   $$;
   ```
   The `SECURITY DEFINER` attribute is load-bearing — it lets the function query `employees` without triggering the table's own RLS policies, preventing infinite recursion.

7. Enable RLS:
   ```sql
   ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
   ALTER TABLE absence_types ENABLE ROW LEVEL SECURITY;
   ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
   ```

8. RLS policies — `employees`:
   - SELECT: `USING (auth.uid() IS NOT NULL AND deleted_at IS NULL)` — any authenticated user sees active employees
   - INSERT: `WITH CHECK (get_user_role() = 'moderator')` — moderator only
   - UPDATE: `USING (get_user_role() = 'moderator')` — moderator only (covers soft-delete)
   - No DELETE policy — hard deletes blocked by omission

9. RLS policies — `absence_types`:
   - SELECT: `USING (auth.uid() IS NOT NULL)` — any authenticated user
   - No INSERT/UPDATE/DELETE policies (static seed)

10. RLS policies — `absences` (all four operations share the same predicate):
    ```sql
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) OR get_user_role() = 'moderator'
    ```
    Four policies: SELECT with USING, INSERT with WITH CHECK, UPDATE with USING, DELETE with USING — all using the predicate above.

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npx supabase db reset`
- All three tables present in Studio schema view
- `get_user_role()` function visible in Studio → Database → Functions
- RLS shown as enabled on all three tables (`\d employees` in psql shows "Row Level Security: enabled")

#### Manual Verification

- Smoke test as employee: create a test employee row (role = 'employee'), authenticate as that user in Supabase client, confirm `SELECT * FROM absences` returns 0 rows (no absences yet, not an error)
- Smoke test as moderator: create a second employee row (role = 'moderator'), authenticate as moderator, confirm `SELECT * FROM employees` returns all active rows
- Unauthenticated client: `SELECT * FROM employees` returns 0 rows (RLS deny, not a permission error — the anon key should return empty)
- Employee cannot INSERT an absence with another employee's `employee_id` (returns RLS violation)

**Implementation Note**: After Phase 1 automated verification passes, run the manual RLS smoke tests before proceeding to Phase 2. The correctness of these policies is the single most important thing in this change.

---

## Phase 2: Seed Migration

### Overview

Insert the six canonical absence types from the PRD with their hex colors. Produces one migration file.

### Changes Required

#### 1. Seed migration file

**File**: `supabase/migrations/20260526000002_seed_absence_types.sql`

**Intent**: Populate `absence_types` with the six PRD-defined types and their hex color codes.

**Contract**: Six INSERT rows — names and colors must match the PRD Business Logic section exactly:

| name | color |
|------|-------|
| wyjazd zagraniczny | #2f578c |
| szkolenie/wyjście poza miejsce pracy | #10bbef |
| szkolenie w miejscu pracy | #ffcc00 |
| urlop | #58873e |
| choroba | #e50040 |
| stała nieobecność | #6f6f6f |

Use `INSERT INTO absence_types (name, color) VALUES (…)` — six rows in one statement.

### Success Criteria

#### Automated Verification

- `npx supabase db reset` applies both migrations in sequence without errors
- `SELECT COUNT(*) FROM absence_types;` returns 6
- `SELECT name, color FROM absence_types ORDER BY id;` matches the table above

#### Manual Verification

- All six types visible in Supabase Studio → Table Editor → absence_types
- Color values display correctly (Studio shows them as text; verify no hex truncation)

**Implementation Note**: After automated verification, visually confirm the names in Studio match the PRD spelling (Polish characters: ś, ę, ó, ł in the type names) — encoding issues during migration execution are the most common failure mode here.

---

## Phase 3: TypeScript Types

### Overview

Create `src/types.ts` with TypeScript interfaces that mirror the database schema. These interfaces are the shared contract used by all subsequent slices.

### Changes Required

#### 1. Entity interfaces

**File**: `src/types.ts` (new file)

**Intent**: Provide typed representations of `Employee`, `AbsenceType`, and `Absence` for use across Astro pages, React components, and API routes.

**Contract**: Export three interfaces and one type alias:

- `UserRole = 'employee' | 'moderator'`
- `Employee` — mirrors `employees` table columns; all timestamps as `string` (ISO format from Supabase client)
- `AbsenceType` — mirrors `absence_types` table columns
- `Absence` — mirrors `absences` table columns; `date` is `string` in `'YYYY-MM-DD'` format; `hours` and `substitute_employee_id` are nullable

Column-to-field mapping:

| DB column | TS field | TS type |
|-----------|----------|---------|
| id (UUID) | id | string |
| user_id (UUID) | user_id | string |
| role | role | UserRole |
| first_name | first_name | string |
| last_name | last_name | string |
| deleted_at | deleted_at | string \| null |
| created_at | created_at | string |
| id (SERIAL) | id | number |
| name | name | string |
| color | color | string |
| employee_id | employee_id | string |
| absence_type_id | absence_type_id | number |
| date | date | string |
| is_full_day | is_full_day | boolean |
| hours | hours | number \| null |
| comment | comment | string \| null |
| substitute_employee_id | substitute_employee_id | string \| null |
| updated_at | updated_at | string |

### Success Criteria

#### Automated Verification

- `npm run build` completes without TypeScript errors
- `npm run lint` passes

#### Manual Verification

- Import `Employee` type in a scratch file or existing page component and confirm IDE autocomplete resolves all fields correctly

---

## Testing Strategy

### Manual Testing Steps (RLS)

1. Start local Supabase: `npx supabase start`
2. Apply migrations: `npx supabase db reset`
3. In Studio SQL editor, insert one employee with `role = 'employee'` and one with `role = 'moderator'`, both linked to test `auth.users` entries
4. Use the Supabase JS client with each user's session to run SELECT/INSERT/UPDATE/DELETE on all three tables
5. Verify employee cannot SELECT absences belonging to another employee's `employee_id`
6. Verify moderator can SELECT all absences
7. Verify anon client returns empty on all tables

### Automated Verification

- `npx supabase db reset` is the primary automated gate — both migrations must apply without error
- `npm run build` covers TypeScript compilation of the new types

## Performance Considerations

With ~10 employees and ~200 absence entries per month, no indexes beyond the primary keys and the UNIQUE constraint are needed for MVP. The `employees.user_id` UNIQUE constraint creates an implicit index used by `get_user_role()`.

## Migration Notes

- Run `npx supabase start` before `npx supabase db reset` to apply migrations locally
- If the remote Supabase project also needs these migrations: `npx supabase db push`
- Rollback: `npx supabase db reset` drops and recreates the local DB — no rollback SQL needed for local dev. Remote rollback would require manual `DROP TABLE` statements in reverse order (absences → employees → absence_types → ENUM)

## References

- PRD: `context/foundation/prd.md` — FR-001..007, Business Logic (hex colors), Access Control
- Roadmap: `context/foundation/roadmap.md` — F-01 section, soft-delete risk note
- Supabase client: `src/lib/supabase.ts`
- Middleware: `src/middleware.ts`
- CLAUDE.md — migration naming convention, local dev commands

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema Migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — ea4ab77
- [x] 1.2 All three tables present in Studio schema view — ea4ab77
- [x] 1.3 `get_user_role()` function visible in Studio → Database → Functions — ea4ab77
- [x] 1.4 RLS enabled on all three tables — ea4ab77

#### Manual

- [x] 1.5 Employee smoke test: authenticated employee reads 0 absences (not an error), cannot insert absence for another employee — ea4ab77
- [x] 1.6 Moderator smoke test: authenticated moderator reads all employees and absences — ea4ab77
- [x] 1.7 Unauthenticated smoke test: anon client gets 0 rows on all tables — ea4ab77

### Phase 2: Seed Migration

#### Automated

- [x] 2.1 Both migrations apply in sequence: `npx supabase db reset` — 5377bd9
- [x] 2.2 `SELECT COUNT(*) FROM absence_types;` returns 6 — 5377bd9

#### Manual

- [x] 2.3 All six types visible in Studio with correct names and hex colors — 5377bd9

### Phase 3: TypeScript Types

#### Automated

- [x] 3.1 `npm run build` succeeds — dbbdf70
- [x] 3.2 `npm run lint` passes — dbbdf70

#### Manual

- [x] 3.3 IDE autocomplete resolves all fields on `Employee`, `AbsenceType`, `Absence` — dbbdf70
