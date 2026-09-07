import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkStatsPushRateLimit,
  recordStatsPushAttempt,
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

test("recordStatsPushAttempt blocks a second push for the same guild within the per-guild window", () => {
  resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 60000 });
  const first = recordStatsPushAttempt("guild-1");
  assert.equal(first.allowed, true);
  const second = recordStatsPushAttempt("guild-1");
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterSeconds > 0);
});

test("a blocked guild stays blocked until perGuildBlock elapses, then resets", () => {
  let now = 1000;
  resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 5000, now: () => now });
  recordStatsPushAttempt("guild-1"); // count=1, allowed
  recordStatsPushAttempt("guild-1"); // reaches perGuildMax, now blocked
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, false);

  now += 4000; // still within perGuildBlock
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, false);

  now += 2000; // past perGuildBlock (6000ms elapsed since block started)
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, true);
});

test("different guild_ids have independent per-guild limits", () => {
  resetStatsPushRateLimiterForTests({ perGuildMax: 1, perGuildWindow: 60000, perGuildBlock: 60000 });
  recordStatsPushAttempt("guild-1");
  assert.equal(checkStatsPushRateLimit("guild-1").allowed, false, "guild-1 is now blocked");
  assert.equal(checkStatsPushRateLimit("guild-2").allowed, true, "guild-2 has its own independent limit");
});

// This is the direct regression test for Layer 1 Security Architect /
// Network audit findings #3/#20: a flood of requests using distinct
// fabricated/unknown guild_ids -- each of which gets its own fresh
// per-guild bucket -- must still be bounded by a limit that does not
// depend on guild_id at all.
test("the global cap bounds a flood of distinct guild_ids, independent of any single guild's own limit", () => {
  // globalMax=3 -> 2 real allowed attempts, the 3rd both trips and is
  // itself rejected by the block (see the PER_GUILD_MAX_ATTEMPTS comment
  // in statsPushRateLimit.js for why this module's threshold is
  // inclusive of the blocking call).
  resetStatsPushRateLimiterForTests({ globalMax: 3, globalWindow: 60000, globalBlock: 60000, perGuildMax: 1000, perGuildWindow: 60000 });
  assert.equal(recordStatsPushAttempt("fabricated-1").allowed, true);
  assert.equal(recordStatsPushAttempt("fabricated-2").allowed, true);
  const third = recordStatsPushAttempt("fabricated-3");
  assert.equal(third.allowed, false, "a third distinct guild_id must still be rejected once the global cap is reached");
});

test("the global cap does not falsely reject a well-behaved single guild pushing at its normal interval", () => {
  resetStatsPushRateLimiterForTests({ globalMax: 2, globalWindow: 60000, perGuildMax: 100, perGuildWindow: 60000 });
  assert.equal(recordStatsPushAttempt("guild-1").allowed, true);
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
  assert.doesNotThrow(() => recordStatsPushAttempt(undefined));
  assert.doesNotThrow(() => recordStatsPushAttempt(""));
});
