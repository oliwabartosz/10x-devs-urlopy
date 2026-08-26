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
    // Creates and disposes of one temp SQLite database per test file. Must run before the suite
    // body so `beforeAll` finds a migrated database; see src/tests/helpers/astro-env.ts.
    setupFiles: ["./src/tests/helpers/setup.ts"],
    // The 60s timeouts and `fileParallelism: false` that used to sit here are gone with the
    // remote pooler that caused them: 3-5s round trips made vitest's 5s default flaky, and
    // Supabase's 15-client ceiling made parallel suite files return 503s indistinguishable from
    // route defects. A local file has neither latency nor a connection budget, and each test
    // file now owns its own database, so the defaults are correct again.
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
