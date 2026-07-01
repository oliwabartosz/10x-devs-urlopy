# @10xdevs/code-reviewer

AI-powered code reviewer built on the [Vercel AI SDK](https://ai-sdk.dev)'s
`ToolLoopAgent`, the [OpenRouter](https://openrouter.ai) provider, and
[zod](https://zod.dev) for validated structured output. The barrel
(`src/index.ts`) re-exports the reusable surface that further features build on.

## Module layout

```
src/
  models/review.ts   # ReviewFinding, ReviewResult zod schemas + inferred types
  prompts/review.ts  # SYSTEM_INSTRUCTIONS + buildReviewPrompt() + language hint
  agent.ts           # createCodeReviewer() factory, codeReviewer singleton, reviewCode()
  index.ts           # barrel: re-exports the public surface (no side effects)
  cli.ts             # runnable npm start / npm run dev demo
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

## Usage

Run the demo review:

```bash
npm start          # tsx src/cli.ts
npm run dev        # watch mode
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
