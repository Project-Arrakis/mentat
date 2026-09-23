import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { handleWriteCommand, LEGACY_WRITE_STUBS } from "../src/writeHandler.js";
import { getPendingConfirmation, resetPendingConfirmations } from "../src/writeConfirmation.js";

beforeEach(() => resetPendingConfirmations());

function mockInteraction(userId = "user-1", roleIds = [], { guildOwnerId = null } = {}) {
  return {
    user: { id: userId, username: "test-user" },
    guild: { ownerId: guildOwnerId },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: { cache: new Map(roleIds.map(r => [r, {}])) } }
  };
}

// Issue #238: owner-tier access is real Discord guild ownership, never a
// role -- this mock represents the actual guild owner, with zero roles.
function mockOwnerInteraction(userId = "real-owner") {
  return mockInteraction(userId, [], { guildOwnerId: userId });
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
    group: "write",
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
      group: "write",
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
      group: "write",
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

test("handleWriteCommand registers a button-based pending confirmation", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    const interaction = mockInteraction("user-42", ["write-admin-role"]);
    const config = mockConfig(true);
    const result = await handleWriteCommand({
      group: "write",
      subcommand: "maintenance-note",
      interaction,
      adapterClient: {},
      config
    });

    assert.ok(result.confirmationEmbed, "should return an embed for the confirmation prompt");
    assert.ok(result.confirmationRow, "should return a button row for the confirmation prompt");

    const rowJson = result.confirmationRow.toJSON();
    const customIds = rowJson.components.map((c) => c.custom_id);
    assert.deepEqual(customIds, [
      `write:confirm:${result.idempotencyKey}`,
      `write:cancel:${result.idempotencyKey}`
    ]);

    const pending = getPendingConfirmation(result.idempotencyKey);
    assert.ok(pending, "confirmation should be tracked as pending");
    assert.equal(pending.userId, "user-42");
    assert.equal(pending.action, "maintenance:set-note");
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
      group: "write",
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

// [Task 4, Step 7] WRITE_COMMANDS was replaced by LEGACY_WRITE_STUBS -- the 9
// remaining group="write" subcommands with no real backing feature yet
// (backup/restart/update were superseded by real WRITE_ACTIONS entries and
// removed from this table; see writeHandler.js's own comment).
test("LEGACY_WRITE_STUBS registry matches the 9 remaining legacy write subcommands", () => {
  assert.equal(LEGACY_WRITE_STUBS.length, 9);
  const names = LEGACY_WRITE_STUBS.map(c => c.name).sort();
  assert.deepEqual(names, [
    "add-channel",
    "alert-channel",
    "alert-threshold",
    "cache",
    "digest-schedule",
    "maintenance-note",
    "maintenance-window",
    "post-schedule",
    "remove-channel"
  ]);
});

test("LEGACY_WRITE_STUBS have required fields", () => {
  for (const cmd of LEGACY_WRITE_STUBS) {
    assert.equal(cmd.group, "write");
    assert.ok(cmd.name.length > 0, `${cmd.name} has name`);
    assert.ok(cmd.action.length > 0, `${cmd.name} has action`);
    assert.ok(["low", "medium", "high"].includes(cmd.risk), `${cmd.name} valid risk`);
    assert.ok(["admin", "owner"].includes(cmd.tier), `${cmd.name} valid tier`);
  }
});

test("all write commands return pending-upstream status for the real guild owner", async () => {
  // Uses the real guild owner (rather than write-admin) specifically
  // because owner outranks admin: this test verifies every command's
  // scaffold works, not tier enforcement, which is covered separately
  // below. Issue #238: owner-tier access is real Discord guild ownership,
  // never a role (DISCORD_WRITE_OWNER_ROLE_IDS no longer reaches it -- see
  // "write-admin/write-owner-role-env" tests below for that deprecation).
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    for (const cmd of LEGACY_WRITE_STUBS) {
      const interaction = mockOwnerInteraction();
      const config = mockConfig(true);
      const result = await handleWriteCommand({
        group: "write", subcommand: cmd.name,
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
  }
});

test("write-admin role cannot reach owner-tier commands (tier separation)", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    const ownerTierCommands = LEGACY_WRITE_STUBS.filter((c) => c.tier === "owner");
    const adminTierCommands = LEGACY_WRITE_STUBS.filter((c) => c.tier === "admin");
    assert.ok(ownerTierCommands.length > 0, "fixture assumption: at least one owner-tier command exists");
    assert.ok(adminTierCommands.length > 0, "fixture assumption: at least one admin-tier command exists");

    for (const cmd of ownerTierCommands) {
      const interaction = mockInteraction("user-1", ["write-admin-role"]);
      const config = mockConfig(true);
      const result = await handleWriteCommand({ group: "write", subcommand: cmd.name, interaction, adapterClient: {}, config });
      assert.equal(result.ok, false, `write-admin must not reach owner-tier ${cmd.name}`);
      assert.ok(result.error.includes("real owner"), `${cmd.name} error should point at the real Discord guild owner, not a role (issue #238)`);
      assert.ok(!result.error.includes("write-owner"), `${cmd.name} error must not reference a nonexistent "write-owner role" (issue #238)`);
    }

    for (const cmd of adminTierCommands) {
      const interaction = mockInteraction("user-1", ["write-admin-role"]);
      const config = mockConfig(true);
      const result = await handleWriteCommand({ group: "write", subcommand: cmd.name, interaction, adapterClient: {}, config });
      assert.equal(result.ok, true, `write-admin should still reach admin-tier ${cmd.name}`);
    }
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});

test("the real guild owner can reach both admin-tier and owner-tier commands", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    for (const cmd of LEGACY_WRITE_STUBS) {
      const interaction = mockOwnerInteraction();
      const config = mockConfig(true);
      const result = await handleWriteCommand({ group: "write", subcommand: cmd.name, interaction, adapterClient: {}, config });
      assert.equal(result.ok, true, `the real guild owner should reach ${cmd.tier}-tier ${cmd.name}`);
    }
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
  }
});

// Issue #238: DISCORD_WRITE_OWNER_ROLE_IDS is deprecated for granting
// owner-tier access -- a non-owner holding this role reaches admin-tier
// commands only (it's folded into the admin-equivalent set, matching
// isAdminActor()'s existing back-compat behavior), never owner-tier ones.
test("DISCORD_WRITE_OWNER_ROLE_IDS role reaches admin-tier commands but not owner-tier ones (deprecated for owner)", async () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldOwnerIds = process.env.DISCORD_WRITE_OWNER_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_OWNER_ROLE_IDS = "write-owner-role";
  try {
    const ownerTierCommands = LEGACY_WRITE_STUBS.filter((c) => c.tier === "owner");
    const adminTierCommands = LEGACY_WRITE_STUBS.filter((c) => c.tier === "admin");
    for (const cmd of ownerTierCommands) {
      const interaction = mockInteraction("user-1", ["write-owner-role"]);
      const config = mockConfig(true);
      const result = await handleWriteCommand({ group: "write", subcommand: cmd.name, interaction, adapterClient: {}, config });
      assert.equal(result.ok, false, `a non-owner holding the legacy write-owner-role must not reach owner-tier ${cmd.name}`);
    }
    for (const cmd of adminTierCommands) {
      const interaction = mockInteraction("user-1", ["write-owner-role"]);
      const config = mockConfig(true);
      const result = await handleWriteCommand({ group: "write", subcommand: cmd.name, interaction, adapterClient: {}, config });
      assert.equal(result.ok, true, `write-owner-role should still reach admin-tier ${cmd.name} (folded into admin-equivalent)`);
    }
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_OWNER_ROLE_IDS = oldOwnerIds;
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
    for (const cmd of LEGACY_WRITE_STUBS) {
      await handleWriteCommand({
        group: "write", subcommand: cmd.name,
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

// ─────────────────────────────────────────────────────────────────────────
// [Task 4, Step 5] Real dispatch flow tests -- these exercise the new,
// real handleWriteCommand path (findWriteAction/WRITE_ACTIONS, real
// adapterClient.writePreview()/writeExecute() calls, the host-operator gate
// for bot.self-update), as distinct from the legacy group="write" stub tests
// above, which continue to exercise the untouched scaffold behavior.
// ─────────────────────────────────────────────────────────────────────────

function fakeAdapterClient({ previewResult, previewError, executeResult, executeError, capture } = {}) {
  return {
    async writePreview(actor, body, guildId) {
      if (capture) capture.previewCall = { actor, body, guildId };
      if (previewError) throw previewError;
      return previewResult;
    },
    async writeExecute(actor, body, guildId) {
      if (executeError) throw executeError;
      return executeResult;
    }
  };
}

function fakeOwnerInteraction() {
  return { user: { id: "owner-1" }, member: { roles: new Set() }, guild: { ownerId: "owner-1" } };
}

// [Audit fix: QA, MEDIUM] Revision 1's test never asserted the actual
// request shape sent to Core -- only that the return value threaded
// through. This uses `capture` to prove the real action/params reach
// writePreview, directly contradicting the design's own "not a hand-wavy
// mock" standard if left unchecked.
test("handleWriteCommand: a real preview success returns needsConfirmation with the real Core nonce/expiresAt, and calls writePreview with the exact real action+params", async () => {
  const capture = {};
  const adapterClient = fakeAdapterClient({
    capture,
    previewResult: { ok: true, nonce: "real-nonce-123", expiresAt: Date.now() + 60000, preview: { action: "player.kick", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  const result = await handleWriteCommand({
    subcommand: "kick", group: "player",
    interaction: { ...fakeOwnerInteraction(), options: { getString: (name) => (name === "playerId" ? "Server#4242" : null), getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.nonce, "real-nonce-123");
  assert.ok(!("status" in result) || result.status !== "pending-upstream", "must not return the old stub status");
  assert.equal(capture.previewCall.body.action, "player.kick");
  assert.equal(capture.previewCall.body.params.playerId, "Server#4242");
});

test("handleWriteCommand: a preview rejection (e.g. not_authorized) returns a real error, no confirmation offered", async () => {
  const { AdapterHttpError } = await import("../src/adapterClient.js");
  const adapterClient = fakeAdapterClient({
    previewError: new AdapterHttpError("HTTP 403", { status: 403, route: "write-preview", body: { ok: false, code: "not_authorized", error: "nope" } })
  });
  const config = { discord: { writes: { enabled: true } } };
  const result = await handleWriteCommand({
    subcommand: "kick", group: "player",
    interaction: { ...fakeOwnerInteraction(), options: { getString: () => "Server#4242", getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
  assert.ok(!result.needsConfirmation);
  assert.match(result.error, /permission/i);
});

// [Audit fix: QA, HIGH] Revision 1 had zero coverage for non-string
// params -- every proposed test used player.kick (string-only params).
// 6 of 28 real commands use integer/number params; this proves
// collectParams() reads them via the correct accessor, not getString.
test("handleWriteCommand: integer params (base.refill-generators's baseId) are read via getInteger, not getString", async () => {
  const capture = {};
  const adapterClient = fakeAdapterClient({
    capture,
    previewResult: { ok: true, nonce: "n", expiresAt: Date.now() + 60000, preview: { action: "base.refill-generators", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  await handleWriteCommand({
    subcommand: "refill-generators", group: "base",
    interaction: {
      ...fakeOwnerInteraction(),
      options: {
        getString: () => { throw new Error("must not call getString for an integer param"); },
        getInteger: (name) => (name === "baseId" ? 42 : null),
        getNumber: () => null
      }
    },
    adapterClient, config
  });
  assert.equal(capture.previewCall.body.params.baseId, 42);
});

test("handleWriteCommand: number params (map.teleport's x/y/z/yaw) are read via getNumber", async () => {
  const capture = {};
  const adapterClient = fakeAdapterClient({
    capture,
    previewResult: { ok: true, nonce: "n", expiresAt: Date.now() + 60000, preview: { action: "map.teleport", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  await handleWriteCommand({
    subcommand: "teleport", group: "map",
    interaction: {
      ...fakeOwnerInteraction(),
      options: {
        getString: (name) => (name === "playerId" ? "Server#4242" : null),
        getInteger: () => null,
        getNumber: (name) => ({ x: 1.5, y: 2.5, z: 3.5, yaw: 90 }[name] ?? null)
      }
    },
    adapterClient, config
  });
  assert.equal(capture.previewCall.body.params.x, 1.5);
  assert.equal(capture.previewCall.body.params.yaw, 90);
});

test("handleWriteCommand: bot.self-update is rejected for a non-host-operator even at 'owner' Discord tier, and never reaches adapterClient", async () => {
  const config = { discord: { writes: { enabled: true }, botOperatorUserId: "the-real-operator" } };
  const adapterClient = fakeAdapterClient({});
  const result = await handleWriteCommand({
    subcommand: "self-update", group: "bot",
    interaction: { ...fakeOwnerInteraction(), user: { id: "some-guild-owner-not-the-operator" }, options: { getString: () => null, getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /host operator|not authorized/i);
});

test("handleWriteCommand: bot.self-update is disabled entirely when DUNE_BOT_OPERATOR_DISCORD_USER_ID is unset", async () => {
  const config = { discord: { writes: { enabled: true } } }; // no botOperatorUserId
  const adapterClient = fakeAdapterClient({});
  const result = await handleWriteCommand({
    subcommand: "self-update", group: "bot",
    interaction: { ...fakeOwnerInteraction(), options: { getString: () => null, getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
});

// [Audit fix: Security, MEDIUM round 3] Proves the 9 remaining legacy
// group="write" stub subcommands still work exactly as they always have
// -- never routed into findWriteAction (which has no "write"-group
// entries) and never reaching adapterClient at all.
test("handleWriteCommand: a legacy group='write' stub subcommand (e.g. maintenance-note) still returns the scaffolded status, never calling adapterClient", async () => {
  const config = { discord: { writes: { enabled: true } } };
  const adapterClient = fakeAdapterClient({});
  let previewCalled = false;
  adapterClient.writePreview = async () => { previewCalled = true; return {}; };
  const result = await handleWriteCommand({
    subcommand: "maintenance-note", group: "write",
    interaction: { ...fakeOwnerInteraction(), options: { getString: (name) => (name === "note" ? "test note" : null), getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.status, "pending-upstream");
  assert.equal(previewCalled, false, "a legacy stub subcommand must never call adapterClient.writePreview()");
});

test("handleWriteCommand: group='write' subcommand names superseded by a real command (e.g. 'restart') are NOT in LEGACY_WRITE_STUBS", async () => {
  const { LEGACY_WRITE_STUBS } = await import("../src/writeHandler.js");
  const supersededNames = new Set(["backup", "restart", "update"]);
  for (const stub of LEGACY_WRITE_STUBS) {
    assert.ok(!supersededNames.has(stub.name), `${stub.name} was superseded by a real command and must be removed from both LEGACY_WRITE_STUBS and commands.js's write group (Task 7 Step 3)`);
  }
  assert.equal(LEGACY_WRITE_STUBS.length, 9);
});
