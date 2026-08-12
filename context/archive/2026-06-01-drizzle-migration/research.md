---
date: 2026-06-01T00:00:00+00:00
researcher: Claude Sonnet 4.6
git_commit: 4365bfd00ca18219b6ca997933c386cccadc6a5b
branch: main
repository: 10x-devs-urlopy
topic: "Migrate Supabase JS client to Drizzle ORM — Cloudflare Workers runtime"
tags: [research, drizzle, supabase, cloudflare-workers, rls, migration]
status: complete
last_updated: 2026-06-01
last_updated_by: Claude Sonnet 4.6
---

# Research: Migrate Supabase JS client to Drizzle ORM

**Date**: 2026-06-01  
**Git Commit**: [`4365bfd`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/)  
**Branch**: main  
**Repository**: oliwabartosz/10x-devs-urlopy

## Research Question

How to migrate all application-table queries from Supabase JS client to Drizzle ORM in this Astro 6 + Cloudflare Workers project, preserving the existing security model (dual RLS/service-role client pattern) and choosing the right driver for the Workers runtime.

---

## Summary

- **Driver**: `@neondatabase/serverless` + `drizzle-orm/neon-http` — the only viable option for Cloudflare Workers + Supabase PostgreSQL. `postgres-js` does not work (needs raw TCP not available in Workers even with `nodejs_compat`).
- **`nodejs_compat`** is already enabled in `wrangler.jsonc` — no Workers config change needed.
- **46 Supabase calls** across 8 files will be migrated; **6 auth calls** stay on Supabase JS permanently.
- **Biggest architectural decision**: RLS strategy (see §RLS Strategy). Two options with clear trade-offs.
- **No schema changes** in this slice — Drizzle schema is derived from existing migrations. Future migrations can use `drizzle-kit generate`.
- **New files**: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`.
- **Env vars**: one new connection string added to `.dev.vars` + Cloudflare Secrets.

---

## Detailed Findings

### Current Supabase Client Architecture

Two clients exist in the codebase:

| Client | File | Key | RLS |
|--------|------|-----|-----|
| Session-based | [`src/lib/supabase.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/lib/supabase.ts) | `SUPABASE_KEY` (anon) | Enforced — `auth.uid()` active |
| Service-role (admin) | `src/lib/supabase-admin.ts` | `SUPABASE_SERVICE_KEY` | Bypassed entirely |

`src/middleware.ts` uses the session client only for `auth.getUser()` — this stays on Supabase JS.

---

### Full Query Inventory (46 calls → migrate; 6 auth calls → keep)

#### Files where ALL calls migrate to Drizzle

**[`src/pages/api/absences/index.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/pages/api/absences/index.ts)**

| Line | Client | Table | Op | Key filters | Notes |
|------|--------|-------|----|-------------|-------|
| 52-57 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — verify employee exists |
| 90-95 | RLS | absences | SELECT | `date >= from`, `date < to` | `.order("date")` — date-range fetch |
| 128-136 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — fetch caller role |
| 161-166 | RLS | employees | SELECT | `id = targetId`, `deleted_at IS NULL` | `.single()` — moderator validates target |
| 176-180 | RLS | absences | INSERT | — | `.select().single()` — returns inserted row |

**[`src/pages/api/absences/[id].ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/pages/api/absences/%5Bid%5D.ts)**

| Line | Client | Table | Op | Key filters | Notes |
|------|--------|-------|----|-------------|-------|
| 57-62 | RLS | absences | UPDATE | `id = :id` | Partial update; `.select().single()` |
| 96 | RLS | absences | DELETE | `id = :id` | `.select()` — empty array when RLS blocks |

**[`src/pages/api/employees/index.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/pages/api/employees/index.ts)**

| Line | Client | Table | Op | Key filters | Notes |
|------|--------|-------|----|-------------|-------|
| 17-22 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — auth check |
| 31-35 | **Admin** | employees | SELECT | none | Includes deleted; ordered by last/first name |
| 41-46 | RLS | employees | SELECT | `deleted_at IS NULL` | Fallback when admin unavailable |
| 77-85 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — verify moderator |
| 116-120 | **Admin** | auth | createUser | — | **Stays on Supabase JS** (auth admin API) |
| 129-133 | **Admin** | employees | INSERT | — | `.select().single()` — create employee record |
| 137 | **Admin** | auth | deleteUser | — | **Stays on Supabase JS** (compensating tx) |

**[`src/pages/api/employees/[id].ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/pages/api/employees/%5Bid%5D.ts)**

| Line | Client | Table | Op | Key filters | Notes |
|------|--------|-------|----|-------------|-------|
| 36-44 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — auth check |
| 74-81 | RLS | employees | SELECT | `id = :id` | Includes deleted (moderator RLS); checks `deleted_at` |
| 94-98 | RLS | employees | SELECT | `role = 'moderator'`, `deleted_at IS NULL` | **COUNT only**: `{ count: "exact", head: true }` |
| 104-109 | RLS | employees | UPDATE | `id = :id` | Partial; `.select().single()` |
| 129-137 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — auth check |
| 158-161 | RLS | employees | SELECT | `id = :id` | Read including deleted; checks already deleted |
| 173-178 | RLS | employees | UPDATE | `id = :id` | Soft-delete: set `deleted_at = NOW()` |

**[`src/pages/api/employees/[id]/restore.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/pages/api/employees/%5Bid%5D/restore.ts)**

| Line | Client | Table | Op | Key filters | Notes |
|------|--------|-------|----|-------------|-------|
| 26-34 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — auth check |
| 52 | RLS | employees | SELECT | `id = :id` | Read including deleted; verify IS deleted |
| 67-72 | RLS | employees | UPDATE | `id = :id` | Restore: set `deleted_at = NULL` |

**[`src/pages/dashboard.astro`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/pages/dashboard.astro)**

| Line | Client | Table | Op | Key filters | Notes |
|------|--------|-------|----|-------------|-------|
| 41-46 | RLS | employees | SELECT | `user_id = uid`, `deleted_at IS NULL` | `.single()` — current user employee record |
| 61-72 | **Admin** (Path A) / RLS (Path B) | employees | SELECT | Path A: none; Path B: `deleted_at IS NULL` | Dual path; admin includes deleted for moderator grid |
| 76-80 | RLS | absences | SELECT | `date >= firstDay`, `date < nextMonth` | Month's absences for grid |
| 81 | RLS | absence_types | SELECT | none | All types; `.order("id")` |

#### Files that stay on Supabase JS (no Drizzle migration)

| File | Reason |
|------|--------|
| `src/middleware.ts` | `auth.getUser()` — auth API, not data query |
| `src/pages/api/auth/signin.ts` | `auth.signInWithPassword()` |
| `src/pages/api/auth/signup.ts` | `auth.signUp()` |
| `src/pages/api/auth/signout.ts` | `auth.signOut()` |
| `src/pages/api/employees/index.ts:116-120` | `auth.admin.createUser()` — admin auth API |
| `src/pages/api/employees/index.ts:137` | `auth.admin.deleteUser()` — compensating transaction |

---

### Database Schema (Drizzle schema.ts target)

All defined in [`supabase/migrations/20260526000001_schema.sql`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/supabase/migrations/20260526000001_schema.sql) with patches in `20260527000001_fix_hours_check_and_moderator_select.sql`.

#### Enum
```sql
CREATE TYPE user_role AS ENUM ('employee', 'moderator');
```
Drizzle: `export const userRoleEnum = pgEnum('user_role', ['employee', 'moderator'])`

#### `employees` table
| Column | PG type | Nullable | Default | Constraint |
|--------|---------|----------|---------|-----------|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | — | UNIQUE, FK → `auth.users(id)` ON DELETE CASCADE |
| `role` | `user_role` | NO | — | — |
| `first_name` | TEXT | NO | — | — |
| `last_name` | TEXT | NO | — | — |
| `deleted_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | — |

#### `absence_types` table
| Column | PG type | Nullable | Default | Constraint |
|--------|---------|----------|---------|-----------|
| `id` | SERIAL | NO | auto | PK |
| `name` | TEXT | NO | — | — |
| `color` | TEXT | NO | — | CHECK `color ~ '^#[0-9a-fA-F]{6}$'` |

Seed: 6 rows (static — no UI CRUD). Drizzle will not seed; existing migration handles it.

#### `absences` table
| Column | PG type | Nullable | Default | Constraint |
|--------|---------|----------|---------|-----------|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `employee_id` | UUID | NO | — | FK → `employees(id)` |
| `absence_type_id` | INTEGER | NO | — | FK → `absence_types(id)` |
| `date` | DATE | NO | — | — |
| `is_full_day` | BOOLEAN | NO | TRUE | — |
| `hours` | NUMERIC(4,2) | YES | NULL | CHECK: `(is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL)` |
| `comment` | TEXT | YES | NULL | — |
| `substitute_employee_id` | UUID | YES | NULL | FK → `employees(id)` |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | — |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | — (auto-updated by trigger) |

**Unique**: `(employee_id, date)` — one absence per employee per day.  
**Trigger**: `absences_updated_at` BEFORE UPDATE → sets `updated_at = NOW()` automatically. Trigger is in the DB; Drizzle schema just needs to declare the column.

#### TypeScript type mapping ([`src/types.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/src/types.ts))

Current types are hand-written (no `supabase gen types`). After migration these should be replaced with `typeof employees.$inferSelect` etc., or kept as explicit interfaces that match Drizzle's inferred types.

---

### Driver Decision: `drizzle-orm/neon-http` via `@neondatabase/serverless`

**`wrangler.jsonc`** already has `"compatibility_flags": ["nodejs_compat"]` — no config change needed.

| Driver | Works on Workers? | Why |
|--------|------------------|-----|
| `drizzle-orm/neon-http` | ✅ | HTTP-only, no TCP, works in any edge runtime |
| `drizzle-orm/neon-serverless` | ✅ | WebSocket-based; Workers support native WebSocket |
| `drizzle-orm/postgres-js` | ❌ | Needs raw TCP (`node:net`/`node:tls`) — not available in Workers even with `nodejs_compat` |

**Install:**
```bash
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit
```

`neon-http` is recommended for all simple reads/writes (lower latency on cold start, stateless).  
`neon-serverless` (WebSocket + `Pool`) is required **only** if RLS JWT forwarding is chosen (needs session-mode connection, see §RLS Strategy).

---

### RLS Strategy (Key Architectural Decision)

This is the most consequential decision in the migration. Two options:

#### Option A — Service Role Only (Simpler)

Use one `neon-http` connection with the **service role key** for all Drizzle queries.

- RLS policies remain in the DB as a passive safety net but are bypassed by Drizzle.
- Application-level authorization (already implemented: role checks via `get_user_role()` equivalent in app code, ownership checks against `context.locals.user`) is the sole enforcement mechanism.
- Current app already has robust app-level checks in every API handler — this is not a security regression if those checks are correctly preserved in the Drizzle migration.

**Connection string** (Transaction Mode pooler, port 6543):
```
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

**Env var name**: `DATABASE_URL` (service role key in the password position, or separate `SUPABASE_DB_PASSWORD`)

**Pro**: Simple. One connection string. No session management. Fast cold starts.  
**Con**: DB-level enforcement lost. A bug in app auth logic → no DB safety net.

#### Option B — Dual Connection with JWT Forwarding (Preserves Current Model)

Two Drizzle instances:
- `adminDb` — `neon-http` + service role + Transaction Mode (6543) for admin queries
- `clientDb` — `neon-serverless` (WebSocket Pool) + anon key + Session Mode (5432) for user queries

User queries are wrapped in a transaction that calls `set_config('request.jwt.claims', ...)` and `SET LOCAL ROLE authenticated`, activating the same RLS policies as the Supabase JS session client.

```ts
// Pattern from Drizzle docs (drizzle-team/drizzle-orm-docs → rls.mdx)
export function createDrizzle(token, { admin, client }) {
  return {
    admin,
    rls: (async (transaction, ...rest) => {
      return await client.transaction(async (tx) => {
        await tx.execute(sql`
          select set_config('request.jwt.claims', ${JSON.stringify(token)}, TRUE);
          select set_config('request.jwt.claim.sub', ${token.sub ?? ''}, TRUE);
          set local role ${sql.raw(token.role ?? 'anon')};
        `);
        return await transaction(tx);
      }, ...rest);
    }) as typeof client.transaction,
  };
}
```

**Session Mode pooler** (port 5432) is mandatory for this — `SET LOCAL` inside a transaction requires a persistent session that Transaction Mode (6543) does not provide.

**Pro**: Full RLS enforcement at DB level — exact parity with current Supabase JS session client behavior.  
**Con**: Two connection strings. WebSocket pool in Workers (slightly heavier). `createDrizzle` wrapper on every RLS-aware request. More complex to set up and test.

**Recommendation for plan phase**: Start with Option A. The app-level auth is solid, and this is a tech-improvement slice (typesafe queries) not a security hardening slice. Option B can be added later if full DB-level enforcement becomes a requirement.

---

### `drizzle.config.ts`

`drizzle-kit` runs in Node.js (not Workers), so it uses a **direct connection** (not the pooler) to avoid PgBouncer prepared-statement limitations:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './supabase/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT!,  // direct connection, port 5432
  },
  migrations: {
    prefix: 'supabase',  // generates YYYYMMDDHHMMSS_ prefix matching existing convention
  },
  verbose: true,
  strict: true,
});
```

The direct connection URL is in the Supabase dashboard under Settings → Database → Connection string → URI (port 5432, not pooler).

---

### Environment Variable Changes

#### `.dev.vars` (wrangler dev — add these):
```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
# Option B only:
DATABASE_URL_SESSION=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

#### `.env` (drizzle-kit Node.js tooling — add):
```
DATABASE_URL_DIRECT=postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
```

#### `astro.config.mjs` — add to `env.schema`:
```ts
DATABASE_URL: envField.secret({ context: 'server', access: 'secret' }),
```

#### Cloudflare Secrets (production — set once):
```bash
npx wrangler secret put DATABASE_URL
```

---

### Query Translation Patterns

| Supabase JS | Drizzle equivalent |
|-------------|-------------------|
| `.from('t').select('a,b').eq('id', x).single()` | `db.select({a: t.a, b: t.b}).from(t).where(eq(t.id, x)).then(r => r[0])` |
| `.is('deleted_at', null)` | `isNull(employees.deletedAt)` |
| `.gte('date', from).lt('date', to)` | `and(gte(absences.date, from), lt(absences.date, to))` |
| `.order('last_name').order('first_name')` | `orderBy(asc(employees.lastName), asc(employees.firstName))` |
| `.select('*').insert(data).select().single()` | `db.insert(t).values(data).returning().then(r => r[0])` |
| `.update(data).eq('id', x).select().single()` | `db.update(t).set(data).where(eq(t.id, x)).returning().then(r => r[0])` |
| `.delete().eq('id', x).select()` | `db.delete(t).where(eq(t.id, x)).returning()` |
| `.select('id', { count: 'exact', head: true })` | `db.select({ count: count() }).from(t).where(...)` |

**`.single()` semantics**: Supabase throws `PGRST116` (zero rows) when `.single()` returns nothing. Drizzle returns `undefined` — code must handle this explicitly (currently caught as `PGRST116` error code in several handlers).

---

### New File Structure

```
src/
  db/
    schema.ts       — Drizzle table definitions + enum
    index.ts        — Drizzle client(s) export (adminDb; optionally clientDb)
drizzle.config.ts   — drizzle-kit config (Node.js only)
```

`src/lib/supabase.ts` and `src/lib/supabase-admin.ts` **remain** — used by auth operations.

---

## Architecture Insights

1. **`get_user_role()` SECURITY DEFINER function** is non-negotiable — it prevents RLS infinite recursion. It lives in the DB (migration), so it continues to exist regardless of which client is used. Under Option A (service role), it's irrelevant to Drizzle. Under Option B it's activated via JWT forwarding.

2. **The "dual path" pattern in dashboard.astro and employees/index.ts** (admin vs RLS client based on admin client availability) will simplify under Drizzle — the admin `db` is always available as a module-level import, eliminating the null-check fallback.

3. **Compensating transaction** for employee creation (`createUser` → `insertEmployee` → on failure: `deleteUser`) is the most complex pattern in the codebase. It crosses the Supabase Auth boundary (stays on Supabase JS) and the DB (moves to Drizzle). The two operations cannot be in one Drizzle transaction; the compensating pattern must remain as two separate operations.

4. **Count-only query** (`{ count: 'exact', head: true }` for moderator count check) maps to Drizzle's `count()` aggregate — one of the less obvious translations.

5. **`absences.date` is a `DATE` type** (not `TIMESTAMP`) — Drizzle's `pgTable` uses `date()` which returns a string in `YYYY-MM-DD` format, matching the current TypeScript type.

6. **`updated_at` trigger** on `absences` is in the DB and will continue to work; Drizzle just needs to declare the column as readable.

---

## Historical Context (from prior changes)

- [`context/changes/data-schema-and-rls/plan.md`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/context/changes/data-schema-and-rls/plan.md) — Full RLS policy design rationale. `get_user_role()` SECURITY DEFINER is mandatory to prevent recursive RLS. Ownership predicate `employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL)` is shared across all four absences operations.
- `context/changes/data-schema-and-rls/reviews/plan-review.md` — F1: hours biconditional tightening. F2: moderator select policy was missing, fixed by adding `employees_select_moderator_all`.
- [`context/changes/employee-management/plan.md`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/4365bfd00ca18219b6ca997933c386cccadc6a5b/context/changes/employee-management/plan.md) — Admin client bypass strategy for date-aware moderator queries. Service role must stay for auth user creation/deletion.
- `supabase/migrations/20260529000001_fix_absences_select_rls.sql` — Absences SELECT was originally own-only; changed to all-authenticated for team grid visibility.

---

## Open Questions

1. **RLS Strategy**: Option A (service role only, app-level auth) vs Option B (dual connection with JWT forwarding)? Recommendation: plan with Option A.

2. **Migration file ownership**: Should `drizzle-kit generate` own future migration files in `supabase/migrations/`, or continue using Supabase CLI (`supabase migration new`) for future schema changes? Since S-05 has no schema changes, this is a post-S-05 decision.

3. **`src/types.ts` after migration**: Replace hand-written interfaces with Drizzle's `$inferSelect` / `$inferInsert`? Or keep explicit interfaces (current convention)? Recommendation: replace — eliminates drift between DB schema and TypeScript types.

4. **`drizzle-kit push` vs `drizzle-kit migrate`**: `push` is for dev iteration (direct apply, no migration file); `migrate` applies from SQL files. Decision: use `migrate` only, matching the existing Supabase migration workflow. Do not use `push`.
