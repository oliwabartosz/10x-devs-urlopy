# Cloudflare Integration & Deployment Plan — urlopy

## Context

The project already has `@astrojs/cloudflare` wired and a `wrangler.jsonc` stub, but the deployment pipeline is incomplete and contains several bugs that would cause silent failures in production. This plan addresses all five risk items from `context/foundation/infrastructure.md`:

- Missing production secrets → auth fails silently
- Bundle exceeds 25 MB → deploy fails at `wrangler pages deploy`
- `astro dev` instead of `wrangler dev` → runtime divergence
- Pages rollback has no `wrangler` command
- Fork PR preview deploys fail auth silently

---

## Phase 1 — Wrangler Config Audit
**Goal:** Make `wrangler.jsonc` match the intended Pages deployment model.

- [ ] **Remove `kv_namespaces`** — the `SESSION` KV namespace in the current file is not in the scaffold and is unused. Auth uses Supabase cookie sessions, not KV. Delete the entire `kv_namespaces` block.
- [ ] **Remove `workers_dev: true`** — this flag is for standalone Workers, not Pages Functions. Leaving it is harmless but misleading; remove for clarity.

**Final `wrangler.jsonc`:**
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "urlopy",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-05-08",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist",
    "not_found_handling": "404-page",
  },
  "observability": {
    "enabled": true,
  },
}
```

**`astro.config.mjs` — no changes needed:**
- `cloudflare({ imageService: "passthrough" })` is correct for MVP (avoids paid Image Resizing)
- `envField.secret({ optional: true })` allows `astro build` to succeed in CI without real secrets

---

## Phase 2 — Local Dev Environment
**Goal:** Ensure `npm run dev` actually runs the Cloudflare workerd runtime.

- [ ] **Fix `package.json` `dev` script** — change `"astro dev"` → `"wrangler dev"`. The current value causes `npm run dev` to start Vite (not workerd), which doesn't read `.dev.vars`, doesn't emulate Workers APIs, and can produce behavior that differs from production.
- [ ] **Add `predev` warning script** — npm lifecycle hook that fires before `npm run dev`, warning developers not to use `astro dev` directly.
- [ ] **Fix `package.json` `name`** — change `"10x-astro-starter"` → `"urlopy"` for consistency with `wrangler.jsonc`.

**Script block diff:**
```json
"scripts": {
  "predev": "echo '\\n[urlopy] wrangler dev — Cloudflare Workers runtime. Do NOT run astro dev directly.\\n'",
  "dev": "wrangler dev",
  ...
}
```

> **Note on wrangler dev workflow:** `wrangler dev` does not trigger `astro build`. Run `npm run build` once first (or run `astro build --watch` in one terminal + `wrangler dev` in another) for hot-reload during development.

- [ ] **Create `.dev.vars.example`** in the repo root — a committed template for the Cloudflare-format secrets file (distinct from `.env.example` which is for Node-based tooling):

```
# Cloudflare local dev secrets — copy to .dev.vars (gitignored) and fill in real values.
# wrangler dev reads .dev.vars automatically; astro dev does NOT read this file.
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
```

---

## Phase 3 — GitHub Actions CI + Deploy Pipeline
**Goal:** Replace the broken `ci.yml` (targets `master`, no deploy, no health check) with a two-job pipeline.

**File:** `.github/workflows/ci.yml`

- [ ] **Fix branch targets** — `master` → `main` (confirmed via `git status`)
- [ ] **Add `deploy` job** — gates on `ci` passing, runs only on `push` to `main` (not PRs, which get automatic Cloudflare preview URLs via the Pages GitHub integration)
- [ ] **Upload/download `dist/` artifact** — share the build output from `ci` to `deploy` so the deployed bundle is byte-for-byte identical to the one that passed linting
- [ ] **Add bundle size check** — `npx wrangler pages deploy dist --project-name urlopy --dry-run` catches the 25 MB compressed limit before it blocks a real deploy
- [ ] **Add post-deploy health check** — curl `/auth/signin` on the deployed URL, assert HTTP < 500 and page body looks like an auth form. Catches the most critical silent failure: a missing Supabase secret that crashes the Worker.
- [ ] **Add `permissions: deployments: write`** — required by `cloudflare/pages-action@v1` to post a GitHub Deployment record

**Full `ci.yml`:**
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    name: Lint & Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npx astro sync

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}

      - name: Bundle size check (dry-run)
        run: npx wrangler pages deploy dist --project-name urlopy --dry-run
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Upload dist artifact
        uses: actions/upload-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/
          retention-days: 1

  deploy:
    name: Deploy to Cloudflare Pages
    runs-on: ubuntu-latest
    needs: ci
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: read
      deployments: write
    outputs:
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4

      - name: Download dist artifact
        uses: actions/download-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/

      - name: Deploy to Cloudflare Pages
        id: deploy
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: urlopy
          directory: dist
          branch: main
          wranglerVersion: "4"

      - name: Post-deploy health check
        run: |
          DEPLOY_URL="${{ steps.deploy.outputs.url }}"
          echo "Health check: ${DEPLOY_URL}/auth/signin"
          HTTP_CODE=$(curl -s -o /tmp/body.txt -w "%{http_code}" \
            --max-time 30 --retry 3 --retry-delay 5 \
            "${DEPLOY_URL}/auth/signin")
          if [ "$HTTP_CODE" -ge 500 ]; then
            echo "FAIL: HTTP ${HTTP_CODE}"
            cat /tmp/body.txt
            exit 1
          fi
          if ! grep -qi "sign.in\|email\|login" /tmp/body.txt; then
            echo "FAIL: response does not look like an auth page"
            cat /tmp/body.txt
            exit 1
          fi
          echo "OK: HTTP ${HTTP_CODE}"
```

---

## Phase 4 — One-Time Manual Setup
**Goal:** Provision Cloudflare and GitHub secrets. These steps cannot be automated.

### Cloudflare Side
- [ ] **Authenticate wrangler** (once per machine):
  ```bash
  npx wrangler login
  ```

- [ ] **First deploy / project creation** (choose one):
  - **Dashboard path (recommended):** Pages → Create application → Pages → Connect to Git → select `urlopy` repo → build command: `npm run build`, output: `dist`, add env var `NODE_VERSION=22`
  - **CLI path:** `npm run build && npx wrangler pages deploy dist --project-name urlopy`

- [ ] **Set production secrets** (AFTER the project exists):
  ```bash
  npx wrangler pages secret put SUPABASE_URL --project-name urlopy
  npx wrangler pages secret put SUPABASE_KEY --project-name urlopy
  ```
  Trigger a redeploy after setting — Workers pick up secrets on next cold start.

### GitHub Side
Add at `Settings → Secrets and variables → Actions → Repository secrets`:

| Secret | Value | Source |
|--------|-------|--------|
| `CLOUDFLARE_API_TOKEN` | Scoped API token | Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" template, scoped to `urlopy` |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID | Cloudflare dashboard sidebar |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase → Project Settings → API |
| `SUPABASE_KEY` | `eyJ...` anon key | Supabase → Project Settings → API |

- [ ] `CLOUDFLARE_API_TOKEN` — use "Edit Cloudflare Workers" template, do NOT use Global API Key
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `SUPABASE_URL` (used in CI build step to avoid type-check crash)
- [ ] `SUPABASE_KEY`

### New Developer Onboarding
- [ ] Copy `.dev.vars.example` → `.dev.vars`, fill in real Supabase values
- [ ] `npm ci`
- [ ] `npm run build` (generates `dist/`)
- [ ] `npm run dev` → open `http://localhost:8788` (wrangler port, not Vite's 4321)

---

## Phase 5 — Edge Case Mitigations
**Goal:** Document and implement safeguards for the known failure modes.

### 5.1 Pages Rollback (no `wrangler` command)
`wrangler rollback` does NOT work for Pages. Two options:

**Dashboard (fastest):** `dash.cloudflare.com` → Workers & Pages → urlopy → View deployments → three-dot menu → "Rollback to this deployment"

**REST API (scriptable):**
```bash
# List deployments to find target ID
curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/urlopy/deployments" \
  | jq '.result[] | {id, created_on}'

# Promote a prior deployment
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/urlopy/deployments/$DEPLOYMENT_ID/retry"
```

- [ ] Add rollback commands to `CLAUDE.md` under a "Deployment" section

### 5.2 Fork PR Preview Deploy Limitation
Fork PRs do NOT inherit Cloudflare Secrets → auth silently fails in fork PR previews. Expected Cloudflare security behavior.

- [ ] Add a comment above the `deploy` job in `ci.yml` explaining this
- [ ] Add to `CONTRIBUTING.md`: "Fork PR preview deploys will show a Supabase configuration error — this is expected. Only maintainer-branch PRs have working auth in preview environments."
- [ ] (Optional) Enable Cloudflare Access on `*.urlopy.pages.dev` to gate preview URLs (free for ≤50 users via Cloudflare Zero Trust)

### 5.3 Log Streaming Fallbacks
`wrangler pages deployment tail` drops connections — use in tiers:

- **Tier 1 — wrangler (free, may drop):** `npx wrangler pages deployment tail --project-name urlopy`
- **Tier 2 — Cloudflare MCP server:** `workers_observability` tool via `github.com/cloudflare/mcp-server-cloudflare` (structured queries from Claude Code)
- **Tier 3 — Logpush** (Workers Paid, $5/month): persistent log drain to R2 or external HTTPS endpoint

- [ ] Document Tier 1 command + reliability note in `CLAUDE.md`

### 5.4 `astro dev` Misuse
- [ ] `predev` npm hook (Phase 2) handles `npm run dev` invocations
- [ ] VS Code Astro extension reads `package.json#scripts.dev` — fixing the script automatically fixes the extension's "Start Dev Server" button
- [ ] Update `CLAUDE.md` dev command description to be explicit: `npm run dev — wrangler dev (Cloudflare workerd runtime). Do NOT use astro dev.`

---

## Verification Checklist

- [ ] `npm run build` — succeeds without real Supabase secrets (`optional: true` in env schema)
- [ ] `npm run dev` — starts wrangler on port 8788 (not Vite on 4321); predev warning echoes
- [ ] `npm run lint` — passes
- [ ] Push to `main` → GitHub Actions: `ci` succeeds → `deploy` triggers → health check passes
- [ ] Push to feature branch → `ci` runs, `deploy` skipped; Cloudflare Pages generates a preview URL
- [ ] Deployed URL → `/auth/signin` renders the sign-in form (not a 500)
- [ ] Cloudflare dashboard: Workers & Pages → urlopy → Deployments shows correct commit SHA

---

## Files Changed

| File | Action |
|------|--------|
| `wrangler.jsonc` | Edit: remove `kv_namespaces` block and `workers_dev` |
| `package.json` | Edit: `dev` → `wrangler dev`, add `predev` echo, `name` → `urlopy` |
| `.dev.vars.example` | Create: committed template for local Cloudflare secrets |
| `.github/workflows/ci.yml` | Replace: full rewrite with `ci` + `deploy` jobs |
| `CLAUDE.md` | Edit: add deployment section, fix `master` → `main`, clarify `wrangler dev` |
