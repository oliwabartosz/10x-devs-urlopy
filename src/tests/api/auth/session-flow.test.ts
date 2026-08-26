import { describe, it, beforeAll, beforeEach, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { employees, sessions, users } from "@/db/schema";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee, FIXTURE_PASSWORD } from "@/tests/helpers/fixtures";
import { makeApiContext, redirectError, formBody, TestCookies } from "@/tests/helpers/http";
import { SESSION_COOKIE, readSession, resetRateLimits } from "@/lib/auth";
import { POST as SIGNIN } from "@/pages/api/auth/signin";
import { POST as SIGNOUT } from "@/pages/api/auth/signout";
import { POST as CHANGE_PASSWORD } from "@/pages/api/auth/password";

// The credential surface Supabase Auth used to own, now local. These assertions are the reason
// Phase 4 is the riskiest phase in the plan: nothing here is type-checked into correctness, and a
// session cookie that is issued but never accepted, or accepted but never revoked, fails silently
// in exactly the direction that looks like "it works".

/** The single message every sign-in failure produces, whatever the actual cause. */
const GENERIC_FAILURE = "Nieprawidłowy adres email lub hasło.";

describe("Local sessions and sign-in (route level)", () => {
  let db!: Db;
  let employeeId!: string;
  let email!: string;
  let userId!: string;

  const emailOf = async (id: string): Promise<string> => {
    const rows = await db
      .select({ email: users.email })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.user_id))
      .where(eq(employees.id, id));
    return rows[0].email;
  };

  const signIn = async (address: string, password: string, headers?: Record<string, string>) => {
    const cookies = new TestCookies();
    const res = await SIGNIN(
      makeApiContext({
        url: "http://test.invalid/api/auth/signin",
        method: "POST",
        headers,
        body: formBody({ email: address, password }),
        cookies,
      }),
    );
    return { res, cookies };
  };

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    email = await emailOf(employeeId);
    userId = (await db.select({ user_id: employees.user_id }).from(employees).where(eq(employees.id, employeeId)))[0]
      .user_id;
  });

  // Each test starts with a clean window, so one test's deliberate failures cannot throttle the
  // next one's legitimate sign-in and produce a failure that reads as a defect in the wrong file.
  beforeEach(() => {
    resetRateLimits();
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
  });

  it("correct credentials issue a session cookie and redirect home", async () => {
    const { res, cookies } = await signIn(email, FIXTURE_PASSWORD);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    const write = cookies.lastWrite(SESSION_COOKIE);
    expect(write).toBeDefined();
    expect(write?.value).toBeTruthy();

    const rows = await db
      .select({ user_id: sessions.user_id })
      .from(sessions)
      .where(eq(sessions.id, write?.value ?? ""));
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
  });

  it("the session cookie is HttpOnly, SameSite=Lax and path-scoped to the whole app", async () => {
    const { cookies } = await signIn(email, FIXTURE_PASSWORD);
    const options = cookies.lastWrite(SESSION_COOKIE)?.options ?? {};
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    // `Secure` follows PUBLIC_ORIGIN, which the test stub sets to http:// — the flag must NOT be
    // set here, or the cookie would be issued and never sent back.
    expect(options.secure).toBe(false);
  });

  it("the issued cookie resolves back to the signed-in user", async () => {
    const { cookies } = await signIn(email, FIXTURE_PASSWORD);
    const user = await readSession(cookies.asAstroCookies());
    expect(user).toEqual({ id: userId, email });
  });

  it("a wrong password issues no cookie and reports the generic message", async () => {
    const { res, cookies } = await signIn(email, "definitely-not-the-password");
    expect(res.status).toBe(302);
    expect(cookies.has(SESSION_COOKIE)).toBe(false);
    expect(redirectError(res)).toBe(GENERIC_FAILURE);
  });

  it("an unknown address is indistinguishable from a wrong password", async () => {
    const { res: unknownRes, cookies } = await signIn(`nobody-${crypto.randomUUID()}@test.invalid`, FIXTURE_PASSWORD);
    const { res: wrongRes } = await signIn(email, "definitely-not-the-password");

    expect(redirectError(unknownRes)).toBe(redirectError(wrongRes));
    expect(unknownRes.status).toBe(wrongRes.status);
    expect(cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("signing out deletes the session row and clears the cookie", async () => {
    const { cookies } = await signIn(email, FIXTURE_PASSWORD);
    const sessionId = cookies.lastWrite(SESSION_COOKIE)?.value ?? "";

    const res = await SIGNOUT(makeApiContext({ url: "http://test.invalid/api/auth/signout", method: "POST", cookies }));
    expect(res.status).toBe(302);
    expect(cookies.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(sessions).where(eq(sessions.id, sessionId))).toHaveLength(0);
  });

  it("an expired session resolves to null and is pruned", async () => {
    const { cookies } = await signIn(email, FIXTURE_PASSWORD);
    const sessionId = cookies.lastWrite(SESSION_COOKIE)?.value ?? "";
    await db
      .update(sessions)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionId));

    expect(await readSession(cookies.asAstroCookies())).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.id, sessionId))).toHaveLength(0);
  });

  it("a fabricated session id resolves to null", async () => {
    const cookies = new TestCookies();
    cookies.set(SESSION_COOKIE, "not-a-session-id-anyone-issued");
    expect(await readSession(cookies.asAstroCookies())).toBeNull();
  });
});

describe("Self-service password change (route level)", () => {
  let db!: Db;
  let employeeId!: string;
  let email!: string;
  let userId!: string;

  const NEW_PASSWORD = "changed-Password-456";

  const signInCookies = async (password: string): Promise<TestCookies> => {
    const cookies = new TestCookies();
    await SIGNIN(
      makeApiContext({
        url: "http://test.invalid/api/auth/signin",
        method: "POST",
        body: formBody({ email, password }),
        cookies,
      }),
    );
    return cookies;
  };

  const changePassword = (cookies: TestCookies, current: string, next: string) =>
    CHANGE_PASSWORD(
      makeApiContext({
        url: "http://test.invalid/api/auth/password",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
        cookies,
        locals: { user: { id: userId, email } },
      }),
    );

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    const rows = await db
      .select({ user_id: employees.user_id, email: users.email })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.user_id))
      .where(eq(employees.id, employeeId));
    userId = rows[0].user_id;
    email = rows[0].email;
  });

  // Every test here signs in one or more times, and those sessions outlive the test that made
  // them — so the revocation assertion below counts rows, and a leftover from a neighbour would
  // break it. Clear the account's sessions rather than the whole table: other suites in this file
  // share the database file.
  beforeEach(async () => {
    resetRateLimits();
    await db.delete(sessions).where(eq(sessions.user_id, userId));
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
  });

  it("a wrong current password is 400 with the Polish message and changes nothing", async () => {
    const cookies = await signInCookies(FIXTURE_PASSWORD);
    const res = await changePassword(cookies, "not-the-current-password", NEW_PASSWORD);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Obecne hasło jest nieprawidłowe." });

    // The old password still works — the failed attempt must not have written a hash.
    const stillValid = await signInCookies(FIXTURE_PASSWORD);
    expect(stillValid.has(SESSION_COOKIE)).toBe(true);
  });

  it("reusing the current password as the new one is 400", async () => {
    const cookies = await signInCookies(FIXTURE_PASSWORD);
    const res = await changePassword(cookies, FIXTURE_PASSWORD, FIXTURE_PASSWORD);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nowe hasło musi różnić się od obecnego." });
  });

  it("a new password under 8 characters is 400", async () => {
    const cookies = await signInCookies(FIXTURE_PASSWORD);
    expect((await changePassword(cookies, FIXTURE_PASSWORD, "short")).status).toBe(400);
  });

  it("a successful change keeps the caller's session and revokes every other one", async () => {
    // Three live sessions for one account: the browser making the change, plus two others
    // standing in for the phone and the desktop the dialog's toast promises to log out.
    const caller = await signInCookies(FIXTURE_PASSWORD);
    const other = await signInCookies(FIXTURE_PASSWORD);
    const third = await signInCookies(FIXTURE_PASSWORD);
    expect(await db.select().from(sessions).where(eq(sessions.user_id, userId))).toHaveLength(3);

    const res = await changePassword(caller, FIXTURE_PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    expect(await readSession(caller.asAstroCookies())).not.toBeNull();
    expect(await readSession(other.asAstroCookies())).toBeNull();
    expect(await readSession(third.asAstroCookies())).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.user_id, userId))).toHaveLength(1);

    // And the credential itself actually changed.
    expect((await signInCookies(NEW_PASSWORD)).has(SESSION_COOKIE)).toBe(true);
    expect((await signInCookies(FIXTURE_PASSWORD)).has(SESSION_COOKIE)).toBe(false);
  });

  it("an unauthenticated caller is 401", async () => {
    const res = await CHANGE_PASSWORD(
      makeApiContext({
        url: "http://test.invalid/api/auth/password",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: "a", new_password: "bbbbbbbb" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("Sign-in rate limiting (route level)", () => {
  let db!: Db;
  let employeeId!: string;
  let email!: string;

  const IP_HEADERS = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };

  const attempt = async (password: string) => {
    const cookies = new TestCookies();
    const res = await SIGNIN(
      makeApiContext({
        url: "http://test.invalid/api/auth/signin",
        method: "POST",
        headers: IP_HEADERS,
        body: formBody({ email, password }),
        cookies,
      }),
    );
    return { res, cookies };
  };

  beforeAll(async () => {
    db = await getTestDb();
    employeeId = await createTestEmployee(db);
    const rows = await db
      .select({ email: users.email })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.user_id))
      .where(eq(employees.id, employeeId));
    email = rows[0].email;
  });

  beforeEach(() => {
    resetRateLimits();
  });

  afterAll(async () => {
    await teardownTestEmployee(db, employeeId);
  });

  it("throttles after repeated failures, and says nothing different when it does", async () => {
    const failures = [];
    for (let i = 0; i < 5; i++) failures.push(await attempt("wrong-password-here"));
    for (const { res, cookies } of failures) {
      expect(cookies.has(SESSION_COOKIE)).toBe(false);
      expect(redirectError(res)).toBe(GENERIC_FAILURE);
    }

    // The window is now closed. The CORRECT password must be refused — that is what proves the
    // throttle is real rather than the sixth wrong password simply being wrong — and the response
    // must be byte-identical to a wrong-password one, or it announces both that the account exists
    // and exactly when the window resets.
    const throttled = await attempt(FIXTURE_PASSWORD);
    expect(throttled.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(throttled.res.status).toBe(failures[0].res.status);
    expect(redirectError(throttled.res)).toBe(GENERIC_FAILURE);
  });

  it("a successful sign-in clears the address's window", async () => {
    for (let i = 0; i < 4; i++) await attempt("wrong-password-here");
    expect((await attempt(FIXTURE_PASSWORD)).cookies.has(SESSION_COOKIE)).toBe(true);

    // Four more failures would have tripped the limit had the success not reset the count.
    for (let i = 0; i < 4; i++) await attempt("wrong-password-here");
    expect((await attempt(FIXTURE_PASSWORD)).cookies.has(SESSION_COOKIE)).toBe(true);
  });

  it("one address's exhausted window does not lock out another", async () => {
    for (let i = 0; i < 6; i++) await attempt("wrong-password-here");

    const otherId = await createTestEmployee(db);
    try {
      const rows = await db
        .select({ email: users.email })
        .from(employees)
        .innerJoin(users, eq(users.id, employees.user_id))
        .where(eq(employees.id, otherId));
      const cookies = new TestCookies();
      await SIGNIN(
        makeApiContext({
          url: "http://test.invalid/api/auth/signin",
          method: "POST",
          headers: IP_HEADERS,
          body: formBody({ email: rows[0].email, password: FIXTURE_PASSWORD }),
          cookies,
        }),
      );
      expect(cookies.has(SESSION_COOKIE)).toBe(true);
    } finally {
      await teardownTestEmployee(db, otherId);
    }
  });
});
