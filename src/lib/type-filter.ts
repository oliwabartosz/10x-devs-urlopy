// Details-tab type filter, held as the set of *hidden* absence-type ids.
//
// The control is a two-state toggle, not a one-way clear: with everything visible it offers
// "Wyczyść filtry" and hides all; with anything hidden it offers "Zaznacz wszystkie" and
// restores all. The prototype (`new-design/10xUrlopy.dc.html`) only ever performs the first
// arm — clearFilters (`:1321`) assigns every type id while the label still says "clear", and
// hasFilters (`:1446`) / clearStyle (`:1447`) never reflect the real state. Hiding everything
// is a legitimate action here precisely because the label says so and the next click undoes it.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.

/** Toggle one type's visibility, returning a new set. */
export function toggleHidden(hidden: ReadonlySet<number>, typeId: number): ReadonlySet<number> {
  const next = new Set(hidden);
  if (next.has(typeId)) next.delete(typeId);
  else next.add(typeId);
  return next;
}

/** "Zaznacz wszystkie" — restores every type. An empty hidden set, never a full one. */
export function clearHidden(): ReadonlySet<number> {
  return new Set();
}

/** "Wyczyść filtry" — hides every type. Only reachable while nothing is hidden. */
export function hideAll(typeIds: readonly number[]): ReadonlySet<number> {
  return new Set(typeIds);
}

export type FilterToggleAction = "hide-all" | "show-all";

/**
 * Which arm of the toggle the control offers next.
 *
 * Nothing hidden → the only useful move is to hide everything. Anything hidden → the only
 * useful move is to restore, including when everything is hidden (the state that traps the
 * prototype, where the same control would hide again and the tab could never come back).
 */
export function filterToggleAction(hidden: ReadonlySet<number>): FilterToggleAction {
  return hidden.size === 0 ? "hide-all" : "show-all";
}

/** True while at least one type is hidden — drives the control's active styling. */
export function isFilterActive(hidden: ReadonlySet<number>): boolean {
  return hidden.size > 0;
}

/** Keep only rows whose type is not hidden. */
export function visibleByType<T extends { absence_type_id: number }>(rows: T[], hidden: ReadonlySet<number>): T[] {
  if (hidden.size === 0) return rows;
  return rows.filter((r) => !hidden.has(r.absence_type_id));
}
