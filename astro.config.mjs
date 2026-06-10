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
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_SERVICE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      DATABASE_URL: envField.string({ context: "server", access: "secret" }),
    },
  },
});
