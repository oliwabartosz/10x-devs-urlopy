import { z } from "zod";
import { ReviewFinding } from "./review.js";

/**
 * Structured-output schemas for the PR review mode.
 *
 * Mirrors the schema/agent split of `review.ts`: the shapes live here so the
 * agent, callers, and future evals can share them. The pass/fail verdict is
 * deliberately NOT part of the model output — it is derived deterministically
 * from the scores in `../verdict.ts`.
 */

/** A single rubric criterion: a 1–10 score with the model's justification. */
export const CriterionScore = z.object({
  // Plain z.number(): Anthropic structured outputs reject minimum/maximum on
  // integer schemas, and zod's .int()/.min()/.max() all emit them — the 1–10
  // integer range is enforced by the prompt and description instead.
  score: z.number().describe("Integer score from 1 (worst) to 10 (best)"),
  justification: z.string().describe("Concise reasoning behind the score"),
});

/** Shape of a full PR review result: summary, six criterion scores, findings. */
export const PrReviewResult = z.object({
  summary: z.string().describe("One-paragraph overall assessment of the pull request"),
  scores: z.object({
    implementation: CriterionScore,
    idiomaticity: CriterionScore,
    complexity: CriterionScore,
    testCoverage: CriterionScore,
    documentation: CriterionScore,
    security: CriterionScore,
  }),
  findings: z.array(ReviewFinding),
});

export type CriterionScore = z.infer<typeof CriterionScore>;
export type PrReviewResult = z.infer<typeof PrReviewResult>;
