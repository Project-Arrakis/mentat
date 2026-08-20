/**
 * TEST-2: syncCommands.integration.test.js
 *
 * End-to-end integration test for /dune admin sync-commands, run through
 * the REAL executeDuneCommand() dispatcher (same pattern as
 * test/commands.test.js) rather than isolated t.pass() placeholders.
 *
 * Verifies:
 * - Command requires admin/owner role (non-admins get a permission error)
 * - Successful drift check reports registry vs Core catalog (no guildId
 *   leaked)
 * - Error messages are sanitized (SEC-2): no guildId, no raw adapter
 *   error text reaches the user-facing embed — classified by the
 *   adapter's HTTP status, not message substrings (#199)
 * - Core unavailability is handled gracefully (no crash, sanitized message)
 * - A sync never mutates the shared registry served to other tenants and
 *   the public API (#192 cross-tenant poisoning regression), exercised
 *   here at the full command-dispatch level, not just registryLoader's
 *   own unit tests
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeDuneCommand } from "../src/commands.js";
import { __resetForTests, loadRegistryAtStartup, getRegistryFromCache, getRegistryMetadata } from "../src/registryLoader.js";
import { resetCooldowns } from "../src/cooldown.js";

beforeEach(() => {
  __resetForTests();
  // sync-commands compares Core's catalog against the committed registry
  // artifact — load it exactly as index.js does at startup.
  loadRegistryAtStartup();
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

test("sync-commands integration: successful drift check renders the dedicated embed, no guildId leaked", async () => {
  const adapterClient = { discordCatalog: async () => mockRegistry() };
  let replied;
  const interaction = mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    guildId: "guild-super-secret-id",
    onReply: (r) => { replied = r; }
  });

  await executeDuneCommand(interaction, adapterClient, adminConfig);

  const text = JSON.stringify(replied);
  // #210/P1: the dedicated drift-check embed, not a generic debug dump
  assert.match(text, /Command Catalog Drift Check/);
  assert.match(text, /Bot Registry/);
  assert.match(text, /Core Catalog/);
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
  assert.match(text, /Command Catalog Drift Check/);
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

test("sync-commands integration: a sync never mutates the shared registry (#192 poisoning regression)", async () => {
  const committedBefore = getRegistryFromCache();
  const metaBefore = getRegistryMetadata();

  // A (hostile or just different) tenant Core returns a catalog that
  // looks nothing like the committed artifact...
  const adapterClient = {
    discordCatalog: async () => ({
      version: 99,
      groups: [{ name: "evil", subcommands: [{ name: "poisoned", description: "injected", params: [] }] }]
    })
  };
  let replied;
  const interaction = mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    guildId: "guild-tenant-a",
    onReply: (r) => { replied = r; }
  });

  await executeDuneCommand(interaction, adapterClient, adminConfig);

  // ...the invoker gets an honest drift report...
  const text = JSON.stringify(replied);
  assert.match(text, /drift/i);

  // ...and shared process state is untouched: what every other tenant
  // and the public GET /api/commands see is still the committed artifact.
  const cachedAfter = getRegistryFromCache();
  assert.equal(cachedAfter.version, committedBefore.version);
  assert.equal(getRegistryMetadata().commandCount, metaBefore.commandCount);
  assert.ok(!cachedAfter.groups.some((g) => g.name === "evil"));
});

test("sync-commands integration: concurrent syncs from different guilds each fetch their own Core", async () => {
  const calls = [];
  const adapterClient = {
    discordCatalog: async (actor, guildId) => {
      calls.push(guildId);
      await new Promise((r) => setTimeout(r, 20));
      return mockRegistry();
    }
  };

  const replies = [];
  const makeInteraction = (guildId) => mockInteraction("admin", "sync-commands", {
    roles: ["admin-role"],
    guildId,
    onReply: (r) => replies.push(r)
  });

  await Promise.all([
    executeDuneCommand(makeInteraction("guild-a"), adapterClient, adminConfig),
    executeDuneCommand(makeInteraction("guild-b"), adapterClient, adminConfig)
  ]);

  // Each guild talks to its OWN Core: coalescing guild-b's check onto
  // guild-a's in-flight fetch (the old "CRITICAL-1 serialization") would
  // report one tenant the other tenant's catalog.
  assert.deepEqual(calls.sort(), ["guild-a", "guild-b"]);
  assert.equal(replies.length, 2, "both callers must get a reply");
});

export default undefined;
