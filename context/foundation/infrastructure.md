---
project: urlopy
researched_at: 2026-05-24
recommended_platform: Cloudflare Workers + Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd / V8 isolate)
  adapter: "@astrojs/cloudflare"
  auth_db: Supabase (external)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

The tech stack already uses `@astrojs/cloudflare` — there is zero adapter migration cost, making Cloudflare the only platform where the first deploy is a one-command operation from day one. The free tier (100k requests/day, ~3M/month) covers this MVP's entire traffic lifetime with large headroom, the developer has existing Cloudflare familiarity, and Cloudflare publishes a GA MCP server that Claude Code can use directly for deployments, log tailing, and secret management. Every other platform scored equally on paper but would require adapter work, pricing risk, and operational patterns the team doesn't yet know.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Notes |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass | Pass | Pass | 5 / 5 — existing adapter |
| Vercel | Pass | Pass | Pass | Pass | Pass | 5 / 5 — requires adapter swap, Pro plan for commercial use |
| Netlify | Partial | Pass | Pass | Partial | Partial | 2P + 3 Partial — no CLI rollback or log tailing; MCP 404'd on research date |
| Fly.io | Pass | Partial | Partial | Pass | Fail | 3P + 1 Partial + 1 Fail — container overhead overkill for stateless SSR |
| Railway | Pass | Partial | Partial | Pass | Fail | 3P + 1 Partial + 1 Fail — same as Fly.io |
| Render | Partial | Partial | Fail | Partial | Fail | 3 Partial + 2 Fail — no GitHub docs, no llms.txt, free tier cold-starts |

**Scoring notes:**
- Netlify CLI-first PARTIAL: rollback is dashboard-only (API route exists but no `netlify rollback` command); log tailing requires Enterprise Log Drains.
- Netlify MCP PARTIAL: `llms.txt` confirmed at `docs.netlify.com/llms.txt`, but MCP server docs URL returned 404 on 2026-05-24.
- Fly.io / Railway PARTIAL on managed/serverless: both require Dockerfile or buildpack config and more runtime-level decisions than pure serverless. Not wrong for larger apps, but overkill for a stateless SSR MVP.
- Render FAIL on agent docs: no GitHub-hosted Markdown source, no confirmed `llms.txt`.

**Interview weights applied:**
- No persistent connections needed → no platform filtered out
- No strong cost/DX preference → neutral weighting
- Cloudflare familiarity → tiebreaker between Cloudflare and Vercel (both scored 5/5)
- Single region (Poland/EU) → Cloudflare's global edge is free upside, not a required feature
- External providers (Supabase) fine → co-location irrelevant

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

The only platform where the project deploys without touching the adapter. `wrangler deploy` / `wrangler pages deploy` are deterministic one-command operations; the free tier (100k requests/day) covers this MVP's entire lifetime; the official Cloudflare MCP server (GA, open source at `github.com/cloudflare/mcp-server-cloudflare`) gives Claude Code typed access to deploy, tail, and manage KV without leaving the IDE. The primary operational risks — Pages rollback being dashboard-only, `wrangler pages deployment tail` having community-reported reliability issues, and the two-store secret management pattern — are documented in the risk register with concrete mitigations.

#### 2. Vercel

Vercel also scores 5/5 and has the most polished MCP integration (`https://mcp.vercel.com`, OAuth-backed, GA as of 2026-02-12). It would be the recommendation if this project weren't already on the Cloudflare adapter. The blockers: (a) `@astrojs/vercel` adapter swap is non-trivial — env var wiring (`astro:env/server` maps to Cloudflare env bindings, not `process.env`), (b) the Hobby plan prohibits commercial use, so the $20/month Pro plan is required for any real product, and (c) functions are archived after 2 weeks of inactivity in production adding cold-start latency.

#### 3. Netlify

Netlify has a confirmed `llms.txt` (February 2025 GA) and the `@astrojs/netlify` adapter is maintained by the Astro team. It falls to third because: rollback is dashboard-only with no CLI command, log tailing requires Enterprise Log Drains, the MCP server docs URL returned 404 on research date (status unconfirmed), and Netlify's pricing migrated to a credit-based model that changed twice in 2025–2026 — making SSR cost predictability uncertain.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **Workers runtime is not Node.js — transitive dependency failures happen at runtime, not build time.** The `nodejs_compat` flag enables most Node.js built-ins but not all. A transitive dependency inside `@supabase/ssr` or any future package that calls an unsupported Node.js API will pass `npm run build` and crash only in production. `wrangler dev` is required for runtime-accurate local testing; `astro dev` does not emulate the Workers environment at all.

2. **Pages rollback has no CLI — the Cloudflare dashboard is required.** `wrangler rollback` works for standalone Workers but **not for Pages deployments**. Reverting a bad Pages deploy requires navigating to the Cloudflare dashboard and clicking "Rollback." The Cloudflare REST API (`/client/v4/pages/projects/.../deployments`) can automate this, but `wrangler` cannot. An agent running in CI cannot perform a Pages rollback without custom API scripting.

3. **`wrangler pages deployment tail` has documented reliability issues.** Log streaming for Pages Functions is in the official docs but community threads report connection drops and delayed output. Production debugging relies on this feature; its real-world reliability is lower than `wrangler tail` for standalone Workers.

4. **25 MB compressed bundle size limit.** Astro 6 + React 19 + shadcn/ui components can accumulate. If the bundle approaches this limit, the deploy will fail at `wrangler pages deploy` time with no obvious fix short of code-splitting or dependency removal. This should be monitored in CI.

5. **Vendor lock-in via Cloudflare env binding model.** `astro:env/server` secrets map to Cloudflare Worker `env` bindings, not `process.env`. Both `.dev.vars` (local dev) and `wrangler secret put` (production) must be populated with matching names. If this project ever moves platforms, env handling must be rewritten — it is not a portable pattern.

### Pre-Mortem — How This Could Fail

The team deployed Urlopy to Cloudflare Pages on day one. Local development worked perfectly with `npm run dev`. Production deployment succeeded through GitHub Actions on the first attempt.

Week two: authentication began failing silently for some users. The team reached for `wrangler pages deployment tail` to inspect live logs — the command connected but dropped every few minutes, making it hard to catch the error. The root cause turned out to be `SUPABASE_KEY` set in `.dev.vars` for local dev but never added as a Cloudflare Worker Secret for production. The error in the Workers runtime was `TypeError: Cannot read properties of undefined (reading 'getSession')` — no indication a secret was missing. Diagnosis took four hours.

Week three: a bad deploy required a rollback. The developer discovered there was no `wrangler` command for Pages rollback, found the Cloudflare dashboard, clicked through to the deployment history, and reverted. The rollback itself took five seconds; finding the right UI page took twenty minutes.

The project shipped on time, but approximately one day of the three-week MVP window was lost to Cloudflare-specific operational friction. The incidents were avoidable with better upfront documentation of the secret management pattern and the Pages-vs-Workers rollback distinction.

### Unknown Unknowns

- **Two secret stores must stay in sync: `.dev.vars` (local) and Cloudflare Secrets (production).** Astro's `envField.secret()` declaration is a third source of truth. A developer touching secrets who doesn't know the pattern will almost certainly set only one store and be confused when the other environment breaks.

- **Preview deploys from forked PRs cannot access production secrets.** Fork PRs don't inherit Cloudflare Secrets — preview deploys will fail auth silently. This affects onboarding any contributor, even on a small team.

- **`wrangler dev` and `astro dev` are different programs.** `npm run dev` in this project correctly calls `wrangler dev`, but any developer who triggers `astro dev` directly (VS Code Astro extension, global `astro dev` command) will get a Vite server that doesn't emulate the Workers runtime, doesn't read `.dev.vars`, and can produce behavior that differs from production.

- **Supabase requests originate from Cloudflare's anycast IPs.** If Supabase's threat detection ever rate-limits Cloudflare egress IPs (uncommon but non-zero for shared infrastructure), auth failures would appear global with no obvious cause.

- **React 19 + shadcn/ui bundle size should be monitored proactively.** The 25 MB compressed Pages bundle limit is not typically hit, but an absence-tracking grid with many cell components and color-coded entries can grow. A `wrangler pages deploy --dry-run` step in CI catches this before it blocks a production deploy.

## Operational Story

- **Preview deploys**: Every push to a non-main branch automatically creates a preview URL via the Cloudflare Pages GitHub integration (`cloudflare/pages-action`). Preview URLs take the form `<commit-sha>.<project>.pages.dev`. Fork PRs do not inherit production secrets — preview deploys from forks will fail Supabase auth (expected security behavior). Protect preview URLs with Cloudflare Access if the absence data is sensitive.

- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in two places: `.dev.vars` for local `wrangler dev` (gitignored), and as Cloudflare Worker Secrets for production set via `npx wrangler secret put SUPABASE_URL`. The `astro.config.mjs` env schema declares them via `envField.secret()` — the names must match exactly in both stores. Rotation: update both stores, then trigger a new deploy; Workers pick up secrets on next cold start.

- **Rollback**: For Pages deployments, rollback is dashboard-only — navigate to `dash.cloudflare.com` → Pages → Urlopy → Deployments → find the previous build → "Rollback to this deployment." Time-to-revert: ~30 seconds once in the dashboard. For programmatic rollback (CI/agent), use the Cloudflare REST API: `POST /client/v4/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/retry` (promotes a prior deployment). DB migrations applied in a deploy do not roll back automatically.

- **Approval**: Actions an agent may perform unattended: `wrangler pages deploy` (new deploy), `wrangler secret put` (update a secret), `wrangler tail` (read logs). Actions that require a human: rolling back a Pages deployment (dashboard click or explicit Cloudflare API script), rotating the Supabase service role key (Supabase dashboard), changing the custom domain or SSL configuration.

- **Logs**: Stream live logs with `npx wrangler pages deployment tail --project-name urlopy`. For historical logs, use `npx wrangler pages deployment list --project-name urlopy` to find a deployment ID then tail it. Note: `wrangler pages deployment tail` has community-reported reliability issues — if the stream drops, re-run the command. Alternative: use the Cloudflare MCP server tool `workers_observability` to query logs via structured tool calls from Claude Code.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Transitive dependency uses unsupported Node.js API, breaks only at runtime | Devil's advocate | M | H | Set `nodejs_compat` flag in `wrangler.toml`; add a `wrangler dev` smoke-test step to CI that exercises auth routes before merging |
| `SUPABASE_KEY` missing from Cloudflare Secrets (set only in `.dev.vars`) | Pre-mortem + Unknown unknowns | H | H | Add a deployment health-check step in GitHub Actions: after `wrangler pages deploy`, hit `/api/auth/signin` and assert a non-500 response |
| Pages rollback requires dashboard navigation — agent or CI cannot automate it | Devil's advocate | M | M | Document the Cloudflare REST API rollback call (`/pages/projects/{name}/deployments/{id}/retry`) in the runbook; add it to the GitHub Actions reusable workflow |
| `wrangler pages deployment tail` connection drops in production debugging | Devil's advocate | M | M | Set up a Cloudflare Log Drain (Workers Paid, $5/month) to forward logs to a persistent sink (R2, Logpush to S3); use Cloudflare MCP server `workers_observability` as fallback |
| Fork PR preview deploys fail auth silently | Unknown unknowns | H | L | Document expected behavior in CONTRIBUTING.md; protect preview URLs with Cloudflare Access for internal testing |
| Bundle exceeds 25 MB compressed limit | Devil's advocate | L | H | Add `wrangler pages deploy --dry-run` to CI to catch bundle size before production deploy |
| Supabase anycast IP rate limiting | Unknown unknowns | L | H | Monitor Supabase usage dashboard; if rate limiting appears, add Cloudflare Hyperdrive as a proxy layer |
| Developer uses `astro dev` instead of `wrangler dev`, misses runtime differences | Unknown unknowns | H | L | Add a `predev` npm hook that echoes "Use npm run dev (wrangler dev) for Cloudflare runtime fidelity" |

## Getting Started

1. **Authenticate wrangler** (if not already done):
   ```bash
   npx wrangler login
   ```

2. **Add production secrets** (run once per environment):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```

3. **Verify local dev** reads `.dev.vars` correctly:
   ```bash
   npm run dev   # runs wrangler dev — do NOT use astro dev for runtime testing
   ```

4. **Deploy to Cloudflare Pages** (manual first deploy):
   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name urlopy
   ```
   After the first deploy, subsequent deploys are automated via GitHub Actions (`cloudflare/pages-action`) on every push to `main`.

5. **Connect the GitHub repo to Cloudflare Pages** via the Cloudflare dashboard (one-time setup): Pages → Create a project → Connect to Git → select this repo → set build command `npm run build`, output directory `dist`, Node.js version `22`.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow is already in `.github/workflows/ci.yml`)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare Access configuration for preview deploy protection
