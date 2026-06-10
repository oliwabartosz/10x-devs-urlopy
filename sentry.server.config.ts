import * as Sentry from "@sentry/cloudflare";
import handler from "@astrojs/cloudflare/entrypoints/server";

interface Env {
  SENTRY_DSN: string;
}

export default Sentry.withSentry<Env>(
  (env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
  }),
  handler,
);
