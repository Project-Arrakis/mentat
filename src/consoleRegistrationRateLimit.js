// consoleRegistrationRateLimit.js -- rate limiting for the new
// POST /api/consoles/register endpoint (dune-awakening-selfhost-docker's
// hosted-bot OAuth registration design). Modeled directly on
// statsPushRateLimit.js's own global-then-per-key pattern and its most
// important lesson: the per-key bucket (here, per verified Discord user ID)
// must only ever be touched AFTER the forwarded token has already been
// independently re-verified against Discord -- guildId/userId arrive
// alongside an UNVERIFIED token in the request, so consuming a per-user
// bucket before verification would let anyone claiming any user ID exhaust
// that specific user's quota with zero valid credentials. The global bucket
// has no such key and is the only limit an unauthenticated caller can ever
// affect -- and it is what actually bounds the endpoint's real cost, since a
// garbage token still reaches the local shape-validation step (see the
// route handler) before this limiter is even consulted for the per-user
// bucket.
//
// Layer 3 integration review Minor finding (2026-09-09): the real cost of
// one accepted request is TWO outbound Discord API calls, not one --
// verifyAndRegisterConsole() fetches /users/@me/guilds AND /users/@me in
// parallel for every request that passes local shape-validation. At
// GLOBAL_MAX_ATTEMPTS=120 per GLOBAL_WINDOW_MS (one minute), the real
// ceiling this bucket imposes on outbound Discord traffic is therefore 240
// calls/min, not 120.
const PER_USER_MAX_ATTEMPTS = 10;
const PER_USER_WINDOW_MS = 60 * 1000;
const PER_USER_BLOCK_MS = 60 * 1000;

const GLOBAL_MAX_ATTEMPTS = 120;
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_BLOCK_MS = 30 * 1000;

const GLOBAL_KEY = "__global__";

let perUserAttempts = new Map();
let globalAttempts = new Map();
let now = () => Date.now();

let perUserMax = PER_USER_MAX_ATTEMPTS;
let perUserWindow = PER_USER_WINDOW_MS;
let perUserBlock = PER_USER_BLOCK_MS;
let globalMax = GLOBAL_MAX_ATTEMPTS;
let globalWindow = GLOBAL_WINDOW_MS;
let globalBlock = GLOBAL_BLOCK_MS;

export function resetConsoleRegistrationRateLimiterForTests(options = {}) {
  perUserAttempts = new Map();
  globalAttempts = new Map();
  perUserMax = options.perUserMax ?? PER_USER_MAX_ATTEMPTS;
  perUserWindow = options.perUserWindow ?? PER_USER_WINDOW_MS;
  perUserBlock = options.perUserBlock ?? PER_USER_BLOCK_MS;
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

// recordGlobalConsoleRegistrationAttempt: call this FIRST, before any local
// validation or Discord call. Bounds total request volume regardless of
// credential validity -- the only limit an unauthenticated caller can ever
// affect.
export function recordGlobalConsoleRegistrationAttempt() {
  const timestamp = now();
  return recordBucket(globalAttempts, GLOBAL_KEY, timestamp, globalWindow, globalMax, globalBlock);
}

// recordUserConsoleRegistrationAttempt: call this ONLY after the forwarded
// token has already been independently verified against Discord for this
// exact userId. Never call it before verification succeeds.
export function recordUserConsoleRegistrationAttempt(discordUserId) {
  const timestamp = now();
  return recordBucket(perUserAttempts, String(discordUserId || ""), timestamp, perUserWindow, perUserMax, perUserBlock);
}
