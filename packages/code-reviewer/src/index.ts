import { pathToFileURL } from "node:url";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ReviewResult } from "./models/review.js";
import { SYSTEM_INSTRUCTIONS, buildReviewPrompt, appendLanguageHint } from "./prompts/review.js";

/**
 * Entry point for the AI-powered code reviewer.
 *
 * Wires together the three building blocks that the rest of the package will
 * grow on top of:
 *   - the Vercel AI SDK (`generateText` + `Output.object`) for model calls,
 *   - the OpenRouter provider for model access, and
 *   - zod for validating the model's structured output.
 *
 * Keep this file thin: it exposes a reusable `reviewCode` function plus a small
 * demo `main()` so further features can import `reviewCode` without triggering
 * the demo.
 */

/** Model to review with. Any OpenRouter model id works (e.g. `openai/gpt-4o`). */
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

// Re-export the structured-output schemas + inferred types so existing import paths keep working.
export { ReviewFinding, ReviewResult } from "./models/review.js";

export interface ReviewOptions {
  /** OpenRouter model id. Defaults to `OPENROUTER_MODEL` env var or `DEFAULT_MODEL`. */
  model?: string;
  /** Optional language/framework hint to focus the review. */
  language?: string;
}

/**
 * Review a snippet of code and return a structured, validated result.
 *
 * Requires the `OPENROUTER_API_KEY` environment variable to be set.
 */
export async function reviewCode(code: string, options: ReviewOptions = {}): Promise<ReviewResult> {
  const openrouter = createOpenRouter();
  const modelId = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const { output } = await generateText({
    model: openrouter(modelId),
    output: Output.object({ schema: ReviewResult }),
    system: appendLanguageHint(SYSTEM_INSTRUCTIONS, options.language),
    prompt: buildReviewPrompt(code),
  });

  return output;
}

/** Small demonstration run, executed only when this file is the entry point. */
async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "Missing OPENROUTER_API_KEY. Copy .env.example to .env and add your key,\n" +
        "then run with: OPENROUTER_API_KEY=... npm start   (or use a dotenv loader).",
    );
    process.exitCode = 1;
    return;
  }

  const sample = [
    "function sum(items) {",
    "  let total;",
    "  for (let i = 0; i <= items.length; i++) {",
    "    total += items[i];",
    "  }",
    "  return total;",
    "}",
  ].join("\n");

  console.log(`Reviewing sample snippet with ${process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL}...\n`);
  const result = await reviewCode(sample, { language: "JavaScript" });

  console.log(result.summary, "\n");
  for (const f of result.findings) {
    const where = f.line === null ? "" : ` (line ${f.line})`;
    console.log(`[${f.severity}]${where} ${f.issue}\n  -> ${f.suggestion}\n`);
  }
}

// Run the demo only when executed directly (e.g. `npm start`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
