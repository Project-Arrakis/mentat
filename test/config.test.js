import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

function baseEnv(overrides = {}) {
  return {
    DISCORD_BOT_TOKEN: "discord-token",
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_OBSERVER_ROLE_IDS: "observer-role",
    DUNE_CONSOLE_API_URL: "http://console-api:3000",
    DUNE_DISCORD_ADAPTER_TOKEN: "adapter-token",
    ...overrides
  };
}

test("loadConfig returns safe read-only adapter defaults", () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.adapter.paths.health, "/api/integrations/discord/health");
  assert.equal(config.adapter.methods.health, "GET");
  assert.equal(config.adapter.methods.status, "POST");
  assert.equal(config.discord.defaultEphemeral, true);
  assert.equal(config.discord.rbac.mode, "restricted");
  assert.deepEqual(config.discord.rbac.commandRoleIds.about, ["observer-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds.ping, ["observer-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds.status, ["observer-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds["status-summary"], ["observer-role"]);
});

test("loadConfig accepts endpoint overrides and legacy role allow-list", () => {
  const config = loadConfig(baseEnv({
    DISCORD_OBSERVER_ROLE_IDS: "",
    DISCORD_ALLOWED_ROLE_IDS: "one, two",
    DUNE_ADAPTER_STATUS_PATH: "/api/discord/status",
    DUNE_ADAPTER_STATUS_METHOD: "get",
    DISCORD_DEFAULT_EPHEMERAL: "false"
  }));

  assert.deepEqual(config.discord.rbac.observerRoleIds, ["one", "two"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds.status, ["one", "two"]);
  assert.equal(config.adapter.paths.status, "/api/discord/status");
  assert.equal(config.adapter.methods.status, "GET");
  assert.equal(config.discord.defaultEphemeral, false);
});

test("loadConfig supports command-specific and admin RBAC role inheritance", () => {
  const config = loadConfig(baseEnv({
    DISCORD_ADMIN_ROLE_IDS: "admin-role",
    DISCORD_PING_ROLE_IDS: "ping-role",
    DISCORD_STATUS_SUMMARY_ROLE_IDS: "summary-role",
    DISCORD_SERVICES_ROLE_IDS: "service-role"
  }));

  assert.deepEqual(config.discord.rbac.commandRoleIds.health, ["observer-role", "admin-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds.about, ["observer-role", "admin-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds.ping, ["observer-role", "admin-role", "ping-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds["status-summary"], ["observer-role", "admin-role", "summary-role"]);
  assert.deepEqual(config.discord.rbac.commandRoleIds.services, ["observer-role", "admin-role", "service-role"]);
});

test("loadConfig can run in explicit open RBAC mode for local testing", () => {
  const config = loadConfig(baseEnv({
    DISCORD_OBSERVER_ROLE_IDS: "",
    DISCORD_RBAC_MODE: "open"
  }));

  assert.equal(config.discord.rbac.mode, "open");
  assert.deepEqual(config.discord.rbac.observerRoleIds, []);
});

test("loadConfig fails closed when restricted RBAC has no principals", () => {
  assert.throws(
    () => loadConfig(baseEnv({ DISCORD_OBSERVER_ROLE_IDS: "" })),
    /Restricted RBAC requires/
  );
});

test("loadConfig rejects unsafe adapter URLs", () => {
  assert.throws(
    () => loadConfig(baseEnv({ DUNE_CONSOLE_API_URL: "file:///etc/passwd" })),
    /must use http or https/
  );
});

test("loadConfig requires adapter paths to stay absolute", () => {
  assert.throws(
    () => loadConfig(baseEnv({ DUNE_ADAPTER_SERVICES_PATH: "api/services" })),
    /must start with/
  );
});
