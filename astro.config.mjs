// @ts-check
import process from "node:process";
import { defineConfig, envField } from "astro/config";
import { loadEnv } from "vite";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";

import sentry from "@sentry/astro";

const viteEnv = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN ?? viteEnv.SENTRY_AUTH_TOKEN;

// `site` is baked into the sitemap at build time and `security.allowedDomains` decides which
// `Host` / `X-Forwarded-Host` the server will believe, so both are derived from the one origin the
// browser actually sees. The build happens on the developer machine (INSTALL.md's
// build-here-copy-there flow), so PUBLIC_ORIGIN must be set in `.env` *there* — putting it only in
// the VPS's systemd EnvironmentFile is too late. `new URL` throwing on a malformed value is the
// intended loud failure.
//
// Split rather than chained so an empty `PUBLIC_ORIGIN=` falls through to the default instead of
// reaching `new URL("")`; `viteEnv` is a plain string record, so it never contributes a nullish.
const configuredOrigin = process.env.PUBLIC_ORIGIN ?? viteEnv.PUBLIC_ORIGIN;
const publicUrl = new URL(configuredOrigin ? configuredOrigin : "http://localhost:4321");

if (!configuredOrigin) {
  // Not fatal — `npm run build` in CI and a bare local build must both work — but a build without
  // it is only usable at http://localhost, because the allowedDomains below are what let Astro
  // trust the proxy's host header at all.
  process.emitWarning(
    `PUBLIC_ORIGIN is not set; building for ${publicUrl.origin}. ` +
      `A build for a VPS behind nginx must set it, or every form POST will 403.`,
    "urlopy",
  );
}

// Patterns carry hostname + protocol but deliberately no port: the port Astro ends up using comes
// from the host header anyway, and pinning it here only creates a trap where serving on a
// different port silently falls back to `localhost` and 403s the form routes. When PUBLIC_ORIGIN
// is absent the build is local-only, so both loopback spellings are allowed.
const allowedDomains = configuredOrigin
  ? [{ hostname: publicUrl.hostname, protocol: publicUrl.protocol.replace(":", "") }]
  : [
      { hostname: "localhost", protocol: "http" },
      { hostname: "127.0.0.1", protocol: "http" },
    ];

// https://astro.build/config
export default defineConfig({
  output: "server",
  site: publicUrl.origin,
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
  adapter: node({ mode: "standalone" }),
  security: {
    // Trust `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` for exactly this origin. This is not
    // optional hardening: with an empty list Astro discards the host header outright and computes
    // `Astro.url` as `localhost:<listen port>`, so `checkOrigin` 403s both FormData routes
    // (sign-in, sign-out) while every JSON route keeps working. `X-Forwarded-Proto` is honoured
    // only when it matches a pattern's protocol, which is why nginx must send it when PUBLIC_ORIGIN
    // is https.
    allowedDomains,
  },
  env: {
    schema: {
      // Filesystem path to the SQLite file, e.g. /var/lib/urlopy/urlopy.db. Required: a missing
      // value must fail at startup on the VPS rather than at the first query.
      DATABASE_PATH: envField.string({ context: "server", access: "secret" }),
      // The origin the browser actually sees, e.g. https://urlopy.internal. Drives the session
      // cookie's `Secure` flag (src/lib/auth/session.ts) — behind nginx the Node process cannot
      // observe the scheme itself — and, at build time, `site` and `security.allowedDomains`
      // above. Optional so a bare build and the test stub work without it.
      PUBLIC_ORIGIN: envField.string({ context: "server", access: "public", optional: true }),
    },
  },
});
