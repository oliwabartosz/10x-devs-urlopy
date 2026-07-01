/**
 * Public entry point for the AI-powered code reviewer.
 *
 * A re-export barrel for the full public surface (agent, factory, `reviewCode`
 * wrapper, schemas, and prompts) so consumers — including promptfoo evals and
 * tests — can import from one place. Importing runs no demo and makes no network
 * call: the eager `codeReviewer` singleton only resolves the API key lazily at
 * request time, so a keyless import is safe. The runnable demo lives in `./cli.ts`.
 */

export { reviewCode, createCodeReviewer, codeReviewer, DEFAULT_MODEL } from "./agent.js";
export type { ReviewOptions } from "./agent.js";

// `ReviewFinding` / `ReviewResult` are each both a zod value and an inferred
// type under the same name; a plain re-export carries both meanings (the value
// binding and the type binding), which satisfies `verbatimModuleSyntax`.
export { ReviewFinding, ReviewResult } from "./models/review.js";

export { SYSTEM_INSTRUCTIONS, buildReviewPrompt } from "./prompts/review.js";
