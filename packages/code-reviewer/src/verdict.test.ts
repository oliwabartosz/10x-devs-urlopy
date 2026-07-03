import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveVerdict, PASS_FLOOR } from "./verdict.js";
import type { PrReviewResult } from "./models/pr-review.js";

function scores(overrides: Partial<Record<keyof PrReviewResult["scores"], number>> = {}, base = 7) {
  const criterion = (score: number) => ({ score, justification: "test" });
  return {
    implementation: criterion(overrides.implementation ?? base),
    idiomaticity: criterion(overrides.idiomaticity ?? base),
    complexity: criterion(overrides.complexity ?? base),
    testCoverage: criterion(overrides.testCoverage ?? base),
    documentation: criterion(overrides.documentation ?? base),
    security: criterion(overrides.security ?? base),
  };
}

void test("all criteria at the floor pass", () => {
  assert.equal(deriveVerdict(scores({}, PASS_FLOOR)), "passed");
});

void test("a single criterion below the floor fails", () => {
  assert.equal(deriveVerdict(scores({ testCoverage: PASS_FLOOR - 1 })), "failed");
});

void test("all criteria at the maximum pass", () => {
  assert.equal(deriveVerdict(scores({}, 10)), "passed");
});

void test("high scores do not compensate for one sub-floor criterion", () => {
  assert.equal(deriveVerdict(scores({ security: 1 }, 10)), "failed");
});
