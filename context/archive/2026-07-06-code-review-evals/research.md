---
date: 2026-07-06T17:09:55+0200
researcher: Bartosz Oliwa
git_commit: 24bed98fddde538ed548c2fa1cc90b785a82badc
branch: main
repository: 10x-devs-urlopy
topic: "Eval-readiness of packages/code-reviewer and promptfoo fit for agent/prompt evaluation"
tags: [research, codebase, code-reviewer, evals, promptfoo, ai-sdk, openrouter]
status: complete
last_updated: 2026-07-06
last_updated_by: Bartosz Oliwa
---

# Research: Eval-readiness of packages/code-reviewer and promptfoo fit

**Date**: 2026-07-06T17:09:55+0200
**Researcher**: Bartosz Oliwa
**Git Commit**: 24bed98fddde538ed548c2fa1cc90b785a82badc
**Branch**: main
**Repository**: 10x-devs-urlopy

## Research Question

Analyze the current state of `packages/code-reviewer/` in the context of potential eval introduction — reusability of prompts, importability of the agent, etc. First-pick eval toolkit is promptfoo; if the tech stack is not aligned with it, analyze other OSS tools for evaluating prompts and agents.

## Summary

**The package is already promptfoo-ready by design, and promptfoo (verified against live docs, v0.121.17, MIT) fits the stack well.** No blocker was found; no restructuring of the package is needed.

1. **Eval-readiness**: the `models/` + `prompts/` + agent-factory split was made *specifically* so promptfoo could wrap the agent later — the tool-loop-agent plan says so verbatim, and the eval environment was explicitly deferred (twice) as out-of-scope. The barrel `src/index.ts` is side-effect-free on import (no network call, lazy API-key resolution), prompts are exported as plain strings/builder functions, schemas are standalone zod values, and both agents are importable via ergonomic wrappers (`reviewCode`, `reviewPr`) plus per-model factories (`createCodeReviewer({ model })`, `createPrReviewer({ model })`).
2. **Promptfoo fit**: custom TypeScript providers (`file://provider.ts` with `callApi`) are loaded natively (no bundling/tsx needed), can return the zod-validated object directly as `output`, and `javascript` assertions receive it as an object. Promptfoo has a native `openrouter:` provider, so LLM-rubric graders can run through the existing `OPENROUTER_API_KEY` (the default grader is OpenAI — must be overridden via `defaultTest.options.provider`). Prompts can also be imported from TS functions (`file://x.ts:fn`) for cheap prompt-only A/B evals.
3. **Frictions (small, plannable)**: promptfoo requires Node `^20.20.0 || >=22.22.0` (stricter than the package's `>=20.11`; CI already uses Node 22 — pin 22.x in the eval job); promptfoo is fast-moving 0.x (pin the version); zod is not a conflict (promptfoo ships its own zod 4.x as a regular dep).
4. **Alternatives**: nothing clearly beats promptfoo. Evalite is the best ergonomic match (vitest-based, TS-native, peer-deps on `ai@^6`) but is a stalled single-maintainer beta; vitest + AI SDK roll-your-own is the safest no-framework hedge; `@arizeai/phoenix-evals` (deps: `ai@^6` + `zod@^4`, exact stack match) is a promising but young scorer library. Promptfoo wins on maturity, turnkey CI, `llm-rubric`, and OpenRouter support.

## Detailed Findings

### 1. Package surface: what an eval can import today

All source references at commit `24bed98` (permalink base: https://github.com/oliwabartosz/10x-devs-urlopy/blob/24bed98fddde538ed548c2fa1cc90b785a82badc/).

**Barrel (side-effect-free)** — [`packages/code-reviewer/src/index.ts`](https://github.com/oliwabartosz/10x-devs-urlopy/blob/24bed98fddde538ed548c2fa1cc90b785a82badc/packages/code-reviewer/src/index.ts): re-exports the full public surface; the docstring explicitly says "consumers — including promptfoo evals and tests — can import from one place. Importing runs no demo and makes no network call: the eager `codeReviewer` singleton only resolves the API key lazily at request time, so a keyless import is safe" (index.ts:4-9).

**Agent entry points** (both modes follow the same three-tier shape):

| Surface | Snippet review | PR review |
|---|---|---|
| Ergonomic wrapper | `reviewCode(code, {model?, language?})` — `agent.ts:68-77` | `reviewPr({title, description, diff, truncated}, {model?})` — `pr-agent.ts:53-61` |
| Factory (per-model) | `createCodeReviewer({model})` — `agent.ts:40-56` | `createPrReviewer({model})` — `pr-agent.ts:31-40` |
| Singleton | `codeReviewer` — `agent.ts:59` | `prReviewer` — `pr-agent.ts:43` |

Model resolution is `config.model` → `OPENROUTER_MODEL` env → `DEFAULT_MODEL` (`anthropic/claude-sonnet-5`) in both (`agent.ts:42`, `pr-agent.ts:33`). The `reviewCode` docstring literally calls itself "the ergonomic wrapper promptfoo can call" (`agent.ts:17`).

**Prompts (versionable, model-wiring-free)**:
- `prompts/review.ts` — `SYSTEM_INSTRUCTIONS` (static string, review.ts:12-15), `buildReviewPrompt(code)` (review.ts:18-20), `appendLanguageHint(instructions, language?)` (review.ts:27-30). Header comment: "Centralized and separate from model wiring so prompts stay versionable and eval-friendly."
- `prompts/pr-review.ts` — `PR_REVIEW_INSTRUCTIONS` with the six-criteria rubric and 1/10 anchors embedded verbatim (pr-review.ts:21-41), `buildPrReviewPrompt(input)` with prompt-injection guard line and truncation note (pr-review.ts:44-65), `PrReviewInput` interface (pr-review.ts:12-18).

**Schemas (standalone zod, reusable by assertions)**:
- `models/review.ts` — `ReviewFinding` (severity enum info/minor/major/critical, nullable line, issue, suggestion; review.ts:11-16), `ReviewResult` (summary + findings[]; review.ts:19-22). Header: "Kept separate from the agent wiring so they can be reused by the agent, by callers, and by evals (e.g. promptfoo) independently."
- `models/pr-review.ts` — `CriterionScore` (pr-review.ts:14-20; note: plain `z.number()` because Anthropic structured outputs reject min/max on integer schemas — the 1–10 range is enforced by prompt/description only), `PrReviewResult` (summary, six named criterion scores, findings; pr-review.ts:23-34).

**Deterministic post-processing (unit-testable, eval-relevant)**:
- `verdict.ts` — `deriveVerdict(scores)`: fail iff any criterion `< PASS_FLOOR` (5); the verdict is deliberately NOT model output (verdict.ts:11-17).
- `truncate.ts` — `truncateDiff` caps at `MAX_DIFF_CHARS` = 100,000 (truncate.ts:11-19).

**Existing test/dev harness**: `node:test` unit tests via `npm test` (`node --import tsx --test "src/**/*.test.ts"`) covering verdict, truncation, render-comment; `npm run demo` does a single live snippet review. No eval config of any kind exists in the package yet (no promptfoo files anywhere).

**Runtime/tooling constraints an eval harness must respect**:
- `package.json`: `"type": "module"`, engines `node >= 20.11`, deps `ai@^6.0.217` + `@openrouter/ai-sdk-provider@^2.10.0` + `zod@^4.4.3`; TS is run directly via tsx, `tsconfig.json` has `noEmit: true` (no build artifacts to import — an eval must consume `.ts` sources).
- AI SDK is **pinned to v6** intentionally: the OpenRouter provider targets provider-spec v3 (= `ai@6`); revisit when the provider ships v7 support (README.md:34-37).
- **Standalone package**: the repo root has no `workspaces` key; the reviewer has its own `package-lock.json` and scoped `npm ci` — promptfoo would be a devDependency of `packages/code-reviewer`, not the root.

### 2. Historical context: evals were the explicitly deferred follow-up

The structure wasn't accidentally eval-friendly — it was designed for this change and deferred twice:

- `context/changes/tool-loop-agent/plan.md:5` — "The module exports a reusable, configured reviewer so that promptfoo can wrap it for evals later. The eval environment itself is out of scope for this change."
- `context/changes/tool-loop-agent/plan.md:46` — "Not configuring promptfoo or any eval environment (no config files, no eval scripts, no test harness)."
- `context/changes/tool-loop-agent/plan.md:75,83,122,160` — per-module intents: schemas reusable "by evals independently of the agent wiring"; prompts "versionable and eval-friendly"; factory "so evals can vary the model per run"; `reviewCode` as "the simplest promptfoo entry point"; barrel "safe to import from promptfoo/tests".
- `context/archive/2026-07-03-ci-cd-code-review/plan.md:36` — "No promptfoo evals — the schema split keeps that door open, same as the tool-loop-agent change."
- `context/archive/2026-07-03-ci-cd-code-review/plan.md:95` — the PR rubric prompt got its own module "separate from the findings persona in `prompts/review.ts` (same versionable/eval-friendly split)."

**CI seam** (what an eval job would sit alongside): `.github/actions/ai-review/action.yml` — Node **22** with npm cache keyed on `packages/code-reviewer/package-lock.json` (action.yml:30-33), `npm ci` in the package dir (action.yml:46-49), reviewer invoked as `npx tsx src/cli.ts` with the diff on stdin (action.yml:64-76). The workflow (`.github/workflows/ai-review.yml`) is `pull_request_target`, never checks out PR-head code, and currently overrides the model to `deepseek/deepseek-v4-pro` (ai-review.yml:41).

### 3. Promptfoo fit (verified against live docs, July 2026)

Verified facts: latest release **0.121.17** (2026-06-16), **MIT**, engines `node ^20.20.0 || >=22.22.0`, now itself ESM (`"type": "module"`), ships zod 4.3.6 as a regular dependency.

**Custom TS provider — the documented pattern for whole-agent eval** ([custom-api docs](https://www.promptfoo.dev/docs/providers/custom-api)):
- `providers: [{ id: file://./providers/reviewPr.ts, config: {...} }]`; `.ts` is loaded natively via Node type-stripping (hence the Node floor) — no tsx/bundling. ESM fine.
- Contract: default-export a class with `id()` + `async callApi(prompt, context, options)` (or a bare async function). Test `vars` arrive via `context.vars` — so test cases carry `{title, description, diff}` / `{code, language}` and the provider calls the real exported function.
- `ProviderResponse.output` is `any` → return the zod-validated `ReviewResult`/`PrReviewResult` object directly; also returnable: `tokenUsage`, `cost`, `latencyMs`, `error`, `metadata`.
- Both official agent guides (LangGraph, OpenAI Agents) use exactly this wrap-the-agent-in-a-provider shape.

**Assertions**:
- `javascript` (inline or `file://assert.ts`): receives the object output as-is (`output.scores.implementation.score >= 7`); returns boolean, number, or `{pass, score, reason}`; supports `threshold`.
- Deterministic: `is-json` (with JSON-schema), `contains-json`, `equals`, `regex`, `latency`, `cost` — mostly redundant given the provider already returns a validated object.
- Model-graded: `llm-rubric`, `factuality`, `g-eval`, etc. **Default grader is OpenAI (needs `OPENAI_API_KEY`) — override at `defaultTest.options.provider` (or per-assertion) to `openrouter:anthropic/claude-sonnet-5`** so the whole eval runs on the single existing `OPENROUTER_API_KEY`.

**OpenRouter**: native provider `openrouter:<model-id>`, reads `OPENROUTER_API_KEY` ([docs](https://www.promptfoo.dev/docs/providers/openrouter/)) — also enables prompt-only A/B evals of `SYSTEM_INSTRUCTIONS`/`buildReviewPrompt` without going through the agent.

**Prompts from TS functions**: `prompts: [file://prompts.ts:createPrompt]` — thin wrappers can reuse `buildReviewPrompt`/`buildPrReviewPrompt` directly.

**Tests from files**: `tests: file://tests/*.yaml`, CSV (`__expected` columns become assertions), or a TS generator function — good home for a fixture set of known-buggy diffs/snippets.

**CI** ([GitHub Action docs](https://www.promptfoo.dev/docs/integrations/github-action/)): official `promptfoo/promptfoo-action@v1` posts before/after PR comparison comments, but given the existing bespoke workflow, plain CLI (`npx promptfoo eval -c promptfooconfig.yaml`) with exit-code gating is the simpler fit; cache `~/.cache/promptfoo` via `actions/cache` to control cost; `promptfoo share` is optional (hosted upload — keep off by default).

**Frictions**:
- Node floor `^20.20.0 || >=22.22.0` — stricter than the package's `>=20.11`; pin Node 22.x in the eval job (CI already uses 22).
- Fast-moving 0.x with config-surface churn between minors — pin the promptfoo version as a devDependency.
- Native TS loading = erasable-syntax TS only (no `enum` in provider glue; the package's codebase style is fine).
- Multi-turn/tool-trajectory assertions (`trajectory:*`) need OpenTelemetry traces — only relevant if/when the agent gains tools (AI SDK experimental telemetry can feed this later).
- zod: no conflict (promptfoo bundles its own zod 4.x; the provider imports the package's own zod anyway).

**Verdict**: good fit; the docs' recommended shape here is layered — (1) primary: custom TS providers wrapping `reviewCode`/`reviewPr` (evals the true production path incl. OpenRouter + structured-output parsing), asserted with `javascript` checks on scores/findings plus `llm-rubric` graded through OpenRouter; (2) secondary/cheap: prompt-function evals for prompt/model A/B comparisons.

### 4. Alternatives scan (OSS, TS-agent-function evals)

Nothing clearly beats promptfoo; the honest trade-off is config-first (promptfoo) vs code-first (Evalite / roll-your-own):

| Tool | Fit | Verdict |
|---|---|---|
| **promptfoo** (baseline) | Mature, MIT, native OpenRouter, `llm-rubric`, official GH Action; agent eval via custom-provider bridge | Defensible default for a CI gate |
| **Evalite** (mattpocock) | vitest-based, TS-native, `task` = any imported TS fn, peer-dep `ai@^6` (exact match); `--threshold` CI gating | Best ergonomics, but stalled beta (`1.0.0-beta.16`, Feb 2026), single maintainer — bus-factor risk |
| **Vitest/node:test + AI SDK roll-your-own** | Judge = `generateObject` with zod rubric via the already-installed OpenRouter provider; zero new deps | Safest hedge; plumbing (datasets, aggregation, diffing) is yours to build |
| **`@arizeai/phoenix-evals`** (TS) | Deps literally `ai@^6` + `zod@^4`; `createClassifier` judges over any AI SDK model; Apache-2.0, standalone | Sleeper pick as a *scorer library* inside vitest; young (1.x), thin docs, DIY CI thresholds |
| **autoevals** (Braintrust) | TS scorer library, MIT, active; uses `openai` client (OpenRouter via `baseURL`) | Building block, not a runner |
| **DeepEval** | Python; TS package is currently a platform client, local TS evals just promised | Wrong language, too immature in TS |
| **Langfuse** | OSS platform w/ experiments + server-side judges; requires running a server | Overkill for a CI gate; attractive later for tracing/score history |
| **OpenAI Evals** | Hosted platform shutting down Nov 2026; OpenAI's migration guidance points to promptfoo | Skip |
| **Inspect AI** | Python-only, research-bench oriented | Wrong tool |
| **Mastra evals / Laminar** | Framework-bound (Mastra) / platform-first (Laminar) | Not worth the coupling |

## Code References

Permalink base: `https://github.com/oliwabartosz/10x-devs-urlopy/blob/24bed98fddde538ed548c2fa1cc90b785a82badc/`

- `packages/code-reviewer/src/index.ts:12-36` — side-effect-free barrel; the single import point for evals
- `packages/code-reviewer/src/agent.ts:40-77` — `createCodeReviewer` factory, `codeReviewer` singleton, `reviewCode` wrapper ("the ergonomic wrapper promptfoo can call")
- `packages/code-reviewer/src/pr-agent.ts:31-61` — `createPrReviewer`, `prReviewer`, `reviewPr`
- `packages/code-reviewer/src/prompts/review.ts:12-30` — `SYSTEM_INSTRUCTIONS`, `buildReviewPrompt`, `appendLanguageHint`
- `packages/code-reviewer/src/prompts/pr-review.ts:21-65` — `PR_REVIEW_INSTRUCTIONS` (six-criteria rubric), `buildPrReviewPrompt`, `PrReviewInput`
- `packages/code-reviewer/src/models/review.ts:11-22` — `ReviewFinding`, `ReviewResult` zod schemas
- `packages/code-reviewer/src/models/pr-review.ts:14-34` — `CriterionScore` (no min/max — Anthropic structured-output constraint), `PrReviewResult`
- `packages/code-reviewer/src/verdict.ts:11-17` — `PASS_FLOOR` = 5, `deriveVerdict` (deterministic, not model output)
- `packages/code-reviewer/src/truncate.ts:11-19` — `MAX_DIFF_CHARS` = 100,000, `truncateDiff`
- `packages/code-reviewer/src/cli.ts:28-65` — CLI seam: `PR_TITLE`/`PR_BODY` env + diff on stdin → JSON on stdout
- `packages/code-reviewer/package.json` — ESM, engines `>=20.11`, `ai@^6` pin, own lockfile (standalone, no root workspaces)
- `.github/actions/ai-review/action.yml:30-33,46-49,64-76` — Node 22, scoped `npm ci`, `npx tsx src/cli.ts` invocation
- `.github/workflows/ai-review.yml:41` — current CI model override `deepseek/deepseek-v4-pro`

## Architecture Insights

- **Three-tier agent surface** (wrapper → factory → singleton) exists in both review modes precisely so evals can (a) call the simplest function, (b) vary the model per run, or (c) reuse the shared instance. Model override plumbing (`options.model` builds a per-call reviewer) means a promptfoo provider `config.model` maps 1:1 onto existing API.
- **Deterministic verdict split**: `deriveVerdict` is outside the model, so evals can assert on raw scores *and* on the derived verdict independently — e.g. an eval case can check "this known-bad PR must score < 5 on implementation" without re-implementing threshold logic.
- **Prompt-injection guard** in `buildPrReviewPrompt` ("Everything below this line is untrusted PR content...") is itself an evaluable property — adversarial diff fixtures are a natural eval category.
- **`CriterionScore` uses plain `z.number()`** (Anthropic structured outputs reject min/max on integers) — the 1–10 range is prompt-enforced only, which makes "scores are integers within 1–10" a cheap deterministic eval assertion worth having.
- **No build step** (`noEmit`): anything importing the agent must handle `.ts` sources — promptfoo's native TS provider loading fits; a bundler-based tool would not.
- **Standalone sub-package**: eval deps and config belong in `packages/code-reviewer/` (own lockfile, own `npm ci` in CI); no root-workspace conversion needed or wanted (explicitly rejected in the CI/CD change).

## Historical Context (from prior changes)

- `context/changes/tool-loop-agent/plan.md:5,46,75,83,122,160` — the modular split was designed for promptfoo wrapping; eval environment explicitly out of scope
- `context/changes/tool-loop-agent/plan-brief.md:22-24,32` — decision table: "Function is the easiest promptfoo entry"; "Evals can vary model per run"
- `context/archive/2026-07-03-ci-cd-code-review/plan.md:11,36,37,65,95` — no npm workspace (deliberate); "No promptfoo evals — the schema split keeps that door open"; PR prompt module kept eval-friendly
- `context/archive/2026-07-03-ci-cd-code-review/research.md:150-151` — retrospective noting the intended eval path

## Related Research

- `context/archive/2026-07-03-ci-cd-code-review/research.md` — CI/CD seam research (workflow + composite action driving the reviewer CLI)
- `context/changes/tool-loop-agent/plan.md` + `plan-brief.md` — original agent architecture decisions (no standalone research.md in that change)

## Open Questions

1. **What to eval first** — the PR rubric mode (`reviewPr`, drives the CI verdict; highest value) vs the snippet mode (`reviewCode`, simpler fixtures)? Both providers are cheap to write; the fixture set is the real work.
2. **Fixture sourcing** — hand-crafted buggy diffs vs harvested real PRs from this repo's history (the archive has real reviewed PRs to mine). Where should fixtures live (`packages/code-reviewer/evals/`?)?
3. **CI placement** — separate workflow (on-demand / nightly, cost-bounded) vs a job in the existing `ai-review.yml`? Promptfoo eval runs cost real OpenRouter tokens per test case; cadence and `--max-concurrency` need deciding.
4. **Grader model choice** — the CI reviewer currently runs `deepseek/deepseek-v4-pro` while `DEFAULT_MODEL` is `anthropic/claude-sonnet-5`; evals should probably compare both, and the grader should be a distinct (stronger?) model than the system under test.
5. **Score-stability question** — rubric scores are prompt-enforced integers from a nondeterministic model; how many repetitions per fixture (promptfoo `repeat`) are needed for a stable CI signal, and what does that do to cost?
6. **promptfoo version pinning strategy** — devDependency in the package lockfile (recommended) vs `npx promptfoo@latest` in CI (docs' default, but 0.x churn makes it risky).
