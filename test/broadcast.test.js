import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBroadcastMessage, broadcastEnabled, checkBroadcastCooldown, applyBroadcastCooldown } from "../src/broadcast.js";

test("validateBroadcastMessage accepts valid message", () => {
  assert.equal(validateBroadcastMessage("Server restart in 5m"), "Server restart in 5m");
});

test("validateBroadcastMessage rejects empty message", () => {
  assert.throws(() => validateBroadcastMessage(""));
  assert.throws(() => validateBroadcastMessage("  "));
});

test("validateBroadcastMessage rejects long message", () => {
  assert.throws(() => validateBroadcastMessage("x".repeat(501)));
});

test("validateBroadcastMessage rejects control characters", () => {
  assert.throws(() => validateBroadcastMessage("bad\u0001message"));
});

test("broadcastEnabled returns false by default", () => {
  assert.equal(broadcastEnabled({}), false);
});

test("broadcast cooldown allows first request", () => {
  const result = checkBroadcastCooldown("u1");
  assert.equal(result.allowed, true);
});

test("broadcast cooldown blocks repeated requests", () => {
  applyBroadcastCooldown("u1");
  const result = checkBroadcastCooldown("u1");
  assert.equal(result.allowed, false);
});

test("broadcast cooldown allows different users", () => {
  applyBroadcastCooldown("u1");
  assert.equal(checkBroadcastCooldown("u2").allowed, true);
});
