---
date: 2026-08-25T14:18:17+02:00
researcher: Bartosz Oliwa
git_commit: 52a917ddd7de07fa1f27dbdaade04eb0130f3d72
branch: main
repository: oliwabartosz/10x-devs-urlopy
topic: "Self-hosted install on a Linux VPS: SQLite instead of Supabase, own auth, Node behind nginx"
tags: [research, codebase, sqlite, drizzle, auth, deployment, nginx, self-hosting, astro-node-adapter]
status: complete
last_updated: 2026-08-25
last_updated_by: Bartosz Oliwa
---

# Research: Self-hosted install on a Linux VPS (SQLite + own auth + nginx)

**Date**: 2026-08-25T14:18:17+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: `52a917d` (52a917ddd7de07fa1f27dbdaade04eb0130f3d72)
**Branch**: main
**Repository**: oliwabartosz/10x-devs-urlopy

## Research Question

Make Urlopy easy to install on a local Linux VPS: replace Supabase Postgres with SQLite, replace
Supabase Auth with self-hosted credentials, and serve the app behind nginx.

### Scope decided before research (user answers)

| Question      | Answer                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Target        | **Self-hosted is primary.** The Cloudflare deployment is kept only long enough to demo to the course teacher, then it goes down. No long-lived dual-target abstraction is warranted. |
| Auth          | **Own auth.** The system admin comes from `.env`; that admin creates all other users through the existing UI.                                                                        |
| Install shape | **Bare-metal script** — `install.sh` + systemd + nginx + Node 24. Not Docker.                                                                                                        |

Because the Cloudflare target is disposable rather than permanent, this research treats every
Cloudflare/Supabase touchpoint as something to **replace once**, not to abstract behind a
portability layer. The only constraint the demo imposes is that `main` must keep deploying and
working on Workers until the demo has happened.

## Summary

**The runtime move is far smaller than the project's own documentation implies. The auth and
error-mapping work is larger.**

Three findings dominate:

1. **The application contains no Cloudflare runtime API surface at all.** Falsifying greps for
   `caches.`, `waitUntil`, `ExecutionContext`, `locals.runtime`, `KVNamespace`/`R2Bucket`/`D1Database`,
   `WebSocketPair`, `crypto.subtle` and `Request.cf` return **zero hits** in source. The Cloudflare
   coupling is confined to the adapter, four lines of `sentry.server.config.ts`, and build/deploy config.
2. **`astro:env/server` is portable to Node with zero code changes.** Astro's runtime default getter is
   `let _getEnv = (key) => process.env[key]` (`node_modules/astro/dist/env/runtime.js:4`, Astro 6.3.1);
   the Cloudflare adapter _overrides_ it. Under `@astrojs/node` no override is installed, so all 14
   `astro:env/server` import sites keep working provided systemd puts the variables in the process
   environment. This **contradicts `context/foundation/infrastructure.md:75`**, which claims the env
   model must be rewritten on any platform move — it is non-portable to Vercel, but portable to Node.
3. **RLS is already inert, so the security model does not regress.** Every data query goes through
   Drizzle on the service-role `DATABASE_URL`; a repo-wide grep for `supabase.from(` / `.rpc(` returns
   **zero hits**. `AGENTS.md:73` and `src/lib/employees.ts:4-12` both state authorization is app-level
   by design. Dropping 18 RLS policies costs nothing at runtime.

Against that, the genuinely hard parts:

- **Auth must be rebuilt**, not ported. 27 distinct behaviours currently come from Supabase Auth,
  including password hashing/verification, session issuance and validation, selective session
  revocation, and — easy to miss — **sign-in rate limiting, for which the app has no substitute**.
- **`src/lib/db-errors.ts` breaks silently.** 15 call sites compare Postgres SQLSTATE codes
  (`23505`, `23503`, `23514`, `42501`). SQLite reports `SQLITE_CONSTRAINT_UNIQUE`-style strings. No
  throw, no type error — the routes just stop returning 409/422/400 and start returning 500.
- **The `updated_at` trigger disappears** and `PATCH /api/absences/:id` is the one path that depends on it.

The change is also **unbudgeted**: `context/foundation/roadmap.md` covers none of it (all 25 slices are
done and none concerns infrastructure), and the requirement is recorded in exactly one place —
`context/foundation/tech-stack.md:24`, "The later Red Hat server + SQLite requirement is a known manual
adaptation after scaffolding."

### Work at a glance

| Workstream                                  | Size                   | Character                                         |
| ------------------------------------------- | ---------------------- | ------------------------------------------------- |
| A. Runtime: adapter, Sentry, build          | Small                  | Mechanical; ~20 edited lines + one file rewrite   |
| B. Data layer: schema + driver              | Medium                 | Mostly mechanical, five real rewrites             |
| C. Error mapping                            | Small but **critical** | Silent-failure class; needs deliberate re-testing |
| D. Auth replacement                         | **Large**              | New code, new table, new security decisions       |
| E. Install + ops (systemd/nginx/TLS/backup) | Medium                 | All new; nothing to port                          |

## Detailed Findings

### A. Runtime: Cloudflare → Node behind nginx

#### A.1 What changes in `astro.config.mjs`

| Line                     | Today                                                  | Change                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `astro.config.mjs:9,33`  | `adapter: cloudflare({ imageService: "passthrough" })` | → `node({ mode: "standalone" })`. `@astrojs/node` is **not currently installed**. `imageService` has no Node equivalent; the repo has effectively no `astro:assets` usage, so drop it (optionally set the noop image service to avoid pulling in `sharp`). |
| `astro.config.mjs:19`    | `site: "https://urlopy.oliwa-bartosz.workers.dev"`     | Hardcoded Workers host, baked into `dist/client/sitemap-0.xml` at build time. Must become the VPS hostname.                                                                                                                                                |
| `astro.config.mjs:34-41` | `env.schema`                                           | Keeps working unchanged (see A.2). `DATABASE_URL` is **non-optional** and validated at runtime, not build time — which is why CI builds pass without it.                                                                                                   |

Standalone mode produces a runnable `dist/server/entry.mjs` plus `dist/client/`, replacing
`dist/server/wrangler.json`, the `cloudflare:workers` import, the injected `process` shim, and the
`SESSION` KV binding. The app never uses Astro sessions (`Astro.session` / `locals.session`: zero hits),
so that binding's disappearance is a non-event.

#### A.2 The env model is portable — with one operational catch

`node_modules/astro/dist/env/runtime.js:4` — `let _getEnv = (key) => process.env[key];`

That is the shipped default; `setGetEnv` exists for adapters to override, and the Cloudflare adapter does
(`dist/server/chunks/worker-entry_DS4ga2S7.mjs:25236`). Under `@astrojs/node`, nothing overrides it.

**Catch:** per current Astro docs, _"Astro and the Node adapter do not automatically load environment
variables at runtime."_ There is no `.env` loading in production. The systemd unit must supply them via
`EnvironmentFile=/etc/urlopy/env` (mode 0600), or the entry must be launched under `dotenvx`.

#### A.3 Sentry — 15 import lines plus one full rewrite

`@sentry/cloudflare` is imported at 15 sites; 14 of them use only `captureException` / `setUser` / `setTag`.
`node_modules/@sentry/astro/build/esm/index.server.js:3` re-exports the whole `@sentry/node` surface, so
swapping `@sentry/cloudflare` → `@sentry/astro` is a one-token find-and-replace and `@sentry/node` need
not become a direct dependency.

`sentry.server.config.ts` (15 lines) is Cloudflare-shaped in every line — `Sentry.withSentry<Env>(envFactory, handler)`
wrapping `@astrojs/cloudflare/entrypoints/server`, reading `env.SENTRY_DSN` from a Worker binding. It becomes
a plain `Sentry.init({ dsn: process.env.SENTRY_DSN, ... })`. Note `SENTRY_DSN` is **not** in the
`astro.config.mjs` env schema, so `process.env` is the correct read, not `astro:env/server`.

A subtlety worth knowing during the swap: `@sentry/astro` auto-discovers `sentry.server.config.ts` by
filename and injects it as a `page-ssr` script, so today's file is already being import-injected — it just
happens to export a handler instead of calling `init()`. Rewriting it makes that injection do the right thing
with no extra wiring. Two vite plugins (`sentryCloudflareNodeWarningPlugin`, `sentryCloudflareVitePlugin`)
are gated on the adapter name and drop off automatically.

#### A.4 nginx and systemd — all new

Nothing exists to port: **`_headers` and `_redirects` do not exist** (grep: 0 results), and neither does
`robots.txt`. Cloudflare supplied edge security headers for free; the VPS supplies none by default. nginx
must author `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`,
`Referrer-Policy`, plus cache headers.

- **Proxy to Node** (`127.0.0.1:4321`): `/`, `/dashboard`, `/auth/*`, all of `/api/*` (13 route files, every one
  `prerender = false`). Standalone mode can serve statics itself, so the nginx static split is a performance
  choice rather than a requirement.
- **Serve from disk**: `/_astro/` with `expires 1y; Cache-Control: public, immutable` (content-hashed),
  `favicon.png`, `sitemap-*.xml`.
- **TLS is new** — Cloudflare terminated it. Internal CA or Let's Encrypt depending on whether the VPS is
  internet-reachable (see Open Questions).
- `public/.assetsignore` is a Cloudflare-assets directive — delete.
- Housekeeping while touching the build: `public/template.png` (1.27 MB) is unreferenced starter cruft, and
  `*.scaffold` duplicates in `public/` ship into `dist/client/` as real, publicly fetchable assets.

#### A.5 CI: one job dies, one job is gold

`.github/workflows/ci.yml`:

- **Bundle-size gate (`:45-50`)** — `wrangler deploy --dry-run` enforcing Cloudflare's 3 MB gzip Free limit.
  **A VPS has no bundle limit. Delete it**; it protects nothing real.
- **Deploy job (`:84-88`)** — `wrangler deploy` becomes rsync/SSH + `systemctl restart urlopy`.
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` become dead; SSH host/user/key become new secrets.
- **Post-deploy health check (`:90-139`)** — **keep verbatim, retarget only `DEPLOY_URL` at `:92`.** It curls
  `/auth/signin` and asserts four literal strings plus a `>= 2` count of `Zaloguj się`. Its comments record
  why: a weaker check once stayed green through a Polonization commit and left E2E broken for a day. This is
  the highest-value artifact in the workflow.
- `ai-review.yml` and its composite action are untouched by the migration.

**Security bonus:** `dist/server/.dev.vars` is generated by the Cloudflare adapter from `.env` and contains all
12 secrets in plaintext — including `SUPABASE_SERVICE_KEY`, `DATABASE_URL` and `ADMIN_PASSWORD`. It is
excluded from asset upload but **is inside the `dist-${sha}` CI artifact**. Leaving the Cloudflare adapter
removes `.dev.vars` generation entirely.

### B. Data layer: Postgres → SQLite

`src/db/schema.ts` is entirely `drizzle-orm/pg-core`. Column-by-column:

| Today                                            | Sites                                                   | SQLite                                          | Verdict                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid().defaultRandom()`                         | 4 PKs + 3 FK columns (`schema.ts:18,19,47,48,60,71,72`) | `text().$defaultFn(() => crypto.randomUUID())`  | Mechanical. Values stay canonical UUID strings, so `z.uuid()` and the hand-rolled regexes at `absences/[id].ts:55,245` keep working. Generation moves to JS; `.returning()` still yields the id. **Store as TEXT, never BLOB.**                                                                          |
| `pgEnum("user_role", …)` (`schema.ts:15,20`)     | role gate on ~9 routes                                  | `text({ enum: [...] })` + `CHECK (role IN (…))` | Identical TS union → zero call-site changes. DB-level guarantee needs the explicit CHECK.                                                                                                                                                                                                                |
| `timestamp({withTimezone:true})` × 6             | `schema.ts:23,24,61,63,82,83`                           | `integer({ mode: "timestamp" })`                | Keeps `Date` in and out. **Choosing `text` mode silently breaks** `dashboard.astro:180-181`, where `e.created_at <= new Date(...)` becomes a codepoint compare.                                                                                                                                          |
| `date()` (mode `string`)                         | `schema.ts:54`, ~20 consumers                           | `text()`                                        | **No-op.** `'YYYY-MM-DD'` in, `'YYYY-MM-DD'` out; ISO dates sort correctly under BINARY collation, so `gte`/`lt`/`inArray`/`asc` keep their semantics. Lost: Postgres rejecting `2026-02-31`. `bulk.ts` validates in zod already; `absences/index.ts:112` uses a weaker regex and does lean on Postgres. |
| `time()` × 2                                     | `schema.ts:57,58`                                       | `text()`                                        | Reads fine — every consumer already `.slice(0,5)`s and both parse regexes make seconds optional. **But see the CAS hazard in C.2.**                                                                                                                                                                      |
| `serial()`                                       | `schema.ts:32`                                          | `integer().primaryKey({ autoIncrement: true })` | Direct. Preserve ids 1–7; `absences.absence_type_id` points at them.                                                                                                                                                                                                                                     |
| `unique().on(...)` × 2                           | `schema.ts:65,87`                                       | Same API                                        | Direct; `ON CONFLICT (cols) DO UPDATE` maps 1:1.                                                                                                                                                                                                                                                         |
| `auth.users` FK (`20260526000001_schema.sql:18`) | —                                                       | FK into the new local `users` table             | Becomes a normal same-database FK once auth moves in-house (D).                                                                                                                                                                                                                                          |

**Four CHECK constraints live only in migrations, not in the Drizzle schema** (documented inline at
`schema.ts:34,56,85-86`). Three port directly. `absence_types.color ~ '^#[0-9a-fA-F]{6}$'` does not —
SQLite has no `~` and no built-in `REGEXP`; use `GLOB` or register a UDF.

#### B.1 The five real rewrites

1. **`src/db/index.ts:12`** — `drizzle(postgres(url, { ssl: false, prepare: false }))`. Both options are
   Supabase-pooler artifacts and die with Postgres. More importantly the _shape_ inverts: `AGENTS.md:45`
   mandates **one pool per request, never closed** ("correct for the Workers isolate, which owns the
   lifetime"), and `createDb` is invoked at **19 sites across 16 files**. On a long-lived Node process
   that pattern is a file-handle leak; the correct shape is a module-level singleton — which also relaxes
   `AGENTS.md:44` ("do not call `createDb` at module top level"), a rule that existed only because
   `astro:env/server` was request-scoped under Workers.
2. **`src/lib/services/holiday-balance.ts:42`** — `extract(epoch from (end_time - start_time))`. SQLite has
   neither `EXTRACT` nor interval arithmetic on times. Either `strftime('%s', …)` differences, or — cleaner,
   given `getAbsenceHours()` already exists at `absence-stats.ts:13-18` — select the rows and aggregate in JS.
   (`count(*) FILTER (WHERE …)`, `coalesce`, `sum` all port directly.)
3. **`src/pages/api/employees/order.ts:79`** — `UPDATE … FROM (SELECT UNNEST(ARRAY[…]))` with `::uuid` / `::int`
   casts. No arrays, no `unnest`, no cast operator. Rewrite as a `VALUES` CTE or `json_each(?)`.
   `UPDATE … FROM` itself is fine (SQLite 3.33+). Note the `AND employees.is_system = false` guard is
   load-bearing and must survive the rewrite.
4. **`src/pages/api/employees/[id]/email.ts:108`** — `select 1 from auth.users where lower(email) = lower(…)`.
   The table ceases to exist; becomes an ordinary query against the local `users` table. This is currently
   the only place Drizzle touches the `auth` schema (`AGENTS.md:46`) and therefore invisible to migration discipline.
5. **`scripts/seed-admin.ts:63-64`** — builds its own postgres-js driver rather than using `createDb`
   (deliberately: `astro:env/server` only resolves inside the Worker). It needs its own rewrite — and it is
   the natural entry point for the installer (D.3).

#### B.2 What is a genuine no-op

`date` → `text` (~20 consumers unaffected); `unique().on()`; `onConflictDoUpdate` (2 production sites:
`bulk.ts:211`, `holiday-balances/index.ts:216`); `.returning()` (12 production + 15 test sites — SQLite has
supported `RETURNING` since 3.35, and the zero-rows-returned CAS detection at `absences/[id].ts:212-221`
is preserved); `CASE WHEN` at `dashboard.astro:129`; and **transactions — because there are none**. A
repo-wide grep for `transaction` returns four hits, all comments, zero `db.transaction(` invocations. That
makes better-sqlite3's synchronous-transaction footgun moot. Atomicity today comes from single statements.

`EXTRACT` outside `holiday-balance.ts:42`, plus `to_char`, `date_trunc`, `ILIKE`, `generate_series`, `ANY(`,
`interval` and `now()` in application code: **zero occurrences**.

#### B.3 Correction to the project's own docs

`AGENTS.md:77-83` documents a `NUMERIC absences.hours` → string coercion gotcha and a
``sql`${absences.hours}::float` `` workaround. **The `hours` column was dropped** in
`20260605000001_absence_start_end_time.sql:23` and replaced by `start_time`/`end_time`. Verified directly:
`src/db/schema.ts` contains no `hours` column and `src/` contains no `::float` cast. `AGENTS.md:62` repeats
the stale reference. The _live_ driver-coercion dependency is `src/lib/services/holiday-balance.ts:38-43`,
where `count()`/`sum()` come back as strings from postgres-js and are `Number()`-cast — under
better-sqlite3 they arrive as numbers, `Number()` absorbs both, and only the comment becomes wrong.

### C. Error mapping — the silent-failure class

This is the part most likely to ship broken, because nothing fails loudly.

#### C.1 `src/lib/db-errors.ts` stops matching

`extractPgErrorCode` reads `err.code ?? err.cause?.code` (the `cause` indirection exists because Drizzle
wraps driver errors in `DrizzleQueryError`). Codes consumed today:

| Code    | Meaning                | Maps to   | Consumers                                                                                          |
| ------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `23505` | unique violation       | 409       | `absences/index.ts:236`, `absences/[id].ts:233`, `employees/index.ts:166`                          |
| `23503` | FK violation           | 422 / 404 | `absences/index.ts:230-235`, `[id].ts:227-232`, `bulk.ts:237-242`, `holiday-balances/index.ts:231` |
| `23514` | CHECK violation        | 400       | `absences/index.ts:237`, `[id].ts:234`, `bulk.ts:245`, `holiday-balances/index.ts:232`             |
| `42501` | insufficient privilege | 403       | 6 sites                                                                                            |

better-sqlite3 throws `SqliteError` with `.code` = `"SQLITE_CONSTRAINT_UNIQUE"` etc. (confirmed against
better-sqlite3 docs). **Every comparison becomes dead code and the routes degrade to 500** with no signal.
`42501` has no analogue at all — it came from RLS/GRANT, which is gone.

**`extractPgErrorConstraint` has no SQLite analogue whatsoever.** Three sites discriminate on the constraint
_name_ — `extractPgErrorConstraint(err) === "absences_absence_type_id_fkey"` (`bulk.ts:239`,
`absences/index.ts:232`, `absences/[id].ts:229`) — to tell "unknown absence type" from "unknown substitute
employee". SQLite reports `FOREIGN KEY constraint failed`, naming neither constraint nor column. Those two
distinct 422 messages must move to **pre-flight existence checks** — reversing an explicit prior decision at
`absence-write-target.ts:62-65`: _"A nonexistent substitute is deliberately not checked — the FK maps it to
422 via `extractPgErrorConstraint`, which is the existing contract."_ Only `23514` is recoverable by message
parsing, since SQLite names the check (`CHECK constraint failed: absences_time_check`).

Unit tests at `src/tests/lib/db-errors.test.ts:6-20` and assertions at `crud.test.ts:162,178,199` encode the
Postgres codes and must be rewritten alongside.

#### C.2 Three more silent failures

- **`updated_at` freezes.** `supabase/migrations/20260526000001_schema.sql:58-70` defines the repo's _only_
  trigger. `PATCH /api/absences/:id` is the only path depending on it: `absences/[id].ts:199` sets the
  zod-parsed body (which has no `updated_at`) and reads the column back at `:210`, returning it at `:222`.
  `bulk.ts:220` and `holiday-balances/index.ts:221` already set `updated_at: new Date()` explicitly. The
  clean fix is to make `[id].ts:199` do the same and drop the trigger. Without either, the column silently
  freezes at insert time.
- **Time-string width in the CAS pin.** `absences/[id].ts:188-189` pins optimistic concurrency with
  `value === null ? isNull(col) : eq(col, value)`. Postgres compares as `time`, so `'09:00'` matches a stored
  `09:00:00`. SQLite compares TEXT literally. **Any data migration must normalise time strings to one width**,
  or migrated rows produce spurious 409 "Wpis został w międzyczasie zmieniony".
- **Foreign-key enforcement is driver-dependent.** Stock SQLite defaults `PRAGMA foreign_keys` **off**;
  better-sqlite3 ships compiled with `SQLITE_DEFAULT_FOREIGN_KEYS=1`, so it is **on** there. Do not rely on
  the default implicitly — set it explicitly, because four route behaviours derive from FK violations.

### D. Auth replacement

Supabase Auth is reached through exactly two factories — `createClient` (`src/lib/supabase.ts:5`) and
`createAdminClient` (`src/lib/supabase-admin.ts:6`) — called from **8 live files**. Everything else consumes
`context.locals.user` indirectly. The blast radius is small; the semantics are not.

#### D.1 The cleanest seam

`src/env.d.ts:3` types `locals.user` as `@supabase/supabase-js`'s `User`. **Only two fields are ever read
anywhere**: `user.id` (15 sites) and `user.email` (`src/components/Topbar.astro:17`, the sole consumer).
Changing that declaration to a local `{ id: string; email: string }` is a one-line swap the whole codebase
follows. `locals.userRole` is already computed by this app's own Drizzle query (`middleware.ts:21-27`) and
is Supabase-independent.

#### D.2 The 27-item replacement scope, condensed

**Credentials** — a `users` table holding id/email/password hash (today `employees` has **no email column**;
the address lives only in `auth.users`); hashing on write; verification on sign-in and on password change;
case-insensitive email uniqueness surfaced as 409.

**Sessions** — creation on sign-in; validation on _every_ request (`middleware.ts:16`); revocation on
sign-out; and **selective revocation** — `signOut({ scope: "others" })` at `password.ts:112`, which
`ChangePasswordDialog.tsx:51` explicitly promises the user in a toast. An opaque session-id design removes
the JWT-refresh machinery entirely.

**Admin operations** — create-with-chosen-password-pre-confirmed, delete, read email by id, change email
immediately, set password without the old one, enumerate users. All six already exist as routes; only their
implementation changes.

**Error semantics the routes branch on** — `status === 422` → duplicate email (3 sites);
`code ∈ {reauthentication_needed, weak_password, same_password}` (`password.ts:81,89,94`);
`status ∈ {400,401,422}` → wrong current password (`password.ts:97`). A replacement must emit equivalent
discriminated errors or five response branches collapse into one.

**The one thing with no substitute: sign-in rate limiting.** `supabase/config.toml:189-193` configures it
today; there is **no application-level rate limiting anywhere**. `signin.ts` has no lockout, no
generic-error normalisation, and reflects the raw provider message into `/?error=`. Removing Supabase
removes the only brute-force defence on `/api/auth/signin`.

#### D.3 What gets _easier_

- **Self-registration does not exist and must not be built.** `signup.ts` is `.scaffold` only. It was deleted
  deliberately — `context/archive/2026-06-22-admin-bootstrap/plan-brief.md:26`: _"Fully portable — survives a
  planned future migration off Supabase."_ A decision made in anticipation of exactly this change.
- **No SMTP is needed.** Every `createUser` passes `email_confirm: true`; password-reset-by-link does not
  exist (the flow is a moderator setting a password by hand, and the UI copy at
  `ResetPasswordDialog.tsx:94-97` already says so). `src/pages/auth/confirm-email.astro` is **orphaned** —
  zero references outside itself — and can be deleted.
- **The bootstrap-admin-from-env contract already exists.** `scripts/seed-admin.ts` reads
  `ADMIN_LOGIN`/`ADMIN_PASSWORD`, is idempotent via the `is_system` gate (`:68-77`), and already runs in Node
  against a direct connection. Its Supabase half becomes a local password hash; the rest is the installer.
- **The compensating-delete dance disappears.** `employees/index.ts:156-164` and `seed-admin.ts:120-129`
  exist because the auth user and the employee row live in different systems. With `users` in the same SQLite
  file, both become one transaction.
- **The session cookie gets safer.** Observed in `tests/e2e/.auth/user.json`: a single ~3 KB
  `sb-<ref>-auth-token`, `SameSite=Lax`, 1-year expiry, **`httpOnly: false` and `secure: false`**. A
  hand-rolled cookie with `HttpOnly; Secure; SameSite=Lax; Path=/` is a strict improvement.

#### D.4 CSRF — know what you're relying on

There is no CSRF token anywhere (grep: 0 hits for `csrf`). Protection comes entirely from Astro's default
`security.checkOrigin: true`, which 403s non-safe methods when `origin !== url.origin` — **but only for
form-like content types**. So the two `FormData` routes (`signin`, `signout`) are covered; the JSON routes
(`/api/auth/password`, `/api/employees/*`) are not, and rely on CORS preflight plus `SameSite=Lax`. Keep
`checkOrigin` on, and note Astro's `security.allowedDomains` governs `X-Forwarded-Host` handling behind a
reverse proxy.

#### D.5 The invariant that must survive

`employees.is_system` — the technical admin — is **entirely app-enforced across ~9 read and ~7 write
points**, with no database backstop (`src/lib/employees.ts:4-12`). It has already failed twice this way:
`POST /api/absences` shipped without the guard and `bulk.ts` inherited the gap by copying that route
verbatim (`context/archive/2026-08-18-absence-write-hardening/`). SQLite adds no new backstop. Every
handler touched during the port must be re-checked against `visibleEmployeesFilter` / `isProtectedAdmin`.

### E. Migrations, seed, and data movement

**14 migration files**, of which **only 5 are in `supabase/migrations/meta/_journal.json`** — the other 9 are
hand-written and invisible to `drizzle-kit migrate` (`AGENTS.md:64`). The documented provisioning order is
three-legged: Supabase CLI applies the baseline → `db:migrate` applies the journaled DDL → manual `psql`
applies the data migrations. **There is no `supabase/seed.sql`** despite `config.toml:60-65` pointing at one.

For a fresh SQLite install this whole apparatus should collapse into **one baseline schema + one seed file**,
run programmatically at startup via `drizzle-orm/better-sqlite3/migrator`. That is exactly what a
self-contained installer wants.

**What a fresh install actually needs to be usable:**

1. The **7-row `absence_types` catalogue** with final colours, foregrounds, icons and display order —
   currently spread across four migrations (`20260526000002`, `20260722120000`, `20260807122840`, and the
   required icon fix `20260812153000`, whose omission renders three or four glyphs per offsite cell).
   Note `absence_types` has **no unique constraint on `name`**, yet `src/lib/absence-types.ts:7-11` gates the
   partial-day feature on exact name strings — adding `UNIQUE(name)` is a free win.
2. The **single `is_system` admin employee row** (`role='moderator'`).
3. Nothing else — `holiday_balances` rows are created on demand; employees and absences come from the UI.

**Data movement** is small: ~11 employees, 7 types, low-thousands absences (bounded by
`UNIQUE(employee_id, date)`), and a handful of balances. Id formats: keep UUIDs as **TEXT** (a BLOB port
breaks every equality comparison and island prop); preserve the integer 1–7 type ids; normalise time-string
widths (C.2); and pick one timestamp representation consistently.

Watch for a **second, drifting copy of the seed data**: `scripts/export-sample.ts:32-47` hardcodes the whole
catalogue and still carries the pre-`20260812153000` 8-codepoint icon.

### F. Testing — the biggest quality-of-life win

Everything about the current test setup is shaped by talking to a remote Postgres pooler:

- `vitest.config.ts` — `testTimeout: 60_000` because _"a single round trip measures 3-5s"_, and
  `fileParallelism: false` because _"Supabase's session pooler allows 15 clients"_.
- `src/tests/helpers/db.ts:13` appends `?max=1&idle_timeout=1` for the same reason.
- 13 suites self-skip via `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`.
- Tests share a database with production, so every delete is defensively double-scoped by fixture UUID _and_
  a suite-specific date window (`context/archive/2026-08-18-absence-write-hardening/reviews/impl-review.md:184-187`).

**All of it becomes obsolete rather than portable.** A per-run SQLite file makes tests millisecond-fast,
parallelisable, and removes the production-data hazard entirely. Do not mechanically port the scaffolding.

Route tests are already auth-agnostic — they hand-build an `APIContext` with `locals: { user: { id } }` and
never exercise middleware or cookies, so they survive the auth swap unchanged. The exceptions:
`src/tests/helpers/fixtures.ts:13-37` creates a **real Supabase auth user** per fixture (the last tie keeping
`SUPABASE_SERVICE_KEY` in CI secrets), and `src/tests/api/employees/password.test.ts:56-60` is the only test
that touches auth as auth.

**Playwright** currently points `BASE_URL` at production by necessity. Once the app runs locally, this
unlocks three things previously rejected on cost grounds: E2E in CI, a moderator/employee-role fixture
(_"not currently seedable"_ — `workers-data-edit/plan.md:431`), and dropping the "don't point BASE_URL at
`wrangler dev`" warning. Three constraints carry over unchanged: accessible-name locators (no testids), the
Polish signin literals, and the hydration wait in `auth.setup.ts`.

## Code References

Highest-value anchors for planning:

- `src/db/index.ts:9-13` — the driver factory; per-request pool contract inverts on Node
- `src/db/schema.ts:15-88` — every pg-core type needing a sqlite-core counterpart
- `src/lib/db-errors.ts:1-18` — the silent-failure epicentre
- `src/lib/services/holiday-balance.ts:41-42` — `extract(epoch …)`, the one aggregate needing a rewrite
- `src/pages/api/employees/order.ts:67-80` — `UNNEST(ARRAY[…])` + casts
- `src/pages/api/employees/[id]/email.ts:107-108` — the only cross-schema `auth.users` read
- `src/pages/api/absences/[id].ts:188-189` — the CAS pin sensitive to time-string width
- `src/pages/api/absences/[id].ts:199,210` — the only consumer of the `updated_at` trigger
- `src/middleware.ts:11-45` — session resolution, role lookup, the silent `catch {}` that exists only for `wrangler dev`
- `src/env.d.ts:1-6` — the one-line seam for the auth type swap
- `src/lib/supabase.ts:5` / `src/lib/supabase-admin.ts:6` — the two factories to replace
- `src/lib/employees.ts:4-25` — the `is_system` invariant and why it is app-enforced
- `scripts/seed-admin.ts:50-130` — the existing env-bootstrap-admin contract; the installer's seed
- `astro.config.mjs:9,19,33-41` — adapter, site, env schema
- `sentry.server.config.ts:1-15` — full rewrite
- `wrangler.jsonc:1-15` — everything to delete
- `.github/workflows/ci.yml:45-50` (delete), `:84-88` (replace), `:90-139` (keep, retarget)
- `supabase/migrations/20260526000001_schema.sql:58-70` — the repo's only trigger
- `node_modules/astro/dist/env/runtime.js:4` — the `process.env` fallback that makes `astro:env` portable

## Architecture Insights

- **The app was accidentally well-prepared for this.** Zero Cloudflare APIs, zero `supabase.from()` calls,
  zero transactions, no self-signup surface, authorization already app-level. Several of these were
  deliberate — the signup deletion cites a _"planned future migration off Supabase"_ by name.
- **Every hard edge is a _silent_ one.** Nothing in this migration fails loudly: error codes stop matching,
  a timestamp freezes, a CAS pin mismatches, a `text`-mode timestamp becomes a string compare. The plan needs
  explicit verification steps for each, not just "it builds".
- **Two Postgres behaviours were being used as free validation** and must move into app code: calendar-date
  rejection (`absences/index.ts:112` leans on it) and FK-name discrimination for the two 422 messages.
- **The removal of `wrangler dev`'s TLS limitation is the largest second-order effect.** It is cited 18+ times
  across 12 archived changes and shaped test strategy, verification ritual ("verify against production"), and
  at least one product decision (client-side XLSX generation, chosen partly because a server route _"could
  only ever be verified against production"_). Those carve-outs become re-openable — and the "verify against
  prod on push to main" workflow should be retired rather than carried over.
- **The Workers CPU cap and bundle limit disappear**, reopening the server-side XLSX question. Not in scope,
  but worth recording so the constraint isn't inherited unexamined.

## Historical Context (from prior changes)

- `context/foundation/tech-stack.md:24` — the **only** record of the requirement: _"The later Red Hat server +
  SQLite requirement is a known manual adaptation after scaffolding."_ Duplicated at
  `context/changes/bootstrap-verification/verification.md:39`.
- `context/archive/2026-06-01-drizzle-migration/` — chose service-role-only ("Option A") over JWT forwarding,
  which is what made RLS inert. Also records that `postgres-js` was _rejected_ in research
  (`research.md:190`) then adopted anyway during implementation because the pooler is incompatible with
  `neon-http` — the origin of the `wrangler dev` TLS problem.
- `context/archive/2026-06-01-drizzle-migration/reviews/impl-review-phase-2.md:29` — **the canonical warning
  for this change**: last time the DB safety net was removed, three authorization holes shipped, because the
  plan asserted "existing handler checks enforce ownership" and that claim was false.
- `context/archive/2026-06-22-admin-bootstrap/` — the `is_system` design and the ~9 enforcement points;
  signup deleted explicitly for portability.
- `context/archive/2026-08-18-absence-write-hardening/` — proof the app-level guard model is fragile without
  tests; guards propagate by copy-paste and gaps persist for months.
- `context/foundation/lessons.md` — _"Repo-wide claims are load-bearing — verify before writing one down."_
  Directly applicable: this document's universally-quantified claims (zero Cloudflare APIs, zero
  `supabase.from()`, zero transactions, no `_headers`) were each produced by running the falsifying grep.
- `context/changes/development.md` is a stale Cloudflare-Pages-era deployment plan describing a model the
  project has already left; it needs rewriting or deleting.

### Documentation corrections this change should make

| Location                                  | Claim                                                      | Reality                                                                |
| ----------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `AGENTS.md:32`                            | `@neondatabase/serverless` "is still installed"            | **Not in `package.json`, not in `node_modules`** (verified)            |
| `AGENTS.md:62,77-83`                      | `NUMERIC absences.hours` needs `::float` casts             | Column dropped in `20260605000001`; no `::float` anywhere in `src/`    |
| `AGENTS.md:113`                           | CI targets `master`                                        | `ci.yml:5,7` say `main`                                                |
| `AGENTS.md:17`                            | `npm run dev` starts "the Astro dev server"                | It runs `wrangler dev`                                                 |
| `README.md:18`                            | Node v22.14.0                                              | `.nvmrc` is 24.15.0                                                    |
| `context/foundation/infrastructure.md:75` | `astro:env` is non-portable, must be rewritten on any move | Portable to Node specifically — `process.env` is the built-in fallback |
| `context/foundation/roadmap.md`           | —                                                          | No slice covers this work; needs a new entry                           |

## Related Research

- `context/archive/2026-06-01-drizzle-migration/research.md` — driver selection and the RLS Option A/B analysis
- `context/archive/2026-08-12-workers-data-edit/research.md` — the Supabase Auth admin-API surface, enumerated
- `context/archive/2026-08-24-export-grid-to-xlsx/research.md` — Workers CPU/bundle limits; the constraints that lapse
- `context/foundation/infrastructure.md` — the 2026-05-24 platform decision; never evaluated self-hosting
- `context/foundation/test-plan.md` — current test fixtures and their Supabase coupling

## Open Questions

Things planning needs an answer to, roughly in the order they bite:

1. **Is the VPS internet-reachable?** Decides Let's Encrypt vs an internal CA vs a self-signed cert, and
   whether Sentry can reach `ingest.de.sentry.io` at all. If it can't, `@sentry/astro` needs a no-DSN path
   and the 15 `captureException` sites need to degrade quietly.
2. **SQLite driver: `better-sqlite3` or `libsql`?** better-sqlite3 is synchronous (fine — the repo has no
   transactions) and needs a native build on the target OS, which matters on Red Hat with Node 24. libsql is
   async and friendlier if transactions ever appear. This is a plan-level decision, not a research one.
3. **Password hashing choice** — argon2id or bcrypt. Both need native modules or a WASM build; same Red Hat
   build-toolchain question as (2).
4. **Session storage** — a `sessions` table in the same SQLite file is the obvious answer given
   `signOut({scope:"others"})` must work, but it puts a write on every sign-in.
5. **Is existing production data being migrated, or is this a fresh install?** The answer decides whether the
   time-string normalisation and timestamp-representation work (C.2, E) is needed at all.
6. **How long must the Cloudflare deployment keep working?** It constrains whether `main` can carry
   breaking changes or whether the port lands on a branch until the demo is done.
7. **Backup story for the SQLite file** — `sqlite3 .backup` on a timer, or filesystem snapshots. Cloudflare
   and Supabase were handling durability implicitly; on a VPS nobody is.
8. **Does sign-in rate limiting land in this change or a follow-up?** It is a genuine security regression the
   moment Supabase Auth is removed (D.2).
