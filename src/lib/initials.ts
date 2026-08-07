// Initials for avatar chips and substitute badges.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
//
// The prototype's version (`10xUrlopy.dc.html:925-927`) strips non-letters, splits on
// whitespace and reads `w[0]` unguarded — a name whose tokens contain no letters (e.g.
// "123 456", or a lone "-") leaves it mapping over `[""]` and throwing a TypeError.
// Filtering empty tokens before the map is the whole fix.
export function initialsOf(name: string): string {
  return name
    .replace(/[^\p{L}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
