import { describe, it, expect } from "vitest";
import { medalRanks } from "@/lib/medals";

describe("medalRanks", () => {
  it("awards gold, silver and bronze by descending value", () => {
    const m = medalRanks([1, 5, 3]);
    expect(m.get(1)).toBe("🥇");
    expect(m.get(2)).toBe("🥈");
    expect(m.get(0)).toBe("🥉");
  });

  it("shares a rank on a tie and skips the next rank", () => {
    // 5, 5, 3 → gold, gold, bronze. No silver is awarded.
    const m = medalRanks([5, 5, 3]);
    expect(m.get(0)).toBe("🥇");
    expect(m.get(1)).toBe("🥇");
    expect(m.get(2)).toBe("🥉");
  });

  it("drops off the podium entirely when a three-way tie takes gold", () => {
    // 5, 5, 5, 4 → three golds; the fourth place is rank 3, which is off the podium.
    const m = medalRanks([5, 5, 5, 4]);
    expect(m.get(0)).toBe("🥇");
    expect(m.get(1)).toBe("🥇");
    expect(m.get(2)).toBe("🥇");
    expect(m.has(3)).toBe(false);
  });

  it("gives no medal to zero values", () => {
    const m = medalRanks([0, 0, 0]);
    expect(m.size).toBe(0);
  });

  it("still awards gold when only one person has any days", () => {
    const m = medalRanks([0, 2, 0]);
    expect(m.get(1)).toBe("🥇");
    expect(m.size).toBe(1);
  });

  it("ranks fractional day counts", () => {
    const m = medalRanks([0.5, 1.5, 1]);
    expect(m.get(1)).toBe("🥇");
    expect(m.get(2)).toBe("🥈");
    expect(m.get(0)).toBe("🥉");
  });

  it("returns an empty map for an empty input", () => {
    expect(medalRanks([]).size).toBe(0);
  });
});
