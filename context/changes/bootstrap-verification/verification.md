---
bootstrapped_at: 2026-05-20T09:00:49Z
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

| Signal | Value | Severity | Notes |
| --- | --- | --- | --- |
| npm package | not run | n/a | skipped because the starter command uses `git clone` rather than an npm create package |
| GitHub repo | `przeprogramowani/10x-astro-starter` last pushed 2026-05-17T10:33:39Z | fresh | from card.docs_url |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 top-level entries
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently
**.bootstrap-scaffold cleanup**: deleted

Notes:

- The cloned `.bootstrap-scaffold/.git/` directory was deleted before files were moved up, so upstream starter history was not preserved.
- `context/` in the current directory was preserved and not overwritten.
- The first merge attempt failed before moving files because `zsh` treats unmatched hidden-file globs as errors.
- The second merge attempt failed before moving files because `path` is a reserved zsh array tied to command lookup; rerun used `item` and absolute system command paths.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0

#### CRITICAL findings

None.

#### HIGH findings

- `devalue`: Svelte devalue: DoS via sparse array deserialization. Advisory: GHSA-77vg-94rm-hx3p. Severity: high. Direct: no. Fix available: true.

#### MODERATE findings

- `@astrojs/check`: affected via `@astrojs/language-server`. Direct: yes. Fix available: `@astrojs/check@0.9.2` with semver-major change.
- `@astrojs/cloudflare`: affected via `@cloudflare/vite-plugin`, `wrangler`. Direct: yes. Fix available: `@astrojs/cloudflare@12.6.13` with semver-major change.
- `@astrojs/language-server`: affected via `volar-service-yaml`. Direct: no. Fix available via `@astrojs/check@0.9.2` with semver-major change.
- `@cloudflare/vite-plugin`: affected via `miniflare`, `wrangler`, `ws`. Direct: no. Fix available via `@astrojs/cloudflare@12.6.13` with semver-major change.
- `miniflare`: affected via `ws`. Direct: no. Fix available via `@astrojs/cloudflare@12.6.13` with semver-major change.
- `volar-service-yaml`: affected via `yaml-language-server`. Direct: no. Fix available via `@astrojs/check@0.9.2` with semver-major change.
- `wrangler`: affected via `miniflare`. Direct: yes. Fix available: `wrangler@3.107.3` with semver-major change.
- `ws`: Uninitialized memory disclosure. Advisory: GHSA-58qx-3vcg-4xpx. Direct: no. Fix available via `@astrojs/cloudflare@12.6.13` with semver-major change.
- `yaml`: Stack overflow via deeply nested YAML collections. Advisory: GHSA-48c2-rrv3-qjmp. Direct: no. Fix available via `@astrojs/check@0.9.2` with semver-major change.
- `yaml-language-server`: affected via `yaml`. Direct: no. Fix available via `@astrojs/check@0.9.2` with semver-major change.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint | Value |
| --- | --- |
| bootstrapper_confidence | first-class |
| quality_override | false |
| path_taken | standard |
| self_check_answers | null |
| team_size | solo |
| deployment_target | cloudflare-pages |
| ci_provider | github-actions |
| ci_default_flow | auto-deploy-on-merge |
| has_auth | true |
| has_payments | false |
| has_realtime | false |
| has_ai | false |
| has_background_jobs | false |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified - happy hacking.

Useful manual steps in the meantime:

- `git init` if you have not already, to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance - the full breakdown is in this log.
