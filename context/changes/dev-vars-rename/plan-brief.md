# dev-vars-rename — Plan Brief

> Full plan: `context/changes/dev-vars-rename/plan.md`

## What & Why

The project has two local env files: `.env` (Node tooling) and `.dev.vars` (Wrangler runtime). Wrangler natively reads both `.dev.vars` and `.env`, so there's no technical reason to keep the non-`.env.*`-named file. Consolidating into `.env` removes the naming inconsistency without any workarounds or script gymnastics.

## Starting Point

`.dev.vars` holds three vars absent from `.env`: `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (transaction pooler), and `SENTRY_DSN`. `vitest.config.ts` has a custom 14-line block to merge `.dev.vars` into the test environment. All documentation (CLAUDE.md, AGENTS.md, README.md) tells contributors to maintain both files.

## Desired End State

A single `.env` (gitignored) is the only local secrets file. `.env.example` is the only committed template. `vitest.config.ts` loads just `.env`. All documentation points to `.env` only. `wrangler dev` continues to work without any configuration changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Target filename | Consolidate into `.env` (not `.env.dev`) | Wrangler reads `.env` natively; `.env.dev` is not a supported filename and would require a workaround script | Plan |
| Scope of doc updates | All live docs (CLAUDE.md, AGENTS.md, README.md, infrastructure.md) | Historical context/archive files are immutable records and excluded | Plan |
| Typo fix | Fix `SUPABASE_SERIVCE_KEY` → `SUPABASE_SERVICE_KEY` in `.env` | Pre-existing typo discovered during merge; trivial to fix inline | Plan |

## Scope

**In scope:** `.env`, `.env.example`, `vitest.config.ts`, `.gitignore`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `context/foundation/infrastructure.md`; deleting `.dev.vars` and `.dev.vars.example`

**Out of scope:** Application code, Astro env schema, CI secrets, `wrangler secret put`, context/archive historical files

## Architecture / Approach

No architectural change — purely a file consolidation and reference update. Wrangler's native `.env` support means zero config changes are needed in `wrangler.jsonc`. The vitest custom loader becomes dead code and is deleted.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Consolidate env files | `.env` contains all vars; `.dev.vars*` deleted | Forgetting to copy a value before deleting `.dev.vars` |
| 2. Update all references | Code + docs reference only `.env`; grep check passes | Missing a reference (caught by the `git grep` automated check) |

**Prerequisites:** Access to the real `.dev.vars` values to copy into `.env` before deletion  
**Estimated effort:** ~1 session, 2 phases

## Open Risks & Assumptions

- Wrangler's `.env` support may have edge cases vs `.dev.vars` (e.g., variable quoting differences) — manual verification of `npm run dev` in Phase 2 is the safety net.
- The `SUPABASE_SERIVCE_KEY` typo may or may not affect production (production uses `wrangler secret put`, not env files) — fixing it here is safe and corrects local tooling only.

## Success Criteria (Summary)

- `git grep 'dev\.vars'` returns no results in tracked files (excluding archive and this change folder)
- `npm run dev` starts without missing-binding errors
- `npm test` passes after removing the `.dev.vars` vitest loader
