import type { PrReviewResult } from "./models/pr-review.js";

/**
 * Deterministic pass/fail derivation for PR reviews.
 *
 * The verdict is computed here, not emitted by the model, so the threshold is
 * unit-testable and lives in exactly one place.
 */

/** Minimum acceptable score per criterion; anything below fails the review. */
export const PASS_FLOOR = 5;

/** Per-criterion floor rule: fail iff any of the six scores is below `PASS_FLOOR`. */
export function deriveVerdict(scores: PrReviewResult["scores"]): "passed" | "failed" {
  const failed = Object.values(scores).some((criterion) => criterion.score < PASS_FLOOR);
  return failed ? "failed" : "passed";
}
