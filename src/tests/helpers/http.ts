import type { APIContext, AstroCookies } from "astro";

/**
 * A cookie jar standing in for `AstroCookies`, recording the options each `set` was given.
 *
 * The options matter as much as the values here: `HttpOnly` and `SameSite=Lax` on the session
 * cookie are part of this phase's contract, and they are invisible to a test that only reads
 * cookie values back. The Supabase cookie this replaces carried neither, which is precisely the
 * kind of regression a value-only assertion would not catch.
 */
export interface RecordedCookie {
  value: string;
  options: Record<string, unknown>;
}

export class TestCookies {
  readonly jar = new Map<string, RecordedCookie>();
  /** Every `set` in order, including ones later deleted — how a test proves a cookie was issued at all. */
  readonly writes: { name: string; value: string; options: Record<string, unknown> }[] = [];

  get(name: string) {
    const record = this.jar.get(name);
    return record ? { value: record.value } : undefined;
  }

  set(name: string, value: string, options?: Record<string, unknown>) {
    const opts = options ?? {};
    this.jar.set(name, { value, options: opts });
    this.writes.push({ name, value, options: opts });
  }

  delete(name: string, _options?: Record<string, unknown>) {
    this.jar.delete(name);
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  /** The last `set` for `name`, or undefined — the shape assertions about cookie flags read. */
  lastWrite(name: string) {
    return [...this.writes].reverse().find((w) => w.name === name);
  }

  asAstroCookies(): AstroCookies {
    return this as unknown as AstroCookies;
  }
}

export interface ApiContextOptions {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  cookies?: TestCookies;
  locals?: Partial<App.Locals>;
  params?: Record<string, string>;
}

/**
 * A hand-built `APIContext`, matching the direct-handler-import harness the ten existing route
 * suites use (template: `korekta-gate.test.ts:32-44`), plus the two things the auth routes need
 * that no earlier route did: a cookie jar and a working `redirect`.
 */
export function makeApiContext({
  url = "http://test.invalid/",
  method = "GET",
  headers,
  body,
  cookies = new TestCookies(),
  locals = {},
  params = {},
}: ApiContextOptions = {}): APIContext & { cookies: TestCookies } {
  return {
    cookies,
    locals,
    params,
    url: new URL(url),
    request: new Request(url, { method, headers, body }),
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext & { cookies: TestCookies };
}

/** The `?error=` message a redirect response carries, decoded, or null. */
export function redirectError(res: Response): string | null {
  const location = res.headers.get("Location");
  if (!location) return null;
  return new URL(location, "http://test.invalid").searchParams.get("error");
}

export function formBody(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}
