/**
 * Per-IP rate limiting for the sensitive route handlers.
 *
 * WHY THIS LAYER EXISTS, AND WHY IT IS IN MEMORY
 *
 * The database already caps sign-in and registration, but it can only see an
 * email address: `smartgov.login_rate_limited` counts ten attempts per address,
 * so a password spray across a hundred addresses from one host is invisible to
 * it, and nothing inside the RPC layer can see the caller's address at all. The
 * route handler is the last place the request still carries one, which is why
 * this lives here and not in the functions.
 *
 * That also fixes the ceiling on how much this can be trusted. The counters are
 * per process: a scaled-out or serverless deployment gives every instance its
 * own `Map`, so an attacker who can spread load gets a fresh budget per
 * instance, and a cold start or a redeploy empties it outright. Anyone reading
 * this as a reason to relax `login_rate_limited` is reading it backwards -- the
 * two layers are meant to hold together, because the database one survives a
 * restart and cannot be walked around with a forged header.
 */

/** Either the caller may proceed, or how long they must wait before retrying. */
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Returned instead of an address when the forwarded chain says nothing usable. */
export const UNKNOWN_IP = "unknown";

type Bucket = { hits: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Sweeping on every write would walk the map on the hot path, which is the same
 * reason `consume_rate_limit` only sweeps two calls in a hundred. The counter is
 * a floor beneath that sample, so a run of unlucky draws still gets swept and
 * the map stays bounded by the keys touched in the current window.
 */
const SWEEP_PROBABILITY = 0.02;
const SWEEP_EVERY = 64;
let callsSinceSweep = 0;

function sweep(now: number): void {
  callsSinceSweep = (callsSinceSweep + 1) % SWEEP_EVERY;
  if (callsSinceSweep !== 0 && Math.random() >= SWEEP_PROBABILITY) return;

  for (const [id, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(id);
  }
}

/** Whole seconds left in the window, never zero and never past its own length. */
function secondsLeft(resetAt: number, now: number, windowSeconds: number): number {
  return Math.min(windowSeconds, Math.max(1, Math.ceil((resetAt - now) / 1000)));
}

/**
 * Charges one call against `key` and reports whether the caller is still inside
 * its budget.
 *
 * Fixed-window counting, and the key carries its window slot as
 * `<key>#<slot>` exactly as `consume_rate_limit` builds it, so the two layers
 * age the same way: a window rolling over starts a fresh count rather than
 * resetting a row, and a burst at the end of one window cannot borrow the next
 * one's headroom. A refused call still counts, for the same reason -- a
 * sustained flood should keep the window full rather than let it trickle.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  // A nonsense window is floored at a second rather than allowed to divide by
  // zero or produce a non-finite slot.
  const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 1_000;
  const windowSeconds = Math.ceil(window / 1_000);

  // Mirrors the guard at the top of `consume_rate_limit`: an empty bucket or a
  // non-positive budget is refused outright, because silently unlimited is the
  // one outcome a rate limiter must never produce.
  if (!key || !Number.isFinite(limit) || limit <= 0) {
    return { ok: false, retryAfterSeconds: windowSeconds };
  }

  const now = Date.now();
  const slot = Math.floor(now / window);
  const id = `${key}#${slot}`;
  const resetAt = (slot + 1) * window;

  sweep(now);

  const previous = buckets.get(id);
  const hits = (previous?.hits ?? 0) + 1;
  buckets.set(id, { hits, resetAt });

  // `consume_rate_limit` allows `hits <= p_limit`, so the call after the budget
  // is spent is the first one refused.
  if (hits > limit) {
    return { ok: false, retryAfterSeconds: secondsLeft(resetAt, now, windowSeconds) };
  }

  return { ok: true };
}

const IPV4_SHAPE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_SHAPE = /^[0-9a-f:]{2,45}$/i;

function looksLikeAddress(value: string): boolean {
  if (value.includes(":") && IPV6_SHAPE.test(value)) return true;
  if (!IPV4_SHAPE.test(value)) return false;
  return value.split(".").every((part) => Number(part) <= 255);
}

/**
 * The caller's address, for bucketing only -- never for an authorization
 * decision, and never logged as a trusted identity.
 *
 * Vercel appends to `x-forwarded-for` as a request crosses proxies, so the
 * leftmost entry is the original client; `x-real-ip` covers a self-hosted proxy
 * that sets only that.
 *
 * Anywhere else the header is whatever the caller typed, so anything that is
 * not plainly an address is discarded in favour of `UNKNOWN_IP`. That is not
 * only tidiness: a forged header that changed on every request would mint a
 * fresh bucket each time and walk straight past the limit, whereas a caller
 * whose address cannot be read at least shares a bucket that is still capped.
 * The price is that when the header is genuinely absent every such caller
 * spends one budget, which is why the windows in the routes are set for a
 * campus NAT rather than for one person.
 */
export function clientIp(req: Request): string {
  const chain = req.headers.get("x-forwarded-for");
  if (chain) {
    const first = chain.split(",")[0].trim();
    if (looksLikeAddress(first)) return first;
  }

  const real = req.headers.get("x-real-ip")?.trim() ?? "";
  if (looksLikeAddress(real)) return real;

  return UNKNOWN_IP;
}
