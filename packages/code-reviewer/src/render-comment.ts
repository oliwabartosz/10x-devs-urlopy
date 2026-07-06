import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { PrReviewResult } from "./models/pr-review.js";

/**
 * Render the PR-review CLI's JSON output as the sticky PR comment markdown.
 *
 * Lives in the package (next to the schema) as a pure, unit-tested function;
 * the composite action invokes it directly via
 * `npx tsx src/render-comment.ts <review.json>` and posts the stdout.
 */

/** The CLI's JSON output shape: the review result plus derived fields. */
export const RenderableReview = PrReviewResult.extend({
  verdict: z.enum(["passed", "failed"]),
  truncated: z.boolean(),
  model: z.string(),
});

export type RenderableReview = z.infer<typeof RenderableReview>;

/** Hidden marker the comment-upsert step searches for to find the sticky comment. */
export const COMMENT_MARKER = "<!-- ai-cr -->";

/** Display order and labels for the six rubric criteria. */
const CRITERIA: [keyof RenderableReview["scores"], string][] = [
  ["implementation", "Implementation"],
  ["idiomaticity", "Idiomaticity"],
  ["complexity", "Complexity"],
  ["testCoverage", "Test / risk coverage"],
  ["documentation", "Documentation"],
  ["security", "Security & safety"],
];

/** Keep model-authored text from breaking out of a markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Turn a review JSON object into the full sticky-comment markdown. */
export function renderComment(result: RenderableReview): string {
  const headline = result.verdict === "passed" ? "✅ AI code review: **passed**" : "❌ AI code review: **failed**";

  const table = [
    "| Criterion | Score | Justification |",
    "| --- | --- | --- |",
    ...CRITERIA.map(([key, label]) => {
      const { score, justification } = result.scores[key];
      return `| ${label} | ${score}/10 | ${cell(justification)} |`;
    }),
  ].join("\n");

  const findings =
    result.findings.length === 0
      ? "None."
      : result.findings
          .map((f) => {
            const where = f.line === null ? "" : ` (line ${f.line})`;
            return `- **${f.severity}**${where}: ${f.issue}\n  - Suggestion: ${f.suggestion}`;
          })
          .join("\n");

  const truncationNotice = result.truncated
    ? "\n> ⚠️ The diff exceeded the size budget and was truncated before review; scores cover only the visible part.\n"
    : "";

  return `${COMMENT_MARKER}

## ${headline}

${result.summary}

${table}

### Findings

${findings}
${truncationNotice}
---

_Model: \`${result.model}\` · Add the \`ai-cr:review\` label to re-run this review._
`;
}

// CLI mode for the composite action: render a review JSON file to stdout.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx src/render-comment.ts <review.json>");
    process.exitCode = 1;
  } else {
    const review = RenderableReview.parse(JSON.parse(readFileSync(path, "utf8")));
    console.log(renderComment(review));
  }
}
