/**
 * The sub-path the app is mounted under, and the one way to build a URL that respects it.
 *
 * Urlopy owned the root of its hostname until it had to share one with two other applications
 * (`/wrifboard/` and `/metabase/` on the same nginx). Mounting under `/urlopy` is a build-time
 * decision — `PUBLIC_BASE_PATH` in `astro.config.mjs` — because Astro bakes it into every emitted
 * asset URL. `import.meta.env.BASE_URL` is where that value comes back out, on the server and in
 * the client bundle alike, which is why this module is the single source rather than a constant
 * somebody has to remember to keep in sync.
 *
 * Query-free and dependency-free by design, so it is importable from React islands, `.astro`
 * pages, API routes and the middleware without dragging anything along. See the header comment in
 * `src/lib/absence-list.ts` for why that matters.
 */

/**
 * Astro reports the base with a trailing slash (`"/urlopy/"`, or `"/"` when unset). Normalised
 * here to either `""` or `"/urlopy"` so callers can concatenate a leading-slash path onto it
 * without producing `//api/...`, which nginx and the browser treat as a protocol-relative URL.
 */
const RAW_BASE = import.meta.env.BASE_URL;
export const BASE_PATH = RAW_BASE === "/" ? "" : RAW_BASE.replace(/\/+$/, "");

/**
 * Prefix an app-absolute path with the base.
 *
 * `withBase("/api/absences")` → `"/api/absences"` unmounted, `"/urlopy/api/absences"` under
 * `/urlopy`. Idempotent for the unmounted case, so call sites read the same either way.
 */
export function withBase(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
