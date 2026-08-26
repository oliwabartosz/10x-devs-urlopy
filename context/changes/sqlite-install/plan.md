# Self-hosted VPS install (SQLite + own auth + nginx) Implementation Plan

## Overview

Turn Urlopy from a Cloudflare-Workers app backed by Supabase into a self-contained install that runs on
an **offline Linux VPS**: a SQLite file instead of Postgres, hand-rolled credentials instead of Supabase
Auth, Node behind nginx, installed by a script. All work happens on a `sqlite-install` branch; `main`
keeps deploying to Workers until the course demo, and merging the branch is what retires it.

## Current State Analysis

From `context/changes/sqlite-install/research.md` (commit `52a917d`):

- **The runtime is barely coupled to Cloudflare.** No Cloudflare runtime API appears in source, and
  `astro:env/server` already falls back to `process.env` (`node_modules/astro/dist/env/runtime.js:4`),
  so all 14 secret-import sites survive an adapter swap untouched.
- **RLS is already inert.** Every query runs through Drizzle on a service-role connection; zero
  `supabase.from()` calls exist. Authorization is app-level by design (`AGENTS.md:73`,
  `src/lib/employees.ts:4-12`). Dropping 18 policies costs nothing.
- **Supabase Auth is reached through exactly two factories** — `createClient` (`src/lib/supabase.ts:5`)
  and `createAdminClient` (`src/lib/supabase-admin.ts:6`) — from 8 live files. Only `user.id` (15 sites)
  and `user.email` (`Topbar.astro:17`) are ever read off the session user.
- **The dangerous surface is silent.** 15 route branches compare Postgres SQLSTATE codes via
  `src/lib/db-errors.ts`; under SQLite they stop matching and 409/422/400 responses become 500s with no
  throw and no type error.
- **13 test suites currently self-skip** unless `DATABASE_URL_DIRECT` is set, and the whole vitest config
  is shaped around a remote pooler (`testTimeout: 60_000`, `fileParallelism: false`).
- **`scripts/seed-admin.ts` already implements the desired bootstrap contract** — `ADMIN_LOGIN` /
  `ADMIN_PASSWORD` from the environment, idempotent via an `is_system` gate (`:68-77`).

New constraint established during planning: **the VPS has no network access.** No `npm ci`, no registry,
no CI-driven deploy. Artifacts are built on the developer machine and copied across.

## Desired End State

A single command on a freshly-prepared VPS brings up a working Urlopy:

```
sudo ./install.sh --db /var/lib/urlopy/urlopy.db --origin https://urlopy.internal
```

…after which `systemctl status urlopy` shows a running Node service, nginx proxies to it, the SQLite file
exists with the 7-type absence catalogue seeded and one hidden `is_system` admin created from
`ADMIN_LOGIN`/`ADMIN_PASSWORD`, and that admin can sign in and create employees through the existing UI.

**Verification**: sign in as the seeded admin, add an employee, record an absence for them, see it in the
grid, the details table and the statistics tab; restart the service and confirm the session and the data
survive; confirm a nightly backup file appears.

### Key Discoveries

- Drizzle 0.45.2 ships no `node-sqlite` entrypoint, but does ship `sqlite-proxy` — and this Node 24.15.0
  has `node:sqlite` with `DatabaseSync` and a native `backup()`. That pairing is the only zero-native-module
  route, which is what makes the offline install and the backup timer both trivial.
- `absences.hours` no longer exists — dropped in `20260605000001_absence_start_end_time.sql:23`. The
  `NUMERIC`→string gotcha documented at `AGENTS.md:77-83` is stale. The live coercion dependency is
  `src/lib/services/holiday-balance.ts:38-43`.
- **There are zero `db.transaction(` calls in the repo** (four matches for "transaction", all comments).
  `node:sqlite`'s synchronous API therefore costs nothing.
- `src/pages/auth/confirm-email.astro` is orphaned — zero references outside itself. `signup` exists only
  as `.scaffold`. No SMTP-dependent flow is live: every `createUser` passes `email_confirm: true`.
- The `is_system` invariant is app-enforced across ~9 read and ~7 write points with no DB backstop, and has
  already leaked twice by copy-paste (`context/archive/2026-08-18-absence-write-hardening/`).

## What We're NOT Doing

- **Not migrating existing Supabase data.** Fresh install; absence types and the admin are seeded, everything
  else is entered through the UI. This removes time-string normalisation, timestamp re-encoding and
  uuid-format work entirely.
- **Not removing the Supabase or Cloudflare dependencies.** `@supabase/*`, `@astrojs/cloudflare`, `wrangler`,
  `@sentry/cloudflare`, `wrangler.jsonc` and `supabase/` stay on disk. Package removal is a follow-up change
  after the demo. This plan only stops _using_ them. (Exception: two CI steps that would break the branch's
  build are neutralised in Phase 6.)
- **Not retargeting Playwright** to a local server, and not adding E2E to CI. Both are newly possible and
  both are deferred.
- **Not building a dual-target abstraction.** The Cloudflare path survives on `main`, not behind a runtime flag.
- **Not automating deployment.** The VPS is offline; CI cannot reach it. Deploys are a documented manual copy.
- **Not installing Node or nginx.** The install script assumes both are present.
- **Not touching the absence/grid/statistics feature surface.** No behaviour changes visible to end users
  beyond the login mechanism.

## Implementation Approach

Six phases on a `sqlite-install` branch, ordered so each is verifiable before the next starts.

The schema lands first — including the `users` and `sessions` tables, before any auth logic exists — so
that Phase 2 can rebuild the test harness against it. With the harness green, the two highest-risk phases
(error mapping, auth) are verified as they are written rather than after. Runtime and packaging come last
because they cannot be proven by unit tests anyway.

The driver sits behind `src/db/index.ts` as the single seam, so the `node:sqlite` choice remains reversible
in one file.

## Critical Implementation Details

**The sqlite-proxy row-shape contract.** `drizzle-orm/sqlite-proxy` calls back with
`(sql, params, method)` where `method` is `run` | `all` | `get` | `values`, and it expects `{ rows }` in a
_positional_ shape — an array of arrays for `all`/`values`, a single flat array for `get` — not the objects
`node:sqlite`'s `StatementSync.all()` returns. Mapping each row through `Object.values()` is correct here
because JS preserves insertion order and `node:sqlite` builds the object in column order. Getting this
wrong produces rows whose columns silently land in the wrong fields — it does not throw. This is the one
place in the plan where a mistake is invisible, so it gets its own unit test in Phase 1.

**Error normalisation belongs in the proxy, not in the routes.** Because we own the callback, driver errors
can be re-thrown with a stable shape before Drizzle wraps them in `DrizzleQueryError`. `node:sqlite` throws
with `code: 'ERR_SQLITE_ERROR'` plus a numeric `errcode` carrying SQLite's extended result code
(`SQLITE_CONSTRAINT_UNIQUE` = 2067, `SQLITE_CONSTRAINT_FOREIGNKEY` = 787, `SQLITE_CONSTRAINT_CHECK` = 275).
Normalising there keeps `db-errors.ts` a pure mapping and keeps the 15 call sites unchanged in shape.

**Origin checking behind nginx.** Astro's `security.checkOrigin` defaults on and 403s non-safe form posts
when the `Origin` header does not match the computed URL origin — which is exactly what happens when nginx
forwards without `Host` and `X-Forwarded-Proto` set correctly. Symptom: sign-in and sign-out (the two
`FormData` routes) return 403 while every JSON route works. The nginx template must set both headers, and
`site` must match the public origin.

**Ordering: `users` before `employees`.** `employees.user_id` becomes a real FK into the local `users`
table, and `node:sqlite` enables foreign-key enforcement by default. Table creation order and seed order
both matter; the admin seed must insert the user row before the employee row.

---

## Phase 1: Data layer on SQLite

### Overview

Replace the Postgres schema and driver with SQLite equivalents, including the two new auth tables, and
rewrite the five Postgres-only query constructs. No auth logic yet — tables only.

### Changes Required:

#### 1. Schema

**File**: `src/db/schema.ts`

**Intent**: Port every table from `drizzle-orm/pg-core` to `drizzle-orm/sqlite-core`, preserving the exact
TypeScript types the rest of the app consumes so no call site changes. Add the `users` and `sessions` tables
that Phase 4 will drive.

**Contract**: Type mapping, chosen to keep `$inferSelect` identical where it matters —
`uuid().defaultRandom()` → `text().$defaultFn(() => crypto.randomUUID())`;
`pgEnum("user_role", …)` → `text({ enum: ["employee","moderator"] })`;
`timestamp({withTimezone:true})` → `integer({ mode: "timestamp" })` (**not** `text` — `dashboard.astro:180-181`
compares these as `Date` objects server-side);
`date()` → `text()` (already a `'YYYY-MM-DD'` string in and out — ~20 consumers unaffected);
`time()` → `text()`;
`serial()` → `integer().primaryKey({ autoIncrement: true })`, preserving ids 1–7 for `absence_types`.
New tables: `users(id text pk, email text not null unique collate nocase, password_hash text not null,
created_at, updated_at)` and `sessions(id text pk, user_id text not null → users.id on delete cascade,
created_at, expires_at)`. `employees.user_id` gains a real `.references(() => users.id)`.

#### 2. Driver

**File**: `src/db/index.ts`

**Intent**: Replace the postgres-js factory with a `node:sqlite` connection behind Drizzle's `sqlite-proxy`,
as a lazily-created module-level singleton rather than one instance per request.

**Contract**: `createDb(databasePath: string)` keeps its name and its `Db` export type so the 19 call sites
compile unchanged, but memoises the handle. Drop `ssl` and `prepare` (both Supabase-pooler artifacts). Set
`journal_mode = WAL` and confirm `enableForeignKeyConstraints` (default true) explicitly. The proxy callback
implements `run`/`all`/`get`/`values` per the row-shape contract above and re-throws driver errors carrying
`errcode`.

Note this inverts `AGENTS.md:44-45` ("do not call `createDb` at module top level", "one pool per request") —
both rules existed only because `astro:env/server` was request-scoped under Workers. Phase 6 corrects the docs.

#### 3. Migration and seed

**File**: `drizzle.config.ts`, `supabase/migrations/` → new `drizzle/` output directory

**Intent**: Switch drizzle-kit to the SQLite dialect and generate a single baseline migration from the new
schema, plus one consolidated seed. The three-legged Supabase provisioning ritual (CLI baseline → `db:migrate`
→ manual `psql`) collapses into one runner.

**Contract**: `dialect: "sqlite"`, `schema: "./src/db/schema.ts"`, `out: "./drizzle"`, credentials from
`DATABASE_PATH`. Drop `prefix: "supabase"`. Seed carries the **final** 7-row catalogue — the values after
`20260807122840` _and_ the single-codepoint icon fix from `20260812153000`, whose omission renders three or
four glyphs per offsite cell. Add `UNIQUE(name)` to `absence_types`: `src/lib/absence-types.ts:7-11` gates the
partial-day feature on exact name strings, so a duplicate row silently breaks it today.

The `absence_types.color` regex CHECK has no SQLite equivalent (`~` does not exist) — express it as a `GLOB`
pattern. The three other CHECK constraints (`absences_time_check`, the two `holiday_balances` ones) port as-is.

**File**: `src/db/migrate.ts` (new)

**Intent**: Apply pending migrations and the seed at startup, idempotently, so a fresh install needs no
separate migration step.

**Contract**: Uses `drizzle-orm/sqlite-proxy/migrator` with the same callback as the driver. Safe to call on
every boot.

#### 4. The Postgres-only query rewrites

**File**: `src/lib/services/holiday-balance.ts`

**Intent**: Replace the `extract(epoch from (end_time - start_time))` aggregate, which SQLite cannot express.

**Contract**: Keep `count(*) FILTER (WHERE …)`, `coalesce` and `sum` (all supported). Compute partial-day
hours by selecting the rows and aggregating in JS via the existing `getAbsenceHours()`
(`src/lib/absence-stats.ts:13-18`) rather than in SQL — the row count here is bounded by one employee-year.
The `Number()` casts at `:55-56` stay correct (SQLite returns numbers); the comment at `:38` becomes wrong
and should go.

**File**: `src/pages/api/employees/order.ts`

**Intent**: Replace the `UPDATE … FROM (SELECT UNNEST(ARRAY[…]))` bulk reorder — no arrays, no `unnest`, no
cast operator in SQLite.

**Contract**: Rewrite as a `json_each(?)` join or a `VALUES` CTE over a single parameter. `UPDATE … FROM` is
supported (SQLite 3.33+) and may stay. **The `AND employees.is_system = false` guard is load-bearing** — it
is what stops a crafted payload from reordering the technical admin — and must survive the rewrite verbatim.

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Set `updated_at` explicitly on update, so the column no longer depends on a DB trigger.

**Contract**: The repo's only trigger (`supabase/migrations/20260526000001_schema.sql:58-70`) is not being
ported. `PATCH /api/absences/:id` is its sole consumer: `:199` sets the zod-parsed body, which has no
`updated_at`, then reads the column back at `:210` and returns it at `:222`. Add `updated_at: new Date()` to
the `set`, matching what `bulk.ts:220` and `holiday-balances/index.ts:221` already do. Without this the column
silently freezes at insert time.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- A new unit test proves the sqlite-proxy row mapping returns columns in the right fields for `all`, `get` and `values`
- A new unit test proves a fresh DB file is created, migrated and seeded with exactly 7 absence types carrying the single-codepoint offsite icon
- Existing pure-logic suites still pass: `npm run test:run`

#### Manual Verification:

- `sqlite3`-free inspection via a short node script shows the expected tables, the `UNIQUE(name)` index and FK enforcement on
- Deleting the DB file and re-running the migrator reproduces an identical schema and seed

---

## Phase 2: Test infrastructure on SQLite

### Overview

Rebuild the test harness against a temporary SQLite file so the 13 route suites actually run — they
currently self-skip. Everything after this phase is verified by them.

### Changes Required:

#### 1. Test database helper

**File**: `src/tests/helpers/db.ts`

**Intent**: Point `getTestDb()` at a per-run temporary SQLite file instead of a remote pooler, and drop the
connection-bounding hack.

**Contract**: Creates a temp file per worker, runs the Phase 1 migrator + seed, returns the `Db`. Removes the
`?max=1&idle_timeout=1` suffix and the `DATABASE_URL_DIRECT` requirement, so suites no longer self-skip.

#### 2. Fixtures

**File**: `src/tests/helpers/fixtures.ts`

**Intent**: Replace the real-Supabase-auth-user creation with local `users` rows — the last dependency
keeping `SUPABASE_SERVICE_KEY` in the test environment and in CI secrets.

**Contract**: `createTestEmployee` inserts a `users` row then an `employees` row in one call and returns the
employee id, keeping its current signature so the 12 consuming suites don't change.
`teardownTestEmployee` deletes both — trivially, since the FK cascades. Add a moderator-role fixture, now
that one is seedable (previously "not currently seedable", `workers-data-edit/plan.md:431`).

#### 3. Env stub and vitest config

**File**: `src/tests/helpers/astro-env.ts`, `vitest.config.ts`

**Intent**: Export `DATABASE_PATH` instead of a connection string, and remove the pooler-driven workarounds
that no longer describe reality.

**Contract**: Delete `testTimeout: 60_000`, `hookTimeout: 60_000` and `fileParallelism: false` — all three
exist solely because "a single round trip measures 3-5s" against Supabase. Drop the `SUPABASE_*` exports from
the stub once Phase 4 lands; until then leave them so the suite stays green mid-branch.

#### 4. Production-data safety scaffolding

**File**: `src/tests/api/**`

**Intent**: Leave the defensive double-scoping (fixture UUID _and_ suite-specific date window) in place for
now, but stop treating it as a requirement.

**Contract**: No functional change. The hazard it guards against — tests sharing a database with production —
is gone with a per-run temp file. Note it in the file comments rather than removing it in the same phase that
changes everything else.

### Success Criteria:

#### Automated Verification:

- All 13 route suites run rather than skip: `npm run test:run` reports zero skipped describes
- Full suite passes: `npm run test:run`
- Suite completes substantially faster than the previous remote-Postgres runs, with `fileParallelism` restored to default
- Linting passes: `npm run lint`

#### Manual Verification:

- Running the suite twice in a row is clean — no cross-run state leaks from a stale temp file
- A deliberately broken assertion fails for the right reason, confirming the suites are genuinely exercising handlers

---

## Phase 3: Error mapping and pre-flight checks

### Overview

Restore every 409/422/400 contract that Postgres error codes currently drive, and replace the FK-constraint-name
discrimination that SQLite cannot support. This is the silent-failure phase — nothing here throws when it is wrong.

### Changes Required:

#### 1. The error helper

**File**: `src/lib/db-errors.ts`

**Intent**: Map SQLite extended result codes to the same semantic categories the 15 call sites already branch on.

**Contract**: Keep both exported function names and the `err.code ?? err.cause?.code` indirection (Drizzle still
wraps). Translate `2067` (`SQLITE_CONSTRAINT_UNIQUE`) → the unique category, `787`
(`SQLITE_CONSTRAINT_FOREIGNKEY`) → the FK category, `275` (`SQLITE_CONSTRAINT_CHECK`) → the check category.
`42501` (insufficient privilege) has no analogue — it came from RLS and its branches can go.
`extractPgErrorConstraint` loses its meaning for FK violations; keep it only for CHECK violations, where SQLite
does name the constraint in the message. Rename both to drop the `Pg` prefix.

#### 2. Pre-flight existence checks

**File**: `src/lib/absence-write-target.ts`, `src/pages/api/absences/index.ts`, `src/pages/api/absences/[id].ts`, `src/pages/api/absences/bulk.ts`

**Intent**: Resolve "unknown absence type" and "unknown substitute employee" before the write, since SQLite's
FK error names neither constraint nor column.

**Contract**: Two lookups producing the existing distinct Polish 422 messages
("Nie znaleziono wybranego typu nieobecności" / "Nie znaleziono pracownika na zastępstwo"). This deliberately
reverses the decision recorded at `absence-write-target.ts:62-65` — _"A nonexistent substitute is deliberately
not checked — the FK maps it to 422 via `extractPgErrorConstraint`, which is the existing contract."_ Update
that comment to record the reversal and why.

#### 3. Date validation

**File**: `src/pages/api/absences/index.ts`

**Intent**: Stop leaning on Postgres to reject impossible calendar dates like `2026-02-31`.

**Contract**: `:112` currently validates with a bare `/^\d{4}-\d{2}-\d{2}$/`. Replace with the existing
`DateSchema` from `src/lib/validators.ts:3-9`, which `bulk.ts:48-51` already uses and which does real calendar
validation. SQLite TEXT accepts anything.

#### 4. Tests

**File**: `src/tests/lib/db-errors.test.ts`, `src/tests/api/absences/crud.test.ts`

**Intent**: Rewrite the assertions that encode Postgres codes.

**Contract**: `db-errors.test.ts:6-20` asserts on `23505`/`23514`; `crud.test.ts:162,178,199` assert
`e.cause?.code === "23514"` / `"23505"`. Both move to the SQLite codes. Add route-level tests asserting the
status codes themselves — 409 on duplicate `(employee_id, date)`, 422 on each of the two unknown-reference
cases, 400 on a CHECK violation — so the contract is proven at the boundary, not just in the helper.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm run test:run`
- Route tests prove 409 on duplicate absence, 422 on unknown absence type, 422 on unknown substitute, 400 on time-check violation
- A test proves `2026-02-31` is rejected with 400 rather than stored
- Type checking and linting pass: `npx tsc --noEmit && npm run lint`

#### Manual Verification:

- No route in `src/pages/api/**` still references a five-digit SQLSTATE constant (grep confirms)
- The two 422 messages are still distinguishable in the UI when creating an absence with a bad type or substitute

---

## Phase 4: Auth replacement

### Overview

Replace Supabase Auth with local credentials and sessions, seeded from an environment-provided admin, plus
the sign-in rate limiting Supabase was silently providing.

### Changes Required:

#### 1. The type seam

**File**: `src/env.d.ts`

**Intent**: Stop typing `locals.user` as a Supabase `User`; the whole codebase follows from this one line.

**Contract**: `user: { id: string; email: string } | null`. Only `user.id` (15 sites) and `user.email`
(`Topbar.astro:17`) are ever read. `userRole` is already computed by this app's own query and is unaffected.

#### 2. Password hashing

**File**: `src/lib/auth/password.ts` (new)

**Intent**: Hash and verify passwords with `node:crypto`'s scrypt — no dependency, nothing to compile.

**Contract**: `hashPassword(plain): string` producing a self-describing encoded string that carries the
algorithm, cost parameters and salt alongside the digest, so parameters can change later without a migration.
`verifyPassword(plain, encoded): boolean` must compare with `timingSafeEqual`, not `===`. Enforce the same
8-character floor the three existing zod schemas use.

#### 3. Sessions

**File**: `src/lib/auth/session.ts` (new)

**Intent**: Issue, validate and revoke opaque session ids backed by the `sessions` table.

**Contract**: `createSession(userId)`, `readSession(cookies)`, `destroySession(id)`,
`destroyOtherSessions(userId, keepId)` — the last one is what `password.ts:112` needs and what
`ChangePasswordDialog.tsx:51` promises the user in a toast. Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, and
`Secure` driven by configuration (see Phase 5) — strictly better than today's Supabase cookie, which is
observably neither `HttpOnly` nor `Secure` (`tests/e2e/.auth/user.json`). Expired rows are pruned
opportunistically on read.

#### 4. The two factory replacements

**File**: `src/lib/supabase.ts` → `src/lib/auth/index.ts`, `src/lib/supabase-admin.ts` → `src/lib/auth/users.ts`

**Intent**: Replace the SSR client with session functions, and the admin client with a `users`-table service,
preserving each caller's response contract.

**Contract**: The users service must cover exactly what the routes use today — create with a chosen password
(pre-verified, no confirmation flow), delete, read email by id, update email, set password without knowing the
old one, find by email. Case-insensitive email uniqueness comes from `COLLATE NOCASE` on the column; note this
is ASCII-only, which is fine for the address forms in use. The `null`-when-unconfigured contract disappears —
SQLite is always available — so the three 503 `"Admin client is not configured"` branches can go.

#### 5. Call-site updates

**File**: `src/middleware.ts`, `src/pages/api/auth/{signin,signout,password}.ts`, `src/pages/api/employees/index.ts`, `src/pages/api/employees/[id]/{email,password}.ts`

**Intent**: Point every Supabase call at the new modules while preserving the exact status codes and Polish
messages each route already returns.

**Contract**: The error semantics the routes branch on must be reproduced by the new layer — duplicate email
→ 409 (three sites), wrong current password → 400 "Obecne hasło jest nieprawidłowe."
(`password.ts:81-97` currently discriminates on Supabase's `reauthentication_needed` / `weak_password` /
`same_password` codes plus HTTP status). `signin.ts:18` currently reflects the raw provider message into
`/?error=` — replace with the app's own Polish messages, normalised so they do not reveal whether an account
exists. Two simplifications land here: the compensating `admin.deleteUser` at `employees/index.ts:157` is no
longer needed (user and employee rows are now in the same database), and `middleware.ts:28-30`'s silent
`catch {}` — which existed only to degrade under `wrangler dev`'s TLS failure — becomes a real error path.

#### 6. Rate limiting

**File**: `src/lib/auth/rate-limit.ts` (new), `src/pages/api/auth/signin.ts`

**Intent**: Add the brute-force defence that disappears with Supabase.

**Contract**: In-process sliding window keyed by email and client IP, with a generic failure response that
does not distinguish "too many attempts" from "wrong password". A single Node process serves the whole VPS,
so in-memory is sufficient and resets on restart — an accepted tradeoff, recorded in the code comment.
The client IP must come from nginx's forwarded header, not the socket.

#### 7. Bootstrap seed

**File**: `scripts/seed-admin.ts`

**Intent**: Keep the existing env contract and idempotency, swapping the Supabase half for a local hash.

**Contract**: Still reads `ADMIN_LOGIN` / `ADMIN_PASSWORD`; still exits as a no-op when any `employees` row
has `is_system = true` (`:68-77`). Now inserts a `users` row then the `employees` row in one transaction —
which also deletes the compensating-delete dance at `:120-129`. Drops its bespoke postgres-js driver
construction at `:63-64` in favour of `createDb`.

#### 8. Dead-code and config cleanup

**File**: `src/pages/auth/confirm-email.astro`, `src/lib/config-status.ts`, `src/layouts/Layout.astro`, `astro.config.mjs`, `.env.example`

**Intent**: Remove the orphaned email-confirmation surface and reword the Supabase-specific configuration banner.

**Contract**: `confirm-email.astro` has zero references outside itself and goes, along with the `signup`
`.scaffold` files. `config-status.ts` currently reports "Supabase nie jest skonfigurowany" — it should report
on the database path and admin bootstrap instead. Remove `SUPABASE_URL`/`KEY`/`SERVICE_KEY` and `DATABASE_URL`
from the `astro.config.mjs` env schema, replacing them with `DATABASE_PATH`. Rewrite `.env.example` around the
new variables.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm run test:run`
- Tests prove: sign-in with correct credentials sets a session cookie; wrong credentials do not; sign-out invalidates; a password change invalidates other sessions but not the caller's
- A test proves the session cookie carries `HttpOnly` and `SameSite=Lax`
- A test proves repeated failed sign-ins are throttled and the response does not reveal account existence
- `scripts/seed-admin.ts` is idempotent — running twice produces exactly one `is_system` employee
- Type checking and linting pass

#### Manual Verification:

- Sign in as the seeded admin; create an employee; sign out; sign in as that employee
- Change your own password and confirm other browser sessions are logged out but the current one is not
- Moderator changes another employee's email and password; that employee can sign in with the new values
- A non-moderator cannot reach the employee-management surfaces
- The technical admin is invisible in every employee list and cannot be edited or reordered

---

## Phase 5: Node runtime

### Overview

Swap the adapter and Sentry from Cloudflare to Node, and make the app correct behind a reverse proxy.

### Changes Required:

#### 1. Adapter and site

**File**: `astro.config.mjs`

**Intent**: Build a runnable Node server instead of a Worker.

**Contract**: `adapter: node({ mode: "standalone" })` producing `dist/server/entry.mjs` + `dist/client/`;
`@astrojs/node` must be added as a dependency. Drop `imageService: "passthrough"` (Cloudflare-only). Replace
the hardcoded Workers hostname in `site` with a value derived from the public origin — it is baked into the
sitemap at build time. Set `security.allowedDomains` appropriately for the reverse proxy.

#### 2. Sentry

**File**: `sentry.server.config.ts`, plus 15 import sites

**Intent**: Move off the Workers SDK.

**Contract**: `sentry.server.config.ts` becomes a plain `Sentry.init({ dsn: process.env.SENTRY_DSN, … })` —
every line of the current `withSentry<Env>(envFactory, handler)` form is Cloudflare-shaped. `SENTRY_DSN` is
not in the env schema, so `process.env` is the correct read. The other 14 files swap
`@sentry/cloudflare` → `@sentry/astro`, which re-exports the full `@sentry/node` surface — a one-token
find-and-replace. On an offline VPS Sentry cannot reach its ingest host, so a missing or unset DSN must
degrade quietly rather than throw at startup.

#### 3. Runtime environment loading

**File**: `src/db/index.ts` call sites, systemd unit (Phase 6)

**Intent**: Confirm the `astro:env/server` imports resolve from `process.env` with no adapter override.

**Contract**: No code change expected — Astro's default getter is `process.env` — but the Node adapter does
**not** load `.env` at runtime, so the variables must come from the process environment. This is verified
here and provisioned in Phase 6.

### Success Criteria:

#### Automated Verification:

- `npm run build` produces `dist/server/entry.mjs` and `dist/client/` with no Cloudflare artifacts (`wrangler.json`, `.dev.vars`, `cloudflare:workers` import all absent)
- `node ./dist/server/entry.mjs` starts and serves the sign-in page with the expected Polish literals
- No source file imports `@sentry/cloudflare`: grep returns zero hits
- Type checking and linting pass

#### Manual Verification:

- Sign in works against the locally-started production build — confirming `checkOrigin` is satisfied
- An unset `SENTRY_DSN` starts cleanly with no crash and no noisy logging
- Static assets under `/_astro/` are served correctly by the Node server alone, before nginx is involved

---

## Phase 6: Install, operate, document

### Overview

Produce the install script, the systemd units, the nginx template, the offline delivery procedure, and the
documentation corrections. Neutralise the two CI steps that would break on merge.

### Changes Required:

#### 1. Install script

**File**: `install.sh` (new)

**Intent**: Bring a prepared VPS from "artifact copied" to "service running" in one command.

**Contract**: Creates a dedicated service user and the directory layout (application, database, config);
writes `/etc/urlopy/env` with mode 0600 from arguments or prompts; runs migrations and the admin seed;
installs, enables and starts the systemd service and the backup timer. Idempotent — safe to re-run for an
upgrade. Does **not** install Node, does **not** touch nginx, does **not** reach the network. Fails loudly
with an actionable message if Node 24 is absent or the artifact is incomplete.

**File**: `deploy/urlopy.service`, `deploy/urlopy-backup.service`, `deploy/urlopy-backup.timer` (new)

**Intent**: Supervise the app and take periodic backups.

**Contract**: The service unit runs `node dist/server/entry.mjs` as the service user with
`EnvironmentFile=/etc/urlopy/env`, `Restart=on-failure`, and the hardening directives appropriate for a
service that needs write access to exactly one directory. `HOST`/`PORT` bind to loopback only — nginx is the
only public listener. The backup timer runs a small script using `node:sqlite`'s `backup()` API, so no
`sqlite3` CLI is required on the VPS, with a retention policy.

#### 2. nginx template

**File**: `deploy/nginx/urlopy.conf` (new)

**Intent**: Provide a reviewed server block to be placed by hand.

**Contract**: Proxies dynamic routes to the Node process and serves `dist/client/` from disk, with
`/_astro/` marked immutable. Must set `Host` and `X-Forwarded-Proto` correctly or Astro's origin check 403s
every form post. Carries the security headers that **do not exist anywhere today** — there is no `_headers`
file in the repo, so nothing supplies them once Cloudflare's edge is gone. TLS block present but commented
for the plain-HTTP case, with the cookie `Secure` flag driven by the same choice.

#### 3. Offline delivery procedure

**File**: `INSTALL.md` (new)

**Intent**: Document the build-here-copy-there workflow the offline VPS forces.

**Contract**: Build on the developer machine, prune to production dependencies, archive `dist/`,
`node_modules/`, `package.json` and `deploy/`, copy across, run `install.sh`. Because the `node:sqlite`
choice leaves **no native modules in the tree**, the pruned `node_modules` is portable between any two
Linux x64 machines running Node 24 — call this out, since it is the property the whole procedure depends on.
Include the upgrade path and a rollback (keep the previous artifact directory, re-point the symlink, restart).

#### 4. CI neutralisation

**File**: `.github/workflows/ci.yml`

**Intent**: Keep CI meaningful on the branch without pretending it can deploy to an unreachable VPS.

**Contract**: Remove the bundle-size step (`:45-50`) — it runs `wrangler deploy --dry-run` against a build
that no longer produces a Worker, and a VPS has no bundle limit. Disable the `deploy` job so that merging
does not attempt a Cloudflare deploy of a Node build. **Keep the post-deploy health check's assertions**
(`:90-139`) — repurposed as a smoke test against a locally-started server; its comments record that a weaker
check once stayed green through a Polonization commit and left E2E broken for a day. `CLOUDFLARE_*` secrets
become unused but are not removed here.

#### 5. Documentation corrections

**File**: `AGENTS.md`, `CLAUDE.md`, `README.md`, `context/foundation/infrastructure.md`, `context/foundation/roadmap.md`, `context/changes/development.md`

**Intent**: Fix the stale claims research verified as wrong, and record the new architecture.

**Contract**: Correct each of: `AGENTS.md:32` (`@neondatabase/serverless` is documented as installed but is
in neither `package.json` nor `node_modules`); `AGENTS.md:62,77-83` (the `NUMERIC absences.hours` gotcha —
that column was dropped in June); `AGENTS.md:113` (CI targets `master`; it targets `main`); `AGENTS.md:17`
(`npm run dev` described as the Astro dev server); `AGENTS.md:44-45` (the per-request pool rules, now
inverted); `README.md:18` (Node v22.14.0 vs `.nvmrc`'s 24.15.0); `infrastructure.md:75` (claims `astro:env`
is non-portable — it is portable to Node specifically). Add a roadmap entry: no slice covers this work.
`context/changes/development.md` is a stale Cloudflare-Pages-era plan and should be deleted or rewritten.

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run test:run` pass on the branch
- `npm run build` succeeds without any Cloudflare tooling in the pipeline
- A shell lint (`shellcheck`) passes on `install.sh` and the backup script
- The documented archive step produces a tarball containing `dist/`, `node_modules/`, `package.json` and `deploy/`, and a check confirms **zero `.node` binaries** inside it

#### Manual Verification:

- On the VPS: copy the artifact, run `install.sh`, and reach the sign-in page through nginx
- Sign in as the seeded admin and complete the full flow — add an employee, record an absence, view it in the grid, details and statistics
- `systemctl restart urlopy` preserves both data and existing sessions
- The backup timer produces a restorable file; restoring it into a fresh path yields a working database
- Re-running `install.sh` over an existing install upgrades without data loss
- Every corrected documentation claim is accurate as written

---

## Testing Strategy

### Unit Tests

- sqlite-proxy row mapping across `all` / `get` / `values` — the one silent-corruption risk in the plan
- Migration + seed idempotency and the exact 7-row catalogue
- scrypt hash/verify round-trip, including rejection of a wrong password and constant-time comparison
- SQLite error-code translation in `db-errors.ts`
- Rate-limit window behaviour

### Integration Tests

- The 13 existing route suites, now actually running rather than skipping
- Status-code contracts at the boundary: 409 duplicate, 422 unknown type, 422 unknown substitute, 400 CHECK violation, 400 impossible date
- Session lifecycle: create, validate, revoke self, revoke others
- The `is_system` invariant across every read and write path it guards — the two prior leaks were copy-paste propagation, so this is asserted, not assumed

### Manual Testing Steps

1. Fresh install on the VPS from a copied artifact; reach the sign-in page through nginx
2. Sign in as the seeded admin; create an employee with a known password
3. Sign in as that employee in a second browser; record an absence; verify it in grid, details and statistics
4. As the employee, change the password; confirm the second session is logged out and the first is not
5. As the moderator, change that employee's email and reset their password; confirm both take effect
6. Confirm a non-moderator cannot reach employee management and cannot edit another person's absence
7. Restart the service; confirm data and sessions survive
8. Trigger a backup; restore it to a scratch path; confirm the restored database opens and contains the data
9. Re-run `install.sh`; confirm an upgrade leaves data intact and creates no second admin

## Performance Considerations

Performance is a non-issue at this scale — one department, about 10 people
(`context/foundation/prd.md:28`), on a local file with no network round trip. The pooler latency that
shaped the entire test configuration disappears. Two notes: enable WAL so a read cannot block the writer,
and keep the driver a singleton, since opening a handle per request would churn file descriptors for no
benefit.

## Migration Notes

There is no data migration — the install is fresh by decision. The only data that must exist is the 7-row
absence-type catalogue and the single `is_system` admin, both seeded. Should existing Supabase data ever be
imported later, the research doc records the hazards that would then apply: time-string width normalisation
(`'09:00'` vs `'09:00:00'` breaks the CAS pin at `absences/[id].ts:188-189`), timestamp representation, and
storing uuids as TEXT rather than BLOB.

## References

- Research: `context/changes/sqlite-install/research.md`
- Brief: `context/changes/sqlite-install/plan-brief.md`
- Prior art for the bootstrap-admin contract: `scripts/seed-admin.ts:50-130`
- Prior art for app-level authorization: `src/lib/employees.ts:4-25`, `src/lib/employee-target-guard.ts:54-110`
- The warning this plan is written against: `context/archive/2026-06-01-drizzle-migration/reviews/impl-review-phase-2.md:29`
- Lesson applied throughout: `context/foundation/lessons.md` — "Repo-wide claims are load-bearing"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer on SQLite

#### Automated

- [x] 1.1 Type checking passes — 05de8e9
- [x] 1.2 Linting passes — 05de8e9
- [x] 1.3 Unit test proves sqlite-proxy row mapping for all/get/values — 05de8e9
- [x] 1.4 Unit test proves fresh DB is migrated and seeded with 7 types and the single-codepoint icon — 05de8e9
- [x] 1.5 Existing pure-logic suites pass — 05de8e9

#### Manual

- [x] 1.6 Inspection shows expected tables, UNIQUE(name) index, FK enforcement on — 05de8e9
- [x] 1.7 Deleting the DB file and re-migrating reproduces schema and seed identically — 05de8e9

### Phase 2: Test infrastructure on SQLite

#### Automated

- [x] 2.1 All 13 route suites run rather than skip (10 of 12 un-skipped; employees/{email,password} deferred to Phase 4) — a675627
- [x] 2.2 Full suite passes — a675627
- [x] 2.3 Suite runs with fileParallelism restored to default — a675627
- [x] 2.4 Linting passes — a675627

#### Manual

- [x] 2.5 Two consecutive runs are clean with no temp-file state leak — a675627
- [x] 2.6 A deliberately broken assertion fails for the right reason — a675627

### Phase 3: Error mapping and pre-flight checks

#### Automated

- [x] 3.1 Full test suite passes — 7e7adea
- [x] 3.2 Route tests prove 409 duplicate, 422 unknown type, 422 unknown substitute, 400 time-check — 7e7adea
- [x] 3.3 Test proves an impossible calendar date is rejected with 400 — 7e7adea
- [x] 3.4 Type checking and linting pass — 7e7adea

#### Manual

- [ ] 3.5 No route still references a five-digit SQLSTATE constant
- [ ] 3.6 The two 422 messages remain distinguishable in the UI

### Phase 4: Auth replacement

#### Automated

- [x] 4.1 Full test suite passes
- [x] 4.2 Tests prove sign-in, sign-out, and selective session revocation behaviour
- [x] 4.3 Test proves the session cookie carries HttpOnly and SameSite=Lax
- [x] 4.4 Test proves failed sign-ins are throttled without revealing account existence
- [x] 4.5 seed-admin is idempotent — twice yields exactly one is_system employee
- [x] 4.6 Type checking and linting pass

#### Manual

- [ ] 4.7 Admin signs in, creates an employee, that employee signs in
- [ ] 4.8 Password change logs out other sessions but not the caller
- [ ] 4.9 Moderator changes another employee's email and password; both take effect
- [ ] 4.10 A non-moderator cannot reach employee-management surfaces
- [ ] 4.11 The technical admin stays invisible and immutable everywhere

### Phase 5: Node runtime

#### Automated

- [ ] 5.1 Build produces entry.mjs and dist/client with no Cloudflare artifacts
- [ ] 5.2 The built server starts and serves the sign-in page with expected literals
- [ ] 5.3 No source file imports @sentry/cloudflare
- [ ] 5.4 Type checking and linting pass

#### Manual

- [ ] 5.5 Sign-in works against the local production build (checkOrigin satisfied)
- [ ] 5.6 Unset SENTRY_DSN starts cleanly
- [ ] 5.7 Static assets served correctly by the Node server alone

### Phase 6: Install, operate, document

#### Automated

- [ ] 6.1 Lint and test suite pass on the branch
- [ ] 6.2 Build succeeds with no Cloudflare tooling in the pipeline
- [ ] 6.3 shellcheck passes on install.sh and the backup script
- [ ] 6.4 Archive contains dist, node_modules, package.json, deploy — and zero .node binaries

#### Manual

- [ ] 6.5 Fresh VPS install reaches the sign-in page through nginx
- [ ] 6.6 Full flow works: employee created, absence recorded, visible in grid/details/statistics
- [ ] 6.7 Service restart preserves data and sessions
- [ ] 6.8 Backup restores into a working database
- [ ] 6.9 Re-running install.sh upgrades without data loss
- [ ] 6.10 Every corrected documentation claim is accurate as written
