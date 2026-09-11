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

// Phase 2b (dune-awakening-selfhost-docker#876, design doc §13): a SEPARATE
// bucket for GET /api/consoles/auto-invite/confirmation-status, deliberately
// not sharing globalAttempts above. Layer 2 audit finding: that bucket is
// sized to bound one-shot calls (/auto-invite/start, /register), each
// costing real outbound Discord API traffic -- but Core's wizard polls this
// status route repeatedly (every ~10s for up to ~20 minutes PER pending
// confirmation) by design. Sharing the 120/min bucket would let sustained
// legitimate polling from even one or two in-flight confirmations consume
// most of the budget sized for real registration attempts, causing an
// unrelated operator's brand-new /auto-invite/start call to get a spurious
// 429. Sized generously for a purely in-memory Map.get() with real,
// multi-tenant concurrent polling in mind (up to ~100 confirmations polling
// concurrently at the wizard's own 10-second interval), not for bounding
// expensive outbound calls the way the registration bucket is.
const CONFIRMATION_STATUS_MAX_ATTEMPTS = 600;
const CONFIRMATION_STATUS_WINDOW_MS = 60 * 1000;
const CONFIRMATION_STATUS_BLOCK_MS = 30 * 1000;

const GLOBAL_KEY = "__global__";

let perUserAttempts = new Map();
let globalAttempts = new Map();
let confirmationStatusAttempts = new Map();
let now = () => Date.now();

let perUserMax = PER_USER_MAX_ATTEMPTS;
let perUserWindow = PER_USER_WINDOW_MS;
let perUserBlock = PER_USER_BLOCK_MS;
let globalMax = GLOBAL_MAX_ATTEMPTS;
let globalWindow = GLOBAL_WINDOW_MS;
let globalBlock = GLOBAL_BLOCK_MS;
let confirmationStatusMax = CONFIRMATION_STATUS_MAX_ATTEMPTS;
let confirmationStatusWindow = CONFIRMATION_STATUS_WINDOW_MS;
let confirmationStatusBlock = CONFIRMATION_STATUS_BLOCK_MS;

export function resetConsoleRegistrationRateLimiterForTests(options = {}) {
  perUserAttempts = new Map();
  globalAttempts = new Map();
  confirmationStatusAttempts = new Map();
  perUserMax = options.perUserMax ?? PER_USER_MAX_ATTEMPTS;
  perUserWindow = options.perUserWindow ?? PER_USER_WINDOW_MS;
  perUserBlock = options.perUserBlock ?? PER_USER_BLOCK_MS;
  globalMax = options.globalMax ?? GLOBAL_MAX_ATTEMPTS;
  globalWindow = options.globalWindow ?? GLOBAL_WINDOW_MS;
  globalBlock = options.globalBlock ?? GLOBAL_BLOCK_MS;
  confirmationStatusMax = options.confirmationStatusMax ?? CONFIRMATION_STATUS_MAX_ATTEMPTS;
  confirmationStatusWindow = options.confirmationStatusWindow ?? CONFIRMATION_STATUS_WINDOW_MS;
  confirmationStatusBlock = options.confirmationStatusBlock ?? CONFIRMATION_STATUS_BLOCK_MS;
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

// recordGlobalConfirmationStatusAttempt: the poll-specific bucket described
// above -- deliberately separate from recordGlobalConsoleRegistrationAttempt()
// so sustained legitimate polling never starves an unrelated operator's
// one-shot registration attempt.
export function recordGlobalConfirmationStatusAttempt() {
  const timestamp = now();
  return recordBucket(confirmationStatusAttempts, GLOBAL_KEY, timestamp, confirmationStatusWindow, confirmationStatusMax, confirmationStatusBlock);
}
