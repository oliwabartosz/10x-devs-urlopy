# Promptfoo Evals for the Code Reviewer — Implementation Plan

## Overview

Introduce promptfoo into `packages/code-reviewer` as its first eval harness. The initial configuration runs the existing PR-review agent (`reviewPr`) — same prompt, same production code path — across three OpenRouter models (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro`), against one deliberately flawed test case: a complex React 16 → React 19 class-to-function migration diff seeded with three impactful bugs. An LLM judge (`anthropic/claude-sonnet-5` via OpenRouter) verifies per flaw that the review identified it, and deterministic `javascript` assertions verify the review actually fails (`deriveVerdict === "failed"`) and that scores are well-formed integers.

## Current State Analysis

The package was designed for exactly this change (see `context/changes/code-review-evals/research.md` — all findings verified against source at commit `24bed98`):

- **Side-effect-free barrel** `packages/code-reviewer/src/index.ts` exports everything an eval needs: `reviewPr`, `createPrReviewer`, `PrReviewResult`, `deriveVerdict`, `PASS_FLOOR`, `truncateDiff`, `MAX_DIFF_CHARS`. Keyless import is safe — the API key resolves lazily at request time.
- **Model override plumbing exists**: `reviewPr(input, { model })` builds a per-call reviewer (`src/pr-agent.ts:53-61`), so a promptfoo provider's `config.model` maps 1:1 onto the existing API.
- **Deterministic verdict**: `deriveVerdict(scores)` fails iff any of six criteria scores `< PASS_FLOOR` (5) — `src/verdict.ts:11-17`. This is the hook for the static "review actually fails" assertion.
- **No eval harness of any kind exists yet** — no promptfoo files, no `evals/` directory. Existing tests are `node:test` unit tests (`npm test`).
- **Standalone package**: own `package-lock.json`, no root workspaces. Promptfoo becomes a devDependency of `packages/code-reviewer` only.
- **Tooling constraints**: ESM (`"type": "module"`), no build step (`noEmit`) — the eval must consume `.ts` sources. Promptfoo `0.121.x` loads `file://` TS providers natively (Node type-stripping); local Node is v24.15.0, above promptfoo's `^20.20.0 || >=22.22.0` floor.
- Research verified: promptfoo's default grader is OpenAI — it MUST be overridden to an `openrouter:` provider so the whole eval runs on the single existing `OPENROUTER_API_KEY`.

## Desired End State

`npm run eval` inside `packages/code-reviewer/` runs promptfoo against the fixture, producing a 3-model comparison matrix where each cell shows: three per-flaw judge verdicts, the deterministic verdict assertion, and the score-shape assertion. `npm run eval:view` opens the promptfoo web viewer on the results. Everything runs on `OPENROUTER_API_KEY` alone (from the package's `.env`); no OpenAI key needed.

### Key Discoveries:

- `reviewPr` docstring calls itself the ergonomic wrapper for evals; `options.model` gives per-run model control (`src/pr-agent.ts:53-61`)
- `deriveVerdict` / `PASS_FLOOR` live outside the model (`src/verdict.ts`), so the eval asserts on the exact production pass/fail logic without re-implementing it
- `CriterionScore.score` is plain `z.number()` (Anthropic structured-output constraint, `src/models/pr-review.ts:14-20`) — the 1–10 integer range is prompt-enforced only, making "scores are integers in 1–10" a worthwhile deterministic assertion
- Production CLI truncates the diff via `truncateDiff` before calling `reviewPr` (`src/cli.ts`) — the provider mirrors this so the eval exercises the true production path
- Promptfoo custom-provider contract: default-export a class with `id()` + `async callApi(prompt, context)`; test `vars` arrive via `context.vars`; provider `config` (our model id) is available to the provider; returning the zod-validated object as `output` is supported
- `llm-rubric` grader override point: `defaultTest.options.provider` (research.md:97)

## What We're NOT Doing

- No CI integration (no workflow job, no scheduled runs) — local `npm run eval` only; CI is a follow-up once the fixture set grows
- No snippet-mode (`reviewCode`) evals — PR mode only
- No prompt-only A/B evals (`file://prompts.ts:fn` pattern) — the provider wraps the whole agent
- No `promptfoo share` / hosted uploads — results stay local
- No repetition/stability tuning (`repeat: 1` implicitly) — score-stability analysis is a follow-up question, not this change
- No changes to production code in `src/` — the eval consumes the existing public surface as-is
- No root-workspace conversion (explicitly rejected in the CI/CD change)

## Implementation Approach

Everything lands under `packages/code-reviewer/evals/`, with promptfoo pinned as a devDependency in the package's own lockfile. One custom TypeScript provider wraps `reviewPr` and is instantiated three times in the config — once per model — via provider `config.model`, so "same prompt, three models" is expressed as three providers over one test case. The fixture is a unified diff file loaded into test `vars` via `file://`, with title/description inline in the config. Assertions are split by nature: model-graded (`llm-rubric`, one per seeded flaw, graded by `openrouter:anthropic/claude-sonnet-5`) and deterministic (`javascript` file assertions importing `deriveVerdict` from the package source).

Planned layout:

```
packages/code-reviewer/
  evals/
    promptfooconfig.yaml
    providers/pr-review.ts
    asserts/deterministic.ts
    fixtures/react-16-to-19-migration/
      pr.diff
      ground-truth.md
```

## Critical Implementation Details

**TS module resolution when promptfoo loads the provider.** Package sources import each other with `.js` specifiers (e.g. `./agent.js`) that only `tsx` rewrites; Node's native type-stripping does no extension rewriting. Promptfoo loads `file://` TS providers through its own importer, which the research verified handles `.ts` natively — but whether *transitive* imports of the package barrel resolve `.js` → `.ts` must be verified in Phase 1 with a smoke run before building anything else on top. If native loading fails on the transitive imports, the fallback is prepending `NODE_OPTIONS="--import tsx"` to the `eval` npm script so tsx's ESM loader hooks handle resolution — tsx is already a devDependency.

**Env loading.** Promptfoo loads `.env` from the working directory via dotenv. The npm script runs from the package root where `.env` already lives (same file `npm run demo` uses), so no extra flag should be needed — verify during the Phase 1 smoke run, and use promptfoo's `--env-file` flag if not.

**Judge override is mandatory, not optional.** Without `defaultTest.options.provider: openrouter:anthropic/claude-sonnet-5`, every `llm-rubric` silently expects `OPENAI_API_KEY` and the run errors. Set it once at `defaultTest` level, not per-assertion.

**The static "fails" assertion encodes an expectation, not a certainty.** A model can find all three flaws yet still score implementation ≥ 5, which fails the assertion — that is signal (the review didn't fail a PR that ships three severe bugs), not a harness bug. Don't weaken the assertion to make models pass.

## Phase 1: Eval Harness Scaffolding

### Overview

Install and pin promptfoo, create the `evals/` layout, write the provider bridge and the promptfoo config with the three-model matrix and judge override, wire npm scripts, and prove the plumbing works end-to-end with a trivial smoke fixture before the real fixture exists.

### Changes Required:

#### 1. Promptfoo devDependency

**File**: `packages/code-reviewer/package.json` (+ lockfile via `npm install`)

**Intent**: Add promptfoo as a pinned devDependency (exact version, no `^` — promptfoo is fast-moving 0.x with config-surface churn between minors; research pinned `0.121.17` as current). Add two scripts: `eval` (`promptfoo eval -c evals/promptfooconfig.yaml`) and `eval:view` (`promptfoo view`).

**Contract**: `npm run eval` works from the package root with only `OPENROUTER_API_KEY` in `.env`. Do not touch `engines` — local Node 24 and CI Node 22 both satisfy promptfoo; the package's own floor stays `>=20.11`.

#### 2. Custom provider wrapping `reviewPr`

**File**: `packages/code-reviewer/evals/providers/pr-review.ts`

**Intent**: The promptfoo → agent bridge. Reads `title`, `description`, `diff` from `context.vars`, mirrors the production CLI by running the diff through `truncateDiff` (deriving the `truncated` flag), calls `reviewPr(input, { model: this.config.model })`, and returns the validated `PrReviewResult` object as `output`. The model id comes from provider `config`, never from env, so three config entries give three models.

**Contract**: Default-exports a class implementing promptfoo's custom-provider shape — constructor receiving `options` (with `id`, `config`, `label`), `id()`, and `async callApi(prompt, context)` returning `{ output }` (plus `error` on failure). Imports only from the package barrel (`../../src/index.ts`) — `reviewPr`, `truncateDiff`, and types. The promptfoo `prompt` argument is intentionally unused (the agent builds its own prompt via `buildPrReviewPrompt` internally); note this in the provider docstring. Erasable-syntax TS only (no `enum`) — matches existing codebase style.

#### 3. Promptfoo config

**File**: `packages/code-reviewer/evals/promptfooconfig.yaml`

**Intent**: The harness definition: one vestigial prompt (the provider ignores it — required by promptfoo's schema), three provider entries pointing at the same `file://providers/pr-review.ts` with distinct `label`s and `config.model` values (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro`), and the judge override.

**Contract**: `defaultTest.options.provider: openrouter:anthropic/claude-sonnet-5` set once at top level. Provider labels are the model ids so the results matrix is self-describing. In Phase 1 the config carries a single trivial inline smoke test (tiny hardcoded diff var, no assertions beyond an `is-json`-level sanity check) purely to prove the plumbing; Phase 2/3 replace it with the real fixture and assertions.

### Success Criteria:

#### Automated Verification:

- `npm install` succeeds; lockfile updated; promptfoo pinned exact
- `npm run typecheck` passes with the new `evals/**/*.ts` files (extend `tsconfig.json` include if needed)
- `npm test` still passes (no production code touched)
- Smoke run: `npm run eval` completes against the trivial fixture with all three providers returning structured output (this is the moment the TS-resolution and env-loading risks from Critical Implementation Details are settled)

#### Manual Verification:

- `npm run eval:view` opens the viewer and shows a 3-column model matrix
- Confirm each column ran the intended model (check provider labels / token usage per cell)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: The Seeded-Flaw Fixture

### Overview

Author the single test case: a realistic, fairly complex React 16 class component from this app's domain (vacation/leave management) migrated to a React 19 function component, with three impactful flaws planted in an otherwise-plausible migration, plus a ground-truth document that Phase 3's rubrics are written against.

### Changes Required:

#### 1. The migration diff

**File**: `packages/code-reviewer/evals/fixtures/react-16-to-19-migration/pr.diff`

**Intent**: A unified diff (~150–250 lines) migrating one class component (e.g. a `LeaveRequestsPanel` with polling, a subscription, and props-derived filtering) to a function component with hooks. Most of the migration is *correct and idiomatic* — `ReactDOM.render` → `createRoot`, `contextType` → `useContext`, class fields → `useState`, handlers unbound — so the flaws are needles in a haystack, not the only changes. The three seeded flaws:

1. **Stale-closure interval** — `componentDidMount`'s `setInterval` becomes `useEffect(..., [])` whose callback reads a state variable from the closure (instead of a functional update), freezing the polled value at its initial state.
2. **Dropped cleanup → leak/race** — `componentWillUnmount`'s unsubscribe/teardown (subscription or event listener, paired with an async fetch that calls a state setter) is silently not carried over: the `useEffect` has no cleanup return, leaking the listener and allowing set-state-after-unmount.
3. **Derived-state infinite render loop** — `getDerivedStateFromProps` becomes a `useEffect` that sets state with an inline object/derived value in its dependency array (new reference every render), producing an unconditional re-render loop.

**Contract**: Valid unified-diff syntax (the same shape `cli.ts` receives from `git diff` in CI). Each flaw must be *visible within the diff hunks* — including enough red-side context that a reviewer can see what the class version did (this is what makes flaw 2 detectable). Diff stays far below `MAX_DIFF_CHARS` (100k) so truncation never triggers.

#### 2. Ground truth

**File**: `packages/code-reviewer/evals/fixtures/react-16-to-19-migration/ground-truth.md`

**Intent**: Documents each planted flaw for humans and for rubric-authoring: what the flaw is, where it sits in the diff, why it's impactful (user-visible symptom), and what the correct migration would have been. This is the authoritative reference the Phase 3 rubrics paraphrase — keeps judge criteria honest and reviewable.

**Contract**: One section per flaw with a stable heading; a closing section stating the expected overall outcome (a competent review must fail this PR — implementation score below `PASS_FLOOR`).

#### 3. Wire the fixture into the config

**File**: `packages/code-reviewer/evals/promptfooconfig.yaml`

**Intent**: Replace the Phase 1 smoke test with the real test case: `vars.diff` loaded via `file://fixtures/react-16-to-19-migration/pr.diff`, plus an inline `title` and `description` written as a plausible, confident PR submission ("Modernize LeaveRequestsPanel: migrate to function component for React 19") that does *not* hint at the flaws.

**Contract**: The description exercises the untrusted-content framing realistically — a routine-sounding modernization PR. `truncated` is not a var (the provider derives it via `truncateDiff`).

### Success Criteria:

#### Automated Verification:

- `git apply --check` (or `git apply --stat`) accepts `pr.diff` as syntactically valid against an empty tree context — at minimum, promptfoo run completes with the fixture loaded (no YAML/file-loading errors)
- `npm run eval` completes across all three models with the real fixture (assertions still minimal — Phase 3 adds them)

#### Manual Verification:

- Read the diff top-to-bottom: the three flaws are present, findable, and *only* those three impactful flaws exist (no accidental fourth bug that would confuse per-flaw grading)
- The correct-migration parts genuinely read as idiomatic React 19 — the fixture shouldn't fail reviews for unrelated sloppiness
- Ground-truth doc accurately describes each flaw's location and symptom
- Spot-check one model's raw review output in the viewer: does the fixture elicit substantive review content (not a truncation note or parse failure)?

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation — fixture quality is the heart of this eval, and a human read of the diff is the gate before spending judge tokens on it.

---

## Phase 3: Assertions, Live Run, Documentation

### Overview

Add the per-flaw LLM-judge rubrics and the deterministic assertions, run the full eval across all three models, and document the harness in the package README.

### Changes Required:

#### 1. Deterministic assertions

**File**: `packages/code-reviewer/evals/asserts/deterministic.ts`

**Intent**: Two named-export `javascript` assertion functions consuming the provider's object output: `verdictFailed` — imports `deriveVerdict` from the package barrel and passes iff `deriveVerdict(output.scores) === "failed"` (the "static test verifying the code review actually fails"); `scoresWellFormed` — passes iff all six criterion scores are integers within 1–10 (guards the prompt-enforced range that the zod schema deliberately cannot enforce).

**Contract**: Each function returns `{ pass, reason }` (a `GradingResult`-shaped object) so failures are self-explanatory in the viewer; referenced from the config as `file://asserts/deterministic.ts:verdictFailed` / `:scoresWellFormed`. Imports from `../../src/index.ts` (barrel) only.

#### 2. Per-flaw LLM rubrics

**File**: `packages/code-reviewer/evals/promptfooconfig.yaml`

**Intent**: Three `llm-rubric` assertions on the test case, one per seeded flaw, each paraphrasing the corresponding ground-truth section: "The review identifies <flaw + symptom>. Pass only if a finding or the summary concretely describes this specific problem (naming the mechanism or its user-visible symptom); vague mentions of 'potential hook issues' do not pass." Graded by the `defaultTest`-level `openrouter:anthropic/claude-sonnet-5` override from Phase 1.

**Contract**: Rubric text is derived from `ground-truth.md` and stays in sync with it. Each rubric names only one flaw — no compound rubrics — so the matrix shows per-flaw detection per model. The review output reaching the judge is the serialized `PrReviewResult` object (summary + scores + findings), which is exactly what should be judged.

#### 3. README documentation

**File**: `packages/code-reviewer/README.md`

**Intent**: New "Evals" section: what the harness evaluates (PR-review agent, three models, seeded-flaw fixture), how to run it (`npm run eval`, `npm run eval:view`, needs `OPENROUTER_API_KEY` in `.env`), where fixtures live and how to add one, the judge model and why it's overridden, and rough cost expectations per run (3 agent calls + 9 judge calls).

**Contract**: Follows the existing README's tone and structure; mentions the promptfoo version-pinning rationale (0.x churn).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes (assertion file included)
- `npm test` still passes
- `npm run eval` completes a full live run: 3 providers × (3 rubrics + 2 deterministic assertions) all execute — every cell has a result (pass or fail), zero harness errors (no `OPENAI_API_KEY` errors, no provider exceptions)

#### Manual Verification:

- In `promptfoo view`: per-flaw judge reasoning is coherent and references actual review content (spot-check at least one pass and one fail cell)
- The deterministic verdict assertion behaves correctly: cross-check one model's scores by hand against `PASS_FLOOR`
- The resulting model comparison is legible enough to answer the motivating question: which of the three models catches which flaws, and do any pass a PR that should fail
- README section is accurate — follow it verbatim on a clean shell to run the eval

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation of the results review before closing out the change.

---

## Testing Strategy

### Unit Tests:

- None added — the eval harness is itself the test artifact; production `src/` is untouched and existing `node:test` suites (verdict, truncate, render-comment) continue to cover the deterministic logic the assertions reuse.

### Integration Tests:

- The promptfoo run *is* the integration test: it exercises the real `reviewPr` path (prompt building, OpenRouter call, structured-output parsing via zod, truncation) per model.

### Manual Testing Steps:

1. `cd packages/code-reviewer && npm run eval` with a valid `OPENROUTER_API_KEY` in `.env`
2. `npm run eval:view` — verify the 3-model matrix renders with 5 assertion results per cell
3. Read judge reasoning for one flaw across all three models — confirm the rubric discriminates (concrete identification passes, vague hand-waving fails)
4. Temporarily edit one rubric to describe a flaw NOT in the diff and re-run one model — the judge should fail it (sanity-check against a judge that passes everything)

## Performance Considerations

Cost per full run: 3 agent calls (one large diff prompt each) + 9 judge calls + 0-cost deterministic asserts. All through OpenRouter on one key. No `repeat`; promptfoo's default concurrency is fine at this scale. Promptfoo caches provider responses (`~/.cache/promptfoo`) — during rubric iteration in Phase 3, cached agent outputs mean only judge calls re-run.

## Migration Notes

Nothing migrates. Rollback = delete `evals/`, drop the devDependency and the two npm scripts. No production or CI surface changes.

## References

- Related research: `context/changes/code-review-evals/research.md` (promptfoo fit verified against live docs; package eval-readiness audit)
- Agent surface: `packages/code-reviewer/src/pr-agent.ts:31-61`, `src/index.ts`
- Verdict logic the static assert reuses: `packages/code-reviewer/src/verdict.ts:11-17`
- Prior decisions: `context/changes/tool-loop-agent/plan.md` (eval-friendly split designed there), `context/archive/2026-07-03-ci-cd-code-review/plan.md:36` (evals deferred)
- Production CLI path the provider mirrors: `packages/code-reviewer/src/cli.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Eval Harness Scaffolding

#### Automated

- [x] 1.1 `npm install` succeeds; lockfile updated; promptfoo pinned exact
- [x] 1.2 `npm run typecheck` passes with the new `evals/**/*.ts` files
- [x] 1.3 `npm test` still passes
- [x] 1.4 Smoke run: `npm run eval` completes with all three providers returning structured output

#### Manual

- [x] 1.5 `npm run eval:view` shows a 3-column model matrix
- [x] 1.6 Each column ran the intended model (labels / token usage)

### Phase 2: The Seeded-Flaw Fixture

#### Automated

- [ ] 2.1 `pr.diff` is syntactically valid; promptfoo loads the fixture without errors
- [ ] 2.2 `npm run eval` completes across all three models with the real fixture

#### Manual

- [ ] 2.3 Human read: exactly three findable impactful flaws, no accidental extras
- [ ] 2.4 Correct-migration parts read as idiomatic React 19
- [ ] 2.5 Ground-truth doc matches the diff (locations, symptoms)
- [ ] 2.6 Spot-check one model's raw review output for substantive content

### Phase 3: Assertions, Live Run, Documentation

#### Automated

- [ ] 3.1 `npm run typecheck` passes with the assertion file
- [ ] 3.2 `npm test` still passes
- [ ] 3.3 Full live run: 3 providers × 5 assertions, every cell resolved, zero harness errors

#### Manual

- [ ] 3.4 Judge reasoning coherent; spot-check one pass and one fail cell
- [ ] 3.5 Hand-verify one model's verdict assertion against `PASS_FLOOR`
- [ ] 3.6 Matrix answers the motivating question (which model catches which flaws)
- [ ] 3.7 README "Evals" section works verbatim on a clean shell
