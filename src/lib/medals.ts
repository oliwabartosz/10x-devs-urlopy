// Medal ranking for the yearly statistics matrix (new-design/10xUrlopy.dc.html:1099-1120).
//
// Dependency-free on purpose: safe to import from both React islands and server routes.

export const MEDALS = ["🥇", "🥈", "🥉"] as const;

/**
 * Assign 🥇🥈🥉 by value, highest first.
 *
 * Ties share a rank and the next rank is skipped: values 5, 5, 3 award 🥇, 🥇, 🥉 — no
 * silver. Zero (and negative) values never receive a medal, so an employee with nothing
 * recorded in a column stays unmarked even when fewer than three people have any.
 *
 * Returns index-into-`values` → medal, so callers can look up by row position.
 */
export function medalRanks(values: readonly number[]): Map<number, string> {
  const ranked = values
    .map((value, index) => ({ index, value }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const medals = new Map<number, string>();
  let place = 0;
  let previous: number | null = null;

  ranked.forEach((x, position) => {
    if (x.value !== previous) {
      place = position;
      previous = x.value;
    }
    if (place < MEDALS.length) medals.set(x.index, MEDALS[place]);
  });

  return medals;
}
