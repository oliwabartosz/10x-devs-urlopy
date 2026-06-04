import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const dir = import.meta.dirname;

// Load ALL vars from .env (empty prefix = no VITE_ filtering)
const env = loadEnv("test", process.cwd(), "");

// Also merge .dev.vars (Cloudflare Worker secrets) without overriding .env
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in env)) env[key] = val;
  }
}

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
