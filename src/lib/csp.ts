/**
 * The one directive Astro will not emit.
 *
 * `security.csp` in `astro.config.mjs` builds the Content-Security-Policy and hashes Astro's own
 * inline scripts and `<style>` blocks. Its allowed-directive list covers neither the `*-attr` nor
 * the `*-elem` variants, so `style-src-attr` passed through `directives` is silently dropped —
 * not rejected, which is why this needs a comment rather than a config line.
 *
 * Without the directive, inline STYLE ATTRIBUTES fall back to `style-src`, where the spec says a
 * hash never matches an attribute and `unsafe-inline` is ignored outright in any directive that
 * carries hashes. Everything the app colours or sizes at runtime is then blocked: absence-type
 * colours come from the database, grid templates and bar widths are computed per render, so no
 * build-time hash could ever cover them. The grid renders colourless and layouts collapse, with
 * the reason visible only in the browser console.
 *
 * `script-src` keeps its hashes and stays strict, which is the part worth protecting.
 */
const STYLE_ATTR_DIRECTIVE = "style-src-attr 'unsafe-inline'";

/**
 * Append the directive to a policy, or return it unchanged when there is nothing to do.
 *
 * Idempotent: a policy that already names `style-src-attr` is returned untouched, so this cannot
 * accumulate duplicates if it ever runs twice over one response.
 */
export function withStyleAttrDirective(policy: string | null): string | null {
  if (policy === null || policy === "") return policy;
  if (policy.includes("style-src-attr")) return policy;
  return `${policy}; ${STYLE_ATTR_DIRECTIVE}`;
}
