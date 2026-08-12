// Details-tab type filter, held as the set of *hidden* absence-type ids.
//
// "Wyczyść filtry" is a one-way clear: it always empties the set, so every type comes back.
// It renders active only while at least one type is hidden. The prototype
// (`new-design/10xUrlopy.dc.html`) gets both halves backwards — clearFilters (`:1321`) assigns
// every type id, hiding everything while the label says "clear", and hasFilters (`:1446`) /
// clearStyle (`:1447`) never reflect the real state. Do not reintroduce a hide-all arm on this
// control: the all-hidden state is only escapable because clearing is unconditional.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.

/** Toggle one type's visibility, returning a new set. */
export function toggleHidden(hidden: ReadonlySet<number>, typeId: number): ReadonlySet<number> {
  const next = new Set(hidden);
  if (next.has(typeId)) next.delete(typeId);
  else next.add(typeId);
  return next;
}

/** "Wyczyść filtry" — restores every type. An empty hidden set, never a full one. */
export function clearHidden(): ReadonlySet<number> {
  return new Set();
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
