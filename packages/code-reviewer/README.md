# @10xdevs/code-reviewer

AI-powered code reviewer built on the [Vercel AI SDK](https://ai-sdk.dev), the
[OpenRouter](https://openrouter.ai) provider, and [zod](https://zod.dev) for
validated structured output. This is the base entry point (`src/index.ts`) that
further features build on.

## Stack

| Package                        | Version | Notes                                          |
| ------------------------------ | ------- | ---------------------------------------------- |
| `ai`                           | ^6      | AI SDK core (`generateText` + `Output.object`) |
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

## Usage

Run the demo review:

```bash
npm start          # tsx src/index.ts
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
```

Or import the reusable API:

```ts
import { reviewCode } from "./src/index.ts";

const result = await reviewCode(source, { language: "TypeScript" });
console.log(result.summary, result.findings);
```

`reviewCode` reads `OPENROUTER_API_KEY` from the environment and defaults to the
`anthropic/claude-sonnet-5` model (override via `OPENROUTER_MODEL` or the
`model` option).
