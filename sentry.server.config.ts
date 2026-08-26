import * as Sentry from "@sentry/astro";

// A missing DSN leaves the SDK disabled rather than throwing: `Sentry.init` with an undefined
// `dsn` builds a client with no transport, and every `captureException` below becomes a no-op.
// That is the normal state on an offline VPS, which cannot reach Sentry's ingest host at all.
// `SENTRY_DSN` is deliberately not in the `astro:env` schema — this file runs before the Astro
// runtime is up, so `process.env` is the only correct read.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
});
