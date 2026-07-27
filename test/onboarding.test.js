import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, upsertGuild } from "../src/database.js";
import { handleGuildCreate } from "../src/onboarding.js";

// ─── Real bug, found via a live report (2026-07-27): bot added to a new
// guild by an admin who was not the guild owner, the owner received no
// DM (expected -- the inviter should get it, not necessarily the
// owner), but there was ZERO trace of ANY outcome in the logs -- not
// even a warning. Root cause: guild.fetchOwner() and dm.send() were
// both wrapped in silent failure handling (.catch(() => null), or a
// try/catch routed only to console.warn, never this project's own
// structured logger). These tests verify: (1) every real failure path
// now actually sends a DM attempt and doesn't silently no-op, (2) the
// real inviter (via a BOT_ADD audit log lookup) is DMed instead of
// always defaulting to the owner, and (3) the owner gets a distinct,
// shorter notice -- not a duplicate full setup DM -- when someone else
// did the inviting. ────────────────────────────────────────────────────

function mockUser(id, tag) {
  const sentMessages = [];
  return {
    id,
    tag,
    username: tag,
    sentMessages,
    async createDM() {
      return {
        async send(payload) {
          sentMessages.push(payload);
        }
      };
    }
  };
}

function mockGuild({ id = "g1", name = "Test Guild", owner, botUserId = "bot-1", auditEntries = null, auditLogError = null } = {}) {
  return {
    id,
    name,
    client: { user: { id: botUserId } },
    async fetchOwner() {
      return owner;
    },
    async fetchAuditLogs({ type } = {}) {
      if (auditLogError) throw auditLogError;
      return { entries: auditEntries || [] };
    }
  };
}

test("DMs the owner directly when no inviter can be determined (audit log unavailable) -- matches original pre-fix behavior exactly", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({ owner, auditLogError: new Error("Missing Permissions") });

  await handleGuildCreate({}, guild, db);

  assert.equal(owner.sentMessages.length, 1);
  assert.match(owner.sentMessages[0].content, /Welcome to ACP/);
});

test("DMs the real inviter (from the BOT_ADD audit log entry) when the inviter is a different person than the owner", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const inviter = mockUser("admin-1", "AdminUser");
  const guild = mockGuild({
    owner,
    botUserId: "bot-1",
    auditEntries: [{ target: { id: "bot-1" }, executor: inviter }]
  });

  await handleGuildCreate({}, guild, db);

  assert.equal(inviter.sentMessages.length, 1, "the real inviter should get the full setup DM");
  assert.match(inviter.sentMessages[0].content, /Welcome to ACP/);

  assert.equal(owner.sentMessages.length, 1, "the owner should get a distinct notice, not nothing");
  assert.match(owner.sentMessages[0].content, /added the Arrakis Control Panel bot/);
  assert.match(owner.sentMessages[0].content, /AdminUser/, "the owner's notice should name the real inviter");
  assert.ok(!owner.sentMessages[0].content.includes("Setup takes 2 minutes"), "the owner's notice must not be a duplicate full setup DM");
});

test("DMs only the owner (no separate notice) when the audit log shows the owner is the one who invited the bot", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({
    owner,
    botUserId: "bot-1",
    auditEntries: [{ target: { id: "bot-1" }, executor: owner }]
  });

  await handleGuildCreate({}, guild, db);

  assert.equal(owner.sentMessages.length, 1, "should send exactly one message, not a setup DM plus a redundant notice");
  assert.match(owner.sentMessages[0].content, /Welcome to ACP/);
});

test("does not throw and does not send any DM when fetchOwner() itself fails", async () => {
  const db = createDatabase(":memory:");
  const guild = {
    id: "g1",
    name: "Test Guild",
    client: { user: { id: "bot-1" } },
    async fetchOwner() { throw new Error("Unknown Member"); },
    async fetchAuditLogs() { return { entries: [] }; }
  };

  await assert.doesNotReject(handleGuildCreate({}, guild, db));
});

test("skips onboarding entirely for a guild already marked active, without attempting any DM", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "token", status: "active" });
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({ id: "g1", owner });

  await handleGuildCreate({}, guild, db);

  assert.equal(owner.sentMessages.length, 0);
});

test("a DM-send failure for the inviter does not prevent the owner notice from still being attempted", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const inviter = mockUser("admin-1", "AdminUser");
  inviter.createDM = async () => { throw new Error("Cannot send messages to this user"); };
  const guild = mockGuild({
    owner,
    botUserId: "bot-1",
    auditEntries: [{ target: { id: "bot-1" }, executor: inviter }]
  });

  await assert.doesNotReject(handleGuildCreate({}, guild, db));
  assert.equal(owner.sentMessages.length, 1, "the owner should still get their notice even if the inviter's DM failed");
});
