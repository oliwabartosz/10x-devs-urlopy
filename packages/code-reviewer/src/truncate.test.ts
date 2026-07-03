import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateDiff, MAX_DIFF_CHARS } from "./truncate.js";

void test("a diff under the budget is returned untouched", () => {
  const diff = "a".repeat(MAX_DIFF_CHARS - 1);
  assert.deepEqual(truncateDiff(diff), { diff, truncated: false });
});

void test("a diff exactly at the budget is returned untouched", () => {
  const diff = "a".repeat(MAX_DIFF_CHARS);
  assert.deepEqual(truncateDiff(diff), { diff, truncated: false });
});

void test("a diff over the budget is cut at the budget and flagged", () => {
  const result = truncateDiff("a".repeat(MAX_DIFF_CHARS + 1));
  assert.equal(result.diff.length, MAX_DIFF_CHARS);
  assert.equal(result.truncated, true);
});

void test("the cut keeps the head of the diff", () => {
  const head = "diff --git a/file b/file\n";
  const result = truncateDiff(head + "b".repeat(MAX_DIFF_CHARS));
  assert.ok(result.diff.startsWith(head));
});
