# Repository Guidelines

Urlopy is an Astro 6 SSR app with React 19 islands, TypeScript, Tailwind CSS 4, Supabase auth, and Cloudflare Workers deployment. Product requirements live in `@context/foundation/prd.md`; stack decisions live in `@context/foundation/tech-stack.md`.

## Hard Rules

- Do not write to `context/archive/`; archived changes are immutable.
- Do not edit generated or ignored output: `.astro/`, `dist/`, `.wrangler/`, or `node_modules/`.
- No test runner is configured yet: there is no `npm test`, `vitest`, `jest`, or Playwright config. Do not invent test commands in status reports.

## Commands

- `npm ci` - install from `package-lock.json`; use after dependency or lockfile changes.
- `npx astro sync` - regenerate Astro types before lint/build when env or route types changed.
- `npm run dev` - start the Astro dev server.
- `npm run lint` - run type-checked ESLint, React Compiler, Astro JSX a11y, and Prettier rules.
- `npm run build` - build the Cloudflare SSR output.
- `npm run format` - run Prettier with Astro and Tailwind class sorting plugins.

## Architecture Notes

- `src/pages/` owns Astro pages; `src/pages/api/auth/` owns email/password endpoints; protected pages are listed in `PROTECTED_ROUTES` inside `@src/middleware.ts`.
- Supabase client creation is centralized in `@src/lib/supabase.ts`. It returns `null` when `SUPABASE_URL` or `SUPABASE_KEY` is missing; API routes must handle that case.
- Use `@/*` imports for `src/*`. Shared helpers belong in `src/lib/`; UI primitives live in `src/components/ui/` per `@components.json`.
- Keep static/layout markup in `.astro` files and use React components for hydrated interactivity, as the current auth forms do with `client:load`.

## Database (Drizzle ORM)

All application table queries use Drizzle ORM with the `drizzle-orm/postgres-js` driver backed by the `postgres` npm package. The `@neondatabase/serverless` package is still installed but **must not be used for query execution** — `neon()` / `neon-http` is Neon-specific (it POSTs to `https://<host>/sql`) and does not work with Supabase's connection pooler. Supabase JS clients (`src/lib/supabase.ts`, `src/lib/supabase-admin.ts`) are kept only for auth operations and must not be removed.

### Schema and client

- `src/db/schema.ts` — Drizzle schema; the single source of truth for TypeScript table types. Do not write to this file without also reviewing the corresponding Supabase migration.
- `src/db/index.ts` — exports `createDb(databaseUrl: string)` factory. Call it once at the top of each request handler (Astro frontmatter block or exported `GET`/`POST`/etc. function):
  ```ts
  import { createDb } from "@/db/index";
  import { DATABASE_URL } from "astro:env/server";
  // inside a handler or frontmatter:
  const db = createDb(DATABASE_URL);
  ```
  Do **not** call `createDb` at module top level — `astro:env/server` values are only available inside request handler scope.

### Connection strings

- `DATABASE_URL` — Transaction Mode pooler (port 6543), service role password. Set in `.env` for `wrangler dev`; set as a Cloudflare Worker Secret for production. Used at runtime.
- `DATABASE_URL_DIRECT` — Direct connection (port 5432). Set in `.env` for `drizzle-kit` Node.js tooling only; never injected into the Worker runtime.

### npm scripts

- `npm run db:generate` — generate a migration diff from schema changes (outputs to `supabase/migrations/`).
- `npm run db:migrate` — apply pending migrations via drizzle-kit.
- `npm run db:studio` — open Drizzle Studio connected to the direct DB.
- `npm run seed:admin` — one-time-per-environment seed of the technical admin account (role `moderator`, `is_system = true`) from `ADMIN_LOGIN`/`ADMIN_PASSWORD`. Runs in Node via `tsx` (reads `.env`), not in `wrangler dev` — it connects over `DATABASE_URL_DIRECT` and uses the Supabase service-role key to create the auth user. Idempotent: re-running is a no-op once the `is_system` row exists.

### Migration discipline

`drizzle-kit` outputs to `supabase/migrations/` alongside hand-authored Supabase CLI migrations. **Always manually review the generated diff before running `db:migrate`** — the Drizzle schema intentionally omits some DB-level constraints (CHECK constraints on `absence_types.color` and `absences.hours`; the `auth.users` FK cascade) because they cannot be represented in Drizzle. A generated migration will not include them, so any future schema change must re-add them manually after inspecting the diff.

### Authorization

The `DATABASE_URL` uses the service role key, which bypasses Supabase RLS. All row-level authorization must be enforced explicitly in handler code (ownership checks, role checks against `context.locals.user`). Do not rely on RLS as a safety net for Drizzle queries.

### Runtime type gotcha

`NUMERIC` columns (e.g. `absences.hours`) return **strings** from postgres-js, not numbers. Cast in every SELECT and RETURNING clause that includes `hours`:
```ts
import { sql } from "drizzle-orm";
// inside .select({ ... }) or .returning({ ... }):
hours: sql<number | null>`${absences.hours}::float`
```

### Error handling

Drizzle wraps driver errors in `DrizzleQueryError`. The PostgreSQL error code is **not** on `err.code` — it is on `err.cause.code`. Always access it via:
```ts
} catch (err) {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  if (code === "23505") return json({ error: "Duplicate" }, 409);
  // ...
}
```

### Local dev limitation

`wrangler dev` (workerd) rejects Supabase's PostgreSQL TLS certificate at the C++ level regardless of the `ssl` option passed to postgres-js. **Drizzle queries will not work in `wrangler dev`.** Run manual verification against the production (or preview) Cloudflare Workers deployment instead. Auth flows and static pages are unaffected — those do not use Drizzle.

## Style And UI Conventions

- Node is pinned to `22.14.0` in `@.nvmrc`; package manager is npm.
- Prettier uses 2 spaces, semicolons, double quotes, trailing commas, and `printWidth: 120`.
- Merge conditional Tailwind classes with `cn()` from `@src/lib/utils.ts`; do not hand-concatenate long conditional class strings.
- shadcn/ui uses `new-york`, neutral base color, Lucide icons, and aliases in `@components.json`. Add primitives with `npx shadcn@latest add <name>`.

## Env, Auth, And Deployment

- Both local Node tooling and Cloudflare local dev use `.env`; it must contain `SUPABASE_URL` and `SUPABASE_KEY`.
- Local Supabase is optional for auth work; `npx supabase start` requires Docker.
- CI in `@.github/workflows/ci.yml` targets `master` and runs `npm ci`, `npx astro sync`, `npm run lint`, then `npm run build`. Build expects GitHub secrets for `SUPABASE_URL` and `SUPABASE_KEY`.
- There is no commit-message convention in history yet; do not infer one until commits exist.
