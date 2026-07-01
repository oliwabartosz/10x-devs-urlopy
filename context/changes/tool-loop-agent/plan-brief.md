# Code Reviewer → ToolLoopAgent Refactor — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Convert `packages/code-reviewer/src/index.ts` — one flat file mixing schemas, prompts, logic, and a demo — into a modular, reusable code-review **agent built on ai-sdk's `ToolLoopAgent`**. The goal is a clean export surface (a configured agent + a factory + a `reviewCode` function) that promptfoo can wrap for evals later, without building the eval environment now.

## Starting Point

`index.ts` (108 lines) holds the `ReviewFinding`/`ReviewResult` zod schemas, inline system/user prompts, a `generateText`-based `reviewCode`, and a guarded demo `main()`. The package deliberately pins `ai@6.0.217` (OpenRouter provider targets the v6 provider spec); `ToolLoopAgent` is confirmed available in v6.

## Desired End State

`src/` is split into `models/review.ts` (schemas), `prompts/review.ts` (system prompt + prompt builder + language-hint helper), `agent.ts` (the `ToolLoopAgent`, a `createCodeReviewer` factory, a default `codeReviewer` singleton, and the `reviewCode` wrapper), a re-export barrel `index.ts`, and a relocated `demo.ts`. Existing imports keep working; `codeReviewer` and `createCodeReviewer` are exported for reuse/evals.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Module layout | `models/` + `prompts/` + `agent.ts` + barrel `index.ts` | Honors "extract schemas and prompts" with least ceremony for a one-agent package. | Plan |
| Export surface | Both the `codeReviewer` agent instance **and** a `reviewCode()` wrapper | Function is the easiest promptfoo entry; raw agent stays for streaming/tools/types later. | Plan |
| Construction | `createCodeReviewer(config)` factory **+** default singleton | Evals can vary model per run; normal use imports the ready singleton. | Plan |
| Language hint | `callOptionsSchema` + `prepareCall` (agent-native) | Type-safe per-call option that augments `instructions`; evals can pass `language` natively. | Plan |
| Demo | Moved to `src/demo.ts`, `npm start` repointed | Keeps the barrel side-effect-free so it's safe to import. | Plan |
| Back-compat | Barrel re-exports everything (incl. `ReviewFinding`/`ReviewResult`) | Existing import paths and the README example keep working. | Plan |

## Scope

**In scope:** module split (models/prompts/agent/barrel/demo); `ToolLoopAgent` with `output` schema; factory + singleton; `language` via `callOptionsSchema`/`prepareCall`; `reviewCode` wrapper; README + npm script updates.

**Out of scope:** promptfoo/eval environment; adding tools to the agent; streaming/`useChat`/UI types; provider/model/dependency changes; package-local lint/test tooling.

## Architecture / Approach

`createCodeReviewer({ model })` builds an OpenRouter-backed `ToolLoopAgent` with static `SYSTEM_INSTRUCTIONS`, `Output.object({ schema: ReviewResult })`, and a `callOptionsSchema` of `{ language? }` whose `prepareCall` appends a language hint to `instructions`. `reviewCode(code, options)` builds the fenced prompt via `buildReviewPrompt`, calls `generate({ prompt, options: { language } })`, and returns the validated `.output`. `index.ts` re-exports the lot; `demo.ts` carries the guarded `main()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Models & Prompts | `models/review.ts` + `prompts/review.ts`, `index.ts` rewired (behavior unchanged) | Accidental wording/severity drift during move |
| 2. Agent module | `agent.ts` with factory, singleton, `callOptionsSchema`/`prepareCall`, `reviewCode` | `options`-required gotcha; generic resolution of `output`/call-options |
| 3. Barrel, demo, packaging | Re-export barrel, `demo.ts`, npm scripts, README | `verbatimModuleSyntax` value-vs-type re-export; demo side-effects on import |

**Prerequisites:** `OPENROUTER_API_KEY` for the manual demo run (typecheck needs none).
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Once `callOptionsSchema` is set, `generate()` requires an `options` property — the `reviewCode` wrapper always passes it; direct agent callers must too.
- `prepareCall` injects the language hint into `instructions` (not the user prompt) — functionally equivalent guidance, minor behavioral shift from today.
- No automated tests in this package; correctness rests on strict typecheck + a manual demo run.

## Success Criteria (Summary)

- `npm run typecheck` passes; existing `reviewCode`/schema imports still resolve.
- `codeReviewer` (agent) and `createCodeReviewer` (factory) are exported and reusable.
- `npm start` runs an end-to-end review; a barrel import does not trigger the demo.
