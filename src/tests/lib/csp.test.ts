import { describe, it, expect } from "vitest";
import { withStyleAttrDirective } from "@/lib/csp";

describe("withStyleAttrDirective", () => {
  it("appends the directive to a policy that lacks it", () => {
    expect(withStyleAttrDirective("default-src 'self'; script-src 'self' 'sha256-abc='")).toBe(
      "default-src 'self'; script-src 'self' 'sha256-abc='; style-src-attr 'unsafe-inline'",
    );
  });

  it("leaves script-src and its hashes untouched", () => {
    // The whole point of appending rather than rewriting: the hashes are what keep inline scripts
    // safe, and losing them would silently re-open what CSP is here to close.
    const policy = withStyleAttrDirective("script-src 'self' 'sha256-BF0290pkb3jx='");
    expect(policy).toContain("'sha256-BF0290pkb3jx='");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("is idempotent", () => {
    const once = withStyleAttrDirective("default-src 'self'");
    expect(withStyleAttrDirective(once)).toBe(once);
  });

  it("leaves an already-present style-src-attr alone, whatever its value", () => {
    const policy = "default-src 'self'; style-src-attr 'none'";
    expect(withStyleAttrDirective(policy)).toBe(policy);
  });

  it("passes a missing policy through rather than inventing one", () => {
    // A response with no CSP header is not this function's business — a bare
    // `style-src-attr 'unsafe-inline'` policy on its own would be meaningless.
    expect(withStyleAttrDirective(null)).toBeNull();
    expect(withStyleAttrDirective("")).toBe("");
  });
});
