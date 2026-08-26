// @ts-check
import process from "node:process";
import { defineConfig, envField } from "astro/config";
import { loadEnv } from "vite";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

import sentry from "@sentry/astro";

const viteEnv = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN ?? viteEnv.SENTRY_AUTH_TOKEN;

// https://astro.build/config
export default defineConfig({
  output: "server",
  site: "https://urlopy.oliwa-bartosz.workers.dev",
  integrations: [
    react(),
    sitemap(),
    sentry({
      project: "javascript-astro",
      org: "bartosz-o4",
      authToken: sentryAuthToken,
      telemetry: false,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare({ imageService: "passthrough" }),
  env: {
    schema: {
      // Filesystem path to the SQLite file, e.g. /var/lib/urlopy/urlopy.db. Required: a missing
      // value must fail at startup on the VPS rather than at the first query.
      DATABASE_PATH: envField.string({ context: "server", access: "secret" }),
      // The origin the browser actually sees, e.g. https://urlopy.internal. Drives the session
      // cookie's `Secure` flag (src/lib/auth/session.ts) — behind nginx the Node process cannot
      // observe the scheme itself. Optional so a bare build and the test stub work without it;
      // Phase 5 derives `site` and `security.allowedDomains` from the same value.
      PUBLIC_ORIGIN: envField.string({ context: "server", access: "public", optional: true }),
    },
  },
});
