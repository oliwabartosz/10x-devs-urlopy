# Repository Guidelines

Urlopy is an Astro 6 SSR app with React 19 islands, TypeScript, Tailwind CSS 4, its own
credential auth, and a SQLite database, served by a Node process behind nginx on a self-hosted
Linux VPS. Product requirements live in `@context/foundation/prd.md`; stack decisions live in
`@context/foundation/tech-stack.md`; the install and operations story lives in `@INSTALL.md`.

> **Branch note.** `main` still targets Cloudflare Workers + Supabase; the `sqlite-install` branch
> is what this file describes. The `@supabase/*`, `@astrojs/cloudflare`, `wrangler` and
> `@sentry/cloudflare` packages are still in `package.json` and `supabase/` is still on disk —
> unused on this branch, removed in a follow-up change after the demo.

## Hard Rules

- Do not write to `context/archive/`; archived changes are immutable.
- Do not edit generated or ignored output: `.astro/`, `dist/`, `.wrangler/`, or `node_modules/`.
- Tests run on Vitest (`vitest.config.ts`): `npm test` (watch), `npm run test:run` (once), `npm run test:coverage`. Browser-level tests run on Playwright: `npm run e2e` (`playwright.config.ts`). Do not invent commands beyond these.
- **`npm run e2e` still targets the deployed Workers app**, not a local server — `playwright.config.ts` defaults `baseURL` to the production Worker. Retargeting it at a local Node server is possible now and deliberately deferred; until then an E2E run writes to the **production** database and must clean up after itself. Read `tests/e2e/e2e-rules.md` before writing one. Override the target with `BASE_URL`.
- The suites under `src/tests/` no longer self-skip. Each test file creates and disposes of its own temp SQLite database (`src/tests/helpers/setup.ts`), so there is nothing to configure — a green run means passed, not skipped.

## Commands

- `npm ci` - install from `package-lock.json`; use after dependency or lockfile changes.
- `npx astro sync` - regenerate Astro types before lint/build when env or route types changed.
- `npm run dev` - Astro dev server. (It was `wrangler dev` until the Node adapter landed; the Workers runtime is no longer what production runs.)
- `npm run lint` - run type-checked ESLint, React Compiler, Astro JSX a11y, and Prettier rules.
- `npm run lint:sh` - shellcheck `install.sh` and `install-user.sh`.
- `npm run build` - build the Node SSR output, then `postbuild` completes the deployable artifact.
- `npm run pack` - archive the artifact for the offline VPS. Run after `npm prune --omit=dev`.
- `npm run format` - run Prettier with Astro and Tailwind class sorting plugins.

## Architecture Notes

- `src/pages/` owns Astro pages; `src/pages/api/auth/` owns the sign-in/sign-out/password endpoints; protected pages are listed in `PROTECTED_ROUTES` inside `@src/middleware.ts`.
- Authentication is local and lives in `src/lib/auth/`: `password.ts` (scrypt over `node:crypto`), `session.ts` (opaque server-side sessions in the `sessions` table), `rate-limit.ts`, `users.ts`. There is no auth provider and no `auth.users` schema any more — `users` is an ordinary application table.
- Use `@/*` imports for `src/*`. Shared helpers belong in `src/lib/`; UI primitives live in `src/components/ui/` per `@components.json`.
- `src/lib/services/` is only for modules that take a `Db` and execute queries. Query-free logic — Drizzle fragments, zod schemas, `Response` builders — stays in `src/lib/` so it is unit-testable without a database. See the header comment in `@src/lib/absence-list.ts`.
- Keep static/layout markup in `.astro` files and use React components for hydrated interactivity, as the current auth forms do with `client:load`.

## Database (Drizzle ORM + SQLite)

All queries use Drizzle over `drizzle-orm/sqlite-proxy`, with the proxy callback driving Node's
built-in `node:sqlite` (`DatabaseSync`). That pairing is deliberate: Drizzle 0.45.2 ships no
`node-sqlite` entrypoint, and `sqlite-proxy` is the only route that needs no compiled dependency —
which is what makes the offline install and the backup timer both possible. `postgres` and
`@neondatabase/serverless` are not used; the latter is not installed at all.

### Schema and client

- `src/db/schema.ts` — Drizzle schema; the single source of truth for TypeScript table types.
- `src/db/index.ts` — `createDb(databasePath: string)`. Memoised per path:

  ```ts
  import { createDb } from "@/db/index";
  import { DATABASE_PATH } from "astro:env/server";
  const db = createDb(DATABASE_PATH);
  ```

  **This inverts two rules that used to live here.** "Do not call `createDb` at module top level"
  and "one pool per request" both existed because `astro:env/server` was request-scoped under the
  Workers adapter and because a Supabase session pooler capped concurrent clients. Neither applies
  to a local file opened by one long-lived Node process, and `createDb` now returns the same handle
  for the same path. Calling it twice in a request is free.

- `src/db/migrate.ts` — `migrateAndSeed(databasePath)`: applies pending migrations and upserts the
  seven-row absence-type catalogue. Idempotent, safe on every boot.
- The **row-shape contract** in `src/db/index.ts` is the one place a mistake is silent. The proxy
  wants positional rows and gets them from `setReturnArrays(true)`; flattening object rows with
  `Object.values()` looks equivalent but shifts columns on a join that selects two same-named
  fields, with nothing thrown. `src/tests/db/proxy-rows.test.ts` pins it — do not "simplify" it.

### npm scripts

- `npm run db:generate` — generate a migration diff from schema changes (outputs to `drizzle/`).
- `npm run db:migrate` — apply pending migrations via drizzle-kit.
- `npm run db:bootstrap` — migrate, seed the catalogue, and seed the admin, all against `DATABASE_PATH`. The same entry `install.sh` runs on the VPS, where it is the bundled `dist/bootstrap.mjs`.
- `npm run db:studio` — open Drizzle Studio against the local file.
- `npm run seed:admin` — just the admin seed, from `ADMIN_LOGIN`/`ADMIN_PASSWORD`. Idempotent: a no-op once the `is_system` row exists.

### Migration discipline

`drizzle-kit` outputs to `drizzle/`. Nothing else writes there — the Supabase CLI's three-legged
provisioning ritual (CLI baseline → `db:migrate` → manual `psql` for hand-authored data
migrations) is gone, replaced by the single idempotent runner above.

**Always review a generated diff before applying it.** SQLite has no `ALTER TABLE ADD CONSTRAINT`,
so the DB-level CHECK constraints and the `COLLATE NOCASE` on `users.email` must sit inside
`CREATE TABLE` and are hand-added. A regenerated table definition drops them silently.

### Authorization

There is no RLS and there never effectively was — every query ran through a service-role
connection, so all 18 policies were inert. Row-level authorization is enforced explicitly in
handler code (ownership checks, role checks against `context.locals.user`), by design.

The `is_system` invariant (the hidden technical admin) is app-enforced across roughly nine read
and seven write points with no database backstop, and has leaked twice by copy-paste. Assert it in
tests when you touch a read or write path; do not assume it.

### Error handling

Driver errors are normalised in the proxy callback (`SqliteDriverError` in `src/db/index.ts`)
before Drizzle wraps them, so `src/lib/db-errors.ts` stays a pure mapping. `node:sqlite` throws
`code: 'ERR_SQLITE_ERROR'` for everything and carries the discriminator on `errcode` — SQLite's
*extended* result code. The codes routes branch on:

| Constant                      | Value  | Maps to                          |
| ----------------------------- | ------ | -------------------------------- |
| `SQLITE_CONSTRAINT_UNIQUE`    | `2067` | 409 duplicate                    |
| `SQLITE_CONSTRAINT_FOREIGNKEY` | `787`  | 422 unknown reference            |
| `SQLITE_CONSTRAINT_CHECK`     | `275`  | 400 failed CHECK                 |

No five-digit Postgres SQLSTATE (`23505`, `23503`, `23514`) should appear anywhere in `src/`.
A foreign-key violation names nothing, which is why unknown references are resolved with
pre-flight lookups rather than by parsing the message.

## Style And UI Conventions

- Node is pinned to `24.15.0` in `@.nvmrc`; package manager is npm. Node 24 is a hard floor, not a preference — `node:sqlite` is the database layer.
- Prettier uses 2 spaces, semicolons, double quotes, trailing commas, and `printWidth: 120`.
- Merge conditional Tailwind classes with `cn()` from `@src/lib/utils.ts`; do not hand-concatenate long conditional class strings.
- shadcn/ui uses `new-york`, neutral base color, Lucide icons, and aliases in `@components.json`. Add primitives with `npx shadcn@latest add <name>`.

## Env, Auth, And Deployment

- `.env` covers local work. It must contain `DATABASE_PATH`; `PUBLIC_ORIGIN` matters as soon as you serve anything that is not `localhost`. See `@.env.example`.
- **`PUBLIC_ORIGIN` is half a build-time value.** `astro.config.mjs` bakes it into `site` and `security.allowedDomains`, and `src/lib/auth/session.ts` reads it at runtime for the cookie's `Secure` flag. Changing the origin needs a rebuild, not a restart. Get it wrong and sign-in/sign-out 403 while every JSON route keeps working.
- CI in `@.github/workflows/ci.yml` runs on `main` and lints, shellchecks, tests, builds, smoke-tests a locally-started server, and packs the offline artifact. There is no deploy job: the VPS is offline and no runner can reach it. Deployment is a documented manual copy — see `@INSTALL.md`.
- Deployment, upgrade, rollback, backup and restore are all in `@INSTALL.md`. `install.sh` is the entry point; `deploy/` holds the systemd units, the backup script and the nginx template.
- **`PUBLIC_BASE_PATH` mounts the app under a sub-path** (`/urlopy`) for a host it shares with other applications. Build-time and baked into every asset URL. `src/lib/base-path.ts` is the single source — `withBase()` for any app-absolute path, `BASE_PATH` for the cookie scope. A new `fetch("/api/…")`, `href="/…"` or `redirect("/…")` that skips it works at the root and breaks under a mount, which is a bug that only shows up in production. `deploy/nginx/urlopy-location.conf` is the matching proxy block.
- `install-user.sh` is the rootless sibling for a box with no `sudo`: same artifact, installed into `$HOME` with `systemctl --user` units from `deploy/user/` and no nginx. It is linted and shipped alongside `install.sh`, so a change to one usually needs the same change in the other.
- Commit messages on this branch follow Conventional Commits (`feat(change-id): title (pN)`), driven by the `/10x-implement` workflow.
