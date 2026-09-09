// statsPushRateLimit.js — rate limiting for the inbound cross-console
// live-stats push endpoint (POST /api/stats/push, mentat#276). Two
// independent limits, per the Layer 1 Security Architect / Network audit
// (findings #3/#20):
//
//   - Global: bounds total request volume regardless of guild_id, before
//     any authentication is attempted -- this is what actually protects
//     the synchronous DB lookup + decrypt on the shared Node event loop
//     that every request pays regardless of whether its credential is
//     valid (Layer 1 Architect audit finding C1, Security Architect
//     finding #3).
//   - Per-guild: caps how often ONE guild's secret can be used, tighter
//     than the expected push interval so a legitimate operator's Core
//     instance never gets throttled but a runaway retry loop does.
//
// SECURITY (found in a Layer 2 /code-review high pass, mentat#276): the
// per-guild bucket MUST only ever be touched AFTER a request has already
// authenticated successfully. guild_id arrives in the unauthenticated
// request body, and Discord guild IDs are not secret -- if the per-guild
// bucket were consumed before auth (as an earlier version of this route
// did), anyone who merely knows a victim guild's ID could send garbage-
// credentialed requests to exhaust THAT GUILD's own rate-limit bucket,
// denying its real, correctly-authenticated console the ability to push
// at all. Callers must call recordGlobalStatsPushAttempt() before auth
// and recordGuildStatsPushAttempt(guildId) only once auth has actually
// succeeded -- never the reverse, and never call the per-guild function
// for a request that hasn't passed verifyGuildStatsPushSecret().
//
// Keyed by guild_id (from the request body), not IP -- this endpoint sits
// behind the same Cloudflare Tunnel that makes client IP unreliable for
// steamLinkRateLimit.js, and the same reasoning applies here. In-memory,
// module-level singleton, matching that module's own pattern (an
// in-memory-only limiter resetting on process restart is an accepted,
// low-cost limitation, same rationale as steamLinkStore.js's documented
// choice).

// NOTE on the "2" here: this module's activeBucket/recordBucket pair
// (mirroring steamLinkRateLimit.js's own convention exactly) counts the
// attempt that REACHES the threshold as itself already blocked -- with
// maxAttempts=N, exactly N-1 calls return allowed:true before the Nth
// (and every call thereafter, until blockMs elapses) returns
// allowed:false. So maxAttempts=2 is what actually yields "1 real push
// allowed per window, the next one in the same window rejected" --
// maxAttempts=1 would reject even the very first, legitimate push.
const PER_GUILD_MAX_ATTEMPTS = 2;
const PER_GUILD_WINDOW_MS = 45 * 1000;
const PER_GUILD_BLOCK_MS = 45 * 1000;

const GLOBAL_MAX_ATTEMPTS = 240;
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_BLOCK_MS = 30 * 1000;

const GLOBAL_KEY = "__global__";

let perGuildAttempts = new Map();
let globalAttempts = new Map();
let now = () => Date.now();

let perGuildMax = PER_GUILD_MAX_ATTEMPTS;
let perGuildWindow = PER_GUILD_WINDOW_MS;
let perGuildBlock = PER_GUILD_BLOCK_MS;
let globalMax = GLOBAL_MAX_ATTEMPTS;
let globalWindow = GLOBAL_WINDOW_MS;
let globalBlock = GLOBAL_BLOCK_MS;

// resetStatsPushRateLimiterForTests: lets each test start from a clean
// slate and optionally override thresholds/clock, matching
// steamLinkRateLimit.js's resetSteamLinkRateLimiterForTests() convention.
export function resetStatsPushRateLimiterForTests(options = {}) {
  perGuildAttempts = new Map();
  globalAttempts = new Map();
  perGuildMax = options.perGuildMax ?? PER_GUILD_MAX_ATTEMPTS;
  perGuildWindow = options.perGuildWindow ?? PER_GUILD_WINDOW_MS;
  perGuildBlock = options.perGuildBlock ?? PER_GUILD_BLOCK_MS;
  globalMax = options.globalMax ?? GLOBAL_MAX_ATTEMPTS;
  globalWindow = options.globalWindow ?? GLOBAL_WINDOW_MS;
  globalBlock = options.globalBlock ?? GLOBAL_BLOCK_MS;
  now = options.now ?? (() => Date.now());
}

function activeBucket(map, key, timestamp, windowMs) {
  const current = map.get(key);
  if (!current) return null;
  if (current.blockedUntil && current.blockedUntil > timestamp) return current;
  if (current.firstAttemptAt + windowMs <= timestamp) {
    map.delete(key);
    return null;
  }
  return current;
}

function checkBucket(map, key, timestamp, windowMs) {
  const current = activeBucket(map, key, timestamp, windowMs);
  if (current?.blockedUntil && current.blockedUntil > timestamp) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.blockedUntil - timestamp) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// BUG FIXED (Layer 2 /code-review high, mentat#276): this used to
// recompute `blockedUntil = timestamp + blockMs` on EVERY call while a
// bucket was already blocked, because the "already blocked" branch of
// activeBucket() returns the bucket as truthy and the old code treated
// any truthy `current` the same as a fresh one to increment. That meant
// a bucket already past its threshold had its block silently extended by
// every subsequent request that arrived before the block expired --
// turning a bounded, temporary rate limit into an unbounded one that a
// slow, sustained trickle of requests (an attacker deliberately pacing
// just inside the window, or even a naive un-backed-off retry loop)
// could keep alive indefinitely. Fixed by short-circuiting on an
// already-blocked bucket: once blocked, further calls are a pure no-op
// read (via checkBucket) until blockedUntil naturally elapses.
function recordBucket(map, key, timestamp, windowMs, maxAttempts, blockMs) {
  const current = activeBucket(map, key, timestamp, windowMs);
  if (current?.blockedUntil && current.blockedUntil > timestamp) {
    return checkBucket(map, key, timestamp, windowMs);
  }
  const next = !current || current.firstAttemptAt + windowMs <= timestamp
    ? { count: 1, firstAttemptAt: timestamp, blockedUntil: 0 }
    : { ...current, count: current.count + 1 };
  if (next.count >= maxAttempts) next.blockedUntil = timestamp + blockMs;
  map.set(key, next);
  return checkBucket(map, key, timestamp, windowMs);
}

// checkStatsPushRateLimit: read-only peek at both buckets (global, then
// per-guild), without recording an attempt against either. Exposed for
// callers that want a dry-run check; the real route below uses the
// record* functions directly instead (see the check-then-record lag
// warning on those).
export function checkStatsPushRateLimit(guildId) {
  const timestamp = now();
  const globalResult = checkBucket(globalAttempts, GLOBAL_KEY, timestamp, globalWindow);
  if (!globalResult.allowed) return globalResult;
  return checkBucket(perGuildAttempts, String(guildId || ""), timestamp, perGuildWindow);
}

// recordGlobalStatsPushAttempt: call this FIRST, before authenticating
// the request at all. Bounds the synchronous DB-lookup-and-decrypt cost
// every request pays regardless of whether its credential is valid, and
// is the only limit an unauthenticated caller can ever affect -- it has
// no guild_id key, so it cannot be aimed at a specific victim guild.
export function recordGlobalStatsPushAttempt() {
  const timestamp = now();
  return recordBucket(globalAttempts, GLOBAL_KEY, timestamp, globalWindow, globalMax, globalBlock);
}

// recordGuildStatsPushAttempt: call this ONLY after the request has
// already passed verifyGuildStatsPushSecret() for this exact guildId.
// Never call it before authentication succeeds -- guild_id arrives
// unauthenticated in the request body, and Discord guild IDs are public
// (visible in invite links, widgets, etc.), so consuming this bucket
// pre-auth would let anyone who merely knows a victim's guild ID exhaust
// that specific guild's quota with zero valid credentials, denying their
// real console's own legitimate pushes. See the module-level comment.
export function recordGuildStatsPushAttempt(guildId) {
  const timestamp = now();
  return recordBucket(perGuildAttempts, String(guildId || ""), timestamp, perGuildWindow, perGuildMax, perGuildBlock);
}
