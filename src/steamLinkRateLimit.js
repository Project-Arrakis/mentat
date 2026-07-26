// steamLinkRateLimit.js — rate limiting for the two public Steam-link
// OAuth endpoints (/steam-link/start, /steam-link/callback). See
// docs/steam-link-security-review.md FINDING-STEAM-4, which proposed this
// following the exact pattern of Core's own login rate limiter
// (dune-awakening-selfhost-docker's console/api/src/rateLimit.js) but was
// never actually implemented.
//
// Keyed by the session's `state` token rather than by IP: both endpoints
// sit behind the production Cloudflare Tunnel, where client IP is not
// reliably available without additional trusted-proxy configuration this
// repo doesn't set up today, and `state` already uniquely scopes one real
// link attempt (see steamLinkStore.js) -- so limiting per-state is both
// more precise and avoids depending on infrastructure this module can't
// verify from inside the process.
//
// In-memory, module-level singleton (matches cooldown.js's own pattern) --
// an in-memory-only limiter resetting on process restart is an accepted,
// low-cost limitation here, same rationale as steamLinkStore.js's own
// documented choice.

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_BLOCK_MS = 5 * 60 * 1000; // 5 minutes

let attempts = new Map();
let maxAttempts = DEFAULT_MAX_ATTEMPTS;
let windowMs = DEFAULT_WINDOW_MS;
let blockMs = DEFAULT_BLOCK_MS;
let now = () => Date.now();

// resetSteamLinkRateLimiterForTests: lets each test start from a clean
// slate and optionally override thresholds/clock, matching cooldown.test.js's
// resetCooldowns() convention.
export function resetSteamLinkRateLimiterForTests(options = {}) {
  attempts = new Map();
  maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  blockMs = options.blockMs ?? DEFAULT_BLOCK_MS;
  now = options.now ?? (() => Date.now());
}

function activeAttempt(key, timestamp) {
  const current = attempts.get(key);
  if (!current) return null;
  if (current.blockedUntil && current.blockedUntil > timestamp) return current;
  if (current.firstAttemptAt + windowMs <= timestamp) {
    attempts.delete(key);
    return null;
  }
  return current;
}

// checkSteamLinkRateLimit: call before doing any work for a request keyed
// by `key` (the state token). Does not record an attempt by itself --
// call recordSteamLinkAttempt() once the request is actually processed.
export function checkSteamLinkRateLimit(key) {
  const timestamp = now();
  const current = activeAttempt(String(key || ""), timestamp);
  if (current?.blockedUntil && current.blockedUntil > timestamp) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.blockedUntil - timestamp) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// recordSteamLinkAttempt: increments the attempt count for `key`. Once
// maxAttempts is reached within windowMs, the key is blocked for blockMs.
export function recordSteamLinkAttempt(key) {
  const timestamp = now();
  const safeKey = String(key || "");
  const current = activeAttempt(safeKey, timestamp);
  const next = !current || current.firstAttemptAt + windowMs <= timestamp
    ? { count: 1, firstAttemptAt: timestamp, blockedUntil: 0 }
    : { ...current, count: current.count + 1 };
  if (next.count >= maxAttempts) next.blockedUntil = timestamp + blockMs;
  attempts.set(safeKey, next);
  return checkSteamLinkRateLimit(safeKey);
}
