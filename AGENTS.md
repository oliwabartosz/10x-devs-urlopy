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

All application table queries use Drizzle ORM with the `@neondatabase/serverless` / `neon-http` driver. Supabase JS clients (`src/lib/supabase.ts`, `src/lib/supabase-admin.ts`) are kept only for auth operations and must not be removed.

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

- `DATABASE_URL` — Transaction Mode pooler (port 6543), service role password. Set in `.dev.vars` for `wrangler dev`; set as a Cloudflare Worker Secret for production. Used at runtime.
- `DATABASE_URL_DIRECT` — Direct connection (port 5432). Set in `.env` for `drizzle-kit` Node.js tooling only; never injected into the Worker runtime.

### npm scripts

- `npm run db:generate` — generate a migration diff from schema changes (outputs to `supabase/migrations/`).
- `npm run db:migrate` — apply pending migrations via drizzle-kit.
- `npm run db:studio` — open Drizzle Studio connected to the direct DB.

### Migration discipline

`drizzle-kit` outputs to `supabase/migrations/` alongside hand-authored Supabase CLI migrations. **Always manually review the generated diff before running `db:migrate`** — the Drizzle schema intentionally omits some DB-level constraints (CHECK constraints on `absence_types.color` and `absences.hours`; the `auth.users` FK cascade) because they cannot be represented in Drizzle. A generated migration will not include them, so any future schema change must re-add them manually after inspecting the diff.

### Authorization

The `DATABASE_URL` uses the service role key, which bypasses Supabase RLS. All row-level authorization must be enforced explicitly in handler code (ownership checks, role checks against `context.locals.user`). Do not rely on RLS as a safety net for Drizzle queries.

### Runtime type gotcha

`NUMERIC` columns (e.g. `absences.hours`) return **strings** from the neon-http driver, not numbers. Cast in every SELECT that includes `hours`:
```ts
import { sql } from "drizzle-orm";
// inside .select({ ... }):
hours: sql<number | null>`${absences.hours}::float`
```

## Style And UI Conventions

- Node is pinned to `22.14.0` in `@.nvmrc`; package manager is npm.
- Prettier uses 2 spaces, semicolons, double quotes, trailing commas, and `printWidth: 120`.
- Merge conditional Tailwind classes with `cn()` from `@src/lib/utils.ts`; do not hand-concatenate long conditional class strings.
- shadcn/ui uses `new-york`, neutral base color, Lucide icons, and aliases in `@components.json`. Add primitives with `npx shadcn@latest add <name>`.

## Env, Auth, And Deployment

- Local Astro/Supabase env uses `.env`; Cloudflare local dev uses `.dev.vars`; both need `SUPABASE_URL` and `SUPABASE_KEY`.
- Local Supabase is optional for auth work; `npx supabase start` requires Docker.
- CI in `@.github/workflows/ci.yml` targets `master` and runs `npm ci`, `npx astro sync`, `npm run lint`, then `npm run build`. Build expects GitHub secrets for `SUPABASE_URL` and `SUPABASE_KEY`.
- There is no commit-message convention in history yet; do not infer one until commits exist.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Internal research (lesson focus)** | |
| `/10x-research <change-id>` | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`. |
| **External research (lesson focus)** | |
| exa.ai | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer. |
| Context7 (`resolve-library-id` → `get-library-docs`) | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages. |
| **Framing spare wheel** | |
| `/10x-frame <change-id>` | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution** | |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan. |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:
1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
