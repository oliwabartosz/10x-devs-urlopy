import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A source scan, not a unit test — the same shape and for the same reason as
 * base-path-coverage.test.ts.
 *
 * The brand mark is authored twice: `public/icon.svg` is what `<link rel="icon">` points at, and
 * `src/components/BrandMark.astro` holds the same shapes inline for the login tile. Both files say
 * in their own comments that nothing enforces the match — and nothing did. Astro copies `public/`
 * verbatim and no build step parses either file, so a shape edited in one and not the other ships
 * as a favicon and a login tile that are visibly different marks, with every other test green.
 *
 * Two divergences are legitimate and are normalised out below:
 *   - the navy parts are `currentColor` in the component (so the caller can flip them to white on
 *     the navy tile) and the literal `#072143` in the asset (a `public/` file cannot read CSS vars);
 *   - only `public/icon.svg` carries `role`/`aria-label`, because only it is standalone.
 * Geometry is not on that list. If a third divergence becomes legitimate, widen this comment and
 * the normaliser — do not delete the test.
 */

const ROOT = new URL("../../../", import.meta.url).pathname;

/** Every `d="…"` in document order — the geometry, and nothing else. */
function pathData(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

describe("the brand mark's two copies", () => {
  const asset = readFileSync(`${ROOT}public/icon.svg`, "utf8");
  const component = readFileSync(`${ROOT}src/components/BrandMark.astro`, "utf8");

  it("draws the same shapes in the same order", () => {
    const fromAsset = pathData(asset);
    expect(fromAsset.length, "public/icon.svg should draw the ring, the island and six palm parts").toBe(8);
    expect(
      pathData(component),
      "BrandMark.astro and public/icon.svg have drifted — edit both together, they are twins",
    ).toEqual(fromAsset);
  });

  it("keeps the gold literal in both, so the two stay comparable by eye", () => {
    expect(asset).toContain("#c5ac75");
    expect(component).toContain("#c5ac75");
  });

  it("keeps the navy literal only in the asset, and currentColor only in the component", () => {
    // The one deliberate divergence. Asserted so an "unify them" refactor has to face it.
    //
    // Matched as attribute values, not as bare words: both files discuss the other's colour choice
    // in their comments, so a plain `toContain("currentColor")` is true of either one.
    const paints = (source: string) => [...source.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    expect(paints(asset)).toContain("#072143");
    expect(paints(asset)).not.toContain("currentColor");
    expect(paints(component)).toContain("currentColor");
    expect(paints(component)).not.toContain("#072143");
  });
});
