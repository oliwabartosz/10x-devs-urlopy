/**
 * Deterministic (non-model-graded) assertions for the PR-review eval.
 *
 * These consume the provider's structured output — the validated
 * `PrReviewResult` object returned by evals/providers/pr-review.ts — and check
 * the parts of the review that must hold regardless of which model produced it.
 * They import the exact production `deriveVerdict` / `PASS_FLOOR` from the
 * package barrel so the eval asserts on the real pass/fail logic rather than a
 * re-implementation.
 *
 * Referenced from promptfooconfig.yaml as
 *   file://asserts/deterministic.ts:verdictFailed
 *   file://asserts/deterministic.ts:scoresWellFormed
 *
 * promptfoo calls each named export as `(output, context)`. Because the provider
 * returns an object as `output`, promptfoo hands these functions the parsed
 * object (not a JSON string). Each returns a `GradingResult`-shaped object so
 * the reason is self-explanatory in the viewer.
 */

import type { GradingResult } from "promptfoo";
import { deriveVerdict, PASS_FLOOR, type PrReviewResult } from "../../src/index.js";

/** The six rubric criteria, in the order they appear in `PrReviewResult.scores`. */
const CRITERIA = ["implementation", "idiomaticity", "complexity", "testCoverage", "documentation", "security"] as const;

/**
 * Narrow the provider output down to its `scores` object without trusting its
 * shape — a model failure or malformed output should produce a clear failing
 * reason, not a thrown TypeError that promptfoo reports as a harness error.
 */
function readScores(output: unknown): Record<string, { score?: unknown }> | null {
  if (typeof output !== "object" || output === null) return null;
  const scores = (output as { scores?: unknown }).scores;
  if (typeof scores !== "object" || scores === null) return null;
  return scores as Record<string, { score?: unknown }>;
}

/**
 * Passes iff the production verdict for this review is `"failed"`.
 *
 * This is the "static test verifying the code review actually fails" — the
 * fixture ships three severe defects, so a competent review must score at least
 * one criterion below `PASS_FLOOR`, which makes `deriveVerdict` return
 * `"failed"`. A `"passed"` verdict here is real signal (the model waved a
 * broken PR through), not a harness bug — so the assertion is not weakened to
 * let models pass.
 */
export function verdictFailed(output: unknown): GradingResult {
  const scores = readScores(output);
  if (!scores) {
    return {
      pass: false,
      score: 0,
      reason: "Provider output had no `scores` object; cannot derive a verdict.",
    };
  }

  const verdict = deriveVerdict(scores as PrReviewResult["scores"]);
  const pass = verdict === "failed";
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `deriveVerdict === "failed": at least one criterion scored below PASS_FLOOR (${PASS_FLOOR}), as a review of this PR should.`
      : `deriveVerdict === "passed": every criterion scored >= PASS_FLOOR (${PASS_FLOOR}). This PR ships three severe defects and should have failed.`,
  };
}

/**
 * Passes iff all six criterion scores are integers within the 1–10 range.
 *
 * The zod schema types `score` as a plain `z.number()` because Anthropic
 * structured outputs reject min/max on integer schemas (`src/models/pr-review.ts`),
 * so the 1–10 integer range is only prompt-enforced. This guards that
 * prompt-only contract deterministically.
 */
export function scoresWellFormed(output: unknown): GradingResult {
  const scores = readScores(output);
  if (!scores) {
    return {
      pass: false,
      score: 0,
      reason: "Provider output had no `scores` object; nothing to validate.",
    };
  }

  const offenders: string[] = [];
  for (const key of CRITERIA) {
    const value = scores[key]?.score;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
      offenders.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  const pass = offenders.length === 0;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? "All six criterion scores are integers within 1–10."
      : `Malformed score(s) — expected an integer in 1–10: ${offenders.join(", ")}`,
  };
}
