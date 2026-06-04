import { describe, it, expect } from "vitest";
import { extractPgErrorCode } from "@/lib/db-errors";

describe("extractPgErrorCode", () => {
  it("returns top-level code when present", () => {
    expect(extractPgErrorCode({ code: "23505" })).toBe("23505");
  });

  it("returns cause.code when top-level code is absent (critical: the cause.code fallback path)", () => {
    expect(extractPgErrorCode({ code: undefined, cause: { code: "23505" } })).toBe("23505");
  });

  it("returns undefined when neither code nor cause.code is set", () => {
    expect(extractPgErrorCode({})).toBeUndefined();
  });

  it("returns undefined without throwing for non-object input", () => {
    expect(extractPgErrorCode(null)).toBeUndefined();
    expect(extractPgErrorCode("string")).toBeUndefined();
    expect(extractPgErrorCode(undefined)).toBeUndefined();
  });
});
