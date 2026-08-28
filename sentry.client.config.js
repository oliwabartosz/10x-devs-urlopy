import * as Sentry from "@sentry/astro";

// The DSN comes from the environment, mirroring sentry.server.config.ts, rather than being
// hardcoded as it was. A build for the self-hosted VPS leaves PUBLIC_SENTRY_DSN unset, which
// leaves the SDK with no transport and every capture a no-op.
//
// It was hardcoded until this, which meant the browser bundle tried to reach
// ingest.de.sentry.io on every page load of a deployment whose own INSTALL.md opens with "no
// runtime dependency on anything outside the box". On an offline host that is a failed request
// per page; the CSP now blocks it outright, which is how it was noticed.
//
// PUBLIC_ prefix is load-bearing: Vite only exposes those to client code, and this file is
// bundled into the browser. That also means the value is public — which a DSN is by design.
Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
});
