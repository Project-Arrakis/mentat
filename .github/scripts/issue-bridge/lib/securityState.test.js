import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.mjs";
import {
  applySecurityClear,
  applySecurityCommand,
  applySyncPause,
  applySyncResume,
  canPublishOutbound
} from "./securityState.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "..", "..", ".github", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);

test("SEC-005: outbound publication is blocked while sync:paused", () => {
  const labels = new Set(["source:public", "visibility:internal", "sync:paused"]);
  const result = canPublishOutbound(labels, config);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "sync-paused");
});

test("SEC-006: outbound publication is blocked while visibility:security-sensitive", () => {
  const labels = new Set(["source:public", "visibility:internal", "visibility:security-sensitive", "sync:paused"]);
  const result = canPublishOutbound(labels, config);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "security-sensitive");
});

test("publication is blocked when sync:error is present", () => {
  const labels = new Set(["sync:error"]);
  assert.equal(canPublishOutbound(labels, config).reason, "sync-error");
});

test("publication is blocked when sync:enabled is simply absent (no explicit paused/error either)", () => {
  const labels = new Set(["source:public", "visibility:internal"]);
  assert.equal(canPublishOutbound(labels, config).reason, "sync-not-enabled");
});

test("publication is allowed only when sync:enabled is present and no blocking label is set", () => {
  const labels = new Set(["source:public", "visibility:internal", "sync:enabled"]);
  assert.deepEqual(canPublishOutbound(labels, config), { allowed: true, reason: null });
});

test("SEC-008: /security adds security-sensitive + sync:paused and removes sync:enabled", () => {
  const delta = applySecurityCommand(config);
  assert.deepEqual(delta.add.sort(), ["sync:paused", "visibility:security-sensitive"].sort());
  assert.deepEqual(delta.remove, ["sync:enabled"]);
});

test("SEC-010: /security-clear removes ONLY visibility:security-sensitive, never touches sync:paused", () => {
  const delta = applySecurityClear(config);
  assert.deepEqual(delta.remove, ["visibility:security-sensitive"]);
  assert.deepEqual(delta.add, []);
  assert.equal(delta.remove.includes("sync:paused"), false);
});

test("/sync-pause adds sync:paused and removes sync:enabled", () => {
  const delta = applySyncPause(config);
  assert.deepEqual(delta.add, ["sync:paused"]);
  assert.deepEqual(delta.remove, ["sync:enabled"]);
});

test("/sync-resume is blocked while security-sensitive is present, with no label delta", () => {
  const labels = new Set(["visibility:security-sensitive", "sync:paused"]);
  const result = applySyncResume(labels, config);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "security-sensitive");
  assert.deepEqual(result.add, []);
  assert.deepEqual(result.remove, []);
});

test("/sync-resume succeeds once security-sensitive has been cleared", () => {
  const labels = new Set(["sync:paused"]);
  const result = applySyncResume(labels, config);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.add, ["sync:enabled"]);
  assert.deepEqual(result.remove.sort(), ["sync:error", "sync:paused"].sort());
});

test("two-step recovery: /security-clear alone does not re-enable sync (section 27)", () => {
  let labels = new Set(["visibility:security-sensitive", "sync:paused"]);
  const clearDelta = applySecurityClear(config);
  for (const l of clearDelta.remove) labels.delete(l);
  for (const l of clearDelta.add) labels.add(l);

  // Still blocked: sync:paused was never removed by /security-clear.
  assert.equal(canPublishOutbound(labels, config).allowed, false);
  assert.equal(canPublishOutbound(labels, config).reason, "sync-paused");

  // A separate /sync-resume is required, and now succeeds.
  const resumeResult = applySyncResume(labels, config);
  assert.equal(resumeResult.allowed, true);
  for (const l of resumeResult.remove) labels.delete(l);
  for (const l of resumeResult.add) labels.add(l);
  assert.equal(canPublishOutbound(labels, config).allowed, true);
});

test("a single /security-clear command cannot, by itself, immediately republish content", () => {
  // Regression test for the exact security property in spec section 27.
  let labels = new Set(["visibility:security-sensitive", "sync:paused"]);
  const clearDelta = applySecurityClear(config);
  for (const l of clearDelta.remove) labels.delete(l);
  for (const l of clearDelta.add) labels.add(l);
  assert.equal(canPublishOutbound(labels, config).allowed, false);
});
