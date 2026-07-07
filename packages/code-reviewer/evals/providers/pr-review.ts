/**
 * promptfoo → PR-review agent bridge.
 *
 * A custom promptfoo provider that wraps the production `reviewPr` path so the
 * eval exercises the real agent (prompt building, OpenRouter round-trip,
 * structured-output parsing, truncation) rather than a re-implementation. One
 * class, instantiated once per model in `promptfooconfig.yaml` via
 * `config.model`, so "same prompt, three models" is three provider entries over
 * one test case.
 *
 * Contract: reads `title` / `description` / `diff` from `context.vars`, mirrors
 * the CLI by running the diff through `truncateDiff` (deriving `truncated`),
 * calls `reviewPr(input, { model })`, and returns the validated
 * `PrReviewResult` object as `output` (or `error` on failure). It imports only
 * from the package barrel — never from env for the model id.
 */

import type {
  ApiProvider,
  CallApiContextParams,
  ProviderOptions,
  ProviderResponse,
} from "promptfoo";
import { reviewPr, truncateDiff, type PrReviewResult } from "../../src/index.js";

export default class PrReviewProvider implements ApiProvider {
  private readonly providerId: string;
  private readonly model: string;

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? "pr-review";

    // The model id comes from provider config (one entry per model in the
    // config), never from env — so the three config entries stay independent.
    const model = options.config?.model;
    if (typeof model !== "string" || model.trim() === "") {
      throw new Error(
        `pr-review provider requires a non-empty string 'config.model' (got ${JSON.stringify(model)})`,
      );
    }
    this.model = model;
  }

  id(): string {
    return this.providerId;
  }

  /**
   * `_prompt` is promptfoo's rendered prompt string; it is intentionally unused
   * — the agent builds its own prompt via `buildPrReviewPrompt` from the
   * structured vars below. The bridge's job is to feed those vars into the true
   * production path, not to hand promptfoo's prompt to the model.
   */
  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const vars = context?.vars ?? {};
    const title = typeof vars.title === "string" ? vars.title : "";
    const description = typeof vars.description === "string" ? vars.description : "";
    const rawDiff = typeof vars.diff === "string" ? vars.diff : "";

    // Mirror the production CLI (`src/cli.ts`): truncate before prompting and
    // carry the flag so the agent is told when it is seeing a partial diff.
    const { diff, truncated } = truncateDiff(rawDiff);

    try {
      const result: PrReviewResult = await reviewPr(
        { title, description, diff, truncated },
        { model: this.model },
      );
      return { output: result };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
