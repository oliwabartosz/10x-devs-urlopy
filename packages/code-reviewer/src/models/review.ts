import { z } from "zod";

/**
 * Structured-output schemas for the code reviewer.
 *
 * Kept separate from the agent wiring so they can be reused by the agent, by
 * callers, and by evals (e.g. promptfoo) independently.
 */

/** Shape of a single review finding, validated against the model's output. */
export const ReviewFinding = z.object({
  severity: z.enum(["info", "minor", "major", "critical"]),
  line: z.number().nullable().describe("1-based line number, or null if not line-specific"),
  issue: z.string().describe("What is wrong or risky"),
  suggestion: z.string().describe("Concrete fix or improvement"),
});

/** Shape of a full review result. */
export const ReviewResult = z.object({
  summary: z.string().describe("One-paragraph overall assessment"),
  findings: z.array(ReviewFinding),
});

export type ReviewFinding = z.infer<typeof ReviewFinding>;
export type ReviewResult = z.infer<typeof ReviewResult>;
