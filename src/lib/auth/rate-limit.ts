/**
 * Brute-force defence on sign-in — the one protection that disappears with Supabase Auth.
 *
 * In-process and in-memory, which is sufficient *here* and would not be elsewhere: a single Node
 * process serves the whole VPS (`deploy/urlopy.service`), so there is no second instance holding a
 * different view of the counters. The accepted cost is that a restart clears every window — an
 * attacker who can restart the service has already won by other means, and the alternative (a
 * `rate_limits` table) would put a write on the hot path of every failed login for no gain at this
 * scale.
 *
 * Two independent windows, because they answer different questions: the per-address one stops a
 * password spray against one known account, the per-IP one stops the same client walking a list of
 * addresses. Either tripping is enough to refuse.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

/** Failure timestamps per key. Pruned on every touch, so an idle key costs nothing but its entry. */
const attempts = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const kept = (attempts.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (kept.length === 0) attempts.delete(key);
  else attempts.set(key, kept);
  return kept;
}

function emailKey(email: string): string {
  return `email:${email.toLowerCase()}`;
}

function ipKey(ip: string): string {
  return `ip:${ip}`;
}

/**
 * The client's address as nginx reports it, never the socket's — behind a reverse proxy every
 * request appears to come from 127.0.0.1, which would collapse the per-IP window into a single
 * global counter and lock every user out the moment one of them fumbled a password.
 *
 * `X-Forwarded-For` is a client-supplied header and is only trustworthy because nginx overwrites
 * it (`deploy/nginx/urlopy.conf`) and the Node process listens on loopback only. Left-most entry:
 * nginx appends, so the original client sits first.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() ?? "unknown";
}

/** True when this address or this client has already burned its budget of failures. */
export function isSignInThrottled(email: string, ip: string): boolean {
  const now = Date.now();
  return (
    recent(emailKey(email), now).length >= MAX_FAILURES_PER_EMAIL ||
    recent(ipKey(ip), now).length >= MAX_FAILURES_PER_IP
  );
}

export function recordSignInFailure(email: string, ip: string): void {
  const now = Date.now();
  for (const key of [emailKey(email), ipKey(ip)]) {
    attempts.set(key, [...recent(key, now), now]);
  }
}

/** Clear the address's window on a successful sign-in. The per-IP window survives deliberately —
 * one success must not wipe the evidence of nineteen failures against other addresses. */
export function clearSignInFailures(email: string): void {
  attempts.delete(emailKey(email));
}

/** Test-only reset, so one suite's exhausted window cannot leak into the next. */
export function resetRateLimits(): void {
  attempts.clear();
}
