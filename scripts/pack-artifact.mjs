/**
 * Build the tarball that gets carried to the offline VPS, then prove it is portable.
 *
 * Run AFTER `npm run build` and `npm prune --omit=dev`:
 *
 *   npm ci && npm run build && npm prune --omit=dev && npm run pack
 *
 * Why this is a script and not a `tar` one-liner in INSTALL.md: `npm prune --omit=dev` does not
 * produce a portable tree on its own. It leaves 728 MB containing ten compiled `*.node` binaries —
 * sharp, rollup, lightningcss, @tailwindcss/oxide — because the Astro starter puts `astro`,
 * `@tailwindcss/vite`, `@astrojs/cloudflare` and `wrangler` in `dependencies` rather than
 * `devDependencies`. Every one of them is build-time only, but npm has no way to know that, so
 * the exclusion list below is maintained by hand and verified by actually running the result.
 *
 * A compiled module in the archive would make it valid only on a machine matching the builder's
 * platform, architecture, libc and Node ABI — and the failure would appear on the VPS at startup
 * (`ERR_DLOPEN_FAILED`), which is the worst possible place to find out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Package directories under `node_modules/` that survive `--omit=dev` but are never loaded by the
 * running server. Verified by running `dist/server/entry.mjs` against a pruned tree with all of
 * them removed: the sign-in page renders and the database bootstrap completes.
 *
 * `sharp` deserves a note: it is Astro's default image service, so it looks load-bearing. It is
 * not, here — `loadSharp()` reaches it through a lazy `await import("sharp")` that only runs when
 * the `/_image` endpoint is hit, and this app uses no `astro:assets` at all (no `<Image>`, no
 * `getImage`). If that ever changes, Astro throws an explicit `MissingSharp` error rather than
 * failing obscurely, and this entry has to come out.
 */
const BUILD_ONLY = [
  "@astrojs/cloudflare", // Workers adapter; `main` still uses it, this artifact does not
  "@esbuild",
  // drizzle-orm declares @libsql/client as an OPTIONAL PEER, so npm installs it — and libsql
  // ships a compiled .node per platform. Nothing here imports it: the database layer is
  // drizzle-orm/sqlite-proxy over node:sqlite, which is the whole reason this artifact is
  // portable at all. Verified by running bootstrap.mjs and entry.mjs, sign-in included, with
  // both directories moved out of the tree.
  "@libsql",
  "libsql",
  "@img", // sharp's platform binaries
  "@rollup",
  "@tailwindcss", // includes the native `oxide` CSS engine
  "esbuild",
  "lightningcss-linux-x64-gnu",
  "lightningcss-linux-x64-musl",
  "miniflare", // Workers local runtime, pulled in by wrangler
  "rollup",
  "sharp",
  "typescript",
  "vite",
  "wrangler",
];

const CONTENTS = ["dist", "node_modules", "package.json", "deploy", "install.sh", "install-user.sh", "INSTALL.md"];

for (const entry of CONTENTS) {
  if (!existsSync(`${root}${entry}`)) {
    console.error(`✖ ${entry} is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
}
if (!existsSync(`${root}dist/bootstrap.mjs`)) {
  console.error("✖ dist/bootstrap.mjs is missing — `npm run build` did not run its postbuild step.");
  process.exit(1);
}

// Passed in rather than stamped from the clock so a rebuild of the same release is reproducible,
// and so CI can name the archive after the commit.
const stamp =
  process.env.URLOPY_RELEASE ??
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const archive = `${root}urlopy-${stamp}.tar.gz`;

const excludes = BUILD_ONLY.map((name) => `--exclude=node_modules/${name}`);

console.log(`• Packing ${CONTENTS.join(", ")} → urlopy-${stamp}.tar.gz`);
execFileSync("tar", ["-czf", archive, "-C", root, ...excludes, ...CONTENTS], { stdio: "inherit" });

// The gate. Listing the archive is the only check that sees what was actually written, rather
// than what the exclusion list was meant to do.
const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const native = listing.split("\n").filter((line) => line.endsWith(".node"));

if (native.length > 0) {
  console.error(`✖ ${native.length} compiled native module(s) in the archive:`);
  for (const line of native.slice(0, 20)) console.error(`    ${line}`);
  console.error("  Add the offending package to BUILD_ONLY in this script, or the artifact is not portable.");
  process.exit(1);
}

const entries = listing.split("\n").filter(Boolean).length;
const size = statSync(archive).size;
console.log(
  `✔ urlopy-${stamp}.tar.gz — ${entries} entries, ${(size / 1024 / 1024).toFixed(0)} MiB, zero .node binaries.`,
);
console.log("  Copy it to the VPS, extract, and run ./install.sh (see INSTALL.md).");
