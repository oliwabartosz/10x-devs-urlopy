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

/** Stay safely under GitHub's 65,536-char comment body limit. */
export const MAX_COMMENT_CHARS = 60_000;

/** Display order and labels for the six rubric criteria. */
const CRITERIA: [keyof RenderableReview["scores"], string][] = [
  ["implementation", "Implementation"],
  ["idiomaticity", "Idiomaticity"],
  ["complexity", "Complexity"],
  ["testCoverage", "Test / risk coverage"],
  ["documentation", "Documentation"],
  ["security", "Security & safety"],
];

/**
 * Break `@user` / `@org/team` mentions in model-authored text with a
 * zero-width space so a prompt-injected review can't ping people from the
 * bot's comment. Model text derives from attacker-controlled PR content.
 */
function neutralizeMentions(text: string): string {
  return text.replace(/@(\w)/g, "@\u200b$1");
}

/** Keep model-authored text from breaking out of a markdown table cell. */
function cell(text: string): string {
  return neutralizeMentions(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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
            const issue = neutralizeMentions(f.issue);
            const suggestion = neutralizeMentions(f.suggestion);
            return `- **${f.severity}**${where}: ${issue}\n  - Suggestion: ${suggestion}`;
          })
          .join("\n");

  const truncationNotice = result.truncated
    ? "\n> ⚠️ The diff exceeded the size budget and was truncated before review; scores cover only the visible part.\n"
    : "";

  const footer = `
---

_Model: \`${result.model}\` · Add the \`ai-cr:review\` label to re-run this review._
`;

  let body = `${COMMENT_MARKER}

## ${headline}

${neutralizeMentions(result.summary)}

${table}

### Findings

${findings}
${truncationNotice}`;

  // Cut the body (never the footer) so an oversized review can't 422 the
  // comment API after a paid model call.
  const clampNotice = "\n\n> ⚠️ Comment truncated to fit GitHub's size limit.\n";
  if (body.length + footer.length > MAX_COMMENT_CHARS) {
    body = body.slice(0, MAX_COMMENT_CHARS - footer.length - clampNotice.length) + clampNotice;
  }

  return body + footer;
}

// CLI mode for the composite action: render a review JSON file to stdout.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx src/render-comment.ts <review.json>");
    process.exitCode = 1;
  } else {
    try {
      const review = RenderableReview.parse(JSON.parse(readFileSync(path, "utf8")));
      console.log(renderComment(review));
    } catch (error: unknown) {
      console.error(`ai-review: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
