---
date: 2026-07-03T15:46:38+0200
researcher: Bartosz Oliwa
git_commit: 6921c87c58eed18e682245153e287bc399252cf5
branch: main
repository: 10x-devs-urlopy
topic: "CI/CD AI code review — GHA workflow + composite action driving the code-reviewer package"
tags: [research, codebase, ci-cd, github-actions, code-reviewer, ai-sdk, composite-action]
status: complete
last_updated: 2026-07-03
last_updated_by: Bartosz Oliwa
---

# Research: CI/CD AI Code Review (GHA + composite action)

**Date**: 2026-07-03T15:46:38+0200
**Researcher**: Bartosz Oliwa
**Git Commit**: 6921c87c58eed18e682245153e287bc399252cf5
**Branch**: main
**Repository**: 10x-devs-urlopy

## Research Question

Given the expectations in `context/changes/ci-cd-code-review/requirements.md`, how do we build a GitHub Actions workflow (plus a composite action) that reviews every pull request to the default branch using the existing `@10xdevs/code-reviewer` package, scores the change on 6 criteria (1–10), posts a summary PR comment, and applies `ai-cr:passed` / `ai-cr:failed` labels — with an on-demand retry when the `ai-cr:review` label is added?

## Summary

The heavy lifting — an AI reviewer built on the Vercel AI SDK v6 `ToolLoopAgent` + OpenRouter + zod — **already exists** as a standalone package at `packages/code-reviewer`. But it is shaped for a *different* job than the requirements describe, and there is **zero** GitHub-Actions / PR-integration machinery in the repo today. The work splits into four tracks:

1. **AI package gap (largest design delta).** Today the package reviews a **single code snippet** (`reviewCode(code)`) and returns **severity-tagged findings** (`{summary, findings[{severity, line, issue, suggestion}]}`). The requirements want it to consume a **PR (title + description + diff)** and return a **6-criteria 1–10 score** (Implementation, Idiomaticity, Complexity, Test/risk coverage, Documentation, Security) plus a **pass/fail verdict** that drives the label. This needs a new schema, a new prompt, and — critically — a **real CLI entry point** (today's `cli.ts` only reviews a hardcoded sample and parses no args/stdin).

2. **Monorepo wiring.** The root repo is **not an npm workspace**; `packages/code-reviewer` is fully standalone with its own lockfile and pinned deps (`ai@6`, `zod@4`, `tsx`, `typescript@6`). The action must `cd packages/code-reviewer && npm ci` — a root `npm ci` will *not* install the reviewer.

3. **GHA composite action plumbing.** A local composite action (`.github/actions/<name>/action.yml`, `runs.using: "composite"`) fed by the thin workflow. Composite actions **cannot read `secrets`** — the OpenRouter key and GITHUB_TOKEN must be passed as **inputs**. Triggers: `types: [opened, synchronize, reopened, labeled]` with an `if:` guard so `labeled` only fires the review for `ai-cr:review` (and does not self-loop on its own `ai-cr:passed/failed` writes). Sticky PR comment via `actions/github-script@v7` + a hidden `<!-- ai-cr -->` marker. Labels via `gh`/github-script, pre-created with fixed colors.

4. **Fork-PR & secrets security (the load-bearing decision).** On plain `pull_request`, fork PRs get **no secrets** (OpenRouter key is empty) and a **read-only** token (comment/label writes fail). The reviewer only needs the diff as *passive data* and never executes PR code, which makes `pull_request_target` (secrets + write token, **no checkout of PR head**, diff via `gh pr diff`) the pragmatic safe pattern — *if* fork PRs must be supported. If the repo stays private/no-forks, plain `pull_request` is simplest and sufficient.

## Detailed Findings

### Track 1 — AI package gap (`packages/code-reviewer`)

The reusable, schema-validated surface already exists; only the **input shape**, **output schema**, and **CLI plumbing** must change.

**What exists today:**
- Entry API: `reviewCode(code: string, { model?, language? }): Promise<ReviewResult>` — `packages/code-reviewer/src/agent.ts:68`. Builds a fenced prompt from a raw code string via `buildReviewPrompt(code)` — `packages/code-reviewer/src/prompts/review.ts:18`.
- Output schema (`packages/code-reviewer/src/models/review.ts:11-25`):
  - `ReviewResult = { summary: string, findings: ReviewFinding[] }`
  - `ReviewFinding = { severity: "info"|"minor"|"major"|"critical", line: number|null, issue: string, suggestion: string }`
- Agent wiring (`packages/code-reviewer/src/agent.ts:40-56`): `ToolLoopAgent` (tool-less, single structured round-trip) with `instructions: SYSTEM_INSTRUCTIONS`, `output: Output.object({ schema: ReviewResult })`, `callOptionsSchema: { language? }`, and `prepareCall` injecting the language hint into instructions.
- System prompt (`packages/code-reviewer/src/prompts/review.ts:12-15`): "senior software engineer performing a focused code review… correctness bugs, security issues, clear simplifications." — a **findings** persona, not a **scoring** persona.
- Default model `anthropic/claude-sonnet-5` via OpenRouter (`packages/code-reviewer/src/agent.ts:21`), overridable by `OPENROUTER_MODEL`.
- Barrel `src/index.ts:11-19` re-exports `reviewCode`, `createCodeReviewer`, `codeReviewer`, `ReviewResult`, `ReviewFinding`, prompts — side-effect-free, safe to import.

**The gap vs. requirements** (`requirements.md:6-32`):

| Dimension | Today | Required |
|---|---|---|
| Input | one `code` string snippet | PR **title** + **description** + **git diff** (`requirements.md:8-10`) |
| Output | free-form `findings[]` by severity | **6 criteria** each scored **1–10** with justification (`requirements.md:14-32`) |
| Verdict | none | **pass/fail** to drive `ai-cr:passed`/`ai-cr:failed` label |
| Prompt | "find bugs/security/simplifications" | rubric-based scoring per the 6 definitions in `requirements.md:16-32` |
| CLI | reviews a **hardcoded sample**, no args (`packages/code-reviewer/src/cli.ts:23-31`) | read title/body/diff (args/stdin/env), emit machine-readable result |

**Implied new shape** (design, to be settled in `/10x-frame` / `/10x-plan`):
- New zod schema, e.g. `PrReviewResult = { summary, scores: { implementation, idiomaticity, complexity, testCoverage, documentation, security } (each 1–10 + justification), verdict: "passed"|"failed" }`. Reuse the existing `models/`+`prompts/` module split (per the tool-loop-agent refactor) rather than overloading the snippet path.
- New prompt builder `buildPrReviewPrompt(title, description, diff)`. The requirements already flag description as a **cost tradeoff** (`requirements.md:9`) — diffs + descriptions are far larger than the current snippet, so token/cost sizing matters.
- New CLI entry (or a `--mode pr` flag on a real arg parser) reading the diff from a file/stdin and title/body from env/args, printing JSON (for the action to parse into comment + label) and/or setting an exit code.

**Open design decisions (surface, don't pre-decide):**
- **Pass/fail rule.** Requirements give per-criterion 1–10 anchors but **no threshold**. Options: any criterion below N ⇒ fail; weighted average below N ⇒ fail; hard-gate Security/Implementation. Needs a decision.
- **Keep findings too?** The 6-criteria score is a summary; actionable inline findings (the current model) are complementary. Could emit both.
- **Where the verdict is computed** — inside the model output (`verdict` field) vs. derived in TS from the scores (more deterministic/testable). Deriving in TS is more controllable and unit-testable.

### Track 2 — Monorepo wiring & CLI invocation

- **Root is not a workspace.** `package.json` has no `workspaces`, `engines`, or `packageManager` key (`package.json:1-97`). No Turbo/Nx/pnpm/lerna. So `packages/code-reviewer` is *only* physically nested; nothing wires it into the root install.
- **`packages/code-reviewer` is standalone**: own `package.json` (`@10xdevs/code-reviewer`, `"private": true`, `engines.node >=20.11` — `packages/code-reviewer/package.json:7-9`), own tracked `package-lock.json`, own `node_modules`. Its deps (`ai@^6.0.217`, `@openrouter/ai-sdk-provider@^2.10.0`, `zod@^4.4.3`, dev `tsx`/`typescript@^6`) are absent from root.
- **Install must be scoped**: `cd packages/code-reviewer && npm ci`. A root `npm ci` installs only root deps and leaves the reviewer non-runnable. Node 20.11+ requirement is satisfied by the CI runner's Node 22 (`.github/workflows/ci.yml:16-19`).
- **Run command**: `npm start` → `tsx --env-file-if-exists=.env src/cli.ts` (`packages/code-reviewer/package.json:11`). The `--env-file-if-exists` flag means in CI you just export `OPENROUTER_API_KEY` and skip a `.env` file (`packages/code-reviewer/README.md:40-43`).
- **Standalone-script precedent** in the repo: root scripts `seed:admin` and `digest` (`package.json:20-21`) run `tsx scripts/*.ts`. Convention (documented in both file headers): **do not import `@/lib/...` or `@/db/...`** from these scripts — those read `astro:env/server`, which only resolves inside the Worker; build clients inline from `process.env` (`scripts/seed-admin.ts:8-11`, `scripts/team-digest.ts:14-16`). The reviewer already follows this (env-driven, no app imports).
- Env-loading nuance: root scripts call `process.loadEnvFile()` (seed-admin unguarded `scripts/seed-admin.ts:48`; team-digest wrapped in try/catch `scripts/team-digest.ts:392-396`), whereas the reviewer uses tsx's `--env-file-if-exists` — both are CI-safe when the var is exported.

### Track 3 — GHA composite action plumbing

- **Composite action anatomy**: `.github/actions/ai-review/action.yml` with `runs.using: "composite"`, `inputs`, `outputs` wired from `steps.<id>.outputs.*`, and `steps` where every `run:` step **must** declare `shell:`. Composite steps may call other actions (e.g. `actions/github-script@v7`). Referenced from the workflow as `uses: ./.github/actions/ai-review` **after** the action code is checked out. ([Creating a composite action](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action))
- **⚠️ Composite actions cannot read `secrets`.** No `secrets.*` context inside a composite action — pass `OPENROUTER_API_KEY` and the GitHub token as **inputs**, then re-expose via step-level `env:`. ([github/docs#12705](https://github.com/github/docs/issues/12705), [actions/runner#1557](https://github.com/actions/runner/issues/1557)). Inputs are plain strings (not auto-masked) — don't log them.
- **Triggers** — the `pull_request`/`pull_request_target` default types (`opened, synchronize, reopened`) are **replaced**, not extended, when `types:` is set, so list all four including `labeled`:
  ```yaml
  types: [opened, synchronize, reopened, labeled]
  branches: [main]
  ```
- **Retry guard** (also prevents a self-trigger loop, because the action itself adds labels):
  ```yaml
  if: >-
    (github.event.action != 'labeled') ||
    (github.event.action == 'labeled' && github.event.label.name == 'ai-cr:review')
  ```
- **PR data**: title/body come free from the payload (`github.event.pull_request.title` / `.body`). **Diff: use `gh pr diff <number> --patch`** (needs `GH_TOKEN`) — it resolves from the PR number via API regardless of what's checked out, sidestepping the `labeled`-event stale-SHA caveat that a `git diff` after checkout would hit.
- **Sticky comment**: `actions/github-script@v7` — `issues.listComments` → find a comment containing `<!-- ai-cr -->` → `issues.updateComment` else `issues.createComment` (PR comments are issue comments; `context.issue.number` = PR number). `gh pr comment --edit-last --create-if-none` is a simpler alternative if this workflow is the only commenter.
- **Labels**: pre-create once with fixed colors — `gh` errors if a label doesn't exist and neither `gh` nor github-script sets color at add-time:
  ```bash
  gh label create "ai-cr:passed" --color 2ea44f --force
  gh label create "ai-cr:failed" --color d73a4a --force
  gh label create "ai-cr:review" --color 0075ca --force
  ```
  Swap via `gh pr edit "$PR" --add-label ai-cr:passed --remove-label ai-cr:failed`, and clear the trigger with `--remove-label ai-cr:review`. **⚠️ `removeLabel` 404s if the label isn't present** ([REST labels](https://docs.github.com/en/rest/issues/labels)) — wrap github-script `removeLabel` in try/catch swallowing 404, or use `gh pr edit --remove-label` (no-ops instead of failing).
- **Permissions** (allowlist — unlisted scopes become `none`):
  ```yaml
  permissions:
    contents: read
    pull-requests: write   # PR comments, gh pr diff/edit
    issues: write          # labels live under the issues API
  ```
  Explicit block makes the workflow independent of the repo's default-token setting ([Controlling permissions for GITHUB_TOKEN](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token)).

### Track 4 — Fork-PR & secrets security (decision fork)

- **Plain `pull_request` breaks on forks**: (1) secrets aren't passed to fork-triggered runs → `secrets.OPENROUTER_API_KEY` is **empty** ([Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)); (2) fork PRs always get a **read-only** `GITHUB_TOKEN`, so `pull-requests: write`/`issues: write` are silently downgraded and comment/label writes fail ([changelog 2021-04-20](https://github.blog/changelog/2021-04-20-github-actions-control-permissions-for-github_token/)).
- **`pull_request_target`** runs in the **base-repo context with full secrets and a write token**, and by default checks out the **base ref** (not PR head). The "pwn request" danger is checking out and **executing** PR head code (build/install/tests) in that privileged context ([Security Lab: Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)).
- **Safe pattern for this reviewer** (treats the PR as passive data, never executes it): `pull_request_target` + `types:[opened, synchronize, reopened, labeled]`, **no `actions/checkout` of the PR head**, get the diff via `gh pr diff <number>`, pass title/body/diff to the CLI **only as data** (stdin/args/env). Route `pull_request.title`/`.body` through intermediate `env:` vars — never interpolate them into a `run:` shell line (script-injection hardening, [secure-use](https://docs.github.com/en/actions/reference/security/secure-use)).
- **⚠️ Snag**: under `pull_request_target`, `uses: ./.github/actions/ai-review` needs the action code present — check out only the **base** repo's trusted copy (default base-ref checkout is safe) or move the write side-effects into an inline `github-script` step. Never checkout PR head to obtain the action.
- **Decision axis**: If the repo is private / no external forks (**likely here** — `oliwabartosz/10x-devs-urlopy`, a solo course project), plain `pull_request` is the simplest correct choice and the fork restrictions don't apply. Adopt `pull_request_target`-without-checkout only if/when external fork PRs must be reviewed.

## Code References

- `packages/code-reviewer/src/agent.ts:21` — `DEFAULT_MODEL = "anthropic/claude-sonnet-5"` (OpenRouter).
- `packages/code-reviewer/src/agent.ts:40-56` — `createCodeReviewer()` `ToolLoopAgent` wiring (`Output.object`, `callOptionsSchema`, `prepareCall`).
- `packages/code-reviewer/src/agent.ts:68-77` — `reviewCode(code, options)` reusable entry (snippet-in, `ReviewResult`-out).
- `packages/code-reviewer/src/models/review.ts:11-25` — current findings-based schema (to be extended/replaced for 6-criteria scoring).
- `packages/code-reviewer/src/prompts/review.ts:12-19` — `SYSTEM_INSTRUCTIONS` + `buildReviewPrompt(code)` (findings persona; needs a scoring variant).
- `packages/code-reviewer/src/cli.ts:13-48` — demo-only entry: hardcoded sample, **no arg/stdin parsing** (the CLI gap).
- `packages/code-reviewer/package.json:7-13` — `engines.node >=20.11`, `start`/`dev` = `tsx --env-file-if-exists=.env`.
- `packages/code-reviewer/.env.example:2` — `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`).
- `package.json:1-97` — root manifest: **no `workspaces`**; standalone-script precedent `seed:admin`/`digest` at `:20-21`.
- `scripts/team-digest.ts:208-256` — closest in-repo precedent for external-signal calls: `gh` subprocess (CI read, `:208-229`) and `fetch(... Authorization: Bearer <env token> ...)` with try/catch graceful degradation (Sentry, `:231-256`).
- `scripts/seed-admin.ts:8-11` / `scripts/team-digest.ts:14-16` — rule: standalone scripts must not import `@/lib`/`@/db` (Worker-only `astro:env`).
- `.github/workflows/ci.yml:1-97` — existing CI: Node 22, PR-triggered `ci` job with **no `permissions:` block** and **no `pull-requests: write`**; secrets via step-level `env:`; fork-secret caveat noted at `:50`.
- `context/changes/ci-cd-code-review/requirements.md:1-47` — the spec this research answers.

## Architecture Insights

- **The reviewer is already the right *engine*, wrong *shape*.** The tool-loop-agent refactor deliberately produced a reusable `reviewCode()` + `createCodeReviewer()` surface "so further features build on" it (`packages/code-reviewer/README.md:6`). This feature is that "further feature": extend the schema/prompt/CLI, don't rebuild the agent.
- **Two independent installs.** CI already installs the *app* (root `npm ci`) for lint/build; the reviewer needs a *second, scoped* install in its subdir. Keep them separate — different lockfiles, different pinned toolchains (root `typescript@5.9`, reviewer `typescript@6`).
- **This feature introduces the repo's first GitHub-API writes.** No `octokit`/`@actions/*`/`github-script`/`GITHUB_TOKEN` exists in shippable code today — the PR-comment/label code is greenfield. The Sentry `fetch(...Bearer...)` block in `team-digest.ts` is the closest stylistic template; the `gh`-subprocess CI reader assumes an interactive-authed `gh` (not a CI token) and is a weaker model.
- **Thin workflow, fat composite action.** Requirements explicitly want the composite action to own the review so the workflow "is easy to reason about" (`requirements.md:4`). Map: workflow = triggers + `if:` guard + permissions + checkout + `gh pr diff`; composite action = install reviewer, run CLI, upsert comment, swap labels.
- **Determinism > model self-report for the verdict.** Prefer deriving pass/fail in TypeScript from the numeric scores (unit-testable, threshold in one place) over trusting a model-emitted `verdict` field.

## Historical Context (from prior changes)

- `context/changes/tool-loop-agent/plan.md:1-273` — built the current modular reviewer (models/prompts/agent/barrel/cli) on `ToolLoopAgent`. Explicitly **out of scope**: adding tools, promptfoo evals, provider/model/dep changes (`plan.md:44-51`). Landed across commits `a372156`, `2863dd8`, `3f4c1c9`, `fcd04af`, `6921c87`.
- `context/changes/tool-loop-agent/plan-brief.md` — "clean export surface … that promptfoo can wrap for evals later" — signals an intended eval path this feature could eventually feed.
- `context/changes/team-status-digest/` (commit `936ce7d`) — produced `scripts/team-digest.ts`, the only existing "external CI + Sentry signals" code; establishes the env-driven, graceful-degradation subprocess/`fetch` pattern but **no reusable GitHub-API/PR-comment client**.
- `context/foundation/lessons.md` — single current lesson is about Astro-component prop-threading; not directly applicable to this CI/CLI feature.

## Related Research

- None prior for CI/CD code review. This is the first `research.md` under `context/changes/ci-cd-code-review/`. Nearest kin: `context/changes/tool-loop-agent/plan.md` (the engine) and `context/changes/team-status-digest/` (external-signal pattern).

## Open Questions

1. **Pass/fail threshold** over the 6 scores — per-criterion floor, weighted average, or security/implementation hard-gate? (`requirements.md` defines anchors but no cutoff.)
2. **Trigger event** — plain `pull_request` (simplest; fine for a private/no-fork repo) vs. `pull_request_target`-without-checkout (needed only if external fork PRs must be reviewed). Confirm the repo's fork exposure.
3. **Include PR description in the prompt?** Requirements flag it as a cost tradeoff (`requirements.md:9`) — decide whether the accuracy gain justifies the extra tokens on large descriptions, and whether to cap diff size.
4. **Keep findings alongside scores?** Emit the 6-criteria score only, or also actionable inline findings (the current model) in the comment.
5. **Verdict location** — model-emitted field vs. TS-derived from scores (recommended: TS-derived for testability).
6. **Comment mechanism** — `github-script@v7` marker-upsert (precise, multi-commenter-safe) vs. `gh pr comment --edit-last` (simpler). Lean github-script for determinism.
7. **CLI I/O contract** — how the action feeds title/body/diff (stdin vs. args vs. files) and what the CLI emits (JSON for the action to render + exit code). This is the concrete integration seam to lock before implementation.
8. **Cost/model** — stay on `anthropic/claude-sonnet-5` for full-diff PR reviews, or allow a cheaper model via `OPENROUTER_MODEL` for large PRs?
