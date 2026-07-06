# @10xdevs/code-reviewer

AI-powered code reviewer built on the [Vercel AI SDK](https://ai-sdk.dev)'s
`ToolLoopAgent`, the [OpenRouter](https://openrouter.ai) provider, and
[zod](https://zod.dev) for validated structured output. The barrel
(`src/index.ts`) re-exports the reusable surface that further features build on.

## Module layout

```
src/
  models/review.ts      # ReviewFinding, ReviewResult zod schemas + inferred types
  models/pr-review.ts   # CriterionScore, PrReviewResult zod schemas (PR review mode)
  prompts/review.ts     # SYSTEM_INSTRUCTIONS + buildReviewPrompt() + language hint
  prompts/pr-review.ts  # PR_REVIEW_INSTRUCTIONS (6-criteria rubric) + buildPrReviewPrompt()
  agent.ts              # createCodeReviewer() factory, codeReviewer singleton, reviewCode()
  pr-agent.ts           # createPrReviewer() factory, prReviewer singleton, reviewPr()
  verdict.ts            # deriveVerdict() — deterministic pass/fail from the six scores
  truncate.ts           # truncateDiff() — caps the diff at MAX_DIFF_CHARS for the prompt
  index.ts              # barrel: re-exports the public surface (no side effects)
  cli.ts                # PR-review CLI (npm start): env + stdin in, JSON out
  demo.ts               # runnable npm run demo snippet-review sanity check
```

## Stack

| Package                        | Version | Notes                                          |
| ------------------------------ | ------- | ---------------------------------------------- |
| `ai`                           | ^6      | AI SDK core (`ToolLoopAgent` + `Output.object`) |
| `@openrouter/ai-sdk-provider`  | ^2.10   | OpenRouter model access                        |
| `zod`                          | ^4      | Schema + runtime validation                    |
| `tsx` / `typescript`           | dev     | Run/typecheck TS directly on Node              |

> **Why AI SDK v6, not v7?** The dedicated OpenRouter provider is built against
> AI SDK provider-spec v3 (i.e. `ai@6`); no release supports `ai@7`'s v4 spec
> yet. We pin the newest `ai@6` so the real OpenRouter provider keeps working.
> Revisit when `@openrouter/ai-sdk-provider` ships v7 support.

## Setup

```bash
cp .env.example .env   # then add your OPENROUTER_API_KEY
npm install
```

`npm start` / `npm run dev` auto-load `.env` (via tsx's `--env-file-if-exists`),
so a local `.env` is picked up without exporting the key. In environments
without a `.env` file (e.g. CI), export `OPENROUTER_API_KEY` in the environment
instead — the flag skips the missing file gracefully.

## PR-review CLI

`npm start` runs the PR-review CLI (`src/cli.ts`) — the seam the CI composite
action calls. It scores a pull request against six criteria (implementation,
idiomaticity, complexity, test coverage, documentation, security) and derives a
deterministic verdict.

**Contract:**

- **Input**: `PR_TITLE` and `PR_BODY` environment variables (body may be
  empty), and the unified diff on **stdin**. Diffs are truncated at 100,000
  characters (`MAX_DIFF_CHARS`); truncation is flagged to both the model and
  the output.
- **Output**: a single JSON object on stdout —
  `{ summary, scores, findings, verdict, truncated, model }` where `verdict`
  is `"passed"` / `"failed"` (fails iff any criterion scores below 5) and
  `model` is the resolved OpenRouter model id. Diagnostics go to stderr only;
  stdout stays pure JSON.
- **Exit codes**: `0` when the review completed, regardless of verdict. `1` on
  infrastructure errors: missing `OPENROUTER_API_KEY`, missing/empty
  `PR_TITLE`, empty stdin/diff, or a model/API/schema failure.

```bash
git diff main...HEAD | PR_TITLE="Add feature" PR_BODY="Details..." npm start
```

## CI integration

Every PR to `main` is reviewed automatically by the `AI Code Review` workflow
(`.github/workflows/ai-review.yml`, `pull_request_target`), which delegates to
the composite action `.github/actions/ai-review`. The action:

1. bootstraps the `ai-cr:passed` / `ai-cr:failed` / `ai-cr:review` labels,
2. installs this package (`npm ci`, cached on its lockfile),
3. fetches the PR title/body/diff via `gh` (the PR is passive data — its code
   is never checked out or executed),
4. runs the CLI above, renders `src/render-comment.ts`, upserts one sticky
   comment (marked `<!-- ai-cr -->`), and swaps the verdict labels.

Action inputs: `openrouter-api-key` (required), `github-token` (required),
`pr-number` (required), `model` (optional → `OPENROUTER_MODEL`).

The verdict is advisory: the check is green whenever the review completes;
only infrastructure errors (missing key, model/API failure) fail the job.
Add the `ai-cr:review` label to a PR to re-run its review on demand.

**Prerequisite**: the `OPENROUTER_API_KEY` repository secret must be set once
(`gh secret set OPENROUTER_API_KEY`).

## Usage

Other scripts:

```bash
npm run demo       # snippet-review demo against a hardcoded buggy sample
npm run dev        # demo in watch mode
npm test           # node:test unit tests (verdict, truncation)
npm run typecheck  # tsc --noEmit
```

Or import the reusable API from the barrel:

```ts
import { reviewCode, createCodeReviewer, codeReviewer } from "./src/index.ts";

// Simplest entry point — uses the default singleton.
const result = await reviewCode(source, { language: "TypeScript" });
console.log(result.summary, result.findings);

// Build a reviewer bound to a specific model (e.g. for evals).
const reviewer = createCodeReviewer({ model: "openai/gpt-4o" });
// `options` is required once callOptionsSchema is set — pass `{}` when no hint.
const { output } = await reviewer.generate({ prompt: source, options: {} });

// Or reuse the shared default agent directly.
await codeReviewer.generate({ prompt: source, options: { language: "TypeScript" } });
```

`reviewCode` reads `OPENROUTER_API_KEY` from the environment and defaults to the
`anthropic/claude-sonnet-5` model (override via `OPENROUTER_MODEL` or the
`model` option).
