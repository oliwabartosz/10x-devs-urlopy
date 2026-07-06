import { test } from "node:test";
import assert from "node:assert/strict";
import { renderComment, COMMENT_MARKER, MAX_COMMENT_CHARS, type RenderableReview } from "./render-comment.js";

function review(overrides: Partial<RenderableReview> = {}): RenderableReview {
  const criterion = { score: 8, justification: "solid work" };
  return {
    summary: "A tidy, well-tested change.",
    scores: {
      implementation: criterion,
      idiomaticity: criterion,
      complexity: criterion,
      testCoverage: criterion,
      documentation: criterion,
      security: criterion,
    },
    findings: [],
    verdict: "passed",
    truncated: false,
    model: "anthropic/claude-sonnet-5",
    ...overrides,
  };
}

void test("a passed review renders the passed headline and the marker", () => {
  const md = renderComment(review());
  assert.ok(md.startsWith(COMMENT_MARKER));
  assert.match(md, /✅ AI code review: \*\*passed\*\*/);
});

void test("a failed review renders the failed headline", () => {
  const md = renderComment(review({ verdict: "failed" }));
  assert.match(md, /❌ AI code review: \*\*failed\*\*/);
});

void test("all six criteria appear as table rows with scores", () => {
  const md = renderComment(review());
  for (const label of [
    "Implementation",
    "Idiomaticity",
    "Complexity",
    "Test / risk coverage",
    "Documentation",
    "Security & safety",
  ]) {
    assert.match(md, new RegExp(`\\| ${label.replace(/[/&]/g, "\\$&")} \\| 8/10 \\|`));
  }
});

void test("an empty findings list renders as None", () => {
  const md = renderComment(review({ findings: [] }));
  assert.match(md, /### Findings\n\nNone\./);
});

void test("findings render severity, line, issue, and suggestion", () => {
  const md = renderComment(
    review({
      findings: [
        { severity: "major", line: 12, issue: "Off-by-one in loop", suggestion: "Use < instead of <=" },
        { severity: "info", line: null, issue: "Consider a changelog entry", suggestion: "Add one" },
      ],
    }),
  );
  assert.match(md, /- \*\*major\*\* \(line 12\): Off-by-one in loop\n {2}- Suggestion: Use < instead of <=/);
  assert.match(md, /- \*\*info\*\*: Consider a changelog entry/);
});

void test("the truncation notice appears only when truncated", () => {
  assert.doesNotMatch(renderComment(review()), /truncated/);
  assert.match(renderComment(review({ truncated: true })), /> ⚠️ The diff exceeded the size budget/);
});

void test("the footer names the model and the retry label", () => {
  const md = renderComment(review());
  assert.match(md, /`anthropic\/claude-sonnet-5`/);
  assert.match(md, /`ai-cr:review`/);
});

void test("@-mentions in model-authored text are neutralized everywhere", () => {
  const md = renderComment(
    review({
      summary: "Ping @maintainers about this.",
      findings: [{ severity: "info", line: null, issue: "cc @octocat", suggestion: "ask @org/team" }],
      scores: {
        ...review().scores,
        security: { score: 6, justification: "flagged by @security-bot" },
      },
    }),
  );
  assert.doesNotMatch(md, /@maintainers/);
  assert.doesNotMatch(md, /@octocat/);
  assert.doesNotMatch(md, /@org\/team/);
  assert.doesNotMatch(md, /@security-bot/);
  // The visible text survives, just with the mention broken.
  assert.ok(md.includes("@\u200boctocat"));
});

void test("an oversized review is clamped under the comment limit, keeping the footer", () => {
  const finding = {
    severity: "minor" as const,
    line: null,
    issue: "x".repeat(1000),
    suggestion: "y".repeat(1000),
  };
  const md = renderComment(review({ findings: Array.from({ length: 50 }, () => finding) }));
  assert.ok(md.length <= MAX_COMMENT_CHARS);
  assert.match(md, /> ⚠️ Comment truncated to fit GitHub's size limit\./);
  assert.match(md, /`ai-cr:review`/);
});

void test("a normal-sized review carries no clamp notice", () => {
  assert.doesNotMatch(renderComment(review()), /Comment truncated/);
});

void test("pipes and newlines in justifications cannot break the table", () => {
  const md = renderComment(
    review({
      scores: {
        ...review().scores,
        security: { score: 3, justification: "bad | worse\nmultiline" },
      },
    }),
  );
  assert.match(md, /\| bad \\\| worse multiline \|/);
});
