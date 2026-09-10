// ownerConfirmation.test.js -- mentat#343 Phase 2, the owner-confirmation
// gate. Against a mocked discord.js client (real DM/interaction objects are
// impossible to construct without a live gateway connection -- matches the
// design doc's own §11 test-plan instruction: "Independently testable
// against a mocked discord.js client").
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, getGuild, createPendingOwnerConfirmation, getPendingOwnerConfirmation } from "../src/database.js";
import { _resetEphemeralStateForTests } from "../src/database.js";
import {
  resolveConfirmation,
  notifyOwnerOfPendingConfirmation,
  handleOwnerConfirmationButtonInteraction,
  handleConfirmConnectionCommand,
  resetOwnerConfirmationTimersForTests
} from "../src/ownerConfirmation.js";

test.beforeEach(() => {
  _resetEphemeralStateForTests();
  resetOwnerConfirmationTimersForTests();
});

function fakeDb() {
  return createDatabase(":memory:");
}

const REAL_OWNER_ID = "111111111111111111";
const GUILD_ID = "222222222222222222";

function stagePending(overrides = {}) {
  const confirmationId = overrides.confirmationId || "confirmation-abc";
  createPendingOwnerConfirmation({
    confirmationId,
    guildId: GUILD_ID,
    guildName: "Real Guild",
    consoleUrl: "https://console.test",
    adapterToken: "adapter-token-xyz",
    ownerId: REAL_OWNER_ID,
    ...overrides
  });
  return confirmationId;
}

// fakeClient: .guilds.cache.get(guildId)?.ownerId is the live-ownership
// re-verification mechanism (issue #864's TOCTOU fix) -- ownerIdOverride
// lets a test simulate a real ownership transfer having happened since
// staging.
function fakeClient({ ownerIdOverride = REAL_OWNER_ID, dmShouldFail = false, guildInCache = true } = {}) {
  const sentDMs = [];
  const leftGuilds = [];
  return {
    users: {
      fetch: async (userId) => ({
        id: userId,
        send: async (payload) => {
          if (dmShouldFail) throw new Error("Cannot send messages to this user");
          sentDMs.push({ userId, payload });
        }
      })
    },
    guilds: {
      cache: {
        get: (guildId) => {
          if (!guildInCache) return undefined;
          return { id: guildId, ownerId: ownerIdOverride, leave: async () => leftGuilds.push(guildId) };
        }
      }
    },
    _sentDMs: sentDMs,
    _leftGuilds: leftGuilds
  };
}

// ─── resolveConfirmation: the core accept/reject decision ────────────────

test("Confirm from the real verified owner writes the guild to the DB exactly once", async () => {
  const db = fakeDb();
  const confirmationId = stagePending();
  const client = fakeClient();

  const result = await resolveConfirmation(client, db, confirmationId, { requestingUserId: REAL_OWNER_ID, action: "confirm" });
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.guildName, "Real Guild");

  const stored = getGuild(db, GUILD_ID);
  assert.equal(stored.status, "active");
  assert.equal(stored.console_url, "https://console.test");

  // "Exactly once": the pending record is gone, so a second resolve attempt
  // can't write again.
  assert.equal(getPendingOwnerConfirmation(confirmationId), undefined);
  const second = await resolveConfirmation(client, db, confirmationId, { requestingUserId: REAL_OWNER_ID, action: "confirm" });
  assert.equal(second.outcome, "expired");
});

test("Deny discards the pending record with NO db write, and does not throw even without a real guild to leave", async () => {
  const db = fakeDb();
  const confirmationId = stagePending();
  const client = fakeClient();

  const result = await resolveConfirmation(client, db, confirmationId, { requestingUserId: REAL_OWNER_ID, action: "deny" });
  assert.equal(result.outcome, "denied");
  assert.equal(getGuild(db, GUILD_ID), undefined, "a denied confirmation must never reach upsertGuild()");
  assert.equal(getPendingOwnerConfirmation(confirmationId), undefined);
  assert.deepEqual(client._leftGuilds, [GUILD_ID]);
});

test("a requesting user who is NOT the verified owner is rejected -- the button-click path's own check", async () => {
  const db = fakeDb();
  const confirmationId = stagePending();
  const client = fakeClient();

  const result = await resolveConfirmation(client, db, confirmationId, { requestingUserId: "999999999999999999", action: "confirm" });
  assert.equal(result.outcome, "not_yours");
  assert.equal(getGuild(db, GUILD_ID), undefined);
  // The pending record must survive an impostor's attempt -- the real
  // owner can still confirm later.
  assert.notEqual(getPendingOwnerConfirmation(confirmationId), undefined);
});

test("issue #864 TOCTOU fix: a real ownership transfer between staging and Confirm is caught by the live gateway-cache re-check, not just the original snapshot", async () => {
  const db = fakeDb();
  const confirmationId = stagePending();
  // The guild's LIVE owner (per the bot's own gateway cache) is now someone
  // else -- simulating a genuine Discord ownership transfer inside the
  // 15-minute pending window.
  const client = fakeClient({ ownerIdOverride: "333333333333333333" });

  const result = await resolveConfirmation(client, db, confirmationId, { requestingUserId: REAL_OWNER_ID, action: "confirm" });
  assert.equal(result.outcome, "owner_changed");
  assert.equal(getGuild(db, GUILD_ID), undefined, "a stale, now-invalid pending confirmation must never reach upsertGuild()");
});

test("a confirmationId that was never staged (or already consumed) is rejected as expired, fails closed", async () => {
  const db = fakeDb();
  const client = fakeClient();
  const result = await resolveConfirmation(client, db, "never-existed", { requestingUserId: REAL_OWNER_ID, action: "confirm" });
  assert.equal(result.outcome, "expired");
});

// ─── The original session-fixation scenario: staging alone (Phase 1) never
// reaches upsertGuild() without an explicit Confirm ─────────────────────

test("session-fixation scenario: a staged-but-unconfirmed record results in NO db write until a real Confirm interaction runs", async () => {
  const db = fakeDb();
  stagePending({ confirmationId: "fixation-attempt" });
  // No Confirm interaction happens at all.
  assert.equal(getGuild(db, GUILD_ID), undefined, "staging alone must never write the guild -- only an explicit Confirm may");
});

// ─── Timeout behaves identically to Deny ──────────────────────────────────

test("timeout (no response within the confirmation window) behaves identically to Deny -- discards the record, no db write, attempts to leave the guild", async () => {
  process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS = "20";
  try {
    const db = fakeDb();
    const confirmationId = stagePending({ confirmationId: "timeout-test" });
    const client = fakeClient();

    await notifyOwnerOfPendingConfirmation(client, {
      confirmationId,
      guildId: GUILD_ID,
      guildName: "Real Guild",
      consoleUrl: "https://console.test",
      ownerId: REAL_OWNER_ID
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(getPendingOwnerConfirmation(confirmationId), undefined, "timeout must discard the pending record");
    assert.equal(getGuild(db, GUILD_ID), undefined, "a timed-out confirmation must never reach upsertGuild()");
    assert.deepEqual(client._leftGuilds, [GUILD_ID]);
  } finally {
    delete process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS;
  }
});

test("a Confirm that arrives before the timeout cancels the scheduled timeout -- no double-processing, no spurious leave-guild after a successful confirm", async () => {
  process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS = "40";
  try {
    const db = fakeDb();
    const confirmationId = stagePending({ confirmationId: "confirm-before-timeout" });
    const client = fakeClient();

    await notifyOwnerOfPendingConfirmation(client, {
      confirmationId,
      guildId: GUILD_ID,
      guildName: "Real Guild",
      consoleUrl: "https://console.test",
      ownerId: REAL_OWNER_ID
    });

    const result = await resolveConfirmation(client, db, confirmationId, { requestingUserId: REAL_OWNER_ID, action: "confirm" });
    assert.equal(result.outcome, "confirmed");

    await new Promise((resolve) => setTimeout(resolve, 80));

    // The confirmed guild must still be active -- a late-firing timeout
    // must not have deleted anything or attempted to leave the guild after
    // a real, successful confirm.
    const stored = getGuild(db, GUILD_ID);
    assert.equal(stored.status, "active");
    assert.deepEqual(client._leftGuilds, [], "a successful Confirm must cancel the scheduled timeout, not just race it");
  } finally {
    delete process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS;
  }
});

// ─── notifyOwnerOfPendingConfirmation: DM-send failure is handled, not
// thrown -- the pending record and the slash-command fallback remain
// available regardless ───────────────────────────────────────────────────

test("DM-send failure does not throw and does not prevent the slash-command fallback from later succeeding", async () => {
  const db = fakeDb();
  const confirmationId = stagePending();
  const client = fakeClient({ dmShouldFail: true });

  const { dmSent } = await notifyOwnerOfPendingConfirmation(client, {
    confirmationId,
    guildId: GUILD_ID,
    guildName: "Real Guild",
    consoleUrl: "https://console.test",
    ownerId: REAL_OWNER_ID
  });
  assert.equal(dmSent, false);

  // The pending record must still be there for /confirm-connection to find.
  assert.notEqual(getPendingOwnerConfirmation(confirmationId), undefined);

  const fakeCommandInteraction = {
    isChatInputCommand: () => true,
    commandName: "confirm-connection",
    guildId: GUILD_ID,
    user: { id: REAL_OWNER_ID },
    replies: [],
    reply(payload) { this.replies.push(payload); return Promise.resolve(); },
    client
  };
  const handled = await handleConfirmConnectionCommand(fakeCommandInteraction, db);
  assert.equal(handled, true);
  assert.equal(getGuild(db, GUILD_ID)?.status, "active");
});

// ─── handleConfirmConnectionCommand: rejects a non-owner ─────────────────

test("the slash command rejects an interaction from a Discord user ID that doesn't match the verified ownerId", async () => {
  const db = fakeDb();
  stagePending();
  const client = fakeClient();

  const fakeCommandInteraction = {
    isChatInputCommand: () => true,
    commandName: "confirm-connection",
    guildId: GUILD_ID,
    user: { id: "999999999999999999" },
    replies: [],
    reply(payload) { this.replies.push(payload); return Promise.resolve(); },
    client
  };
  const handled = await handleConfirmConnectionCommand(fakeCommandInteraction, db);
  assert.equal(handled, true);
  assert.equal(getGuild(db, GUILD_ID), undefined);
  assert.equal(fakeCommandInteraction.replies.length, 1);
});

test("the slash command with no pending confirmation for this guild replies with the expired embed, not a crash", async () => {
  const db = fakeDb();
  const client = fakeClient();
  const fakeCommandInteraction = {
    isChatInputCommand: () => true,
    commandName: "confirm-connection",
    guildId: "444444444444444444",
    user: { id: REAL_OWNER_ID },
    replies: [],
    reply(payload) { this.replies.push(payload); return Promise.resolve(); },
    client
  };
  const handled = await handleConfirmConnectionCommand(fakeCommandInteraction, db);
  assert.equal(handled, true);
  assert.equal(fakeCommandInteraction.replies.length, 1);
});

// ─── handleOwnerConfirmationButtonInteraction: routing shape ─────────────

test("handleOwnerConfirmationButtonInteraction returns false (falls through) for a customId it doesn't own", async () => {
  const db = fakeDb();
  const fakeInteraction = { isButton: () => true, customId: "write:confirm:something", user: { id: REAL_OWNER_ID } };
  const handled = await handleOwnerConfirmationButtonInteraction(fakeInteraction, db);
  assert.equal(handled, false);
});

test("handleOwnerConfirmationButtonInteraction handles a real autoinvite:confirm: button and writes the guild", async () => {
  const db = fakeDb();
  const confirmationId = stagePending({ confirmationId: "button-confirm-test" });
  const client = fakeClient();
  const fakeInteraction = {
    isButton: () => true,
    customId: `autoinvite:confirm:${confirmationId}`,
    user: { id: REAL_OWNER_ID },
    client,
    updates: [],
    update(payload) { this.updates.push(payload); return Promise.resolve(); }
  };
  const handled = await handleOwnerConfirmationButtonInteraction(fakeInteraction, db);
  assert.equal(handled, true);
  assert.equal(getGuild(db, GUILD_ID)?.status, "active");
  assert.equal(fakeInteraction.updates.length, 1);
});

test("handleOwnerConfirmationButtonInteraction handles a real autoinvite:deny: button with no db write", async () => {
  const db = fakeDb();
  const confirmationId = stagePending({ confirmationId: "button-deny-test" });
  const client = fakeClient();
  const fakeInteraction = {
    isButton: () => true,
    customId: `autoinvite:deny:${confirmationId}`,
    user: { id: REAL_OWNER_ID },
    client,
    updates: [],
    update(payload) { this.updates.push(payload); return Promise.resolve(); }
  };
  const handled = await handleOwnerConfirmationButtonInteraction(fakeInteraction, db);
  assert.equal(handled, true);
  assert.equal(getGuild(db, GUILD_ID), undefined);
});

test("handleOwnerConfirmationButtonInteraction from a non-owner uses reply(), not update() -- so the real owner's own prompt is left intact for them to see", async () => {
  const db = fakeDb();
  const confirmationId = stagePending({ confirmationId: "button-impostor-test" });
  const client = fakeClient();
  const fakeInteraction = {
    isButton: () => true,
    customId: `autoinvite:confirm:${confirmationId}`,
    user: { id: "999999999999999999" },
    client,
    replies: [],
    updates: [],
    reply(payload) { this.replies.push(payload); return Promise.resolve(); },
    update(payload) { this.updates.push(payload); return Promise.resolve(); }
  };
  const handled = await handleOwnerConfirmationButtonInteraction(fakeInteraction, db);
  assert.equal(handled, true);
  assert.equal(fakeInteraction.replies.length, 1, "a non-owner's click must get an ephemeral reply()");
  assert.equal(fakeInteraction.updates.length, 0, "must NOT update() the shared prompt -- that would alter what the real owner sees");
});

// ─── Layer 2 audit finding: a retried auto-invite flow for the same guild
// must not leave a stale duplicate confirmation whose later timeout/deny
// can kick a guild the SECOND flow legitimately confirmed ────────────────

test("createPendingOwnerConfirmation supersedes an existing pending entry for the same guildId -- at most one at a time", async () => {
  const { createPendingOwnerConfirmation, getPendingOwnerConfirmation: getEntry } = await import("../src/database.js");
  const first = createPendingOwnerConfirmation({
    confirmationId: "first-attempt",
    guildId: GUILD_ID,
    guildName: "Real Guild",
    consoleUrl: "https://console.test",
    adapterToken: "adapter-token-1",
    ownerId: REAL_OWNER_ID
  });
  assert.equal(first.supersededConfirmationId, undefined, "the very first attempt supersedes nothing");

  const second = createPendingOwnerConfirmation({
    confirmationId: "second-attempt",
    guildId: GUILD_ID,
    guildName: "Real Guild",
    consoleUrl: "https://console.test",
    adapterToken: "adapter-token-2",
    ownerId: REAL_OWNER_ID
  });
  assert.equal(second.supersededConfirmationId, "first-attempt", "the retry must report which entry it superseded");
  assert.equal(getEntry("first-attempt"), undefined, "the superseded entry's DB record must be gone");
  assert.notEqual(getEntry("second-attempt"), undefined);
});

test("end-to-end: confirming via a SECOND (retried) auto-invite attempt cancels the FIRST attempt's active timer -- the stale entry's timeout no longer fires and cannot kick the now-active guild", async () => {
  process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS = "30";
  try {
    const db = fakeDb();
    const client = fakeClient();

    // First attempt: DM sent, timer armed, but the owner never responds
    // (e.g. the DM was missed).
    const first = createPendingOwnerConfirmation({
      confirmationId: "retry-first",
      guildId: GUILD_ID,
      guildName: "Real Guild",
      consoleUrl: "https://console.test",
      adapterToken: "adapter-token-1",
      ownerId: REAL_OWNER_ID
    });
    await notifyOwnerOfPendingConfirmation(client, {
      confirmationId: "retry-first",
      guildId: GUILD_ID,
      guildName: "Real Guild",
      consoleUrl: "https://console.test",
      ownerId: REAL_OWNER_ID,
      supersededConfirmationId: first.supersededConfirmationId
    });

    // Second attempt (the retry): createPendingOwnerConfirmation() itself
    // supersedes the first DB entry; the route-level caller (autoInvite.js
    // + setupServer.js in production) passes the returned
    // supersededConfirmationId through to notifyOwnerOfPendingConfirmation,
    // which is what actually cancels the first attempt's timer.
    const second = createPendingOwnerConfirmation({
      confirmationId: "retry-second",
      guildId: GUILD_ID,
      guildName: "Real Guild",
      consoleUrl: "https://console.test",
      adapterToken: "adapter-token-2",
      ownerId: REAL_OWNER_ID
    });
    await notifyOwnerOfPendingConfirmation(client, {
      confirmationId: "retry-second",
      guildId: GUILD_ID,
      guildName: "Real Guild",
      consoleUrl: "https://console.test",
      ownerId: REAL_OWNER_ID,
      supersededConfirmationId: second.supersededConfirmationId
    });

    // The owner confirms via the SECOND (most recent) flow.
    const result = await resolveConfirmation(client, db, "retry-second", { requestingUserId: REAL_OWNER_ID, action: "confirm" });
    assert.equal(result.outcome, "confirmed");

    // Wait past both attempts' timeout windows. Before the fix, the FIRST
    // attempt's still-armed timer would fire here, find nothing to delete
    // (its own entry is already gone), but STILL best-effort leave the
    // guild -- destroying the connection the second flow just established.
    await new Promise((resolve) => setTimeout(resolve, 90));

    const stored = getGuild(db, GUILD_ID);
    assert.equal(stored?.status, "active", "the legitimately confirmed guild must still be active");
    assert.deepEqual(client._leftGuilds, [], "the superseded first attempt's timer must never fire and leave the guild");
  } finally {
    delete process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS;
  }
});

test("resolveConfirmation rejects an unexpected action value explicitly rather than silently falling through to confirm", async () => {
  const db = fakeDb();
  const confirmationId = stagePending();
  const client = fakeClient();

  const result = await resolveConfirmation(client, db, confirmationId, { requestingUserId: REAL_OWNER_ID, action: "something-unexpected" });
  assert.equal(result.outcome, "invalid_action");
  assert.equal(getGuild(db, GUILD_ID), undefined, "an unrecognized action must never reach upsertGuild()");
});
