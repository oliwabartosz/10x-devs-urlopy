import { describe, it, expect } from "vitest";
import { toggleHidden, clearHidden, isFilterActive, visibleByType } from "@/lib/type-filter";

const ALL_TYPE_IDS = [1, 2, 3, 4, 5, 6, 7];

describe("toggleHidden", () => {
  it("hides a visible type and shows a hidden one", () => {
    const afterHide = toggleHidden(new Set(), 4);
    expect([...afterHide]).toEqual([4]);
    expect([...toggleHidden(afterHide, 4)]).toEqual([]);
  });

  it("does not mutate the input set", () => {
    const before = new Set([1]);
    toggleHidden(before, 2);
    expect([...before]).toEqual([1]);
  });
});

describe("clearHidden", () => {
  it("restores every type instead of hiding every type", () => {
    // The prototype's clearFilters assigns all ids here, hiding everything.
    const cleared = clearHidden();
    expect(cleared.size).toBe(0);
    expect(
      visibleByType(
        ALL_TYPE_IDS.map((id) => ({ absence_type_id: id })),
        cleared,
      ),
    ).toHaveLength(7);
  });

  it("escapes the all-hidden state in one click", () => {
    // Reachable by toggling every chip off. Clearing is unconditional, so this
    // state is always one click from full visibility — the trap the prototype
    // falls into, where the same control hides again.
    const allHidden = ALL_TYPE_IDS.reduce<ReadonlySet<number>>((set, id) => toggleHidden(set, id), new Set());
    expect(allHidden.size).toBe(7);
    expect(isFilterActive(allHidden)).toBe(true);

    const restored = clearHidden();
    expect(
      visibleByType(
        ALL_TYPE_IDS.map((id) => ({ absence_type_id: id })),
        restored,
      ),
    ).toHaveLength(7);
  });
});

describe("isFilterActive", () => {
  it("is false when nothing is hidden", () => {
    expect(isFilterActive(new Set())).toBe(false);
    expect(isFilterActive(clearHidden())).toBe(false);
  });

  it("is true as soon as one type is hidden", () => {
    expect(isFilterActive(new Set([3]))).toBe(true);
    expect(isFilterActive(new Set(ALL_TYPE_IDS))).toBe(true);
  });
});

describe("visibleByType", () => {
  const rows = [
    { id: "a", absence_type_id: 1 },
    { id: "b", absence_type_id: 4 },
    { id: "c", absence_type_id: 4 },
    { id: "d", absence_type_id: 7 },
  ];

  it("drops exactly the hidden type's rows", () => {
    expect(visibleByType(rows, new Set([4])).map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("returns everything when nothing is hidden", () => {
    expect(visibleByType(rows, new Set())).toHaveLength(4);
  });

  it("returns nothing when every present type is hidden", () => {
    expect(visibleByType(rows, new Set([1, 4, 7]))).toHaveLength(0);
  });
});
