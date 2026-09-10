import assert from "node:assert/strict";
import test from "node:test";
import { recordGlobalConsoleRegistrationAttempt, recordUserConsoleRegistrationAttempt, resetConsoleRegistrationRateLimiterForTests } from "../src/consoleRegistrationRateLimit.js";

test("global bucket blocks after its threshold, independent of any user id", () => {
  let clock = 0;
  resetConsoleRegistrationRateLimiterForTests({ globalMax: 3, globalWindow: 10000, globalBlock: 5000, now: () => clock });
  assert.equal(recordGlobalConsoleRegistrationAttempt().allowed, true);
  assert.equal(recordGlobalConsoleRegistrationAttempt().allowed, true);
  assert.equal(recordGlobalConsoleRegistrationAttempt().allowed, false, "the 3rd call reaches maxAttempts=3 and is itself blocked");
});

test("per-user bucket only limits the specific user id it's called for", () => {
  let clock = 0;
  resetConsoleRegistrationRateLimiterForTests({ perUserMax: 2, perUserWindow: 10000, perUserBlock: 5000, now: () => clock });
  recordUserConsoleRegistrationAttempt("111111111111111111");
  assert.equal(recordUserConsoleRegistrationAttempt("111111111111111111").allowed, false, "the 2nd call for the same user reaches maxAttempts=2 and is blocked");
  assert.equal(recordUserConsoleRegistrationAttempt("222222222222222222").allowed, true, "a different user's bucket is unaffected");
});

test("an already-blocked bucket does not have its block silently extended by further calls (mentat#276 regression)", () => {
  let clock = 0;
  resetConsoleRegistrationRateLimiterForTests({ globalMax: 1, globalWindow: 10000, globalBlock: 5000, now: () => clock });
  recordGlobalConsoleRegistrationAttempt();
  const secondCallResult = recordGlobalConsoleRegistrationAttempt();
  clock = 4000;
  const thirdCallResult = recordGlobalConsoleRegistrationAttempt();
  assert.ok(thirdCallResult.retryAfterSeconds <= secondCallResult.retryAfterSeconds, "retryAfterSeconds must count down, not reset, across repeated calls while blocked");
});

// Direct regression test for the actual vulnerability class this pattern
// exists to prevent (matching statsPushRateLimit.test.js's own coverage of
// the same class): an unauthenticated caller who merely claims a user id in
// the request body -- before any Discord token verification has happened --
// must not be able to exhaust that specific user's own bucket using only
// recordGlobalConsoleRegistrationAttempt(), which never touches it.
test("recordGlobalConsoleRegistrationAttempt never touches the per-user bucket, even when called many times", () => {
  let clock = 0;
  resetConsoleRegistrationRateLimiterForTests({ globalMax: 1000, perUserMax: 2, perUserWindow: 10000, perUserBlock: 10000, now: () => clock });
  for (let i = 0; i < 50; i++) {
    recordGlobalConsoleRegistrationAttempt();
  }
  assert.equal(recordUserConsoleRegistrationAttempt("victim-user").allowed, true, "a flood of global-only (pre-verification) attempts must never exhaust a specific user's own per-user bucket");
});

test("different user ids have independent buckets, and an expired window resets a blocked bucket", () => {
  let clock = 0;
  resetConsoleRegistrationRateLimiterForTests({ perUserMax: 2, perUserWindow: 1000, perUserBlock: 500, now: () => clock });
  assert.equal(recordUserConsoleRegistrationAttempt("user-a").allowed, true, "the 1st call for user-a is allowed (maxAttempts=2)");
  assert.equal(recordUserConsoleRegistrationAttempt("user-a").allowed, false, "the 2nd call for user-a reaches maxAttempts=2 and is blocked");
  assert.equal(recordUserConsoleRegistrationAttempt("user-b").allowed, true, "user-b has its own independent limit");
  // Note: a record* call within the still-open ORIGINAL window (here,
  // 0-1000ms) that arrives after blockedUntil (500ms) but before the
  // window itself elapses re-triggers the block, because count is already
  // >= maxAttempts within that window -- only a fully-elapsed window
  // resets the bucket (matching statsPushRateLimit.js's identical
  // behavior). Advance past the window itself, not just the block.
  clock = 1100;
  assert.equal(recordUserConsoleRegistrationAttempt("user-a").allowed, true, "user-a's window must have fully elapsed, resetting the bucket");
});

test("empty/undefined discordUserId is treated as its own distinct key, not a crash", () => {
  resetConsoleRegistrationRateLimiterForTests({ perUserMax: 2 });
  assert.doesNotThrow(() => recordUserConsoleRegistrationAttempt(undefined));
  assert.doesNotThrow(() => recordUserConsoleRegistrationAttempt(""));
});
