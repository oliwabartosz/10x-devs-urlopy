# Drizzle Migration Implementation Plan

## Overview

Replace all 46 Supabase JS data queries across 5 files with Drizzle ORM using the `@neondatabase/serverless` + `drizzle-orm/neon-http` driver. No user-visible change. Auth operations stay on Supabase JS. Authorization remains app-level (service role connection bypasses RLS; existing handler checks enforce ownership and role).

## Current State Analysis

- Two Supabase clients: `src/lib/supabase.ts` (session/RLS) and `src/lib/supabase-admin.ts` (service role). Both remain — needed for auth.
- 46 data queries across 5 files; 6 auth calls (stay unchanged).
- `nodejs_compat` already in `wrangler.jsonc` — no Workers config change needed.
- No automated tests; verification is manual smoke testing.
- `src/types.ts` has hand-written interfaces with snake_case property names and `string` timestamps — will be replaced with Drizzle `$inferSelect` in Phase 5.

## Desired End State

After all phases complete:
- `src/db/schema.ts` defines all 3 tables + 1 enum as the single schema source of truth.
- `src/db/index.ts` exports a `createDb(databaseUrl: string)` factory used in every migrated file.
- `src/types.ts` re-exports Drizzle-inferred types (`typeof employees.$inferSelect`, etc.).
- All 5 migrated files import from `@/db/index` instead of `@/lib/supabase` / `@/lib/supabase-admin`.
- `drizzle.config.ts` present at project root; `db:generate` and `db:migrate` npm scripts available.
- `npm run build` passes. Manual smoke test of all CRUD flows passes.

### Key Discoveries:

- `date()` columns return `YYYY-MM-DD` strings by default in Drizzle — matches current behavior.
- `numeric()` columns return **strings** by default in Drizzle but Supabase JS returns **numbers**. The `absences.hours` column (`NUMERIC(4,2)`) must be cast to float in SELECT queries.
- `timestamp()` columns return `Date` objects by default. `deleted_at`, `created_at`, `updated_at` change from `string` to `Date`. Call sites updated in Phase 5.
- The "dual path" in `dashboard.astro` and `employees/index.ts` (null-check `adminClient`) collapses to a single `db` import — no fallback needed.
- Compensating transaction in `employees/index.ts` (create auth user → insert employee row → on failure: delete auth user) cannot be one atomic Drizzle transaction since auth ops stay on Supabase JS.
- `auth.users` FK on `employees.user_id` is cross-schema — omit from Drizzle schema (enforced in DB already).
- `neon-http` is stateless: each query is one HTTP round-trip. `createDb()` called per handler is cheap.

## What We're NOT Doing

- No JWT forwarding or `set_config` RLS activation — service role is the sole DB connection.
- No `drizzle-zod` — existing hand-written Zod schemas stay untouched.
- No schema changes — Drizzle schema is derived from existing migrations, not used to generate a new one.
- No automated tests — verification is manual smoke testing.
- No camelCase rename — Drizzle schema uses snake_case property names to match current TypeScript conventions.
- No migration of `src/middleware.ts` or any auth routes — these stay on Supabase JS.
- No `drizzle-kit push` — only `drizzle-kit generate` + `drizzle-kit migrate` for future schema changes.

## Implementation Approach

Five sequential phases, each independently testable. Phases 2–4 migrate one file group at a time (isolates regressions). Phase 5 consolidates types once all query logic is proven.

Service role key provides the PostgreSQL connection via the Transaction Mode pooler (port 6543) — bypasses RLS, which is acceptable because every handler already performs explicit ownership and role checks against `context.locals.user`.

## Critical Implementation Details

**`neon-http` client creation**: `DATABASE_URL` from `astro:env/server` is only accessible inside request handler functions, not at module top level. `createDb(DATABASE_URL)` must be called at the start of each exported handler function (`GET`, `POST`, `PATCH`, `DELETE`), or once at the top of the Astro frontmatter block.

**`numeric` → `string` discrepancy**: Supabase JS (PostgREST) serializes `NUMERIC` as JSON numbers. The `neon-http` driver returns them as strings. `absences.hours` must be cast: `sql<number | null>\`${absences.hours}::float\`` in every SELECT that includes `hours`, to keep the downstream JSON shape unchanged.

**`.single()` replacement**: Supabase throws `PGRST116` on zero rows; Drizzle returns `undefined`. Every `PGRST116` branch in existing error handlers becomes `if (!row)`. DB errors that previously returned `{ error }` now throw — ensure each handler has a try/catch (or verify one already wraps the handler body).

**Dual-path collapse**: `dashboard.astro` and `employees/index.ts` currently branch on `adminClient` nullability. After migration, `db` is always available. Remove the null-check branch; use a single query path for each operation.

---

## Phase 1: Scaffold

### Overview

Install packages, create the Drizzle schema + client, set up `drizzle.config.ts`, and wire env vars. No query logic changes. After this phase the new DB layer exists but is not yet used.

### Changes Required:

#### 1. Install dependencies

**File**: `package.json`

**Intent**: Add runtime Drizzle packages and `drizzle-kit` as a dev dependency. Add `db:generate`, `db:migrate`, and `db:studio` scripts.

**Contract**:
```
dependencies: drizzle-orm, @neondatabase/serverless
devDependencies: drizzle-kit
scripts:
  "db:generate": "drizzle-kit generate"
  "db:migrate": "drizzle-kit migrate"
  "db:studio": "drizzle-kit studio"
```

#### 2. Create Drizzle schema

**File**: `src/db/schema.ts` (new)

**Intent**: Define all three application tables and the `user_role` enum as Drizzle table objects. These become the single source of truth for TypeScript types (Phase 5) and future `drizzle-kit generate` migrations.

**Contract**: Export `userRoleEnum`, `employees`, `absence_types`, and `absences` using `pgEnum` / `pgTable` from `drizzle-orm/pg-core`. Column names and types must exactly match the live schema:

| Table | Notable column declarations |
|-------|----------------------------|
| `employees` | `deleted_at: timestamp('deleted_at', { withTimezone: true })` (nullable, no default) |
| `employees` | omit `auth.users` FK (cross-schema; enforced in DB) |
| `absences` | `hours: numeric('hours', { precision: 4, scale: 2 })` (nullable) — note: returns string at runtime |
| `absences` | `date: date('date')` — returns YYYY-MM-DD string |
| `absences` | unique constraint: `.on(table.employee_id, table.date)` |
| `absences` | `updated_at` has no explicit default in Drizzle (set by DB trigger) — declare as `.notNull()` without `.default()` |

All columns use **snake_case** property names matching SQL column names.

#### 3. Create Drizzle client factory

**File**: `src/db/index.ts` (new)

**Intent**: Export a `createDb` factory that takes a connection URL string and returns a typed Drizzle client using `neon-http`. Called once per request handler with `DATABASE_URL` from `astro:env/server`.

**Contract**:
```ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;
export { schema };
export * from './schema';

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}
```

#### 4. Create drizzle-kit config

**File**: `drizzle.config.ts` (new, project root)

**Intent**: Configure `drizzle-kit` to use the direct Postgres URL (from `.env`, not `.dev.vars`) and output generated migrations to `supabase/migrations/` with the existing timestamp prefix format.

**Contract**:
```ts
defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './supabase/migrations',
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT! },
  migrations: { prefix: 'supabase' },
  verbose: true,
  strict: true,
})
```

`DATABASE_URL_DIRECT` is the Supabase **direct connection** string (port 5432, not pooler) — read from `.env` since `drizzle-kit` runs in Node.js.

#### 5. Update environment configuration

**File**: `astro.config.mjs`

**Intent**: Declare `DATABASE_URL` as a server-only secret in Astro's env schema so it is available via `import { DATABASE_URL } from 'astro:env/server'` in API routes and Astro pages.

**Contract**: Add `DATABASE_URL: envField.secret({ context: 'server', access: 'secret' })` to the `env.schema` block alongside the existing Supabase entries.

---

**File**: `.dev.vars.example`

**Intent**: Document the `DATABASE_URL` variable needed for local Wrangler dev. This is the **Transaction Mode pooler** connection string (port 6543) using the service role database password.

**Contract**: Add one line: `DATABASE_URL=postgresql://postgres.[project-ref]:[DB_PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres`

---

**File**: `.env.example`

**Intent**: Document `DATABASE_URL_DIRECT` for `drizzle-kit` Node.js tooling. This is the **direct connection** string (port 5432, not pooler).

**Contract**: Add one line: `DATABASE_URL_DIRECT=postgresql://postgres:[DB_PASSWORD]@db.[project-ref].supabase.co:5432/postgres`

### Success Criteria:

#### Automated Verification:

- `npm install` completes without errors
- `npm run build` passes with `DATABASE_URL` declared in `astro.config.mjs`
- `npm run lint` passes on `src/db/schema.ts` and `src/db/index.ts`
- TypeScript: `src/db/schema.ts` compiles without errors

#### Manual Verification:

- `npm run dev` starts successfully (no import errors for new files)
- `DATABASE_URL` populated in `.dev.vars`; app loads dashboard without errors (Supabase JS still handles all queries at this point)
- `drizzle.config.ts` present; `DATABASE_URL_DIRECT` populated in `.env`; `npm run db:studio` connects to Supabase and shows the three tables

**Implementation Note**: Pause after Phase 1 manual verification before proceeding to Phase 2.

---

## Phase 2: Migrate Absences Routes

### Overview

Replace 7 Supabase JS calls in the two absences API routes with Drizzle queries. The `hours` numeric cast is introduced here for the first time.

### Changes Required:

#### 1. Migrate `GET /api/absences` and `POST /api/absences`

**File**: `src/pages/api/absences/index.ts`

**Intent**: Replace all 5 Supabase queries with Drizzle equivalents. Import `createDb` and `DATABASE_URL` instead of `createClient`. Keep existing Zod validation and response shape unchanged.

**Contract**:

Replace imports:
```
- import { createClient } from '@/lib/supabase'
+ import { createDb } from '@/db/index'
+ import { DATABASE_URL } from 'astro:env/server'
+ import { employees, absences } from '@/db/index'
+ import { eq, isNull, and, gte, lt, asc } from 'drizzle-orm'
```

`createDb(DATABASE_URL)` called once at the top of each exported handler function (`GET`, `POST`).

Query translations (5 queries):

| Current | Drizzle replacement |
|---------|-------------------|
| `employees.select('id').eq('user_id', uid).is('deleted_at', null).single()` | `db.select({ id: employees.id }).from(employees).where(and(eq(employees.user_id, uid), isNull(employees.deleted_at))).then(r => r[0])` |
| `absences.select(...).gte('date', from).lt('date', to).order('date')` | `db.select({ id: absences.id, ... , hours: sql<number\|null>\`${absences.hours}::float\` }).from(absences).where(and(gte(absences.date, from), lt(absences.date, to))).orderBy(asc(absences.date))` |
| `employees.select('id, role').eq('user_id', uid).is('deleted_at', null).single()` | same pattern as first query, selecting `{ id, role }` |
| `employees.select('id').eq('id', targetId).is('deleted_at', null).single()` | same pattern, filter on `employees.id` |
| `absences.insert(data).select().single()` | `db.insert(absences).values(data).returning().then(r => r[0])` |

PGRST116 error branches (`if (error?.code === 'PGRST116')`) become `if (!row)`.

All DB calls wrapped in try/catch returning `{ status: 500 }` on unexpected errors.

#### 2. Migrate `PATCH /api/absences/:id` and `DELETE /api/absences/:id`

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Replace 2 Supabase queries with Drizzle equivalents. `hours` cast applies to the PATCH select result.

**Contract**:

Same import pattern as above.

| Current | Drizzle replacement |
|---------|-------------------|
| `absences.update(data).eq('id', id).select().single()` | `db.update(absences).set(data).where(eq(absences.id, id)).returning().then(r => r[0])` — include `hours: sql<number\|null>\`${absences.hours}::float\`` in the returning shape |
| `absences.delete().eq('id', id).select()` | `db.delete(absences).where(eq(absences.id, id)).returning()` |

For DELETE: the current code returns `[]` when RLS blocks (indistinguishable from "not found"). With service role, Drizzle always has permission — if `returning()` is empty the row didn't exist; return 404.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes on both files
- TypeScript type-checks without errors

#### Manual Verification:

- `GET /api/absences?year=2026` returns correct absence list
- `GET /api/absences?from=2026-06-01&to=2026-07-01` returns correct date-ranged list
- `POST /api/absences` with valid body creates an absence and returns it (including `hours` as number, not string)
- `POST /api/absences` with duplicate `(employee_id, date)` returns 409
- `PATCH /api/absences/:id` updates an absence
- `DELETE /api/absences/:id` deletes an absence
- Non-existent `id` on PATCH/DELETE returns 404

**Implementation Note**: Pause after Phase 2 manual verification before proceeding to Phase 3.

---

## Phase 3: Migrate Employees Routes

### Overview

Replace 15 Supabase data queries across three employees API route files. The compensating transaction pattern and count-only query each have specific Drizzle translations.

### Changes Required:

#### 1. Migrate `GET /api/employees` and `POST /api/employees`

**File**: `src/pages/api/employees/index.ts`

**Intent**: Replace 4 data queries with Drizzle (lines 17-22, 31-35, 41-46, 77-85, 129-133). Keep `auth.admin.createUser()` (line 116-120) and `auth.admin.deleteUser()` (line 137) on Supabase JS admin client.

**Contract**:

Dual import: both `createDb` (Drizzle) and `createAdminClient` (Supabase — auth only) remain in this file.

Collapse the dual-path fetch (lines 31-46): remove the `if (adminClient)` branch. After migration, always use `db.select(...).from(employees).orderBy(asc(employees.last_name), asc(employees.first_name))` for the moderator path (no filter), and the same query with `.where(isNull(employees.deleted_at))` for the employee path.

Compensating transaction (lines 116-137):
```
1. adminClient.auth.admin.createUser(...)  ← stays on Supabase JS
2. db.insert(employees).values(...).returning().then(r => r[0])  ← Drizzle
3. on Drizzle error: adminClient.auth.admin.deleteUser(newUserId)  ← stays on Supabase JS
```
The two operations cannot be wrapped in a single Drizzle transaction. Preserve the existing try/catch compensation pattern.

#### 2. Migrate `PATCH /api/employees/:id` and `DELETE /api/employees/:id`

**File**: `src/pages/api/employees/[id].ts`

**Intent**: Replace 5 Supabase data queries (lines 36-44, 74-81, 94-98, 104-109, 129-137, 158-161, 173-178). This includes the count-only moderator check and the soft-delete UPDATE.

**Contract**:

Count-only query (lines 94-98):
```ts
// Current: .select('id', { count: 'exact', head: true })
// Drizzle:
import { count } from 'drizzle-orm';
const [{ value }] = await db
  .select({ value: count() })
  .from(employees)
  .where(and(eq(employees.role, 'moderator'), isNull(employees.deleted_at)));
```

Soft-delete (line 173-178):
```ts
db.update(employees).set({ deleted_at: new Date() }).where(eq(employees.id, id)).returning().then(r => r[0])
```

Fetch target employee (lines 74-81): the current query expects moderator RLS to allow reading deleted employees. With service role, the query always reads all rows — no `isNull(deleted_at)` filter, so soft-deleted employees are visible. This matches existing behaviour.

#### 3. Migrate `POST /api/employees/:id/restore`

**File**: `src/pages/api/employees/[id]/restore.ts`

**Intent**: Replace 3 Supabase queries (lines 26-34, 52, 67-72). Restore sets `deleted_at: null`.

**Contract**:

```ts
// Restore
db.update(employees).set({ deleted_at: null }).where(eq(employees.id, id)).returning().then(r => r[0])
```

Fetch-before-restore (line 52): `db.select({ id: employees.id, deleted_at: employees.deleted_at }).from(employees).where(eq(employees.id, id)).then(r => r[0])` — no `isNull` filter (need to read deleted employees too).

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes on all three files

#### Manual Verification:

- `GET /api/employees` returns active employees list (regular user)
- `GET /api/employees` as moderator returns all employees including soft-deleted
- `POST /api/employees` creates a new auth user + employee record
- `POST /api/employees` with duplicate email returns 409
- `PATCH /api/employees/:id` updates employee name/role
- `PATCH /api/employees/:id` attempting to demote last moderator returns 409
- `DELETE /api/employees/:id` soft-deletes an employee (sets `deleted_at`)
- `DELETE /api/employees/:id` on own account returns 403
- `POST /api/employees/:id/restore` restores a soft-deleted employee

**Implementation Note**: Pause after Phase 3 manual verification before proceeding to Phase 4.

---

## Phase 4: Migrate Dashboard

### Overview

Replace 4 Supabase queries in `dashboard.astro`. The dual-path pattern collapses to a single `db` path. `absence_types` query is the simplest (all rows, no filter).

### Changes Required:

#### 1. Migrate dashboard data fetches

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the 4 Supabase queries (lines 41-46, 61-72, 76-80, 81) with Drizzle. Remove the `adminClient` import and its null-check branching logic (lines 61-72). Keep all downstream prop passing and grid rendering unchanged.

**Contract**:

Remove: `import { createAdminClient } from '@/lib/supabase-admin'` and the `let adminClient` try/catch block.
Add: `import { createDb } from '@/db/index'`, `import { DATABASE_URL } from 'astro:env/server'`, Drizzle imports.
`const db = createDb(DATABASE_URL)` at the top of the frontmatter block.

Collapsed employees fetch (replaces lines 61-72):
```ts
// Current: two branches (admin all vs RLS active-only)
// Drizzle: one query for moderators (no deleted_at filter), one for employees
const employeeRows = currentEmployee?.role === 'moderator'
  ? await db.select(...).from(employees).orderBy(asc(employees.last_name), asc(employees.first_name))
  : await db.select(...).from(employees).where(isNull(employees.deleted_at)).orderBy(...)
```

Absences fetch (line 76-80): date-range query identical to the one migrated in Phase 2. Include `hours: sql<number|null>\`${absences.hours}::float\`` in the select shape.

Absence types fetch (line 81): `db.select().from(absence_types).orderBy(asc(absence_types.id))`.

The downstream grid filter `employees.filter(e => !e.deleted_at || new Date(e.deleted_at) >= firstDayOfViewedMonth)` (post-fetch, line ~92) will receive `deleted_at` as a `Date | null` object instead of `string | null`. `new Date(Date)` is still valid JavaScript; TypeScript may flag it — simplify to `e.deleted_at >= firstDayOfViewedMonth` since both sides are `Date` after migration.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes on `dashboard.astro`

#### Manual Verification:

- Dashboard loads for a regular employee: monthly grid renders with correct absence colors
- Dashboard loads as moderator: grid shows all columns including soft-deleted employees (filtered by date range)
- Month navigation changes the grid correctly
- Absence type colors render correctly

**Implementation Note**: Pause after Phase 4 manual verification before proceeding to Phase 5.

---

## Phase 5: Types Cleanup

### Overview

Replace hand-written interfaces in `src/types.ts` with Drizzle's inferred types. Update all call sites that use timestamp fields (now `Date` instead of `string`) and `hours` (always `number` after the `::float` cast in queries, so `$inferSelect`'s `string` is not used directly — keep wrapping types that use `number`).

### Changes Required:

#### 1. Replace `src/types.ts` with Drizzle re-exports

**File**: `src/types.ts`

**Intent**: Remove all hand-written `Employee`, `AbsenceType`, `Absence`, `AbsenceInsert`, `AbsenceUpdate` interfaces and replace them with re-exports derived from Drizzle schema inference.

**Contract**:

```ts
export type { userRoleEnum } from '@/db/schema';
import { employees, absence_types, absences } from '@/db/schema';

export type UserRole = 'employee' | 'moderator';
export type Employee = typeof employees.$inferSelect;
export type AbsenceType = typeof absence_types.$inferSelect;
export type Absence = typeof absences.$inferSelect & { hours: number | null };
// The & override is needed because $inferSelect gives `string|null` for numeric
// but all queries cast hours::float, so runtime type is number|null.

export type AbsenceInsert = typeof absences.$inferInsert;
export type AbsenceUpdate = Partial<Omit<AbsenceInsert, 'employee_id'>>;
```

**Type delta from current `src/types.ts`**:

| Field | Current | After |
|-------|---------|-------|
| `Employee.deleted_at` | `string \| null` | `Date \| null` |
| `Employee.created_at` | `string` | `Date` |
| `Absence.created_at` | `string` | `Date` |
| `Absence.updated_at` | `string` | `Date` |
| `Absence.hours` | `number \| null` | `number \| null` (unchanged via override) |
| `Absence.date` | `string` | `string` (unchanged — `date()` column) |

#### 2. Update call sites for timestamp type changes

**Files**: All components and routes that read `deleted_at`, `created_at`, or `updated_at` as strings.

**Intent**: Fix TypeScript errors that arise from `string` → `Date` type change. The JSON serialization of API responses is unaffected (Date serializes to ISO string in JSON). Component prop types that pass timestamps to client-side React need explicit `.toISOString()` calls where strings are expected.

**Contract**: Systematic approach — run `npm run lint` after Step 1 to surface all type errors. Fix each:
- `new Date(employee.deleted_at)` → `employee.deleted_at` (already a Date)
- `employee.created_at.substring(0, 10)` → `employee.created_at.toISOString().substring(0, 10)`
- Prop type mismatches: where a React component expects `string` and receives `Date`, add `.toISOString()` at the prop boundary

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with zero type errors
- `npm run build` passes

#### Manual Verification:

- Full dashboard smoke test: monthly grid renders, absence details show correct dates and timestamps
- Employee management: employee list shows correct `deleted_at` display if any
- All CRUD flows still work end-to-end (add absence, edit absence, delete absence, manage employees)
- `supabase.ts` and `supabase-admin.ts` still imported by middleware and auth routes (confirm not accidentally removed)

---

## Testing Strategy

### Manual Testing Steps:

Per phase (after each phase, before proceeding):

1. `npm run dev` starts without errors
2. Sign in with a test employee account
3. View dashboard — monthly grid loads, absences visible, colors correct
4. Add a new absence (full day and partial day) — appears in grid
5. Edit the absence — changes reflected
6. Delete the absence — removed from grid
7. Sign in with a moderator account
8. View dashboard — all employees including soft-deleted visible
9. Add absence for another employee (moderator path)
10. Create a new employee (POST /api/employees)
11. Soft-delete an employee, verify grid filters correctly
12. Restore the employee
13. Verify absence details table and statistics tabs load correctly

### After Phase 5 only:

14. `npm run lint` passes with zero errors
15. `npm run build` passes

## Performance Considerations

`neon-http` is stateless per query — no connection pooling overhead. Cold start for Workers is slightly lower than `neon-serverless` (no WebSocket handshake). Per-handler `createDb()` is lightweight (object construction, no network).

## Migration Notes

`DATABASE_URL` must be set in two places:
- `.dev.vars` for `wrangler dev` (Transaction Mode pooler, port 6543, service role password)
- Cloudflare Workers Secrets for production: `npx wrangler secret put DATABASE_URL`

`DATABASE_URL_DIRECT` must be set in:
- `.env` for `drizzle-kit` Node.js tooling (direct connection, port 5432)
- This is NOT injected into the Workers runtime; only `DATABASE_URL` is.

Both connection strings use the **database password** from Supabase dashboard (Settings → Database → Database password), not the `SUPABASE_SERVICE_KEY` JWT token.

## References

- Related research: `context/changes/drizzle-migration/research.md`
- Schema migrations: `supabase/migrations/20260526000001_schema.sql`, `20260527000001_fix_hours_check_and_moderator_select.sql`
- Current Supabase client: `src/lib/supabase.ts`, `src/lib/supabase-admin.ts`
- Roadmap: `context/foundation/roadmap.md` (S-05)

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scaffold

#### Automated

- [x] 1.1 `npm install` completes without errors — 5a2c03d
- [x] 1.2 `npm run build` passes with DATABASE_URL in env schema — 5a2c03d
- [x] 1.3 `npm run lint` passes on `src/db/schema.ts` and `src/db/index.ts` — 5a2c03d

#### Manual

- [x] 1.4 `npm run dev` starts without errors; dashboard loads (Supabase JS still active) — 5a2c03d
- [x] 1.5 `npm run db:studio` connects and shows three tables — 5a2c03d

### Phase 2: Migrate Absences Routes

#### Automated

- [x] 2.1 `npm run build` passes — 1113e13
- [x] 2.2 `npm run lint` passes on `api/absences/index.ts` and `api/absences/[id].ts` — 1113e13

#### Manual

- [x] 2.3 `GET /api/absences?year=2026` returns correct list — a57f5a1
- [x] 2.4 `POST /api/absences` creates absence; `hours` is number not string in response — a57f5a1
- [x] 2.5 `PATCH` and `DELETE /api/absences/:id` work; non-existent ID returns 404 — a57f5a1

### Phase 3: Migrate Employees Routes

#### Automated

- [x] 3.1 `npm run build` passes — c48871b
- [x] 3.2 `npm run lint` passes on all three employees route files — c48871b

#### Manual

- [x] 3.3 `GET /api/employees` returns active employees (user) and all incl. deleted (moderator) — c48871b
- [x] 3.4 `POST /api/employees` creates auth user + employee record — c48871b
- [x] 3.5 `PATCH /api/employees/:id` updates employee; last-moderator demotion returns 409 — c48871b
- [x] 3.6 `DELETE /api/employees/:id` soft-deletes; `POST /api/employees/:id/restore` restores — c48871b

### Phase 4: Migrate Dashboard

#### Automated

- [x] 4.1 `npm run build` passes — 920a9dc
- [x] 4.2 `npm run lint` passes on `dashboard.astro` — 920a9dc

#### Manual

- [x] 4.3 Dashboard grid loads for employee (active employees only) — 920a9dc
- [x] 4.4 Dashboard grid loads for moderator (includes soft-deleted, filtered by date range) — 920a9dc
- [x] 4.5 Absence colors and details correct; month navigation works — 920a9dc

### Phase 5: Types Cleanup

#### Automated

- [x] 5.1 `npm run lint` passes with zero type errors — e70bcd8
- [x] 5.2 `npm run build` passes — e70bcd8

#### Manual

- [x] 5.3 Full end-to-end smoke test: all CRUD flows pass — e70bcd8
- [x] 5.4 `supabase.ts` and `supabase-admin.ts` still used by middleware and auth routes (no accidental removal) — e70bcd8
