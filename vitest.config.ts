import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "node:path";

const dir = import.meta.dirname;

// Load ALL vars from .env (empty prefix = no VITE_ filtering)
const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    passWithNoTests: true,
    env,
    // The route-level suites talk to remote Supabase, where a single round trip measures
    // 3-5s. Vitest's 5s default turns that latency into intermittent failures, and a
    // timed-out test skips its afterEach cleanup, so the NEXT run cascades into 23505
    // duplicate-key errors that look like real defects. Bound these suites by correctness,
    // not by network latency.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Supabase's session pooler allows 15 clients. Every route-level suite holds a test pool
    // and every handler invocation opens another (see the note in src/tests/helpers/astro-env.ts),
    // so running suite files in parallel exhausts the budget and requests come back as 503
    // "Database error" ((EMAXCONNSESSION) max clients reached) — indistinguishable from a real
    // route defect, and dependent on how many suites happen to exist. Serialize the files: these
    // suites are network-bound, so the wall-clock cost is small next to the false failures.
    fileParallelism: false,
    coverage: {
      provider: "v8",
    },
  },
  resolve: {
    alias: {
      "@": resolve(dir, "./src"),
      // `astro:env/server` is a virtual module that only exists during an Astro build.
      // Stub it so API route handlers can be imported and invoked directly in tests.
      "astro:env/server": resolve(dir, "./src/tests/helpers/astro-env.ts"),
    },
  },
});
