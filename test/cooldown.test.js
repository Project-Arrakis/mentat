import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCooldown, applyCooldown, clearCooldown, resetCooldowns, cooldownStats } from "../src/cooldown.js";

test.beforeEach(() => {
  resetCooldowns();
  delete process.env.DUNE_COOLDOWN_MS;
  delete process.env.DUNE_ADMIN_COOLDOWN_MS;
  delete process.env.DISCORD_ADMIN_ROLE_IDS;
});

test("checkCooldown allows first request", () => {
  const result = checkCooldown({ userId: "u1", commandName: "status" });
  assert.equal(result.allowed, true);
  assert.equal(result.remainingMs, 0);
});

test("checkCooldown allows different commands from same user", () => {
  applyCooldown({ userId: "u1", commandName: "status" });
  const result = checkCooldown({ userId: "u1", commandName: "health" });
  assert.equal(result.allowed, true);
});

test("checkCooldown allows same command from different users", () => {
  applyCooldown({ userId: "u1", commandName: "status" });
  const result = checkCooldown({ userId: "u2", commandName: "status" });
  assert.equal(result.allowed, true);
});

test("checkCooldown blocks repeated same user+command", () => {
  applyCooldown({ userId: "u1", commandName: "status" });
  const result = checkCooldown({ userId: "u1", commandName: "status" });
  assert.equal(result.allowed, false);
  assert.ok(result.remainingMs > 0);
});

test("checkCooldown allows after cooldown expires", async () => {
  process.env.DUNE_COOLDOWN_MS = "50";
  applyCooldown({ userId: "u1", commandName: "status" });
  await new Promise((r) => setTimeout(r, 60));
  const result = checkCooldown({ userId: "u1", commandName: "status" });
  assert.equal(result.allowed, true);
});

test("clearCooldown removes specific user+command", () => {
  applyCooldown({ userId: "u1", commandName: "status" });
  clearCooldown({ userId: "u1", commandName: "status" });
  const result = checkCooldown({ userId: "u1", commandName: "status" });
  assert.equal(result.allowed, true);
});

test("clearCooldown removes all for user", () => {
  applyCooldown({ userId: "u1", commandName: "status" });
  applyCooldown({ userId: "u1", commandName: "health" });
  clearCooldown({ userId: "u1" });
  assert.equal(checkCooldown({ userId: "u1", commandName: "status" }).allowed, true);
  assert.equal(checkCooldown({ userId: "u1", commandName: "health" }).allowed, true);
});

test("cooldownStats reports active cooldowns", () => {
  applyCooldown({ userId: "u1", commandName: "status" });
  const stats = cooldownStats();
  assert.ok(stats.active >= 1);
  assert.ok(stats.entries.some((e) => e.userId === "u1" && e.command === "status"));
});

test("admin roles get shorter cooldown", () => {
  process.env.DISCORD_ADMIN_ROLE_IDS = "admin-role";
  process.env.DUNE_COOLDOWN_MS = "5000";
  process.env.DUNE_ADMIN_COOLDOWN_MS = "10";
  const interaction = { member: { roles: { cache: new Map([["admin-role", {}]]) } } };
  applyCooldown({ userId: "u1", commandName: "status", interaction });
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = checkCooldown({ userId: "u1", commandName: "status" });
      assert.equal(result.allowed, true);
      resolve();
    }, 20);
  });
});

test("unknown userId or commandName defaults to allowed", () => {
  assert.equal(checkCooldown({}).allowed, true);
  assert.equal(checkCooldown({ userId: "x" }).allowed, true);
});
