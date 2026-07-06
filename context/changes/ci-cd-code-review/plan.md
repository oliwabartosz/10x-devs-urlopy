# CI/CD AI Code Review (GHA + Composite Action) Implementation Plan

## Overview

Wire the existing `@10xdevs/code-reviewer` package into GitHub Actions so that every pull request targeting `main` gets an AI review: six criteria scored 1–10 with justifications, actionable findings, a deterministic pass/fail verdict, a sticky PR comment, and `ai-cr:passed` / `ai-cr:failed` labels — with on-demand retry when the `ai-cr:review` label is added.

## Current State Analysis

- The review **engine exists**: `packages/code-reviewer` is a standalone package (own lockfile, `ai@6` + `@openrouter/ai-sdk-provider` + `zod@4`) exposing `reviewCode(code)` via a tool-less `ToolLoopAgent` with structured output (`packages/code-reviewer/src/agent.ts:40-77`).
- But it is shaped for a **different job**: input is a single code snippet, output is severity-tagged findings (`packages/code-reviewer/src/models/review.ts:11-25`), the persona is "find bugs" not "score a rubric" (`packages/code-reviewer/src/prompts/review.ts:12-15`), and `cli.ts` only reviews a hardcoded sample with no arg/stdin parsing (`packages/code-reviewer/src/cli.ts:23-31`).
- The root repo is **not an npm workspace** (`package.json` has no `workspaces`); the reviewer needs its own scoped `npm ci`.
- There is **zero GitHub-API write machinery** in the repo today — no octokit, no `@actions/*`, no PR comment/label code. The existing CI (`.github/workflows/ci.yml`) runs lint/build on `pull_request` with no `permissions:` block.
- The package has **no test runner** — verdict/truncation/render logic added by this plan needs one (Node's built-in `node:test` via the already-present `tsx`).

## Desired End State

Opening or updating a PR against `main` triggers a workflow that: fetches the PR title/body/diff, runs the reviewer CLI, posts (or updates in place) a single comment containing the summary, a 6-criteria score table with justifications, the verdict, and itemized findings, and swaps the `ai-cr:passed`/`ai-cr:failed` label. Adding the `ai-cr:review` label re-runs the review on demand. The workflow check is always green when the review completes; the verdict lives only in the label and comment.

Verify by: opening a test PR and observing comment + label; pushing a commit and observing the comment update in place; adding `ai-cr:review` and observing a re-run that removes the trigger label.

### Key Discoveries:

- `reviewCode()` / `createCodeReviewer()` were deliberately built as a reusable surface for "further features" (`packages/code-reviewer/README.md:6`) — this feature extends the schema/prompt/CLI, it does not rebuild the agent.
- Composite actions **cannot read `secrets.*`** — the OpenRouter key and GitHub token must be passed as action `inputs` (research.md Track 3).
- Setting `types:` on `pull_request_target` **replaces** the defaults — all four of `opened, synchronize, reopened, labeled` must be listed explicitly.
- The action itself writes labels, so the `labeled` trigger needs an `if:` guard restricted to `ai-cr:review` or it self-loops.
- `gh pr diff <number>` resolves the diff via the API regardless of checkout state — this sidesteps both the `labeled`-event stale-SHA problem and the need to ever check out the PR head.
- GitHub's `removeLabel` API 404s when the label is absent; `gh pr edit --remove-label` no-ops instead — use `gh` for label swaps.
- Standalone-script convention: never import `@/lib`/`@/db` (Worker-only `astro:env`) — the reviewer already complies (env-driven, no app imports).

## What We're NOT Doing

- **No merge gating** — the workflow check is always green when the review completes; the verdict is advisory (label + comment only). No branch-protection requirement on this check.
- **No inline diff annotations** (line-level PR review comments via the reviews API) — findings go in the summary comment body.
- **No business-alignment or architectural-fit criteria** (parked in `requirements.md:34-37`).
- **No promptfoo evals** — the schema split keeps that door open, same as the tool-loop-agent change.
- **No npm-workspace conversion** of the root repo.
- **No changes to the existing `ci.yml`** — the AI review is a separate workflow file.
- **No fork-PR head-code execution** — the PR is treated strictly as passive data.

## Implementation Approach

Thin workflow, fat composite action (per `requirements.md:4`). Four phases, each independently verifiable:

1. Extend the package with a PR-shaped review engine (schema, prompt, agent entry, deterministic verdict) + a test runner.
2. Turn `cli.ts` into a real CLI: env/stdin in, JSON out, diff truncation, meaningful exit codes.
3. Build the composite action: scoped install, fetch PR data, run CLI, render markdown, upsert sticky comment, swap labels.
4. Add the `pull_request_target` workflow with trigger guards, explicit permissions, and idempotent label bootstrap; verify end-to-end on a real PR.

Decisions locked during planning:

- **Verdict rule**: per-criterion floor — **fail if any of the six scores is below 5**; computed in TypeScript, not model-emitted.
- **Trigger**: `pull_request_target` with **no PR-head checkout ever** (diff via `gh pr diff`); fork PRs get reviewed safely.
- **Prompt input**: title + full description + diff **capped at 100,000 characters** with an explicit truncation note.
- **Comment content**: summary + 6-criteria score table + verdict + itemized findings.
- **Model**: keep `anthropic/claude-sonnet-5` default, overridable via action input → `OPENROUTER_MODEL`.
- **Check status**: job succeeds whenever the review completes; only infrastructure errors (missing key, model/API failure) fail the job.

## Critical Implementation Details

- **`pull_request_target` safety invariant**: the workflow runs with secrets and a write token. The ONLY checkout permitted is the default base-ref checkout (needed to load `./.github/actions/ai-review`). Never add a checkout of `github.event.pull_request.head.*` — that is the pwn-request vulnerability. The PR content enters only as data: `gh pr diff` / `gh pr view --json` output.
- **Script-injection hardening**: PR title and body are attacker-controlled. Never interpolate `${{ github.event.pull_request.title }}` (or `.body`) into a `run:` line. Fetch them with `gh pr view "$PR" --json title,body` and pass to the CLI via env vars / files only.
- **Composite action secrets**: `secrets.*` context does not exist inside a composite action. `openrouter-api-key` and `github-token` arrive as inputs; inputs are NOT auto-masked — never echo them.
- **Self-loop guard ordering**: the action adds `ai-cr:passed`/`ai-cr:failed` labels, which fires `labeled` events; the workflow-level `if:` must allow `labeled` only when `github.event.label.name == 'ai-cr:review'`. The action must also remove `ai-cr:review` at the end of each run so the next add re-triggers.
- **Two installs, two lockfiles**: root `npm ci` does not install the reviewer. The action must run `npm ci` with `working-directory: packages/code-reviewer`; if caching npm, key on `packages/code-reviewer/package-lock.json`.

## Phase 1: PR Review Engine (package)

### Overview

Extend `packages/code-reviewer` with the PR-shaped input, 6-criteria scoring schema, scoring prompt, agent entry point, and a deterministic verdict function — plus the package's first unit tests.

### Changes Required:

#### 1. PR review schema

**File**: `packages/code-reviewer/src/models/pr-review.ts` (new)

**Intent**: Define the structured output the model must produce for a PR review, reusing the existing findings shape so the comment can show both scores and actionable items.

**Contract**: Exports `CriterionScore = z.object({ score: int 1–10, justification: string })` and `PrReviewResult = z.object({ summary: string, scores: { implementation, idiomaticity, complexity, testCoverage, documentation, security } (each CriterionScore), findings: z.array(ReviewFinding) })`. `ReviewFinding` is imported from `./review.js`. The verdict is deliberately **not** part of the model output schema.

#### 2. Verdict derivation

**File**: `packages/code-reviewer/src/verdict.ts` (new)

**Intent**: Compute pass/fail deterministically from the six scores so the threshold is unit-testable and lives in one place.

**Contract**: `export const PASS_FLOOR = 5` and `deriveVerdict(scores: PrReviewResult["scores"]): "passed" | "failed"` — returns `"failed"` iff any criterion score `< PASS_FLOOR`. Pure function, no I/O.

#### 3. Scoring prompt

**File**: `packages/code-reviewer/src/prompts/pr-review.ts` (new)

**Intent**: A rubric-scoring persona and user-prompt builder for PR input, separate from the findings persona in `prompts/review.ts` (same versionable/eval-friendly split).

**Contract**: `PR_REVIEW_INSTRUCTIONS` (system prompt embedding the six criteria definitions and their 1/10 anchors verbatim from `requirements.md:16-32`, instructing the model to also report actionable findings) and `buildPrReviewPrompt(input: { title: string; description: string; diff: string; truncated: boolean }): string` — when `truncated` is true the prompt states the diff was cut at the budget so the model doesn't penalize "incomplete" changes.

#### 4. PR reviewer agent entry

**File**: `packages/code-reviewer/src/pr-agent.ts` (new)

**Intent**: Mirror the `agent.ts` pattern (create-function + singleton + ergonomic wrapper) for the PR review mode.

**Contract**: `createPrReviewer({ model? })` — a `ToolLoopAgent` with `output: Output.object({ schema: PrReviewResult })` and `instructions: PR_REVIEW_INSTRUCTIONS`; model resolution identical to `createCodeReviewer` (config → `OPENROUTER_MODEL` → `DEFAULT_MODEL`). `reviewPr(input: PrReviewInput, options?: { model?: string }): Promise<PrReviewResult>`. No language-hint `callOptionsSchema` needed for this mode.

#### 5. Barrel exports

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Re-export the new surface (`reviewPr`, `createPrReviewer`, `PrReviewResult`, `CriterionScore`, `deriveVerdict`, `PASS_FLOOR`, PR prompts) alongside the existing snippet API, keeping the barrel side-effect-free.

**Contract**: Additive exports only; existing exports unchanged.

#### 6. Test runner + verdict tests

**File**: `packages/code-reviewer/package.json`, `packages/code-reviewer/src/verdict.test.ts` (new)

**Intent**: Introduce the package's first unit tests using Node's built-in `node:test` through the already-present `tsx` — no new test framework dependency.

**Contract**: A `"test"` script that runs `node:test` over `src/**/*.test.ts` via the tsx loader. Verdict tests cover: all 5s → passed, one 4 → failed, all 10s → passed, boundary (exactly 5 everywhere) → passed.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `cd packages/code-reviewer && npm test`
- Type checking passes: `cd packages/code-reviewer && npx tsc --noEmit`

#### Manual Verification:

- With `OPENROUTER_API_KEY` set, an ad-hoc `reviewPr()` call against a small sample (title/description/diff) returns a schema-valid result with all six scores populated and sensible justifications

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: CLI Contract

### Overview

Replace the demo-only `cli.ts` with a real PR-review CLI: title/body from env, diff from stdin, truncation at the budget, JSON to stdout, exit codes that separate "review completed" from "infrastructure error". The demo moves aside, it is not deleted.

### Changes Required:

#### 1. Diff truncation helper

**File**: `packages/code-reviewer/src/truncate.ts` (new)

**Intent**: Bound worst-case token cost on large PRs (lockfiles, vendored code) with a pure, testable function.

**Contract**: `export const MAX_DIFF_CHARS = 100_000` and `truncateDiff(diff: string): { diff: string; truncated: boolean }` — cuts at the budget and flags it; the flag flows into both the prompt (`buildPrReviewPrompt`) and the CLI's JSON output.

#### 2. PR review CLI

**File**: `packages/code-reviewer/src/cli.ts` (rewritten)

**Intent**: The machine-readable seam the composite action calls. Reads PR data, runs `reviewPr`, derives the verdict, prints one JSON object.

**Contract**: Input — `PR_TITLE` and `PR_BODY` env vars (body may be empty), diff on **stdin**. Output — a single JSON object on stdout: `{ summary, scores, findings, verdict, truncated, model }` where `verdict` comes from `deriveVerdict()` and `model` is the resolved model id. Exit codes — `0` when the review completed (regardless of verdict, per the always-green decision); `1` on infrastructure errors: missing `OPENROUTER_API_KEY`, empty stdin/diff, model/API/schema failure. Diagnostics go to stderr only — stdout must stay pure JSON.

#### 3. Demo relocation + scripts

**File**: `packages/code-reviewer/src/demo.ts` (new, moved from old `cli.ts`), `packages/code-reviewer/package.json`, `packages/code-reviewer/README.md`

**Intent**: Keep the hardcoded-sample sanity check available without occupying the CLI entry point.

**Contract**: `npm start` → `tsx --env-file-if-exists=.env src/cli.ts` (now the PR CLI); `npm run demo` → the old sample review. README documents the CLI contract (env vars, stdin, JSON shape, exit codes).

### Success Criteria:

#### Automated Verification:

- Unit tests pass (truncation boundary cases): `cd packages/code-reviewer && npm test`
- Type checking passes: `cd packages/code-reviewer && npx tsc --noEmit`

#### Manual Verification:

- `git diff HEAD~3 | PR_TITLE="test" PR_BODY="test body" npm start` (with API key) emits valid JSON with all six scores, findings, and a verdict, exit code 0
- Running without `OPENROUTER_API_KEY` exits 1 with a clear stderr message and no stdout JSON
- Running with empty stdin exits 1 with a clear stderr message

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Composite Action

### Overview

Build `.github/actions/ai-review` — the "fat" half that owns the whole review: install the reviewer, fetch PR data, run the CLI, render the comment markdown, upsert the sticky comment, and swap labels.

### Changes Required:

#### 1. Comment renderer

**File**: `packages/code-reviewer/src/render-comment.ts` (new), plus `packages/code-reviewer/src/render-comment.test.ts`

**Intent**: Turn the CLI's JSON into the PR comment markdown as a pure, unit-tested function in the package (where the schema lives), invoked by the action via `npx tsx`.

**Contract**: `renderComment(result): string` producing: the hidden `<!-- ai-cr -->` marker, a verdict headline (✅ passed / ❌ failed), the summary, a 6-row table (criterion | score/10 | justification), a findings section (severity, line, issue → suggestion; "none" when empty), a truncation notice when `truncated`, and a footer noting the model and the retry hint ("add the `ai-cr:review` label to re-run"). When run directly (`tsx src/render-comment.ts result.json`), prints the markdown for a JSON file argument.

#### 2. Composite action definition

**File**: `.github/actions/ai-review/action.yml` (new)

**Intent**: Encapsulate the entire review flow so the workflow stays trigger-plumbing only.

**Contract**:
- `inputs`: `openrouter-api-key` (required), `github-token` (required), `pr-number` (required), `model` (optional, maps to `OPENROUTER_MODEL`).
- `runs.using: "composite"` with steps (every `run:` step declares `shell: bash`):
  1. `actions/setup-node@v4` with node 22, npm cache keyed on `packages/code-reviewer/package-lock.json`.
  2. Ensure labels exist (idempotent, runs every time): `gh label create` with `--force` for `ai-cr:passed` (`2ea44f`), `ai-cr:failed` (`d73a4a`), `ai-cr:review` (`0075ca`).
  3. `npm ci` with `working-directory: packages/code-reviewer`.
  4. Fetch PR data via `gh` (never from payload interpolation): `gh pr view "$PR" --json title,body` → env vars/files; `gh pr diff "$PR" --patch` → temp file under `$RUNNER_TEMP`.
  5. Run the CLI: env `OPENROUTER_API_KEY`, `PR_TITLE`, `PR_BODY`; stdin from the diff file; JSON captured to `$RUNNER_TEMP/review.json`. A CLI exit 1 fails this step (infra error → red check, correct per decision).
  6. Render markdown: `npx tsx src/render-comment.ts $RUNNER_TEMP/review.json > $RUNNER_TEMP/comment.md`.
  7. Upsert sticky comment via `actions/github-script@v7`: `issues.listComments` → find body containing `<!-- ai-cr -->` → `updateComment`, else `createComment`.
  8. Swap labels via `gh pr edit "$PR" --add-label <verdict label> --remove-label <other verdict label> --remove-label ai-cr:review` (single call; `gh` no-ops on absent labels instead of 404ing). Verdict read from `review.json` with `jq -r .verdict`.
- All `gh` steps get `GH_TOKEN: ${{ inputs.github-token }}` via step-level `env:`.

### Success Criteria:

#### Automated Verification:

- Renderer unit tests pass (passed verdict, failed verdict, empty findings, truncated flag): `cd packages/code-reviewer && npm test`
- Type checking passes: `cd packages/code-reviewer && npx tsc --noEmit`

#### Manual Verification:

- `npx tsx src/render-comment.ts` against a sample JSON produces well-formed markdown (inspect: table renders, marker present, retry hint present)
- Full action behavior is verified end-to-end in Phase 4 (a composite action cannot run outside a workflow)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Workflow + End-to-End Verification

### Overview

Add the thin `pull_request_target` workflow that guards triggers, sets permissions, and delegates to the composite action — then prove the whole loop on a real test PR.

### Changes Required:

#### 1. AI review workflow

**File**: `.github/workflows/ai-review.yml` (new)

**Intent**: Trigger plumbing only — event types, self-loop guard, permissions, base-ref checkout, delegate.

**Contract**:
- `on.pull_request_target`: `types: [opened, synchronize, reopened, labeled]`, `branches: [main]` (all four types listed explicitly — `types:` replaces the defaults).
- Job-level `if:` guard: run always for `opened/synchronize/reopened`; for `labeled` only when `github.event.label.name == 'ai-cr:review'`.
- `permissions:` block: `contents: read`, `pull-requests: write`, `issues: write`.
- `concurrency`: group keyed on the PR number with `cancel-in-progress: true` (rapid pushes don't stack reviews).
- Steps: `actions/checkout@v4` (default base-ref checkout — trusted copy of the action; **never** the PR head), then `uses: ./.github/actions/ai-review` with `openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}`, `github-token: ${{ github.token }}`, `pr-number: ${{ github.event.pull_request.number }}`.

#### 2. Repository secret (manual prerequisite)

**File**: n/a (GitHub repo settings)

**Intent**: The workflow needs `OPENROUTER_API_KEY` as a repository secret before the first run.

**Contract**: `gh secret set OPENROUTER_API_KEY` (or repo Settings → Secrets → Actions). Documented in the reviewer README.

#### 3. Documentation

**File**: `CLAUDE.md` (CI section), `packages/code-reviewer/README.md`

**Intent**: Record the new workflow, its triggers, the retry label, and the secret prerequisite where both humans and agents will find them.

**Contract**: CLAUDE.md CI section gains a bullet for the `ai-review` workflow (trigger, labels, retry, always-green semantics). README documents the action inputs and the end-to-end flow.

### Success Criteria:

#### Automated Verification:

- Workflow file is accepted by GitHub after push: `gh workflow list` shows "AI Code Review" (a malformed workflow file surfaces as a repo error)
- Renderer/verdict/truncation tests still pass: `cd packages/code-reviewer && npm test`

#### Manual Verification:

- Open a test PR against `main` → workflow runs, sticky comment appears with score table + findings + verdict, and exactly one of `ai-cr:passed`/`ai-cr:failed` is applied
- Push another commit to the PR → the same comment is updated in place (no second comment); label reflects the fresh verdict
- Add the `ai-cr:review` label → the review re-runs and the `ai-cr:review` label is removed afterward
- The runs triggered by the action's own `ai-cr:passed`/`ai-cr:failed` label writes are skipped by the `if:` guard (no self-loop — check the Actions run list)
- Workflow check is green even when the verdict is `failed`
- Confirm no step ever checks out or executes PR-head code (review the run logs once)

**Implementation Note**: After completing this phase and all manual verification passes, the change is done.

---

## Testing Strategy

### Unit Tests (node:test via tsx, in `packages/code-reviewer`):

- `deriveVerdict`: all-pass, single sub-floor criterion fails, exact-floor boundary passes
- `truncateDiff`: under budget (untouched, `truncated: false`), over budget (cut at `MAX_DIFF_CHARS`, `truncated: true`), exactly at budget
- `renderComment`: passed and failed verdicts, empty findings list, truncation notice, marker always present

### Integration Tests:

- None automated — the model call and GitHub side-effects are exercised via the manual CLI run (Phase 2) and the live test PR (Phase 4).

### Manual Testing Steps:

1. Phase 2: pipe a real `git diff` through the CLI with a title/body; verify JSON shape, verdict, and both failure modes (no key, empty stdin).
2. Phase 4: run the full PR lifecycle — open, push, retry-label, verify sticky comment update, label swap, no self-loop, always-green check.

## Performance Considerations

- The 100k-character diff cap bounds worst-case model cost and keeps within context limits; the truncation is surfaced in both prompt and comment so neither model nor reader is misled.
- `concurrency.cancel-in-progress` prevents wasted model calls on rapid successive pushes.
- The npm cache in the composite action (keyed on the reviewer's lockfile) keeps the scoped install fast.

## Migration Notes

- No existing behavior changes. `ci.yml` is untouched; the reviewer package's existing `reviewCode` snippet API is preserved (the demo moves from `cli.ts` to `demo.ts`, reachable via `npm run demo`).
- Rollback = delete `.github/workflows/ai-review.yml` (the action and package additions are inert without the workflow).

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Related research: `context/changes/ci-cd-code-review/research.md`
- Engine to extend: `packages/code-reviewer/src/agent.ts:40-77`
- Existing schema/prompt split to mirror: `packages/code-reviewer/src/models/review.ts`, `packages/code-reviewer/src/prompts/review.ts`
- Prior change that built the engine: `context/changes/tool-loop-agent/plan.md`
- Existing CI to leave untouched: `.github/workflows/ci.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: PR Review Engine (package)

#### Automated

- [x] 1.1 Unit tests pass: `cd packages/code-reviewer && npm test` — 25fb1c0
- [x] 1.2 Type checking passes: `cd packages/code-reviewer && npx tsc --noEmit` — 25fb1c0

#### Manual

- [x] 1.3 Ad-hoc `reviewPr()` call returns schema-valid result with all six scores populated — 25fb1c0

### Phase 2: CLI Contract

#### Automated

- [x] 2.1 Unit tests pass (truncation boundary cases): `cd packages/code-reviewer && npm test` — 7c7b73c
- [x] 2.2 Type checking passes: `cd packages/code-reviewer && npx tsc --noEmit` — 7c7b73c

#### Manual

- [x] 2.3 Real diff piped through CLI emits valid JSON with scores, findings, verdict; exit 0 — 7c7b73c
- [x] 2.4 Missing `OPENROUTER_API_KEY` exits 1 with clear stderr message, no stdout JSON — 7c7b73c
- [x] 2.5 Empty stdin exits 1 with clear stderr message — 7c7b73c

### Phase 3: Composite Action

#### Automated

- [x] 3.1 Renderer unit tests pass: `cd packages/code-reviewer && npm test` — f9e1c0e
- [x] 3.2 Type checking passes: `cd packages/code-reviewer && npx tsc --noEmit` — f9e1c0e

#### Manual

- [x] 3.3 `npx tsx src/render-comment.ts` on sample JSON produces well-formed markdown (table, marker, retry hint) — f9e1c0e

### Phase 4: Workflow + End-to-End Verification

#### Automated

- [x] 4.1 `gh workflow list` shows "AI Code Review" after push — 50df98b
- [x] 4.2 Package tests still pass: `cd packages/code-reviewer && npm test` — 50df98b

#### Manual

- [x] 4.3 Test PR gets sticky comment (score table + findings + verdict) and exactly one `ai-cr:*` verdict label — 50df98b
- [x] 4.4 New commit updates the comment in place; label reflects fresh verdict — 50df98b
- [x] 4.5 Adding `ai-cr:review` re-runs the review and the label is removed afterward — 50df98b
- [x] 4.6 No self-loop from the action's own label writes (guarded runs skipped) — 50df98b
- [x] 4.7 Workflow check green even when verdict is `failed` — 50df98b
- [x] 4.8 Run logs confirm PR-head code is never checked out or executed — 50df98b
