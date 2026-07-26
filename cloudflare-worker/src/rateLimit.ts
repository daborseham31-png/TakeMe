// ---------------------------------------------------------------------------
// Basic, best-effort rate limiting for the School Child create/reset
// endpoints — keyed per authenticated uid (never per-IP, since the whole
// point is bounding how often ONE parent can attempt code generation).
//
// IMPORTANT LIMITATION: this is a per-ISOLATE, in-memory counter, not a
// global one. Cloudflare may route a client's requests to different
// isolates/colos across a single burst, so a determined attacker spread
// across many edge locations could exceed this limit in aggregate. A true
// global limit needs a Durable Object or a KV-backed counter (its own
// provisioning step — a new binding in wrangler.jsonc, and, for a Durable
// Object, a `migrations` entry) — a reasonable next hardening step, not
// implemented here since it changes the Worker's deployment shape rather
// than just its code. This still meaningfully raises the cost of a
// single-isolate brute-force burst against one uid, which is what "basic
// rate limiting" calls for.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

// Opportunistic cleanup threshold — keeps this map from growing unbounded
// across a long-lived isolate without needing a separate timer/alarm.
const MAX_TRACKED_KEYS = 5_000;

const hits = new Map<string, { count: number; windowStart: number }>();

function pruneStaleEntries(now: number): void {
  for (const [key, entry] of hits) {
    if (now - entry.windowStart > WINDOW_MS) {
      hits.delete(key);
    }
  }
}

// Returns true when `key` (e.g. `create:${uid}` or `reset:${uid}`) has
// exceeded MAX_REQUESTS_PER_WINDOW requests within the current WINDOW_MS
// window — a fixed window counter, not a sliding one (simple and "basic" by
// design; see this file's header for the documented follow-up).
export function isRateLimited(key: string): boolean {
  const now = Date.now();

  if (hits.size > MAX_TRACKED_KEYS) {
    pruneStaleEntries(now);
  }

  const entry = hits.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// /school-kiosk/lookup rate limiting — this endpoint is deliberately PUBLIC
// (a child at a kiosk has no Firebase account/ID token), so it can't reuse
// the per-uid limiter above at all; the limiting key is the caller's own IP
// and/or the exact code hash they're guessing against, both attacker-chosen
// in a way a uid never is. Guessing a 6-digit code is the real threat this
// guards against (1,000,000 possible values), so this is deliberately
// stricter than isRateLimited above and, where a KV binding is actually
// provisioned, durable ACROSS isolates and deploys rather than only within
// one warm isolate — see env.ts's SCHOOL_KIOSK_RATE_LIMIT comment for exactly
// what "provisioned" requires and the project's final report for the exact
// `wrangler kv namespace create` step. Every caller of this file still also
// hits the in-memory check first (isRateLimited, keyed the same way) as a
// zero-latency first line of defense that works even before the KV
// namespace exists.
// ---------------------------------------------------------------------------

const KIOSK_IP_WINDOW_SECONDS = 60;
const KIOSK_IP_MAX_PER_WINDOW = 20;

// Far stricter than the per-IP window — a real child only ever retries their
// own code a handful of times; anything beyond that against the SAME code
// hash is a targeted guess, regardless of which (possibly rotating) IP it
// comes from.
const KIOSK_HASH_WINDOW_SECONDS = 300;
const KIOSK_HASH_MAX_PER_WINDOW = 8;

// Best-effort fixed-window counter in KV — reads then writes are not
// atomic, so a burst of concurrent requests can under-count by a handful
// under a genuine race; that's an acceptable trade-off for a rate limiter
// (never a security boundary on its own) and is still vastly more durable
// than the per-isolate in-memory map above. Returns false (never blocks)
// when no KV namespace is bound yet, so this endpoint keeps working before
// that binding is provisioned — see env.ts.
async function isKvWindowRateLimited(
  kv: KVNamespace | undefined,
  key: string,
  windowSeconds: number,
  maxPerWindow: number,
): Promise<boolean> {
  if (!kv) return false;

  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
  const kvKey = `${key}:${windowStart}`;

  let count = 0;
  try {
    const current = await kv.get(kvKey);
    count = current ? Number(current) || 0 : 0;
  } catch (error) {
    // KV being unavailable/misconfigured must never itself deny a
    // legitimate lookup — fail OPEN on read errors, same as "no binding".
    console.error("rateLimit: KV read failed", error instanceof Error ? error.name : "unknown");
    return false;
  }

  if (count >= maxPerWindow) return true;

  try {
    await kv.put(kvKey, String(count + 1), { expirationTtl: windowSeconds * 2 });
  } catch (error) {
    console.error("rateLimit: KV write failed", error instanceof Error ? error.name : "unknown");
  }

  return false;
}

// Checked in this order — cheapest/most-specific first: the in-memory
// per-isolate check never needs a network round trip, and the KV checks
// only run at all when the corresponding key is actually known (a lookup
// with no resolvable ip, or before a returnCode is even hashed, simply
// skips that one check rather than treating "unknown" as a free pass on the
// other).
export async function isKioskLookupRateLimited(
  kv: KVNamespace | undefined,
  ip: string,
  codeHash: string,
): Promise<boolean> {
  if (isRateLimited(`kiosk-ip:${ip}`)) return true;
  if (isRateLimited(`kiosk-hash:${codeHash}`)) return true;

  if (await isKvWindowRateLimited(kv, `kiosk-ip:${ip}`, KIOSK_IP_WINDOW_SECONDS, KIOSK_IP_MAX_PER_WINDOW)) {
    return true;
  }

  return isKvWindowRateLimited(kv, `kiosk-hash:${codeHash}`, KIOSK_HASH_WINDOW_SECONDS, KIOSK_HASH_MAX_PER_WINDOW);
}
