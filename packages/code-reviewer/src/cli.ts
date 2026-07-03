import { pathToFileURL } from "node:url";
import { text } from "node:stream/consumers";
import { DEFAULT_MODEL } from "./agent.js";
import { reviewPr } from "./pr-agent.js";
import { deriveVerdict } from "./verdict.js";
import { truncateDiff } from "./truncate.js";

/**
 * PR-review CLI — the machine-readable seam the composite action calls.
 *
 * Contract:
 *   - Input: `PR_TITLE` and `PR_BODY` env vars (body may be empty), unified
 *     diff on stdin.
 *   - Output: a single JSON object on stdout —
 *     `{ summary, scores, findings, verdict, truncated, model }`.
 *     Diagnostics go to stderr only; stdout stays pure JSON.
 *   - Exit codes: 0 when the review completed (regardless of verdict),
 *     1 on infrastructure errors (missing `OPENROUTER_API_KEY`, empty
 *     stdin/diff, model/API/schema failure).
 */

/** Print an infrastructure-error diagnostic to stderr and flag exit 1. */
function fail(message: string): void {
  console.error(`ai-review: ${message}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    fail("missing OPENROUTER_API_KEY environment variable.");
    return;
  }

  const title = process.env.PR_TITLE;
  if (!title || title.trim() === "") {
    fail("missing PR_TITLE environment variable.");
    return;
  }
  const description = process.env.PR_BODY ?? "";

  if (process.stdin.isTTY) {
    fail("no diff on stdin — pipe the PR diff in (e.g. `gh pr diff <n> | ...`).");
    return;
  }
  const rawDiff = await text(process.stdin);
  if (rawDiff.trim() === "") {
    fail("empty diff on stdin.");
    return;
  }

  const { diff, truncated } = truncateDiff(rawDiff);
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const result = await reviewPr({ title, description, diff, truncated });

  const output = {
    summary: result.summary,
    scores: result.scores,
    findings: result.findings,
    verdict: deriveVerdict(result.scores),
    truncated,
    model,
  };
  console.log(JSON.stringify(output, null, 2));
}

// Run only when executed directly (e.g. `npm start`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Model/API/schema failures are infrastructure errors: exit 1, stderr only.
    fail(error instanceof Error ? error.message : String(error));
  });
}
