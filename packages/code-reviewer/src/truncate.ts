/**
 * Diff truncation for the PR review pipeline.
 *
 * Large PRs (lockfiles, vendored code) would otherwise blow the token budget;
 * cutting at a fixed character cap bounds the worst-case model cost. The
 * `truncated` flag flows into both the prompt (`buildPrReviewPrompt`) and the
 * CLI's JSON output so neither the model nor the reader is misled.
 */

/** Maximum number of diff characters sent to the model. */
export const MAX_DIFF_CHARS = 100_000;

/** Cut the diff at `MAX_DIFF_CHARS` and flag whether anything was dropped. */
export function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) {
    return { diff, truncated: false };
  }
  return { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true };
}
