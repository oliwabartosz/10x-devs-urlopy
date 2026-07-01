/**
 * Public entry point for the AI-powered code reviewer.
 *
 * A side-effect-free barrel: it re-exports the full public surface (agent,
 * factory, `reviewCode` wrapper, schemas, and prompts) so consumers — including
 * promptfoo evals and tests — can import from one place without triggering the
 * demo. The runnable demo lives in `./demo.ts`.
 */

export { reviewCode, createCodeReviewer, codeReviewer, DEFAULT_MODEL } from "./agent.js";
export type { ReviewOptions } from "./agent.js";

// `ReviewFinding` / `ReviewResult` are each both a zod value and an inferred
// type under the same name; a plain re-export carries both meanings (the value
// binding and the type binding), which satisfies `verbatimModuleSyntax`.
export { ReviewFinding, ReviewResult } from "./models/review.js";

export { SYSTEM_INSTRUCTIONS, buildReviewPrompt } from "./prompts/review.js";
