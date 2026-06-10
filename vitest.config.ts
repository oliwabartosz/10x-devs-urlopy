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
    coverage: {
      provider: "v8",
    },
  },
  resolve: {
    alias: {
      "@": resolve(dir, "./src"),
    },
  },
});
