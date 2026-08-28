import { describe, it, beforeAll, expect } from "vitest";
import { getTestDb } from "@/tests/helpers/db";
import {
  createUser,
  deleteUser,
  DuplicateEmailError,
  findUserByEmail,
  getUserEmail,
  setUserPassword,
  updateUserEmail,
  verifyPassword,
} from "@/lib/auth";

// The `users`-table service that replaces `createAdminClient()`. The three 409 call sites all
// branch on DuplicateEmailError, and the case-insensitivity below is what `COLLATE NOCASE` on the
// column buys — Drizzle cannot express it, so it is hand-added in drizzle/0000_baseline.sql and
// nothing but a test proves it survived.

describe("users service", () => {
  beforeAll(async () => {
    await getTestDb();
  });

  const address = () => `users-svc-${crypto.randomUUID()}@test.invalid`;

  it("creates a user whose password verifies and whose address reads back", async () => {
    const email = address();
    const user = await createUser(email, "service-Password-1");
    expect(user.email).toBe(email);
    expect(await getUserEmail(user.id)).toBe(email);

    const found = await findUserByEmail(email);
    expect(found?.id).toBe(user.id);
    expect(verifyPassword("service-Password-1", found?.password_hash ?? "")).toBe(true);
  });

  it("rejects a duplicate address with the typed error the routes map to 409", async () => {
    const email = address();
    await createUser(email, "service-Password-1");
    await expect(createUser(email, "service-Password-2")).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("treats addresses case-insensitively, in both directions", async () => {
    const email = `Mixed-Case-${crypto.randomUUID()}@Test.Invalid`;
    const user = await createUser(email, "service-Password-1");

    expect((await findUserByEmail(email.toLowerCase()))?.id).toBe(user.id);
    expect((await findUserByEmail(email.toUpperCase()))?.id).toBe(user.id);
    await expect(createUser(email.toLowerCase(), "service-Password-2")).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("changes an address, and refuses one already taken", async () => {
    const taken = address();
    await createUser(taken, "service-Password-1");
    const user = await createUser(address(), "service-Password-1");

    const next = address();
    await updateUserEmail(user.id, next);
    expect(await getUserEmail(user.id)).toBe(next);

    await expect(updateUserEmail(user.id, taken)).rejects.toBeInstanceOf(DuplicateEmailError);
    expect(await getUserEmail(user.id)).toBe(next); // the failed write changed nothing
  });

  it("sets a password without knowing the old one", async () => {
    const email = address();
    const user = await createUser(email, "service-Password-1");
    await setUserPassword(user.id, "service-Password-9");

    const found = await findUserByEmail(email);
    expect(verifyPassword("service-Password-9", found?.password_hash ?? "")).toBe(true);
    expect(verifyPassword("service-Password-1", found?.password_hash ?? "")).toBe(false);
  });

  it("deletes a user, after which nothing resolves them", async () => {
    const email = address();
    const user = await createUser(email, "service-Password-1");
    await deleteUser(user.id);
    expect(await getUserEmail(user.id)).toBeNull();
    expect(await findUserByEmail(email)).toBeNull();
  });

  it("returns null for an address nobody holds", async () => {
    expect(await findUserByEmail(address())).toBeNull();
  });
});
