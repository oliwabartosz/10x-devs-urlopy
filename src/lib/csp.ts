/**
 * The two directives Astro will not emit, and why they are needed.
 *
 * `security.csp` in `astro.config.mjs` builds the Content-Security-Policy and hashes Astro's own
 * inline scripts and `<style>` blocks. Its allowed-directive list covers neither the `*-attr` nor
 * the `*-elem` variants, so either of these passed through `directives` is silently dropped — not
 * rejected, which is why they are appended to the finished header here instead.
 *
 * **`style-src-attr`** — inline style ATTRIBUTES. The spec says a hash never matches an attribute,
 * and `unsafe-inline` is ignored in any directive carrying hashes, so without this they fall back
 * to `style-src` and are blocked. No build-time hash could cover them anyway: absence-type colours
 * come from the database, and grid templates and bar widths are computed per render.
 *
 * **`style-src-elem`** — `<style>` elements created by scripts at runtime. Radix's dialogs and
 * sheets pull in `react-style-singleton`, which appends a `<style>` whose text is generated from
 * `window.getComputedStyle(document.body)` and the measured scrollbar width. That content differs
 * by browser, OS and zoom level, so it cannot be hashed at build time and a hash captured from one
 * browser would not match another. `sonner` injects its own styles the same way.
 *
 * Both relaxations are confined to styles. **`script-src` keeps its hashes and stays strict**,
 * which is the part that matters for XSS: this trades a CSS-injection surface, which needs an
 * injection point the app does not offer, for dialogs that actually work. Every app-authored
 * inline style goes through React's `style` prop, which assigns properties individually rather
 * than parsing a declaration list, so a database value like `"red; background: url(...)"` is
 * dropped as invalid rather than becoming a second declaration.
 *
 * A nonce would be stricter and was considered: `react-style-singleton` reads one via `get-nonce`.
 * It would need a per-response random value threaded from the server into client code before the
 * first dialog mounts, and `sonner` offers no such hook — so it buys little over this for a great
 * deal more machinery.
 */
const APPENDED_DIRECTIVES = ["style-src-attr 'unsafe-inline'", "style-src-elem 'self' 'unsafe-inline'"];

/**
 * Append the directives to a policy, or return it unchanged when there is nothing to do.
 *
 * Idempotent per directive: one already named in the policy is left exactly as it is, so this can
 * never accumulate duplicates or override a deliberately stricter value.
 */
export function withStyleDirectives(policy: string | null): string | null {
  if (policy === null || policy === "") return policy;

  const missing = APPENDED_DIRECTIVES.filter((directive) => {
    const name = directive.split(" ")[0];
    return !new RegExp(`(^|;)\\s*${name}\\b`).test(policy);
  });

  return missing.length === 0 ? policy : `${policy}; ${missing.join("; ")}`;
}
