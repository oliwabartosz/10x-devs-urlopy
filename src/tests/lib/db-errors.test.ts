import { describe, it, expect } from "vitest";
import {
  extractDbErrorCode,
  extractDbErrorConstraint,
  SQLITE_CONSTRAINT_CHECK,
  SQLITE_CONSTRAINT_FOREIGNKEY,
  SQLITE_CONSTRAINT_UNIQUE,
} from "@/lib/db-errors";

describe("extractDbErrorCode", () => {
  it("returns top-level code when present", () => {
    expect(extractDbErrorCode({ code: SQLITE_CONSTRAINT_UNIQUE })).toBe("2067");
  });

  it("returns cause.code when top-level code is absent (critical: the cause.code fallback path)", () => {
    // The path every route actually takes: Drizzle wraps the normalised `SqliteDriverError` in a
    // `DrizzleQueryError`, so the code arrives one level down.
    expect(extractDbErrorCode({ code: undefined, cause: { code: SQLITE_CONSTRAINT_UNIQUE } })).toBe("2067");
  });

  it("returns undefined when neither code nor cause.code is set", () => {
    expect(extractDbErrorCode({})).toBeUndefined();
  });

  it("returns undefined without throwing for non-object input", () => {
    expect(extractDbErrorCode(null)).toBeUndefined();
    expect(extractDbErrorCode("string")).toBeUndefined();
    expect(extractDbErrorCode(undefined)).toBeUndefined();
  });
});

describe("SQLite extended result codes", () => {
  // Pinned as literals rather than re-derived: these are SQLite's own extended result codes
  // (https://sqlite.org/rescode.html), and the whole 409/422/400 contract is a comparison against
  // them. A typo here would be invisible — every branch would simply stop matching.
  it("carry SQLite's documented extended values", () => {
    expect(SQLITE_CONSTRAINT_UNIQUE).toBe("2067");
    expect(SQLITE_CONSTRAINT_FOREIGNKEY).toBe("787");
    expect(SQLITE_CONSTRAINT_CHECK).toBe("275");
  });

  it("are distinct, so one violation can never be read as another", () => {
    const codes = [SQLITE_CONSTRAINT_UNIQUE, SQLITE_CONSTRAINT_FOREIGNKEY, SQLITE_CONSTRAINT_CHECK];
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("extractDbErrorConstraint", () => {
  it("returns cause.constraint_name for a CHECK violation", () => {
    expect(extractDbErrorConstraint({ cause: { constraint_name: "absences_time_check" } })).toBe("absences_time_check");
  });

  it("returns the top-level constraint_name when present", () => {
    expect(extractDbErrorConstraint({ constraint_name: "absences_time_check" })).toBe("absences_time_check");
  });

  it("returns undefined for a foreign-key violation, which SQLite leaves unnamed", () => {
    // Why the two 422 cases are resolved by pre-flight lookups instead of at the catch site:
    // `SqliteDriverError` finds nothing to lift out of "FOREIGN KEY constraint failed".
    expect(extractDbErrorConstraint({ cause: { code: SQLITE_CONSTRAINT_FOREIGNKEY } })).toBeUndefined();
  });

  it("returns undefined without throwing for non-object input", () => {
    expect(extractDbErrorConstraint(null)).toBeUndefined();
    expect(extractDbErrorConstraint("string")).toBeUndefined();
    expect(extractDbErrorConstraint(undefined)).toBeUndefined();
  });
});
