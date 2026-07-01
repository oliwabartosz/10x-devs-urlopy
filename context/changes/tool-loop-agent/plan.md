# Code Reviewer → ToolLoopAgent Refactor Implementation Plan

## Overview

Convert `packages/code-reviewer/src/index.ts` — currently a single flat file that bundles zod schemas, prompt strings, a `generateText`-based `reviewCode` function, and a demo `main()` — into a **well-organized, modular code-review agent built on ai-sdk's `ToolLoopAgent`**. Schemas move into a `models/` module, prompts into a `prompts/` module, and the agent (plus a factory and a thin `reviewCode` wrapper) lives in `agent.ts`. The module exports a reusable, configured reviewer so that promptfoo can wrap it for evals later. **The eval environment itself is out of scope for this change.**

## Current State Analysis

- `packages/code-reviewer/src/index.ts` (108 lines) mixes four concerns:
  - **Schemas** (`index.ts:24-38`): `ReviewFinding`, `ReviewResult` zod objects + inferred types.
  - **Prompts** (`index.ts:61-65`): inline system string + user prompt template with a `languageHint`.
  - **Logic** (`index.ts:52-69`): `reviewCode(code, options)` using `generateText({ output: Output.object(...) })` + `createOpenRouter()`.
  - **Demo** (`index.ts:72-108`): `main()` guarded by an `import.meta.url` entry-point check.
- Package pins `ai@6.0.217` deliberately (`README.md`): `@openrouter/ai-sdk-provider@^2.10` targets the v3 provider spec (`ai@6`), not `ai@7`. **`ToolLoopAgent` is available in v6** — verified: `class ToolLoopAgent` exists in `node_modules/ai/dist/index.d.ts:3568`, and bundled docs live at `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`.
- No tools exist yet. A `ToolLoopAgent` with no `tools` is effectively a single-step structured generator; tools can be added later without changing the export surface.
- Only build tooling in this package: `typecheck` (`tsc --noEmit`), `dev` (`tsx watch`), `start` (`tsx`). No package-local lint/test. `tsconfig.json` is strict (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `NodeNext`).

### Key Discoveries:

- **`ToolLoopAgent` API** (`node_modules/ai/docs/.../16-tool-loop-agent.mdx`): `new ToolLoopAgent({ model, instructions, output, tools, callOptionsSchema, prepareCall, stopWhen })`; `instructions` replaces today's `system:` string; `output: Output.object({ schema: ReviewResult })` is unchanged from current usage; `agent.generate({ prompt, options })` returns a result whose `.output` is typed by the schema.
- **`callOptionsSchema` + `prepareCall`** (`node_modules/ai/docs/03-agents/05-configuring-call-options.mdx`): declare `callOptionsSchema: z.object({ language: z.string().optional() })`; `prepareCall({ options, ...settings })` returns modified settings — e.g. `{ ...settings, instructions: settings.instructions + hint }`. `prepareCall` may be async. **Gotcha: once `callOptionsSchema` is set, the `options` property becomes required on `generate()`/`stream()`** (see doc: "The `options` parameter is now required and type-checked").
- **`model` accepts a `LanguageModel` instance** — pass `openrouter(modelId)` from `createOpenRouter()`, exactly as today (`index.ts:53,59`).
- **File-convention reference** (`.claude/skills/ai-sdk/references/type-safe-agents.md`) uses `lib/agents/` + `lib/tools/`; adapted here to this package's `src/` layout.

## Desired End State

`packages/code-reviewer/src/` is organized as:

```
src/
  models/review.ts    # ReviewFinding, ReviewResult zod schemas + inferred types
  prompts/review.ts    # SYSTEM_INSTRUCTIONS + buildReviewPrompt() + language-hint helper
  agent.ts             # createCodeReviewer() factory, codeReviewer singleton, reviewCode() wrapper
  index.ts             # barrel: re-exports everything (back-compat surface)
  demo.ts              # the moved main() demo, guarded by import.meta.url
```

Verification of the end state:
- `npm run typecheck` passes.
- `import { reviewCode } from "./src/index.ts"` and `import { ReviewResult, ReviewFinding } from "./src/index.ts"` still resolve (back-compat).
- `codeReviewer` (a `ToolLoopAgent` instance) and `createCodeReviewer({ model })` are exported for reuse/evals.
- `npm start` runs the demo review end-to-end (manual, needs `OPENROUTER_API_KEY`).

## What We're NOT Doing

- **Not** configuring promptfoo or any eval environment (no config files, no eval scripts, no test harness).
- **Not** adding any tools to the agent (no `tools:` set yet) — the loop is single-step for now.
- **Not** adding streaming / `useChat` / UI code, or `InferAgentUIMessage` exports (no consumer yet).
- **Not** changing the model provider (stays OpenRouter via `@openrouter/ai-sdk-provider`), the default model (`anthropic/claude-sonnet-5`), or the `OPENROUTER_MODEL` env override.
- **Not** upgrading `ai` to v7 or changing dependency versions.
- **Not** adding package-local lint/test tooling.

## Implementation Approach

Three incremental phases, each independently typecheckable. First extract the two leaf modules (models, prompts) with zero behavior change. Then introduce `agent.ts` — the `ToolLoopAgent`, its factory, the default singleton, and the `reviewCode` wrapper that delegates to the agent (replacing `generateText`). Finally collapse `index.ts` into a re-export barrel, move the demo into `demo.ts`, repoint the npm scripts, and refresh the README.

## Critical Implementation Details

- **`options` is required once `callOptionsSchema` is set.** The `reviewCode(code, options)` wrapper must always call `codeReviewer.generate({ prompt, options: { language: options.language } })` — passing the `options` object even when `language` is `undefined`. Document that direct `codeReviewer.generate(...)` callers must also supply `options` (e.g. `options: {}`).
- **`prepareCall` injects language into `instructions`, not the prompt.** Keep the system prompt static in `SYSTEM_INSTRUCTIONS`; `prepareCall` appends the per-call language hint to `settings.instructions`. The user prompt is the fenced code from `buildReviewPrompt(code)`.
- **`verbatimModuleSyntax` is on** — type-only imports/re-exports must use `import type` / `export type`. The barrel re-exporting `ReviewFinding`/`ReviewResult` (which are both a value schema and an inferred type under the same name) must re-export the zod value and the type correctly.

## Phase 1: Models & Prompts Modules

### Overview

Extract the schemas and prompt strings into their own modules with no behavior change; rewire `index.ts` to import from them while it still uses `generateText`.

### Changes Required:

#### 1. Review schemas module

**File**: `packages/code-reviewer/src/models/review.ts` (new)

**Intent**: Hold the structured-output schemas so they can be reused by the agent and by evals independently of the agent wiring.

**Contract**: Export `ReviewFinding` and `ReviewResult` zod schemas (moved verbatim from `index.ts:24-35`, including `.describe()` calls) and their inferred types `export type ReviewFinding` / `export type ReviewResult` (`index.ts:37-38`). No logic.

#### 2. Prompts module

**File**: `packages/code-reviewer/src/prompts/review.ts` (new)

**Intent**: Centralize the system prompt and the user-prompt construction so prompts are versionable and eval-friendly, separate from model wiring.

**Contract**: Export `SYSTEM_INSTRUCTIONS` (the senior-engineer string from `index.ts:62-64`), `buildReviewPrompt(code: string): string` (the fenced user prompt from `index.ts:65`, minus the language hint), and `appendLanguageHint(instructions: string, language?: string): string` (returns `instructions` unchanged when `language` is absent, else appends the `The code is written in ${language}.` hint). The language hint moves out of the user prompt and into an instructions augmentation, ready for `prepareCall`.

#### 3. Rewire index.ts imports

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Consume the new modules while leaving `reviewCode`/`main` behavior identical, proving the extraction is safe before the agent swap.

**Contract**: Remove the inline schema and prompt definitions; import `ReviewResult` (and types) from `./models/review.ts` and `SYSTEM_INSTRUCTIONS`/`buildReviewPrompt` from `./prompts/review.ts`. `reviewCode` still uses `generateText` this phase. Preserve existing `export`s of `ReviewFinding`/`ReviewResult`/`reviewCode` so nothing downstream breaks.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `cd packages/code-reviewer && npm run typecheck`
- New files exist: `src/models/review.ts`, `src/prompts/review.ts`

#### Manual Verification:

- `git diff` shows schemas/prompts moved verbatim (no accidental wording/severity changes).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Agent Module

### Overview

Introduce `src/agent.ts`: the `ToolLoopAgent`, a factory for per-run configuration (model), a default singleton, the `language` call-options wiring, and a `reviewCode` wrapper that delegates to the agent instead of `generateText`.

### Changes Required:

#### 1. Agent factory + singleton + wrapper

**File**: `packages/code-reviewer/src/agent.ts` (new)

**Intent**: Provide a reusable agent instance plus a factory so evals can vary the model per run, and keep the ergonomic `reviewCode` function as the simplest promptfoo entry point.

**Contract**:
- `DEFAULT_MODEL = "anthropic/claude-sonnet-5"` (moved from `index.ts:21`).
- `interface ReviewOptions { model?: string; language?: string }` (moved from `index.ts:40-45`).
- `createCodeReviewer(config?: { model?: string }): ToolLoopAgent<...>` — resolves `config.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL`, builds the OpenRouter provider via `createOpenRouter()`, and returns a `ToolLoopAgent` configured with: `model: openrouter(modelId)`, `instructions: SYSTEM_INSTRUCTIONS`, `output: Output.object({ schema: ReviewResult })`, `callOptionsSchema: z.object({ language: z.string().optional() })`, and `prepareCall({ options, ...settings }) => ({ ...settings, instructions: appendLanguageHint(settings.instructions, options.language) })`.
- `codeReviewer` — default singleton: `export const codeReviewer = createCodeReviewer()`.
- `reviewCode(code: string, options?: ReviewOptions): Promise<ReviewResult>` — if `options.model` is set, use `createCodeReviewer({ model })`, else use the `codeReviewer` singleton; call `.generate({ prompt: buildReviewPrompt(code), options: { language: options?.language } })` and return `.output`.

The `prepareCall` closure and the always-pass-`options` rule are the load-bearing details from "Critical Implementation Details".

### Success Criteria:

#### Automated Verification:

- Type checking passes: `cd packages/code-reviewer && npm run typecheck`
- `src/agent.ts` exists and exports `codeReviewer`, `createCodeReviewer`, `reviewCode`.

#### Manual Verification:

- `codeReviewer.generate({ prompt, options: {} })` shape typechecks in an editor (confirms `output`/`callOptions` generics resolved).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Barrel, Demo Split & Packaging

### Overview

Collapse `index.ts` into a clean re-export barrel, move `main()` into `src/demo.ts`, repoint npm scripts, and update the README to document the new surface.

### Changes Required:

#### 1. Barrel index.ts

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Provide one back-compat entry point that re-exports the full public surface without side effects (safe to import from promptfoo/tests).

**Contract**: Remove `reviewCode`/`main`/entry-point guard. Re-export: from `./agent.ts` → `reviewCode`, `createCodeReviewer`, `codeReviewer`, `ReviewOptions`; from `./models/review.ts` → `ReviewFinding`, `ReviewResult` (zod values **and** inferred types — mind `verbatimModuleSyntax`); from `./prompts/review.ts` → `SYSTEM_INSTRUCTIONS`, `buildReviewPrompt`. No top-level executable code.

#### 2. Demo module

**File**: `packages/code-reviewer/src/demo.ts` (new)

**Intent**: Preserve the quick manual `npm start` sanity check as an isolated, importless-of-side-effects entry.

**Contract**: Move `main()` (`index.ts:72-108`) verbatim, importing `reviewCode` and `DEFAULT_MODEL` from `./agent.ts` (or the barrel). Keep the `OPENROUTER_API_KEY` guard and the `import.meta.url === pathToFileURL(process.argv[1]).href` entry-point check.

#### 3. Packaging + docs

**File**: `packages/code-reviewer/package.json`

**Intent**: Point run scripts at the relocated demo.

**Contract**: `start` → `tsx src/demo.ts`; `dev` → `tsx watch src/demo.ts`. `typecheck` unchanged.

**File**: `packages/code-reviewer/README.md`

**Intent**: Document the modular layout and the reusable exports (agent + factory + `reviewCode`).

**Contract**: Update the Usage section to show importing `reviewCode`, `createCodeReviewer`, and `codeReviewer` from the barrel; note the `src/` module layout; keep the existing model/env notes. Update the "AI SDK v6, not v7" note only if wording references `generateText` specifically (now `ToolLoopAgent`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `cd packages/code-reviewer && npm run typecheck`
- Barrel resolves: `node --input-type=module -e "import('./packages/code-reviewer/src/index.ts')"` does not execute the demo (no `OPENROUTER_API_KEY` error printed). *(If `tsx`-only resolution is needed, use `npx tsx -e "import '@10xdevs/code-reviewer/src/index.ts'"` equivalently.)*
- `src/demo.ts` exists; `index.ts` contains no `main()`.

#### Manual Verification:

- `OPENROUTER_API_KEY=... npm start` runs the sample review and prints a summary + findings.
- Importing `reviewCode` from the barrel and running a review returns a validated `ReviewResult` with a `language` hint applied.

**Implementation Note**: After automated verification passes, this completes the plan; confirm the manual demo run before closing out.

---

## Testing Strategy

### Unit Tests:

- None added this change (no package-local test runner). Correctness is guarded by `tsc --noEmit` (strict) plus the manual demo run.

### Integration Tests:

- Manual end-to-end via `npm start` (real OpenRouter call).

### Manual Testing Steps:

1. `cd packages/code-reviewer && npm run typecheck` — expect no errors.
2. `OPENROUTER_API_KEY=... npm start` — expect a printed summary and findings for the buggy `sum` sample.
3. In a scratch file, `import { reviewCode, codeReviewer, createCodeReviewer } from "./src/index.ts"`; call `reviewCode(code, { language: "TypeScript" })` and confirm a validated result.

## Performance Considerations

None. A tool-less `ToolLoopAgent` performs one model round-trip, equivalent to today's `generateText` call. `createCodeReviewer` per-call (only when `options.model` is passed) rebuilds the provider/agent — acceptable and confined to the override path; the default path reuses the singleton.

## Migration Notes

Back-compat is preserved: `index.ts` re-exports `reviewCode`, `ReviewFinding`, `ReviewResult`, so existing import paths and the README example keep working. The only behavioral shift is that the `language` hint now augments `instructions` (via `prepareCall`) instead of the user prompt — functionally equivalent guidance to the model.

## References

- Current implementation: `packages/code-reviewer/src/index.ts:1-108`
- ai-sdk skill: `packages/code-reviewer/.claude/skills/ai-sdk/SKILL.md`
- ToolLoopAgent API: `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`
- Call options (language via prepareCall): `node_modules/ai/docs/03-agents/05-configuring-call-options.mdx`
- File conventions: `packages/code-reviewer/.claude/skills/ai-sdk/references/type-safe-agents.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Models & Prompts Modules

#### Automated

- [x] 1.1 Type checking passes: `cd packages/code-reviewer && npm run typecheck` — a372156
- [x] 1.2 New files exist: `src/models/review.ts`, `src/prompts/review.ts` — a372156

#### Manual

- [x] 1.3 `git diff` shows schemas/prompts moved verbatim (no wording/severity changes) — a372156

### Phase 2: Agent Module

#### Automated

- [x] 2.1 Type checking passes: `cd packages/code-reviewer && npm run typecheck` — 2863dd8
- [x] 2.2 `src/agent.ts` exports `codeReviewer`, `createCodeReviewer`, `reviewCode` — 2863dd8

#### Manual

- [x] 2.3 `codeReviewer.generate({ prompt, options: {} })` shape typechecks (generics resolved) — 2863dd8

### Phase 3: Barrel, Demo Split & Packaging

#### Automated

- [x] 3.1 Type checking passes: `cd packages/code-reviewer && npm run typecheck`
- [x] 3.2 Barrel import does not execute the demo (no side effects on import)
- [x] 3.3 `src/cli.ts` (renamed from `demo.ts`) exists; `index.ts` contains no `main()`

#### Manual

- [x] 3.4 `OPENROUTER_API_KEY=... npm start` runs the sample review and prints summary + findings
- [x] 3.5 Importing `reviewCode` from the barrel returns a validated `ReviewResult` with the language hint applied
