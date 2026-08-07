import { describe, it, expect } from "vitest";
import { initialsOf } from "@/lib/initials";

describe("initialsOf", () => {
  it("takes the first letter of the first two tokens", () => {
    expect(initialsOf("Bartosz Oliwa")).toBe("BO");
  });

  it("ignores tokens past the second", () => {
    expect(initialsOf("Jan Maria Kowalski")).toBe("JM");
  });

  it("uppercases and keeps Polish diacritics", () => {
    expect(initialsOf("łukasz ćwik")).toBe("ŁĆ");
  });

  it("handles a single token", () => {
    expect(initialsOf("Madonna")).toBe("M");
  });

  it("strips non-letters before splitting", () => {
    expect(initialsOf("Anna-Maria Nowak")).toBe("AN");
  });

  it("returns empty for a name whose tokens contain no letters", () => {
    // The prototype's initialsOf throws a TypeError on exactly this input.
    expect(initialsOf("123 456")).toBe("");
    expect(initialsOf("-")).toBe("");
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});
