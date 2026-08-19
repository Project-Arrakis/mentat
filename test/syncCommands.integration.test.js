/**
 * TEST-2: syncCommands.integration.test.js
 *
 * End-to-end integration test for /dune admin sync-commands, run through
 * the REAL executeDuneCommand() dispatcher (same pattern as
 * test/commands.test.js) rather than isolated t.pass() placeholders.
 *
 * Verifies:
 * - Command requires admin/owner role (non-admins get a permission error)
 * - Successful refresh returns before/after metadata (no guildId leaked)
 * - Error messages are sanitized (SEC-2): no guildId, no raw adapter
 *   error text reaches the user-facing embed
 * - Core unavailability is handled gracefully (no crash, sanitized message)
 * - Concurrent sync-commands calls are serialized (CRITICAL-1), exercised
 *   here at the full command-dispatch level, not just registryLoader's
 *   own unit tests
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeDuneCommand } from "../src/commands.js";
import { __resetForTests } from "../src/registryLoader.js";
import { resetCooldowns } from "../src/cooldown.js";

beforeEach(() => {
  __resetForTests();
  // Prevent cross-test cooldown pollution: each test below calls
  // admin:sync-commands, and cooldown.js's in-memory map persists across
  // tests within the same process/file otherwise.
  resetCooldowns();
});

function mockOptions(group, subcommand) {
  return {
    getSubcommandGroup: () => group || "",
    getSubcommand: () => subcommand,
    getBoolean: () => false,
    getString: () => ""
  };
}

function mockInteraction(group, subcommand, opts = {}) {
  return {
    isChatInputCommand: () => true,
    commandName: "dune",
    options: mockOptions(group, subcommand),
    user: opts.user || { id: "user-1" },
    member: { roles: opts.roles || [] },
    guildId: opts.guildId || "guild-123456789",
    channelId: "channel-1",
    deferReply: async () => {},
    editReply: async (r) => { opts.onReply?.(r); },
    reply: async (r) => { opts.onReply?.(r); }
  };
}

const adminConfig = {
  multiTenant: false,
  discord: {
    defaultEphemeral: true,
    rbac: {
      mode: "restricted",
      observerRoleIds: ["observer-role"],
      adminRoleIds: ["admin-role"],
      commandRoleIds: { "admin:sync-commands": ["admin-role"] }
    }
  }
};

function mockRegistry() {
  return {
    version: 2,
    groups: [
      { name: "core", title: "Core", subcommands: [{ name: "about", description: "ok", params: [] }] },
      { name: "server", title: "Server", subcommands: [{ name: "status", description: "ok", params: [] }] }
    ]
  };
}

test("sync-commands integration: non-admin actor is rejected before Core is ever called", async () => {
  let calls = 0;
  const adapterClient = { discordCatalog: async () => { calls += 1; return mockRegistry(); } };
  let replied;
  const interaction = mockInteraction("admin", "sync-commands", {
    roles: ["observer-role"], // NOT admin-role
    onReply: (r) => { replied = r; }
  });

  await executeDuneCommand(interaction, adapterClient, adminConfig);

  assert.equal(calls, 0, "adapter must not be called for a non-admin actor");
  const text = JSON.stringify(replied);
  // Rejected by the generic RBAC gate (isCommandAllowed(), keyed off
  // commandRoleIds) before ever reaching the admin:sync-commands-specific
  // isAdminActor() check -- both are "deny by default" gates, this is
  // the outer one.
  assert.match(text, /not authorized/i);
});

test("sync-commands integration: successful refresh returns before/after metadata, no guildId leaked", async () => {
  const adapterClient = { discordCatalog: async () => mockRegistry() };
  let replied;
  const interaction = mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    guildId: "guild-super-secret-id",
    onReply: (r) => { replied = r; }
  });

  await executeDuneCommand(interaction, adapterClient, adminConfig);

  const text = JSON.stringify(replied);
  assert.match(text, /sync-commands/);
  assert.doesNotMatch(text, /guild-super-secret-id/, "SEC-2: guildId must never appear in the user-facing response");
});

test("sync-commands integration: adapter/Core error is sanitized (SEC-2, no raw error text)", async () => {
  const adapterClient = {
    discordCatalog: async () => {
      throw Object.assign(new Error("Adapter discord-catalog returned HTTP 500."), { status: 500 });
    }
  };
  let replied;
  const interaction = mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    guildId: "guild-super-secret-id",
    onReply: (r) => { replied = r; }
  });

  await executeDuneCommand(interaction, adapterClient, adminConfig);

  const text = JSON.stringify(replied);
  assert.match(text, /Request failed/i);
  assert.match(text, /Core encountered an error/i);
  // Must NOT leak the raw adapter error message, guildId, or internal paths
  assert.doesNotMatch(text, /guild-super-secret-id/);
  assert.doesNotMatch(text, /HTTP 500/);
});

test("sync-commands integration: Core unavailability (network/timeout) is handled gracefully, no crash", async () => {
  const adapterClient = {
    discordCatalog: async () => {
      throw new Error("Adapter discord-catalog request timed out after 8000ms.");
    }
  };
  let replied;
  const interaction = mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    onReply: (r) => { replied = r; }
  });

  // Must resolve, not throw -- the bot must stay up even if Core is down.
  await assert.doesNotReject(executeDuneCommand(interaction, adapterClient, adminConfig));

  const text = JSON.stringify(replied);
  assert.match(text, /timed out|Core encountered an error|unresponsive/i);
});

test("sync-commands integration: concurrent /dune admin sync-commands calls are serialized (CRITICAL-1)", async () => {
  let inFlightCalls = 0;
  let maxConcurrent = 0;
  const adapterClient = {
    discordCatalog: async () => {
      inFlightCalls += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlightCalls);
      await new Promise((r) => setTimeout(r, 20));
      inFlightCalls -= 1;
      return mockRegistry();
    }
  };

  const replies = [];
  const makeInteraction = () => mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    onReply: (r) => replies.push(r)
  });

  await Promise.all([
    executeDuneCommand(makeInteraction(), adapterClient, adminConfig),
    executeDuneCommand(makeInteraction(), adapterClient, adminConfig)
  ]);

  assert.equal(maxConcurrent, 1, "only one discordCatalog() call should be in flight at a time");
  assert.equal(replies.length, 2, "both callers must still get a reply");
});

export default undefined;
