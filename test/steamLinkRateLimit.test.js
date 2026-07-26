import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkSteamLinkRateLimit,
  recordSteamLinkAttempt,
  resetSteamLinkRateLimiterForTests
} from "../src/steamLinkRateLimit.js";

test.beforeEach(() => {
  resetSteamLinkRateLimiterForTests();
});

test("checkSteamLinkRateLimit allows a key with no prior attempts", () => {
  const result = checkSteamLinkRateLimit("state-1");
  assert.equal(result.allowed, true);
  assert.equal(result.retryAfterSeconds, 0);
});

test("recordSteamLinkAttempt allows attempts under the threshold", () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 5 });
  for (let i = 0; i < 4; i += 1) {
    const result = recordSteamLinkAttempt("state-1");
    assert.equal(result.allowed, true);
  }
});

test("recordSteamLinkAttempt blocks once maxAttempts is reached", () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 3 });
  recordSteamLinkAttempt("state-1");
  recordSteamLinkAttempt("state-1");
  const result = recordSteamLinkAttempt("state-1");
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds > 0);
});

test("a blocked key stays blocked on subsequent checks until blockMs elapses", () => {
  let now = 1000;
  resetSteamLinkRateLimiterForTests({ maxAttempts: 2, windowMs: 60000, blockMs: 5000, now: () => now });
  recordSteamLinkAttempt("state-1");
  recordSteamLinkAttempt("state-1"); // reaches maxAttempts, now blocked
  assert.equal(checkSteamLinkRateLimit("state-1").allowed, false);

  now += 4000; // still within blockMs
  assert.equal(checkSteamLinkRateLimit("state-1").allowed, false);

  now += 2000; // past blockMs (6000ms elapsed since block started)
  assert.equal(checkSteamLinkRateLimit("state-1").allowed, true);
});

test("different keys have independent attempt counts", () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 2 });
  recordSteamLinkAttempt("state-1");
  recordSteamLinkAttempt("state-1"); // state-1 now blocked
  assert.equal(checkSteamLinkRateLimit("state-1").allowed, false);
  assert.equal(checkSteamLinkRateLimit("state-2").allowed, true);
});

test("attempt count resets after windowMs elapses without reaching the block threshold", () => {
  let now = 1000;
  resetSteamLinkRateLimiterForTests({ maxAttempts: 5, windowMs: 1000, blockMs: 5000, now: () => now });
  recordSteamLinkAttempt("state-1");
  recordSteamLinkAttempt("state-1");

  now += 2000; // past windowMs, count should reset rather than accumulate
  const result = recordSteamLinkAttempt("state-1");
  assert.equal(result.allowed, true);
});

test("empty/undefined key is treated as its own distinct key, not a crash", () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 2 });
  assert.doesNotThrow(() => recordSteamLinkAttempt(undefined));
  assert.doesNotThrow(() => recordSteamLinkAttempt(""));
});
