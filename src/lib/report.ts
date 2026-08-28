/**
 * Report a server-side error to stderr and to Sentry.
 *
 * Every route handler used to call `Sentry.captureException` directly, which was correct while a
 * DSN was always configured. On the self-hosted VPS there is none — Sentry's ingest host is
 * unreachable from an offline box, so `Sentry.init` builds a client with no transport and every
 * capture becomes a no-op. The result was an application that failed in complete silence:
 * `journalctl -u urlopy` showed the startup line and nothing else, whatever went wrong.
 *
 * stderr first, then Sentry. systemd captures stderr into the journal, so the operator of a box
 * with no error tracking still gets the stack trace, and an installation that does have a DSN
 * loses nothing.
 */
import * as Sentry from "@sentry/astro";

export interface ReportOptions {
  /** Sentry severity. Defaults to `error`; `warning` for handled, expected-ish failures. */
  level?: "warning" | "error";
  /** Structured context — `route` everywhere, plus `action` where one route has several. */
  tags?: Record<string, string>;
}

export function reportError(err: unknown, options: ReportOptions = {}): void {
  // `route` on API handlers, `page` on .astro pages — whichever the caller supplied.
  const label = options.tags?.route ?? options.tags?.page ?? "unknown";
  const detail = options.tags?.action ?? options.tags?.phase;
  const prefix = detail === undefined ? `[urlopy] ${label}` : `[urlopy] ${label} (${detail})`;

  // eslint-disable-next-line no-console -- the point of this module; see the header comment.
  console.error(prefix, err);

  Sentry.captureException(err, options);
}
