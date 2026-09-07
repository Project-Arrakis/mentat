// statsPushRateLimit.js — rate limiting for the inbound cross-console
// live-stats push endpoint (POST /api/stats/push, mentat#276). Two
// independent limits, per the Layer 1 Security Architect / Network audit
// (findings #3/#20):
//
//   - Per-guild: caps how often ONE guild's secret can be used, tighter
//     than the expected push interval so a legitimate operator's Core
//     instance never gets throttled but a runaway retry loop does.
//   - Global: bounds total request volume regardless of guild_id, so a
//     flood of requests using fabricated/unknown guild_ids -- each of
//     which would otherwise get its own fresh per-guild bucket -- can't
//     defeat the per-guild limit simply by rotating IDs. This is what
//     actually protects the synchronous DB lookup + decrypt on the
//     shared Node event loop that every request pays regardless of
//     whether its credential is valid (Layer 1 Architect audit finding
//     C1, Security Architect finding #3).
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

function recordBucket(map, key, timestamp, windowMs, maxAttempts, blockMs) {
  const current = activeBucket(map, key, timestamp, windowMs);
  const next = !current || current.firstAttemptAt + windowMs <= timestamp
    ? { count: 1, firstAttemptAt: timestamp, blockedUntil: 0 }
    : { ...current, count: current.count + 1 };
  if (next.count >= maxAttempts) next.blockedUntil = timestamp + blockMs;
  map.set(key, next);
  return checkBucket(map, key, timestamp, windowMs);
}

// checkStatsPushRateLimit: call before doing any DB work for a request.
// Checks the global bucket first (so an already-flooded global limit
// rejects a fabricated-guild-id request before it can even acquire its
// own fresh per-guild bucket), then the per-guild bucket. Does not record
// an attempt itself -- call recordStatsPushAttempt() once the request is
// actually processed (matches steamLinkRateLimit.js's own check/record
// split).
export function checkStatsPushRateLimit(guildId) {
  const timestamp = now();
  const globalResult = checkBucket(globalAttempts, GLOBAL_KEY, timestamp, globalWindow);
  if (!globalResult.allowed) return globalResult;
  return checkBucket(perGuildAttempts, String(guildId || ""), timestamp, perGuildWindow);
}

// recordStatsPushAttempt: records this request against both the global
// and per-guild buckets and returns whichever result is more
// restrictive. Callers wanting an immediate, per-request allow/reject
// decision (e.g. the HTTP route) should call this directly rather than
// calling checkStatsPushRateLimit() first and record separately -- a
// bucket only becomes "blocked" as a side effect of a record call, so a
// check-then-record split lags one request behind: the exact request
// that pushes a bucket over its threshold would otherwise still be
// reported allowed by a check that ran before this call updated state.
export function recordStatsPushAttempt(guildId) {
  const timestamp = now();
  const globalResult = recordBucket(globalAttempts, GLOBAL_KEY, timestamp, globalWindow, globalMax, globalBlock);
  const perGuildResult = recordBucket(perGuildAttempts, String(guildId || ""), timestamp, perGuildWindow, perGuildMax, perGuildBlock);
  return globalResult.allowed ? perGuildResult : globalResult;
}
