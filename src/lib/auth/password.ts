import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing on `node:crypto`'s scrypt — no dependency, nothing to compile, which is what
 * an offline VPS install needs. Replaces the hashing Supabase Auth used to do for us.
 *
 * Synchronous on purpose. `node:sqlite` is synchronous too, and one Node process serves the whole
 * VPS, so a sign-in blocks the event loop for the ~60 ms scrypt costs at these parameters. For a
 * few dozen internal accounts that is a rounding error, and the alternative — an async variant —
 * buys nothing while forcing every caller to be async for a CPU-bound operation with no I/O in it.
 */

/** Minimum length, matching the three zod schemas that already enforce it (never the 6 Supabase used). */
export const MIN_PASSWORD_LENGTH = 8;

// Encoded form: `scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>`.
//
// Self-describing so the cost parameters can be raised later without a migration: a verify reads
// N/r/p out of the stored string rather than assuming today's values, so old hashes keep verifying
// while new ones are written with the new parameters.
const ALGORITHM = "scrypt";
const N = 16384; // CPU/memory cost. 128 * N * r = 16 MiB, comfortably under scrypt's 32 MiB default maxmem.
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Thrown when a caller tries to hash a password the app's own rules would reject. */
export class WeakPasswordError extends Error {
  constructor() {
    super(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    this.name = "WeakPasswordError";
  }
}

export function hashPassword(plain: string): string {
  if (plain.length < MIN_PASSWORD_LENGTH) throw new WeakPasswordError();
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(plain, salt, KEY_LENGTH, { N, r: R, p: P });
  return [ALGORITHM, N, R, P, salt.toString("base64"), derived.toString("base64")].join("$");
}

/**
 * Constant-time verification. Returns false — never throws — for a malformed or unrecognised
 * encoded string, so a row carrying a placeholder hash (test fixtures seed one deliberately) is
 * simply unauthenticatable rather than a 500.
 */
export function verifyPassword(plain: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 6) return false;
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (algorithm !== ALGORITHM) return false;

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(hashRaw, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length, { N: n, r, p });
  } catch {
    // Parameters out of range (a corrupted or hostile row) — not a credential match.
    return false;
  }
  // timingSafeEqual throws on a length mismatch, and the check above already guarantees equality,
  // but keep the guard: it is the one thing standing between a corrupt row and a thrown 500.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
