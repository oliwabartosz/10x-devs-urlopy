---
bootstrapped_at: 2026-05-24T18:16:45Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: urlopy
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: urlopy
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

## Why this stack

Urlopy is a small web app with a 3-week MVP window, email/password access control, moderator permissions, and a spreadsheet-like monthly absence grid. The standard JavaScript/TypeScript recommendation is 10x Astro Starter because it gives Astro + React + TypeScript, Supabase auth/database, and Cloudflare Pages deployment out of the box, which keeps the first scaffold close to the course-supported path and minimizes setup friction. The selected hand-off uses Cloudflare Pages, GitHub Actions, and auto-deploy on merge. The later Red Hat server + SQLite requirement is a known manual adaptation after scaffolding; the bootstrapper hand-off stays on the starter's supported Supabase-first defaults.

## Pre-scaffold verification

| Signal      | Value                                                                    | Severity | Notes                                                              |
| ----------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| npm package | not run                                                                  | n/a      | cmd_template starts with `git clone`; npm package check skipped    |
| GitHub repo | `przeprogramowani/10x-astro-starter` last pushed 2026-05-17T10:33:39Z   | fresh    | from card.docs_url                                                 |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo, upstream `.git/` deleted before move-up)
**Exit code**: 0
**Files moved**: 1 (`node_modules/` — absent from cwd, moved silently)
**Conflicts (.scaffold siblings)**: 48 files (all pre-existing from prior bootstrap run):
`astro.config.mjs`, `CLAUDE.md`, `components.json`, `.env.example`, `eslint.config.js`,
`.github/workflows/ci.yml`, `.husky/pre-commit`, `.nvmrc`, `package.json`, `package-lock.json`,
`.prettierrc.json`, `public/.assetsignore`, `public/favicon.png`, `public/template.png`,
`README.md`, `src/components/auth/FormField.tsx`, `src/components/auth/PasswordToggle.tsx`,
`src/components/auth/ServerError.tsx`, `src/components/auth/SignInForm.tsx`,
`src/components/auth/SignUpForm.tsx`, `src/components/auth/SubmitButton.tsx`,
`src/components/Banner.astro`, `src/components/Topbar.astro`, `src/components/ui/button.tsx`,
`src/components/ui/LibBadge.astro`, `src/components/Welcome.astro`, `src/env.d.ts`,
`src/layouts/Layout.astro`, `src/lib/config-status.ts`, `src/lib/supabase.ts`,
`src/lib/utils.ts`, `src/middleware.ts`, `src/pages/api/auth/signin.ts`,
`src/pages/api/auth/signout.ts`, `src/pages/api/auth/signup.ts`,
`src/pages/auth/confirm-email.astro`, `src/pages/auth/signin.astro`,
`src/pages/auth/signup.astro`, `src/pages/dashboard.astro`, `src/pages/index.astro`,
`src/styles/global.css`, `supabase/config.toml`, `supabase/.gitignore`, `tsconfig.json`,
`.vscode/extensions.json`, `.vscode/launch.json`, `.vscode/settings.json`, `wrangler.jsonc`
**.gitignore handling**: scaffold `.gitignore` identical to cwd — no lines appended
**context/ handling**: no `context/` in scaffold; cwd `context/` preserved untouched
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0 direct HIGH; 2 direct MODERATE (`wrangler`, `@astrojs/check`); remaining 7 MODERATE transitive

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** v5.6.3–5.8.0 (transitive, via tooling chain)
  - Advisory: GHSA-77vg-94rm-hx3p — Svelte devalue: DoS via sparse array deserialization
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H) | CWE-770
  - Fix available: yes (`npm audit fix` covers this)
  - Note: transitive Svelte dependency; not exercised in this Astro + React project at runtime

#### MODERATE findings

- **@astrojs/check** ≥0.9.3 (direct) — via `@astrojs/language-server` → `volar-service-yaml` → `yaml`; fix: downgrade to `@astrojs/check@0.9.2` (semver-major bump required)
- **@astrojs/language-server** ≥2.14.0 (transitive) — via `volar-service-yaml`; fix tied to `@astrojs/check@0.9.2`
- **@cloudflare/vite-plugin** 0.0.7–1.37.2 (transitive) — via `miniflare` + `wrangler` + `ws`; fix available
- **miniflare** 3.20250204.0–4.20260518.0 (transitive) — via `ws`; fix available
- **volar-service-yaml** ≤0.0.70 (transitive) — via `yaml-language-server`; fix tied to `@astrojs/check@0.9.2`
- **wrangler** 3.108.0–4.93.0 (direct) — via `miniflare`; fix available
- **ws** 8.0.0–8.20.0 (transitive) — GHSA-58qx-3vcg-4xpx: uninitialized memory disclosure; CVSS 4.4; fix available
- **yaml** 2.0.0–2.8.2 (transitive) — GHSA-48c2-rrv3-qjmp: stack overflow via deeply nested YAML; CVSS 4.3; fix tied to `@astrojs/check@0.9.2`
- **yaml-language-server** (transitive) — via `yaml`; fix tied to `@astrojs/check@0.9.2`

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                 |
| ----------------------- | --------------------- |
| bootstrapper_confidence | first-class           |
| quality_override        | false                 |
| path_taken              | standard              |
| self_check_answers      | null                  |
| team_size               | solo                  |
| deployment_target       | cloudflare-pages      |
| ci_provider             | github-actions        |
| ci_default_flow         | auto-deploy-on-merge  |
| has_auth                | true                  |
| has_payments            | false                 |
| has_realtime            | false                 |
| has_ai                  | false                 |
| has_background_jobs     | false                 |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- `npm audit fix` addresses the wrangler + miniflare + ws MODERATE chain and the `devalue` HIGH.
- The `@astrojs/check`-chain MODERATEs require a semver-major downgrade (`@astrojs/check@0.9.2`) — decide based on your risk tolerance.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
