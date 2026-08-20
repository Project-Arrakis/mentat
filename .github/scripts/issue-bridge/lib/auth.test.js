import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCommandAuthorization, isAuthorized } from "./auth.mjs";
import { loadConfig } from "./config.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "..", "..", ".github", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);

test("permission ordering: write < maintain < admin", () => {
  assert.equal(isAuthorized("write", "write"), true);
  assert.equal(isAuthorized("write", "maintain"), false);
  assert.equal(isAuthorized("maintain", "maintain"), true);
  assert.equal(isAuthorized("maintain", "admin"), false);
  assert.equal(isAuthorized("admin", "admin"), true);
  assert.equal(isAuthorized("admin", "write"), true);
});

test("triage collapses to read-equivalent (below write)", () => {
  assert.equal(isAuthorized("triage", "write"), false);
  assert.equal(isAuthorized("read", "write"), false);
});

test("an unrecognized role fails closed rather than being treated as privileged", () => {
  assert.equal(isAuthorized("some-custom-role", "write"), false);
  assert.equal(isAuthorized(undefined, "write"), false);
  assert.equal(isAuthorized(null, "admin"), false);
});

test("rejects an unknown required level rather than silently allowing", () => {
  assert.throws(() => isAuthorized("admin", "superadmin"));
});

// Full permission matrix from spec section 31, driven off the real config.
const MATRIX = [
  ["internal", "write", true],
  ["internal", "maintain", true],
  ["internal", "admin", true],
  ["security", "write", true],
  ["security", "maintain", true],
  ["security", "admin", true],
  ["public", "write", false],
  ["public", "maintain", true],
  ["public", "admin", true],
  ["public_status", "write", false],
  ["public_status", "maintain", true],
  ["public_status", "admin", true],
  ["resolution", "write", false],
  ["resolution", "maintain", true],
  ["resolution", "admin", true],
  ["pause", "write", false],
  ["pause", "maintain", true],
  ["pause", "admin", true],
  ["resume", "write", false],
  ["resume", "maintain", true],
  ["resume", "admin", true],
  ["security_clear", "write", false],
  ["security_clear", "maintain", false],
  ["security_clear", "admin", true]
];

test("SEC-007/SEC-009/SEC-010: full permission matrix matches spec section 31", () => {
  for (const [command, role, expected] of MATRIX) {
    const result = checkCommandAuthorization(config, command, role);
    assert.equal(
      result.authorized,
      expected,
      `${command} with role=${role} expected authorized=${expected}, got ${result.authorized}`
    );
  }
});

test("/internal and unrecognized commands never require authorization", () => {
  assert.equal(checkCommandAuthorization(config, "internal", "none").requiresAuth, false);
  assert.equal(checkCommandAuthorization(config, "unrecognized", "none").requiresAuth, false);
  assert.equal(checkCommandAuthorization(config, null, "none").requiresAuth, false);
});

test("throws for a command with no permission mapping instead of silently allowing", () => {
  assert.throws(() => checkCommandAuthorization(config, "not-a-real-command", "admin"));
});
