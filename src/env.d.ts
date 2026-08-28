declare namespace App {
  interface Locals {
    // The whole codebase follows from this line. It used to be Supabase's `User`, of which only
    // `id` (15 sites) and `email` (`Topbar.astro:17`) were ever read — so the local session store
    // supplies exactly those two and nothing else. `userRole` is this app's own query and is
    // unaffected.
    user: { id: string; email: string } | null;
    userRole: import("@/types").UserRole | null;
  }
}

// Client-side build-time variables. Astro types `import.meta.env` with an index signature of
// `any`, so without this declaration every read of one is an unsafe assignment — and, worse, a
// typo in the name is silently `undefined` rather than a type error.
interface ImportMetaEnv {
  /**
   * Sentry DSN for the browser bundle. Unset on the self-hosted VPS, which cannot reach Sentry's
   * ingest host: `Sentry.init` with an undefined dsn builds a client with no transport. It was
   * hardcoded in sentry.client.config.js until the CSP on the real deployment caught the browser
   * trying to phone home.
   */
  readonly PUBLIC_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
