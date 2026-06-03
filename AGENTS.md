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

- Local Astro/Supabase env uses `.env`; Cloudflare local dev uses `.dev.vars`; both need `SUPABASE_URL` and `SUPABASE_KEY`.
- Local Supabase is optional for auth work; `npx supabase start` requires Docker.
- CI in `@.github/workflows/ci.yml` targets `master` and runs `npm ci`, `npx astro sync`, `npm run lint`, then `npm run build`. Build expects GitHub secrets for `SUPABASE_URL` and `SUPABASE_KEY`.
- There is no commit-message convention in history yet; do not infer one until commits exist.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 1

Open Module 3 by producing a **durable, risk-first quality contract** before any test is written — then drive each rollout phase through the standard change chain.

```
PRD + roadmap + archive
        │
        ▼
   /10x-test-plan  ──►  context/foundation/test-plan.md  (strategy §1–§5 frozen + cookbook §6 grows)
        │
        ▼  (one rollout phase at a time, /clear between handoffs)
   /10x-new ──► /10x-research ──► /10x-plan ──► /10x-implement
```

`/10x-test-plan` is a **stateful orchestrator**, not a one-shot generator. On first run it writes the phased rollout to `context/foundation/test-plan.md`. On every subsequent run it re-derives state from on-disk artifacts and presents the next handoff. The lesson focus is **strategy and rollout sequencing, not configuration**. Hooks, MCP servers, and CI YAML are configured in later lessons of this module.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Quality strategy as a rules-file (lesson focus)** | |
| `/10x-test-plan` | You have a PRD (and ideally a roadmap and a few archived slices) and you are about to write the project's first tests, or you noticed that AI-generated tests are landing on helpers while critical flows go uncovered. First invocation runs discovery (PRD + roadmap + archive + hot-spot scan), a 5-question user interview, and a synthesis pass with a mandatory challenger check, then writes `test-plan.md` in `context/foundation/` with a risk map (5–7 failure scenarios), a phased rollout table, a stack table, a quality-gates table, a cookbook section (`§6`, fills in as phases ship), and a negative-space section (what we deliberately don't test). Subsequent invocations advance the rollout one handoff at a time. |
| `/10x-test-plan --status` | A `test-plan.md` already exists and you want a compact snapshot of where the rollout stands — which phases are `not started`, `change opened`, `researched`, `planned`, `implementing`, or `complete`, and what the next action is. Does no work; safe to run any time. |
| `/10x-test-plan --refresh` | A `test-plan.md` already exists and one of: a new top-3 risk surfaced from the roadmap or archive, a tool's `checked:` date is older than three months, the project's tech stack changed, or §7 negative-space no longer matches what the team believes. Opens a new `test-plan-refresh-<YYYY-MM-DD>` change folder rather than editing the guide in place. |

### Rollout chain — what happens after the guide is written

The guide's §3 *Phased Rollout* table is the orchestrator's state. For each non-`complete` row the orchestrator selects the next handoff based on which artifacts exist in `context/changes/<change-id>/`:

| State on disk | Next handoff | Status transitions to |
| --- | --- | --- |
| change folder missing | `/10x-new <change-id>` | `change opened` |
| `change.md` only | `/10x-research` (with a risks-to-verify brief) | `researched` |
| `+ research.md` | `/10x-plan` (with cost × signal + cookbook-update constraints) | `planned` |
| `+ plan.md` with pending `## Progress` items | `/10x-implement <change-id> phase <N>` | `implementing` / `complete` |
| `+ plan.md` fully `[x]` | Mark §3 row `complete`; loop to next pending row | — |

Each handoff is a **STOP point**. The orchestrator copies the next command to the clipboard, asks the user to `/clear` and run it, then exits. Re-invoke `/10x-test-plan` (no arguments) to advance.

### Risk-first prioritization rules

- Risks are **failure scenarios in user / business terms**, not test names. "Logged-out user reaches paid content via stale token" is a risk; "test the login form" is not.
- 5 to 7 risks. Fewer is too coarse; more makes prioritization useless.
- Impact and likelihood are user/business ratings, not technical complexity.
- Every risk traces to a source: PRD section, archived slice, roadmap entry, Phase 2 interview question, hot-spot **directory** with churn count, or a tech-stack constraint. No invented risks.
- **Signal, not knowledge.** §2 cites *evidence that raised the risk*, never a file as "where the failure lives." File:line anchors, function names, schema names, and module names are forbidden in §2 — they belong in `/10x-research`'s output, produced per rollout phase against current code. The plan is a QA spec; it is not a code audit.
- Coverage is not the metric. **Risk coverage** is the metric.

### Dual-layer mapping rules

- Classic layer first: the cheapest test that gives a real signal wins. Promote to e2e only when no cheaper layer covers the risk.
- AI-native layer second, and only where it adds signal classic tests do not give cheaply.
- Every AI-native row has a **"When NOT to use"** line. If you cannot write one, drop the row.
- Every tool name carries a `checked: <YYYY-MM-DD>` date. Tool names are examples of the category, not endorsements.
- Both layers must be non-empty in the final guide if the project warrants them. Classic-only is a 2020 plan; AI-native-only is hype. AI-native phases are not mandatory — include them only when the brief justified them under cost × signal.

### Quality gates rules

- Required gates (lint, typecheck, unit+integration, e2e on critical flows) must map to actual CI steps. If a required gate is not yet wired, mark it as `required after §3 Phase <N>` and let the named rollout phase wire it.
- Post-edit hook is **recommended local**, not a CI substitute.
- Multimodal visual review is **selective**, applied to 1–3 critical screens, not to every page.
- Vision-driven fallback (Anthropic Computer Use or OpenAI CUA) is reserved for DOM-unreachable surfaces; expensive per action.

### Cookbook patterns (§6) — fills in over time

`test-plan.md` is both a phased strategy and a **growing cookbook**. §6 starts as placeholders (`TBD — see §3 Phase <N>`) and fills in incrementally — each rollout phase's plan ends with a sub-phase that updates the relevant §6 entry (location, naming, reference test, run command). After Module 3 completes, §6 becomes the canonical answer to "how do I add a test for X in this project?" — and is what `/10x-tdd` reads in Lesson 2.

### Lesson boundaries

- Do not write test code. That is Lesson 2 (`/10x-tdd` and unit-test authoring).
- Do not configure hooks, hook lifecycle, or debugging hooks. That is Lesson 3.
- Do not configure MCP servers, Playwright API, e2e code, or multimodal scenario code. That is Lesson 4.
- Do not run the bug-to-fix-to-regression-test workflow. That is Lesson 5.
- Do not author CI/CD pipelines from scratch or write GitHub Actions YAML. The guide names gates; configuration is owned by Module 1 Lesson 5 and Module 2 Lesson 5.
- Do not benchmark multimodal models. Cite criteria (cost, latency, agent-friendliness), never a ranking.
- Do not read the codebase for knowledge (call graphs, schemas, "which file owns this failure"). That is `/10x-research`'s job, per rollout phase.

### Paths used by this lesson

- `context/foundation/test-plan.md` — the quality contract produced and maintained by `/10x-test-plan`
- `context/foundation/prd.md` — primary risk source
- `context/foundation/roadmap.md` — likelihood weighting
- `context/foundation/tech-stack.md` — stack input (when present)
- `context/archive/<change-id>/plan.md` — implemented risk surface
- `context/changes/<change-id>/` — per-rollout-phase change folder (one per row in §3)

<!-- END @przeprogramowani/10x-cli -->
