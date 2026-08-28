import { describe, it, expect } from "vitest";
import { withStyleDirectives } from "@/lib/csp";

describe("withStyleDirectives", () => {
  it("appends both style directives to a policy that has neither", () => {
    expect(withStyleDirectives("default-src 'self'")).toBe(
      "default-src 'self'; style-src-attr 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'",
    );
  });

  it("leaves script-src and its hashes untouched", () => {
    // The whole point of appending rather than rewriting: the hashes are what keep inline scripts
    // safe, and losing them would silently re-open what CSP is here to close.
    const policy = withStyleDirectives("script-src 'self' 'sha256-BF0290pkb3jx='");
    expect(policy).toContain("'sha256-BF0290pkb3jx='");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("is idempotent", () => {
    const once = withStyleDirectives("default-src 'self'");
    expect(withStyleDirectives(once)).toBe(once);
  });

  it("adds only the directive that is missing", () => {
    expect(withStyleDirectives("default-src 'self'; style-src-attr 'unsafe-inline'")).toBe(
      "default-src 'self'; style-src-attr 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'",
    );
  });

  it("never overrides a deliberately stricter value already in the policy", () => {
    const policy = "default-src 'self'; style-src-attr 'none'; style-src-elem 'none'";
    expect(withStyleDirectives(policy)).toBe(policy);
  });

  it("does not mistake style-src for style-src-attr", () => {
    // A word-boundary match, not a substring one: `style-src 'self'` must not be read as already
    // supplying `style-src-attr`, or the fix silently stops applying.
    const policy = withStyleDirectives("style-src 'self' 'sha256-abc='");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("style-src-elem 'self' 'unsafe-inline'");
  });

  it("passes a missing policy through rather than inventing one", () => {
    expect(withStyleDirectives(null)).toBeNull();
    expect(withStyleDirectives("")).toBe("");
  });
});
