# dev-vars-rename Implementation Plan

## Overview

Consolidate `.dev.vars` into `.env`. Wrangler natively reads both `.dev.vars` and `.env` for local secrets, so merging them eliminates the non-`.env.*`-named file and reduces the number of env files developers must maintain, without any workarounds.

## Current State Analysis

The project maintains two separate local env files:
- `.env` — Node-based tooling (Drizzle Kit, Playwright E2E, Sentry source-map upload). Read by `vitest.config.ts` and Node CLI tools.
- `.dev.vars` — Cloudflare Worker runtime secrets. Read by `wrangler dev` automatically.

Three vars live only in `.dev.vars`: `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (transaction pooler), and `SENTRY_DSN`. These are absent from `.env` and `.env.example`.

`vitest.config.ts` has an explicit 14-line block that merges `.dev.vars` into the test environment on top of `.env`. After consolidation this block becomes dead code.

References to `.dev.vars` that must be updated:
- `vitest.config.ts` (lines 11–25) — code
- `.gitignore` (lines 22 and 25) — both entries
- `CLAUDE.md` (3 places)
- `AGENTS.md` (2 places)
- `README.md` (3 places)
- `context/foundation/infrastructure.md` (1 place)

## Desired End State

A single `.env` (gitignored) holds all local-dev secrets for both Node tooling and the Wrangler Worker runtime. `.env.example` is the sole committed template for onboarding. `.dev.vars` and `.dev.vars.example` no longer exist. All documentation refers only to `.env`.

### Key Discoveries

- Wrangler reads both `.dev.vars` and `.env` for local secrets (confirmed in current docs) — no workaround needed.
- `vitest.config.ts` merges `.dev.vars` into the test env; this becomes redundant and can be removed entirely.
- `.env` currently contains a typo: `SUPABASE_SERIVCE_KEY` (letters transposed). The correct name used everywhere else is `SUPABASE_SERVICE_KEY`. Fix the typo while merging.
- `.gitignore` lists `.dev.vars` twice — both entries must be removed.

## What We're NOT Doing

- Not changing any application code, API routes, or Astro env schema.
- Not renaming `.env.dev` (Wrangler doesn't support that filename; consolidation into `.env` is the chosen approach).
- Not updating historical context/archive documents — those are immutable records.
- Not changing CI secrets or Wrangler production secrets (`wrangler secret put` is unaffected).

## Implementation Approach

Two phases in dependency order: merge the files first (Phase 1), then update all references once the source-of-truth is settled (Phase 2).

---

## Phase 1: Consolidate environment files

### Overview

Move the three `.dev.vars`-only vars into `.env` and `.env.example`, fix the pre-existing typo, then delete both `.dev.vars` files.

### Changes Required

#### 1. `.env` — add missing vars and fix typo

**File**: `.env`

**Intent**: Bring the three vars currently only in `.dev.vars` (`SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `SENTRY_DSN`) into `.env` so Wrangler picks them up natively. Also rename the existing `SUPABASE_SERIVCE_KEY` (typo) to `SUPABASE_SERVICE_KEY`.

**Contract**: Add a clearly commented section at the bottom of `.env` with the three new vars. Remove the `SUPABASE_SERIVCE_KEY` typo'd line and replace with the correctly spelled `SUPABASE_SERVICE_KEY` (copy the value across). Copy actual values from `.dev.vars` before deleting it.

#### 2. `.env.example` — document the new vars

**File**: `.env.example`

**Intent**: Keep the committed onboarding template in sync so new contributors know about the three vars that are now required.

**Contract**: Add the following block after the existing vars (placeholder values, with a comment noting these are also used by `wrangler dev`):

```dotenv
# Wrangler runtime (also read by wrangler dev from .env)
SUPABASE_SERVICE_KEY=your-service-role-key-here
DATABASE_URL=postgresql://postgres.[project-ref]:[DB_PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
SENTRY_DSN=https://...@....ingest.sentry.io/...
```

#### 3. Delete `.dev.vars`

**File**: `.dev.vars`

**Intent**: Remove the local secrets file that is being superseded by `.env`.

**Contract**: `rm .dev.vars`. Verify you have already copied all values to `.env` before deleting.

#### 4. Delete `.dev.vars.example`

**File**: `.dev.vars.example`

**Intent**: Remove the committed onboarding template for the now-deleted file.

**Contract**: `rm .dev.vars.example`. Its vars now live in `.env.example`.

### Success Criteria

#### Automated Verification

- No `.dev.vars` files exist: `ls .dev.vars .dev.vars.example 2>&1 | grep 'No such file'`
- `.env` contains all three new vars: `grep -E 'SUPABASE_SERVICE_KEY|^DATABASE_URL=|SENTRY_DSN' .env | wc -l` → 3
- `SUPABASE_SERIVCE_KEY` (typo) is gone: `grep SERIVCE .env` → no output

#### Manual Verification

- Open `.env` and confirm all values (including the three new ones) are filled in with real credentials.

**Implementation Note**: Pause here before Phase 2. Confirm the file merge looks correct.

---

## Phase 2: Update all references

### Overview

Remove every reference to `.dev.vars` from code and documentation now that the file no longer exists.

### Changes Required

#### 1. `vitest.config.ts` — remove the `.dev.vars` merge block

**File**: `vitest.config.ts`

**Intent**: The 14-line block (lines 11–25) that merged `.dev.vars` into the test environment is now dead code since all vars are in `.env`, which is already loaded via `loadEnv`.

**Contract**: Delete lines 2 (`import { existsSync, readFileSync } from "node:fs";`) and 11–25 (the `if (existsSync(".dev.vars"))` block). Keep `loadEnv` and the rest of the config unchanged.

#### 2. `.gitignore` — remove both `.dev.vars` entries

**File**: `.gitignore`

**Intent**: The file no longer exists; its two entries are dead.

**Contract**: Remove the `# environment variables` section line `.dev.vars` (line 22) and the `# cloudflare` section line `.dev.vars` (line 25). No other lines change.

#### 3. `CLAUDE.md` — update three references

**File**: `CLAUDE.md`

**Intent**: Developer documentation should reflect the single-file setup.

**Contract**: Three updates:
1. `npm run dev` note: remove "does not read `.dev.vars`" and replace with "does not read `.env` for Worker runtime" (or simply remove the `.dev.vars` mention).
2. Env vars section: replace "copy `.dev.vars.example` to `.dev.vars` (gitignored) for Cloudflare local dev" → "`.env` (gitignored) covers both Node tooling and Cloudflare local dev; copy `.env.example` to `.env` and fill in all values."
3. Cloudflare local dev note: replace "secrets go in `.dev.vars` (gitignored); `wrangler dev` reads this file automatically" → "secrets go in `.env` (gitignored); `wrangler dev` reads `.env` automatically."

#### 4. `AGENTS.md` — update two references

**File**: `AGENTS.md`

**Intent**: Agent documentation must match the new single-file model.

**Contract**: Two updates:
1. `DATABASE_URL` entry: replace "Set in `.dev.vars` for `wrangler dev`" → "Set in `.env` for `wrangler dev`".
2. Env model note: replace "Local Astro/Supabase env uses `.env`; Cloudflare local dev uses `.dev.vars`; both need …" → "Both local Node tooling and Cloudflare local dev use `.env`; it must contain …".

#### 5. `README.md` — update three references

**File**: `README.md`

**Intent**: Onboarding instructions should tell contributors to create one file, not two.

**Contract**: Three updates — wherever README instructs the contributor to copy `.dev.vars.example` → `.dev.vars`, replace with a note that `.env.example` → `.env` covers all vars including Wrangler secrets. Remove the separate step for `.dev.vars` entirely.

#### 6. `context/foundation/infrastructure.md` — update vendor-lock-in note

**File**: `context/foundation/infrastructure.md`

**Intent**: The infrastructure doc notes that both `.dev.vars` and `wrangler secret put` must be populated; update to reference `.env`.

**Contract**: Replace "Both `.dev.vars` (local dev) and `wrangler secret put` (production)" → "Both `.env` (local dev) and `wrangler secret put` (production)".

### Success Criteria

#### Automated Verification

- No `.dev.vars` references in any tracked file: `git grep -l 'dev\.vars' -- ':!context/archive/' ':!context/changes/dev-vars-rename/change.md'` → no output
- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification

- `npm run dev` (wrangler dev) starts without "Missing binding" or undefined-var errors — auth and static pages load correctly.
- Fresh-clone simulation: copy `.env.example` to a temp file, verify all required var names are present (SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY, DATABASE_URL, DATABASE_URL_DIRECT, SENTRY_DSN, SENTRY_AUTH_TOKEN, E2E_USER_EMAIL, E2E_USER_PASSWORD).

---

## Testing Strategy

### Manual Testing Steps

1. After Phase 1: run `wrangler dev` (or `npm run dev`) and sign in — confirms Wrangler reads vars from `.env`.
2. After Phase 2: run `npm test` — confirms vitest no longer needs `.dev.vars`.
3. Check `.env.example` covers every var name the app declares in `astro.config.mjs` env schema.

## References

- Roadmap: S-10 `dev-vars-rename` in `context/foundation/roadmap.md`
- Wrangler local dev docs: https://developers.cloudflare.com/workers/configuration/secrets/
- `vitest.config.ts` `.dev.vars` merge block: lines 11–25

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Consolidate environment files

#### Automated

- [x] 1.1 `.dev.vars` files deleted: `ls .dev.vars .dev.vars.example 2>&1 | grep 'No such file'` — 3a73792
- [x] 1.2 `.env` contains 3 new vars: `grep -E 'SUPABASE_SERVICE_KEY|^DATABASE_URL=|SENTRY_DSN' .env | wc -l` → 3 — 3a73792
- [x] 1.3 Typo `SUPABASE_SERIVCE_KEY` removed from `.env`: `grep SERIVCE .env` → no output — 3a73792

#### Manual

- [x] 1.4 Open `.env` and confirm all values (including the three new ones) are filled in with real credentials — 3a73792

### Phase 2: Update all references

#### Automated

- [x] 2.1 No `.dev.vars` references in tracked files: `git grep -l 'dev\.vars' -- ':!context/archive/' ':!context/changes/dev-vars-rename/change.md'` → no output
- [x] 2.2 Build passes: `npm run build`
- [x] 2.3 Lint passes: `npm run lint`
- [x] 2.4 Tests pass: `npm test`

#### Manual

- [x] 2.5 `npm run dev` starts without missing-var errors; auth and static pages load
- [x] 2.6 `.env.example` contains all required var names (verify against `astro.config.mjs` env schema)
