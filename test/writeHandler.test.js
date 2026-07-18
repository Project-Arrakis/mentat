import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWriteCommand, WRITE_COMMANDS } from "../src/writeHandler.js";

function mockInteraction(userId = "user-1", roleIds = []) {
  return {
    user: { id: userId, username: "test-user" },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: { cache: new Map(roleIds.map(r => [r, {}])) } }
  };
}

function mockConfig(writesEnabled = false, adminRoleIds = [], ownerRoleIds = []) {
  return {
    discord: {
      writes: { enabled: writesEnabled },
      rbac: { adminRoleIds, observerRoleIds: [] },
      commandRoleIds: {}
    }
  };
}

test("handleWriteCommand returns disabled when writes are off", async () => {
  const interaction = mockInteraction();
  const config = mockConfig(false);
  const result = await handleWriteCommand({
    subcommand: "maintenance-note",
    interaction,
    adapterClient: {},
    config
  });
  assert.equal(result.ok, false);
  assert.equal(result.disabled, true);
  assert.ok(result.error.includes("disabled"));
});

test("handleWriteCommand requires write roles when writes are enabled", async () => {
  const old = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    const interaction = mockInteraction("user-1", ["role-unknown"]);
    const config = mockConfig(true);
    const result = await handleWriteCommand({
      subcommand: "maintenance-note",
      interaction,
      adapterClient: {},
      config
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Not authorized"));
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = old;
  }
});

test("handleWriteCommand returns confirmation for valid write admin", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    const interaction = mockInteraction("user-1", ["write-admin-role"]);
    const config = mockConfig(true);
    const result = await handleWriteCommand({
      subcommand: "maintenance-note",
      interaction,
      adapterClient: {},
      config
    });
    assert.equal(result.ok, true);
    assert.equal(result.needsConfirmation, true);
    assert.ok(result.confirmationMessage.includes("maintenance:set-note"));
    assert.equal(result.tier, "admin");
    assert.equal(result.status, "pending-upstream");
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});

test("handleWriteCommand rejects unknown write subcommand", async () => {
  const old = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    const result = await handleWriteCommand({
      subcommand: "nonexistent",
      interaction: mockInteraction(),
      adapterClient: {},
      config: mockConfig(true)
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Unknown"));
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = old;
  }
});

test("WRITE_COMMANDS registry matches 12 write subcommands", () => {
  assert.equal(WRITE_COMMANDS.length, 12);
  const names = WRITE_COMMANDS.map(c => c.name).sort();
  assert.deepEqual(names, [
    "add-channel",
    "alert-channel",
    "alert-threshold",
    "backup",
    "cache",
    "digest-schedule",
    "maintenance-note",
    "maintenance-window",
    "post-schedule",
    "remove-channel",
    "restart",
    "update"
  ]);
});

test("WRITE_COMMANDS have required fields", () => {
  for (const cmd of WRITE_COMMANDS) {
    assert.equal(cmd.group, "write");
    assert.ok(cmd.name.length > 0, `${cmd.name} has name`);
    assert.ok(cmd.action.length > 0, `${cmd.name} has action`);
    assert.ok(["low", "medium", "high"].includes(cmd.risk), `${cmd.name} valid risk`);
    assert.ok(["admin", "owner"].includes(cmd.tier), `${cmd.name} valid tier`);
  }
});

test("all write commands return pending-upstream status", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    for (const cmd of WRITE_COMMANDS) {
      const interaction = mockInteraction("user-1", ["write-admin-role"]);
      const config = mockConfig(true);
      const result = await handleWriteCommand({
        subcommand: cmd.name,
        interaction,
        adapterClient: {},
        config
      });
      assert.equal(result.ok, true, `${cmd.name} should succeed`);
      assert.equal(result.status, "pending-upstream", `${cmd.name} pending upstream`);
      assert.equal(result.action, cmd.action, `${cmd.name} action matches`);
    }
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});

test("write commands never call adapter — pure read-only scaffold", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  let adapterCalled = false;
  const adapterClient = {
    writeExecute: () => { adapterCalled = true; },
    writePreview: () => { adapterCalled = true; }
  };
  try {
    for (const cmd of WRITE_COMMANDS) {
      await handleWriteCommand({
        subcommand: cmd.name,
        interaction: mockInteraction("user-1", ["write-admin-role"]),
        adapterClient,
        config: mockConfig(true)
      });
    }
    assert.equal(adapterCalled, false, "no adapter write route was called");
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});
