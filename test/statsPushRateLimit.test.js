import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkStatsPushRateLimit,
  recordGlobalStatsPushAttempt,
  recordGuildStatsPushAttempt,
  resetStatsPushRateLimiterForTests
} from "../src/statsPushRateLimit.js";

test.beforeEach(() => {
  resetStatsPushRateLimiterForTests();
});

test("checkStatsPushRateLimit allows a guild with no prior attempts", () => {
  const result = checkStatsPushRateLimit("guild-1");
  assert.equal(result.allowed, true);
  assert.equal(result.retryAfterSeconds, 0);
});

test("recordGuildStatsPushAttempt blocks a second push for the same guild within the per-guild window", () => {
  resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 60000 });
  const first = recordGuildStatsPushAttempt("guild-1");
  assert.equal(first.allowed, true);
  const second = recordGuildStatsPushAttempt("guild-1");
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterSeconds > 0);
});

test("a blocked guild stays blocked until perGuildBlock elapses, then resets", () => {
  let now = 1000;
  resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 5000, now: () => now });
  recordGuildStatsPushAttempt("guild-1"); // count=1, allowed
  recordGuildStatsPushAttempt("guild-1"); // reaches perGuildMax, now blocked
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, false);

  now += 4000; // still within perGuildBlock
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, false);

  now += 2000; // past perGuildBlock (6000ms elapsed since block started)
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, true);
});

// Regression test for the "block extension" bug fixed in the same pass
// (recordBucket used to recompute blockedUntil on every call while a
// bucket was already blocked, silently extending a bounded block into an
// unbounded one). A trickle of calls arriving *while already blocked*
// must never push blockedUntil further into the future.
test("further attempts while already blocked do not extend the block", () => {
  let now = 1000;
  resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 5000, now: () => now });
  recordGuildStatsPushAttempt("guild-1"); // count=1
  recordGuildStatsPushAttempt("guild-1"); // count=2, now blocked until 6000
  now += 3000; // still blocked (now=4000)
  recordGuildStatsPushAttempt("guild-1"); // must NOT push blockedUntil to 3000+5000=8000
  now += 3000; // now=7000 -- past the ORIGINAL blockedUntil of 6000
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, true, "the block must have expired at its original deadline, not been silently extended by the trickle attempt at now=4000");
});

test("different guild_ids have independent per-guild limits", () => {
  resetStatsPushRateLimiterForTests({ perGuildMax: 1, perGuildWindow: 60000, perGuildBlock: 60000 });
  recordGuildStatsPushAttempt("guild-1");
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, false, "guild-1 is now blocked");
  assert.equal(checkStatsPushRateLimit("guild-2").allowed, true, "guild-2 has its own independent limit");
});

// This is the direct regression test for Layer 1 Security Architect /
// Network audit findings #3/#20: a flood of requests -- each of which
// would get its own fresh per-guild bucket if it ever reached that check
// -- must still be bounded by a limit that does not depend on guild_id at
// all. recordGlobalStatsPushAttempt() takes no guild_id argument at all,
// reflecting the real route: it's called for every request before auth,
// regardless of what (unauthenticated, attacker-controlled) guild_id the
// request claims.
test("the global cap bounds a flood of requests, independent of any single guild's own limit", () => {
  // globalMax=3 -> 2 real allowed attempts, the 3rd both trips and is
  // itself rejected by the block (see the PER_GUILD_MAX_ATTEMPTS comment
  // in statsPushRateLimit.js for why this module's threshold is
  // inclusive of the blocking call).
  resetStatsPushRateLimiterForTests({ globalMax: 3, globalWindow: 60000, globalBlock: 60000 });
  assert.equal(recordGlobalStatsPushAttempt().allowed, true);
  assert.equal(recordGlobalStatsPushAttempt().allowed, true);
  const third = recordGlobalStatsPushAttempt();
  assert.equal(third.allowed, false, "a third request must still be rejected once the global cap is reached, regardless of guild_id");
});

test("the global cap does not falsely reject a well-behaved single guild pushing at its normal interval", () => {
  resetStatsPushRateLimiterForTests({ globalMax: 2, globalWindow: 60000, perGuildMax: 100, perGuildWindow: 60000 });
  assert.equal(recordGlobalStatsPushAttempt().allowed, true);
  assert.equal(recordGuildStatsPushAttempt("guild-1").allowed, true);
  // The per-guild limiter here permits a second immediate call, but the
  // global cap of 2 total requests (across ALL guilds) is what this test
  // is really pinning -- confirms the two limits are independent checks,
  // not accidentally sharing state.
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, true);
});

test("checkStatsPushRateLimit does not itself record an attempt (check/record are independent, matching steamLinkRateLimit.js's split)", () => {
  resetStatsPushRateLimiterForTests({ perGuildMax: 1, perGuildWindow: 60000, perGuildBlock: 60000 });
  checkStatsPushRateLimit("guild-1");
  checkStatsPushRateLimit("guild-1");
  checkStatsPushRateLimit("guild-1");
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, true, "repeated checks with no recorded attempts must never block");
});

test("empty/undefined guild_id is treated as its own distinct key, not a crash", () => {
  resetStatsPushRateLimiterForTests({ perGuildMax: 2 });
  assert.doesNotThrow(() => recordGuildStatsPushAttempt(undefined));
  assert.doesNotThrow(() => recordGuildStatsPushAttempt(""));
});

// Direct regression test for the actual vulnerability class this Layer 2
// finding fixed: an unauthenticated attacker who merely knows a victim
// guild's ID (public, not secret) must not be able to exhaust that
// guild's own rate-limit bucket using recordGlobalStatsPushAttempt()
// alone -- the per-guild bucket must stay completely untouched by any
// number of global-only calls.
test("recordGlobalStatsPushAttempt never touches the per-guild bucket, even when called many times", () => {
  resetStatsPushRateLimiterForTests({ globalMax: 1000, perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 60000 });
  for (let i = 0; i < 50; i++) {
    recordGlobalStatsPushAttempt();
  }
  assert.equal(checkStatsPushRateLimit("victim-guild").allowed, true, "a flood of global-only (pre-auth) attempts must never exhaust a specific guild's own per-guild bucket");
});
