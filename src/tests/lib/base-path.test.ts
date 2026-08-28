import { describe, it, expect, vi, afterEach } from "vitest";
import { BASE_PATH, withBase } from "@/lib/base-path";

/**
 * The mounted case is loaded through a fresh module registry rather than tested against the
 * ambient value: `BASE_PATH` is computed once at import time (deliberately — it is a build-time
 * constant), so stubbing the env after the fact would change nothing.
 */
async function loadWithBaseUrl(baseUrl: string) {
  vi.stubEnv("BASE_URL", baseUrl);
  vi.resetModules();
  return import("@/lib/base-path");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("withBase at the root (the unmounted default)", () => {
  it("leaves an app-absolute path untouched", () => {
    expect(BASE_PATH).toBe("");
    expect(withBase("/api/absences")).toBe("/api/absences");
  });

  it("does not produce a protocol-relative '//' path", () => {
    // `//api/...` is read by the browser as a protocol-relative URL pointing at a host named
    // "api", which fails as a DNS error rather than as a 404 — an expensive way to find a typo.
    expect(withBase("/")).toBe("/");
    expect(withBase("/api/x").startsWith("//")).toBe(false);
  });
});

describe("withBase under a mount point", () => {
  it("prefixes the path and strips Astro's trailing slash", async () => {
    const mod = await loadWithBaseUrl("/urlopy/");
    expect(mod.BASE_PATH).toBe("/urlopy");
    expect(mod.withBase("/api/absences")).toBe("/urlopy/api/absences");
    expect(mod.withBase("/dashboard")).toBe("/urlopy/dashboard");
  });

  it("keeps the cookie scope free of a trailing slash", async () => {
    // `Path=/urlopy/` and `Path=/urlopy` are not the same scope: the former excludes the bare
    // /urlopy request the nginx block redirects from.
    const mod = await loadWithBaseUrl("/urlopy/");
    expect(mod.BASE_PATH.endsWith("/")).toBe(false);
  });

  it("accepts a path with no leading slash", async () => {
    const mod = await loadWithBaseUrl("/urlopy/");
    expect(mod.withBase("api/x")).toBe("/urlopy/api/x");
  });

  it("handles a base that arrives without a trailing slash", async () => {
    const mod = await loadWithBaseUrl("/urlopy");
    expect(mod.BASE_PATH).toBe("/urlopy");
    expect(mod.withBase("/api/x")).toBe("/urlopy/api/x");
  });

  it("treats a bare '/' as unmounted", async () => {
    const mod = await loadWithBaseUrl("/");
    expect(mod.BASE_PATH).toBe("");
    expect(mod.withBase("/api/x")).toBe("/api/x");
  });
});
