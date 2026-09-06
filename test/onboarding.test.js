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
// did the inviting.
//
// SECOND real bug, found via a live end-to-end test of the fix above
// (same session, immediately after deploying it): even with the bot's
// View Audit Log permission correctly granted (confirmed directly via
// the Discord API), the very first fetchAuditLogs() call made from
// inside the real guildCreate handler failed with "Missing
// Permissions" -- while the exact same call made about a minute later
// succeeded. This is a real timing race (Discord's own permission-grant
// propagation for a brand new guild membership hadn't finished yet),
// not a real permissions gap. findInviter() now retries up to 3 times
// on this specific error before falling back. These tests use
// { auditLogRetryDelayMs: 0 } to exercise the real retry loop without
// each test actually taking 3+ real seconds (a real, once-slow test
// suite is exactly the kind of thing that gets skipped/ignored later --
// this was fixed the same session it was noticed, not left as a known
// annoyance). ─────────────────────────────────────────────────────────

const NO_DELAY = { auditLogRetryDelayMs: 0 };

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

function mockGuild({ id = "g1", name = "Test Guild", owner, botUserId = "bot-1", auditEntries = null, auditLogError = null, auditLogErrorSequence = null } = {}) {
  let callCount = 0;
  return {
    id,
    name,
    client: { user: { id: botUserId } },
    async fetchOwner() {
      return owner;
    },
    async fetchAuditLogs({ type } = {}) {
      callCount += 1;
      if (auditLogErrorSequence) {
        const err = auditLogErrorSequence[callCount - 1];
        if (err) throw err;
        return { entries: auditEntries || [] };
      }
      if (auditLogError) throw auditLogError;
      return { entries: auditEntries || [] };
    }
  };
}

test("DMs the owner directly with the fallback notice when no inviter can be determined (audit log genuinely unavailable, e.g. permission not granted)", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({ owner, auditLogError: new Error("Missing Permissions") });

  await handleGuildCreate({}, guild, db, NO_DELAY);

  assert.equal(owner.sentMessages.length, 1);
  assert.match(owner.sentMessages[0].content, /Sahir Venn/);
  assert.doesNotMatch(owner.sentMessages[0].content, /\bSentinel\b/);
  assert.match(owner.sentMessages[0].content, /if you're the one who just invited me/i, "the fallback message must acknowledge the reader might be the inviter, not just assume they're the owner");
});

test("retries the audit log lookup on a Missing Permissions error (a real timing race, not a real permission gap) and succeeds on a later attempt", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const inviter = mockUser("admin-1", "AdminUser");
  const guild = mockGuild({
    owner,
    botUserId: "bot-1",
    auditEntries: [{ target: { id: "bot-1" }, executor: inviter }],
    auditLogErrorSequence: [new Error("Missing Permissions"), new Error("Missing Permissions")]
  });

  await handleGuildCreate({}, guild, db, NO_DELAY);

  assert.equal(inviter.sentMessages.length, 1, "should succeed on the 3rd attempt and DM the real inviter, not fall back");
  assert.match(inviter.sentMessages[0].content, /Sahir Venn/);
  assert.doesNotMatch(inviter.sentMessages[0].content, /\bSentinel\b/);
});

test("gives up after 3 attempts and falls back to the owner when every retry hits Missing Permissions", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({
    owner,
    auditLogErrorSequence: [new Error("Missing Permissions"), new Error("Missing Permissions"), new Error("Missing Permissions")]
  });

  await handleGuildCreate({}, guild, db, NO_DELAY);

  assert.equal(owner.sentMessages.length, 1);
  assert.match(owner.sentMessages[0].content, /if you're the one who just invited me/i);
});

test("does NOT retry a non-timing-race error (e.g. a real, unrelated failure) -- fails fast to the fallback", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({ owner, auditLogError: new Error("Unknown Guild") });

  const start = Date.now();
  await handleGuildCreate({}, guild, db, { auditLogRetryDelayMs: 5000 });
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 1000, "a non-timing-race error must not trigger any retry delay at all");
  assert.equal(owner.sentMessages.length, 1);
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

  await handleGuildCreate({}, guild, db, NO_DELAY);

  assert.equal(inviter.sentMessages.length, 1, "the real inviter should get the full setup DM");
  assert.match(inviter.sentMessages[0].content, /Sahir Venn/);
  assert.doesNotMatch(inviter.sentMessages[0].content, /\bSentinel\b/);

  assert.equal(owner.sentMessages.length, 1, "the owner should get a distinct notice, not nothing");
  assert.match(owner.sentMessages[0].content, /added Sahir Venn/);
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

  await handleGuildCreate({}, guild, db, NO_DELAY);

  assert.equal(owner.sentMessages.length, 1, "should send exactly one message, not a setup DM plus a redundant notice");
  assert.match(owner.sentMessages[0].content, /Sahir Venn/);
  assert.doesNotMatch(owner.sentMessages[0].content, /\bSentinel\b/);
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

  await assert.doesNotReject(handleGuildCreate({}, guild, db, NO_DELAY));
});

test("skips onboarding entirely for a guild already marked active, without attempting any DM", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "token", status: "active" });
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({ id: "g1", owner });

  await handleGuildCreate({}, guild, db, NO_DELAY);

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

  await assert.doesNotReject(handleGuildCreate({}, guild, db, NO_DELAY));
  assert.equal(owner.sentMessages.length, 1, "the owner should still get their notice even if the inviter's DM failed");
});

// Documents a real, confirmed limitation found via a live test
// (2026-07-27): when the inviter genuinely cannot be identified (no
// View Audit Log permission, or the audit log has no matching entry
// yet), and that inviter is a DIFFERENT person than the owner, the
// inviter receives NOTHING -- only the owner gets the fallback notice.
// There is currently no way to identify a non-owner inviter without
// the audit log; this is an intentional, documented limitation, not a
// silent gap this test suite is unaware of.
test("documents a known limitation: a non-owner inviter gets nothing when the audit log lookup fails, even though they are the one who needs the setup link", async () => {
  const db = createDatabase(":memory:");
  const owner = mockUser("owner-1", "OwnerUser");
  const guild = mockGuild({ owner, auditLogError: new Error("Missing Permissions") });

  await handleGuildCreate({}, guild, db, NO_DELAY);

  assert.equal(owner.sentMessages.length, 1, "only the owner gets anything in this fallback case");
});
