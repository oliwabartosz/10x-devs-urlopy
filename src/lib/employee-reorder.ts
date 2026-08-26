// The bulk-reorder statement for the employee grid, as a Drizzle fragment.
//
// Query-free by the rule in CLAUDE.md: it builds SQL but executes nothing, so it lives in
// `src/lib/` rather than `src/lib/services/` and is unit-testable against any database handle.
// It sits here rather than inline in the route so the `is_system` guard below is provable —
// that invariant has already leaked twice by copy-paste
// (context/archive/2026-08-18-absence-write-hardening/), and a statement duplicated between a
// route and its test can drift apart without either side failing.
import { sql, type SQL } from "drizzle-orm";

/**
 * `UPDATE employees SET display_order = …` for a whole reorder, in one statement.
 *
 * SQLite has no arrays, no `unnest` and no `::` cast, so the pairs travel as a single JSON
 * parameter and `json_each` unrolls them back into a relation. `UPDATE … FROM` is supported
 * (SQLite 3.33+), so the shape — and the single round trip — survives the port from
 * `UPDATE … FROM (SELECT UNNEST(ARRAY[…]))`.
 *
 * `AND employees.is_system = 0` is load-bearing: it keeps the technical admin out of the update
 * set, so a crafted payload carrying the admin's id reorders everyone else and no-ops on the
 * admin. There is no RLS behind this, so the guard has to live in the statement itself.
 */
export function reorderEmployeesStatement(order: { id: string; display_order: number }[]): SQL {
  const pairs = JSON.stringify(order.map((item) => [item.id, item.display_order]));
  return sql`UPDATE employees SET display_order = json_extract(v.value, '$[1]') FROM json_each(${pairs}) AS v WHERE employees.id = json_extract(v.value, '$[0]') AND employees.is_system = 0`;
}
