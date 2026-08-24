// Viewer-relative column order for the absence grid.
//
// Extracted out of AbsenceGrid so the XLSX export and the on-screen grid provably apply the
// same ordering — a workbook whose columns disagreed with the Siatka tab would be read as a
// bug in the data, not in the export — and so the rule is reachable from a test (vitest runs
// in a node environment with no jsdom, so a React island's output is not).
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
import type { EmployeeListItem } from "@/types";

/**
 * The list with the viewer's own row hoisted to index 0, every other row keeping its incoming
 * relative order. Returns the others unchanged when the viewer is absent from the list.
 */
export function selfFirst(emps: EmployeeListItem[], currentId: string): EmployeeListItem[] {
  const me = emps.find((e) => e.id === currentId);
  const others = emps.filter((e) => e.id !== currentId);
  return me ? [me, ...others] : others;
}
