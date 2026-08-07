import { describe, it, expect } from "vitest";
import {
  toggleHidden,
  clearHidden,
  hideAll,
  filterToggleAction,
  isFilterActive,
  visibleByType,
} from "@/lib/type-filter";

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
});

describe("hideAll", () => {
  it("hides every type it is given", () => {
    const hidden = hideAll(ALL_TYPE_IDS);
    expect(hidden.size).toBe(7);
    expect(
      visibleByType(
        ALL_TYPE_IDS.map((id) => ({ absence_type_id: id })),
        hidden,
      ),
    ).toHaveLength(0);
  });
});

describe("filterToggleAction", () => {
  it("offers hide-all only when nothing is hidden", () => {
    expect(filterToggleAction(new Set())).toBe("hide-all");
  });

  it("offers show-all as soon as one type is hidden", () => {
    expect(filterToggleAction(new Set([3]))).toBe("show-all");
  });

  it("offers show-all when everything is hidden — the state must be escapable", () => {
    expect(filterToggleAction(hideAll(ALL_TYPE_IDS))).toBe("show-all");
  });

  it("round-trips: hide-all then show-all returns every type", () => {
    let hidden = new Set<number>();
    expect(filterToggleAction(hidden)).toBe("hide-all");
    hidden = new Set(hideAll(ALL_TYPE_IDS));
    expect(filterToggleAction(hidden)).toBe("show-all");
    hidden = new Set(clearHidden());
    expect(hidden.size).toBe(0);
    expect(filterToggleAction(hidden)).toBe("hide-all");
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
