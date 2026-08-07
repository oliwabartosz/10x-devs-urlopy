// Details-tab type filter, held as the set of *hidden* absence-type ids.
//
// The prototype gets this backwards in three coupled places
// (`new-design/10xUrlopy.dc.html`): clearFilters (`:1321`) assigns every type id, so
// "clear" hides everything; hasFilters (`:1446`) is `hidden.length < TYPES.length`, true
// almost always; clearStyle (`:1447`) is hardcoded active. The rules below are the
// intended ones — clearing restores all, and the control is active only while something
// is actually hidden.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.

/** Toggle one type's visibility, returning a new set. */
export function toggleHidden(hidden: ReadonlySet<number>, typeId: number): ReadonlySet<number> {
  const next = new Set(hidden);
  if (next.has(typeId)) next.delete(typeId);
  else next.add(typeId);
  return next;
}

/** Clearing restores every type — an empty hidden set, never a full one. */
export function clearHidden(): ReadonlySet<number> {
  return new Set();
}

/** The clear control is active only while at least one type is hidden. */
export function isFilterActive(hidden: ReadonlySet<number>): boolean {
  return hidden.size > 0;
}

/** Keep only rows whose type is not hidden. */
export function visibleByType<T extends { absence_type_id: number }>(rows: T[], hidden: ReadonlySet<number>): T[] {
  if (hidden.size === 0) return rows;
  return rows.filter((r) => !hidden.has(r.absence_type_id));
}
