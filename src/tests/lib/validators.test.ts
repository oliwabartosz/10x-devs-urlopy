import { describe, it, expect } from "vitest";
import { TimeSchema } from "@/lib/validators";

describe("TimeSchema", () => {
  it("accepts real clock times", () => {
    for (const value of ["00:00", "06:00", "09:05", "23:59"]) {
      expect(TimeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects out-of-range hours and minutes", () => {
    // These parsed before the narrowing and reached Postgres as a 22007 → 500.
    for (const value of ["24:00", "99:99", "25:61", "09:60"]) {
      expect(TimeSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects malformed widths and empties", () => {
    for (const value of ["9:05", "09:5", "", "09:05:00", "0905"]) {
      expect(TimeSchema.safeParse(value).success).toBe(false);
    }
  });

  it("keeps its HH:MM message", () => {
    const result = TimeSchema.safeParse("24:00");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Invalid time format HH:MM");
  });
});
