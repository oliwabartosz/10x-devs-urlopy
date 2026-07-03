import { ToolLoopAgent, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { DEFAULT_MODEL } from "./agent.js";
import { PrReviewResult } from "./models/pr-review.js";
import { PR_REVIEW_INSTRUCTIONS, buildPrReviewPrompt, type PrReviewInput } from "./prompts/pr-review.js";

/**
 * The PR-review agent.
 *
 * Mirrors the snippet reviewer in `agent.ts`: a tool-less `ToolLoopAgent`
 * doing a single structured-output round trip, parsed against `PrReviewResult`.
 * No per-call options schema — the PR mode has no language hint.
 *
 * Exposes three entry points:
 *   - `createPrReviewer({ model })` — build a PR reviewer bound to a model,
 *   - `prReviewer` — the default singleton (uses env / `DEFAULT_MODEL`),
 *   - `reviewPr(input, options)` — the ergonomic wrapper the CLI calls.
 */

export interface PrReviewOptions {
  /** OpenRouter model id. Defaults to `OPENROUTER_MODEL` env var or `DEFAULT_MODEL`. */
  model?: string;
}

/**
 * Build a PR-review agent bound to a specific model.
 *
 * Resolves the model id from `config.model`, then the `OPENROUTER_MODEL` env
 * var, then `DEFAULT_MODEL` — identical to `createCodeReviewer`.
 */
export function createPrReviewer(config: { model?: string } = {}) {
  const openrouter = createOpenRouter();
  const modelId = config.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  return new ToolLoopAgent({
    model: openrouter(modelId),
    instructions: PR_REVIEW_INSTRUCTIONS,
    output: Output.object({ schema: PrReviewResult }),
  });
}

/** Default PR reviewer singleton, reused across calls that don't override the model. */
export const prReviewer = createPrReviewer();

/**
 * Review a pull request (title + description + diff) and return a structured,
 * validated result.
 *
 * Uses the default singleton unless `options.model` requests a specific model,
 * in which case a per-call reviewer is built. Requires the `OPENROUTER_API_KEY`
 * environment variable to be set.
 */
export async function reviewPr(input: PrReviewInput, options: PrReviewOptions = {}): Promise<PrReviewResult> {
  const agent = options.model ? createPrReviewer({ model: options.model }) : prReviewer;

  const { output } = await agent.generate({
    prompt: buildPrReviewPrompt(input),
  });

  return output;
}
