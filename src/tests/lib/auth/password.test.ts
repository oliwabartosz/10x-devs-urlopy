import { describe, it, expect } from "vitest";
import { scryptSync } from "node:crypto";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, WeakPasswordError } from "@/lib/auth/password";

describe("scrypt password hashing", () => {
  it("verifies the password it hashed", () => {
    const encoded = hashPassword("correct-horse-battery");
    expect(verifyPassword("correct-horse-battery", encoded)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const encoded = hashPassword("correct-horse-battery");
    expect(verifyPassword("correct-horse-batterz", encoded)).toBe(false);
    expect(verifyPassword("", encoded)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", () => {
    const a = hashPassword("same-password-twice");
    const b = hashPassword("same-password-twice");
    expect(a).not.toBe(b);
    expect(verifyPassword("same-password-twice", a)).toBe(true);
    expect(verifyPassword("same-password-twice", b)).toBe(true);
  });

  it("encodes its own parameters, so they can be raised without a migration", () => {
    const [algorithm, n, r, p, salt, hash] = hashPassword("parameters-are-encoded").split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
    expect(salt.length).toBeGreaterThan(0);
    expect(hash.length).toBeGreaterThan(0);
  });

  it("verifies a hash written with different cost parameters than today's", () => {
    // Hand-built at N=1024 — what an old row would look like after the constants are raised.
    // Nothing in the app writes this, which is the point: verification must read N/r/p from the
    // row rather than assume the current values, or every existing password breaks on the bump.
    const salt = Buffer.from("c2FsdHktc2FsdC0xNg==", "base64");
    const digest = scryptSync("legacy-password", salt, 64, { N: 1024, r: 8, p: 1 }).toString("base64");
    const legacy = `scrypt$1024$8$1$c2FsdHktc2FsdC0xNg==$${digest}`;
    expect(verifyPassword("legacy-password", legacy)).toBe(true);
    expect(verifyPassword("wrong-password", legacy)).toBe(false);
  });

  it("enforces the 8-character floor the zod schemas also enforce", () => {
    expect(() => hashPassword("short")).toThrow(WeakPasswordError);
    expect(() => hashPassword("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it("returns false rather than throwing on a malformed stored hash", () => {
    // Anything that is not an encoded scrypt string must be unauthenticatable, never a 500. The
    // fixture placeholder that stood in `users.password_hash` through Phases 1-3 had exactly this
    // shape, and a row edited by hand could have any of them.
    for (const bad of ["", "x-not-a-hash", "scrypt$16384$8$1$onlyfourparts", "bcrypt$1$2$3$4$5", "$$$$$"]) {
      expect(verifyPassword("anything", bad)).toBe(false);
    }
  });
});
