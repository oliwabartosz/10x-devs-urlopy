import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A source scan, not a unit test — and deliberately so.
 *
 * Every app-absolute path in this codebase has to go through `withBase()`, or it works at the
 * root and 404s under a mount point. That failure is invisible to every other test here: the
 * suites drive route handlers directly, so a hardcoded `action="/api/auth/signin"` passes them
 * all and then fails in production the first time somebody clicks the button. It did exactly
 * that — the form actions were missed when the 21 `fetch()` calls were converted, and the sign-in
 * page rendered perfectly before posting to a path nginx had never heard of.
 *
 * So this asserts on the source text. Cheap, and it fails on the pull request rather than on the
 * VPS.
 */

const SRC = new URL("../../", import.meta.url).pathname;
const SKIP_DIRS = new Set(["tests", "node_modules"]);

/** The forms that reach a browser. Each one takes a URL the browser resolves against the origin. */
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /fetch\(\s*["'`]\//, what: 'fetch("/…")' },
  { pattern: /\baction="\//, what: 'action="/…"' },
  { pattern: /\bhref="\//, what: 'href="/…"' },
  { pattern: /\bsrc="\//, what: 'src="/…"' },
  { pattern: /\bredirect\(\s*["'`]\//, what: 'redirect("/…")' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (/\.(ts|tsx|astro)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no app-absolute path bypasses withBase()", () => {
  it("finds none anywhere under src/", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const { pattern, what } of FORBIDDEN) {
          if (pattern.test(line)) {
            offenders.push(`${relative(SRC, file)}:${i + 1} — ${what} — ${line.trim().slice(0, 100)}`);
          }
        }
      });
    }

    expect(
      offenders,
      `Use withBase() from @/lib/base-path so these keep working when the app is mounted under a sub-path:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
