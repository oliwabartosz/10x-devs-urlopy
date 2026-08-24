import { describe, it, expect } from "vitest";
import type { EmployeeListItem } from "@/types";
import { selfFirst } from "@/lib/employee-order";

// Mock rows, no DB — matching src/tests/lib/absence-stats.test.ts.
const emp = (id: string): EmployeeListItem => ({
  id,
  role: "employee",
  first_name: "Test",
  last_name: id,
  deleted_at: null,
  created_at: new Date(),
  display_order: 0,
  is_system: false,
});

describe("selfFirst", () => {
  it("hoists the viewer's row to index 0", () => {
    const list = [emp("a"), emp("b"), emp("c")];
    expect(selfFirst(list, "c").map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps the incoming relative order of everyone else", () => {
    const list = [emp("a"), emp("b"), emp("c"), emp("d")];
    expect(selfFirst(list, "b").map((e) => e.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("is a no-op when the viewer is already first", () => {
    const list = [emp("a"), emp("b")];
    expect(selfFirst(list, "a").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("returns the others unchanged when the viewer is absent from the list", () => {
    const list = [emp("a"), emp("b")];
    expect(selfFirst(list, "zzz").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("returns an empty list for an empty input", () => {
    expect(selfFirst([], "a")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const list = [emp("a"), emp("b"), emp("c")];
    selfFirst(list, "c");
    expect(list.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});
