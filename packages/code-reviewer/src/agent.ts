import { ToolLoopAgent, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { ReviewResult } from "./models/review.js";
import { SYSTEM_INSTRUCTIONS, buildReviewPrompt, appendLanguageHint } from "./prompts/review.js";

/**
 * The code-review agent.
 *
 * A tool-less `ToolLoopAgent` configured for a single structured-output round
 * trip: it runs the review as one model call and parses the result against
 * `ReviewResult`. Tools can be added later without changing this surface.
 *
 * Exposes three entry points:
 *   - `createCodeReviewer({ model })` — build a reviewer bound to a model,
 *   - `codeReviewer` — the default singleton (uses env / `DEFAULT_MODEL`),
 *   - `reviewCode(code, options)` — the ergonomic wrapper promptfoo can call.
 */

/** Model to review with. Any OpenRouter model id works (e.g. `openai/gpt-4o`). */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

export interface ReviewOptions {
  /** OpenRouter model id. Defaults to `OPENROUTER_MODEL` env var or `DEFAULT_MODEL`. */
  model?: string;
  /** Optional language/framework hint to focus the review. */
  language?: string;
}

/** Per-call options accepted by the agent's `generate`/`stream`. */
const callOptionsSchema = z.object({ language: z.string().optional() });

/**
 * Build a code-review agent bound to a specific model.
 *
 * Resolves the model id from `config.model`, then the `OPENROUTER_MODEL` env
 * var, then `DEFAULT_MODEL`. The `language` call option is injected into the
 * agent's instructions (not the user prompt) via `prepareCall`.
 */
export function createCodeReviewer(config: { model?: string } = {}) {
  const openrouter = createOpenRouter();
  const modelId = config.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  return new ToolLoopAgent({
    model: openrouter(modelId),
    instructions: SYSTEM_INSTRUCTIONS,
    output: Output.object({ schema: ReviewResult }),
    callOptionsSchema,
    prepareCall: ({ options, ...settings }) => {
      // `instructions` is typed as a broad union, but we always configure it as
      // the `SYSTEM_INSTRUCTIONS` string — narrow before the string-only helper.
      const base = typeof settings.instructions === "string" ? settings.instructions : SYSTEM_INSTRUCTIONS;
      return { ...settings, instructions: appendLanguageHint(base, options.language) };
    },
  });
}

/** Default reviewer singleton, reused across calls that don't override the model. */
export const codeReviewer = createCodeReviewer();

/**
 * Review a snippet of code and return a structured, validated result.
 *
 * Uses the default singleton unless `options.model` requests a specific model,
 * in which case a per-call reviewer is built. Requires the `OPENROUTER_API_KEY`
 * environment variable to be set.
 */
export async function reviewCode(code: string, options: ReviewOptions = {}): Promise<ReviewResult> {
  const agent = options.model ? createCodeReviewer({ model: options.model }) : codeReviewer;

  const { output } = await agent.generate({
    prompt: buildReviewPrompt(code),
    options: { language: options.language },
  });

  return output;
}
