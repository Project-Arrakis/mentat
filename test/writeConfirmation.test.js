import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  buildConfirmationRow,
  buildConfirmationEmbed,
  buildCancelledEmbed,
  buildScaffoldedEmbed,
  buildNotYoursEmbed,
  buildExpiredEmbed,
  createPendingConfirmation,
  registerRealPendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  pendingConfirmationCount,
  resetPendingConfirmations,
  handleWriteButtonInteraction,
  CONFIRMATION_TIMEOUT_MS
} from "../src/writeConfirmation.js";

beforeEach(() => resetPendingConfirmations());

// [Final-review fix, IMPORTANT 3] handleWriteButtonInteraction() now takes
// (interaction, adapterClient, config, db) -- config/db feed canWrite(),
// which gates who may click a PUBLIC dual-confirmation waiting-state
// message. Single-tenant shape (no multiTenant flag, db null) so canWrite()
// resolves tier from real Discord guild ownership / mapped roles rather
// than needing a live SQLite handle.
const WRITES_ENABLED_CONFIG = { discord: { writes: { enabled: true } } };

function mockButtonInteraction({ customId, userId = "user-1" } = {}) {
  const interaction = {
    isButton: () => true,
    customId,
    user: { id: userId },
    _update: null,
    _reply: null,
    update: async (payload) => { interaction._update = payload; },
    reply: async (payload) => { interaction._reply = payload; }
  };
  return interaction;
}

test("buildConfirmationRow embeds the idempotency key in both custom IDs", () => {
  const row = buildConfirmationRow("dune-idem-abc");
  const json = row.toJSON();
  const ids = json.components.map((c) => c.custom_id);
  assert.deepEqual(ids, ["write:confirm:dune-idem-abc", "write:cancel:dune-idem-abc"]);
});

test("buildConfirmationEmbed includes action, tier, and risk fields", () => {
  const embed = buildConfirmationEmbed({ action: "operations:restart-service", tier: "owner", risk: "high", target: "gateway" });
  const data = embed.toJSON();
  assert.ok(data.fields.some((f) => f.value.includes("operations:restart-service")));
  assert.ok(data.fields.some((f) => f.value.includes("owner")));
  assert.ok(data.fields.some((f) => f.value.includes("high")));
});

test("createPendingConfirmation registers an entry retrievable by key", () => {
  const { embed, row } = createPendingConfirmation({
    idempotencyKey: "key-1", action: "maintenance:set-note", tier: "admin", risk: "low", userId: "user-1"
  });
  assert.ok(embed);
  assert.ok(row);
  assert.equal(pendingConfirmationCount(), 1);
  const entry = getPendingConfirmation("key-1");
  assert.equal(entry.action, "maintenance:set-note");
  assert.equal(entry.userId, "user-1");
});

test("clearPendingConfirmation removes the entry and cancels its timer", () => {
  createPendingConfirmation({ idempotencyKey: "key-2", action: "a", tier: "admin", risk: "low", userId: "u" });
  assert.equal(pendingConfirmationCount(), 1);
  clearPendingConfirmation("key-2");
  assert.equal(pendingConfirmationCount(), 0);
  assert.equal(getPendingConfirmation("key-2"), undefined);
});

test("handleWriteButtonInteraction ignores non-write custom IDs", async () => {
  const interaction = mockButtonInteraction({ customId: "other:thing:123" });
  const handled = await handleWriteButtonInteraction(interaction, null, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, false);
  assert.equal(interaction._update, null);
});

test("handleWriteButtonInteraction shows expired embed for unknown key", async () => {
  const interaction = mockButtonInteraction({ customId: "write:confirm:missing-key" });
  const handled = await handleWriteButtonInteraction(interaction, null, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(interaction._update.components.length, 0);
  assert.ok(interaction._update.embeds[0].data.title.includes("Expired"));
});

test("handleWriteButtonInteraction rejects a different user's click", async () => {
  createPendingConfirmation({ idempotencyKey: "key-3", action: "a", tier: "admin", risk: "low", userId: "owner-user" });
  const interaction = mockButtonInteraction({ customId: "write:confirm:key-3", userId: "attacker-user" });
  const handled = await handleWriteButtonInteraction(interaction, null, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(interaction._reply.ephemeral, true);
  assert.ok(interaction._reply.embeds[0].data.title.includes("Not Your Confirmation"));
  // The pending confirmation must survive an unauthorized click.
  assert.ok(getPendingConfirmation("key-3"));
});

test("handleWriteButtonInteraction cancel clears the pending entry and shows cancelled", async () => {
  createPendingConfirmation({ idempotencyKey: "key-4", action: "a", tier: "admin", risk: "low", userId: "user-1" });
  const interaction = mockButtonInteraction({ customId: "write:cancel:key-4", userId: "user-1" });
  const handled = await handleWriteButtonInteraction(interaction, null, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(getPendingConfirmation("key-4"), undefined);
  assert.ok(interaction._update.embeds[0].data.title.includes("Cancelled"));
  assert.deepEqual(interaction._update.components, []);
});

test("handleWriteButtonInteraction confirm clears the pending entry but never executes", async () => {
  createPendingConfirmation({ idempotencyKey: "key-5", action: "operations:restart-service", tier: "owner", risk: "high", userId: "user-1" });
  const interaction = mockButtonInteraction({ customId: "write:confirm:key-5", userId: "user-1" });
  const handled = await handleWriteButtonInteraction(interaction, null, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(getPendingConfirmation("key-5"), undefined);
  const embedData = interaction._update.embeds[0].data;
  assert.ok(embedData.title.includes("Not Executed"));
  assert.ok(embedData.description.includes("operations:restart-service"));
  assert.deepEqual(interaction._update.components, []);
});

test("confirmation timeout constant matches documented 60s window", () => {
  assert.equal(CONFIRMATION_TIMEOUT_MS, 60000);
});

test("pending confirmation expires and fires onTimeout when not confirmed", async () => {
  const old = process.env.DUNE_WRITE_CONFIRMATION_TIMEOUT_MS;
  process.env.DUNE_WRITE_CONFIRMATION_TIMEOUT_MS = "20";
  try {
    let timedOut = null;
    createPendingConfirmation({
      idempotencyKey: "key-timeout",
      action: "operations:restart-service",
      tier: "owner",
      risk: "high",
      userId: "user-1",
      onTimeout: (entry) => { timedOut = entry; }
    });
    assert.ok(getPendingConfirmation("key-timeout"), "entry should be pending immediately after creation");

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(getPendingConfirmation("key-timeout"), undefined, "entry must be removed after timeout");
    assert.ok(timedOut, "onTimeout callback should have fired");
    assert.equal(timedOut.action, "operations:restart-service");
  } finally {
    process.env.DUNE_WRITE_CONFIRMATION_TIMEOUT_MS = old;
  }
});

// mentat#331 (comprehensive wizard security audit finding): userId used to
// be optional -- a caller that omitted it would silently let ANY guild
// member confirm someone else's pending write, since the ownership check
// only ran "if (entry.userId && ...)" . Both halves of the fix (creation
// now refuses to omit it; the check itself is unconditional) are pinned
// here.
test("createPendingConfirmation refuses to create an entry with no userId", () => {
  assert.throws(
    () => createPendingConfirmation({ idempotencyKey: "key-no-owner", action: "a", tier: "admin", risk: "low" }),
    /userId is required/
  );
  assert.equal(getPendingConfirmation("key-no-owner"), undefined, "no entry must be created");
});

test("createPendingConfirmation refuses an empty-string userId", () => {
  assert.throws(
    () => createPendingConfirmation({ idempotencyKey: "key-empty-owner", action: "a", tier: "admin", risk: "low", userId: "" }),
    /userId is required/
  );
});

test("handleWriteButtonInteraction: confirm calls adapterClient.writeExecute with the real nonce and shows success", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n1", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  let executeCalledWith = null;
  const adapterClient = { writeExecute: async (actor, body) => { executeCalledWith = { actor, body }; return { ok: true }; } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n1", user: { id: "u1" }, update: async (payload) => updates.push(payload) };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(executeCalledWith.body.nonce, "n1");
  assert.equal(executeCalledWith.body.action, "player.kick");
  assert.equal(updates.length, 1);
});

test("handleWriteButtonInteraction: a 202 second_confirmation_required response shows the waiting state, non-ephemeral, instructing a second admin to click THIS message (not 'run the command yourself', which does not work)", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n2", action: "server.stop", tier: "owner", userId: "u1", expiresAt: Date.now() + 300000, kind: "real" });
  const adapterClient = { writeExecute: async () => ({ ok: true, code: "second_confirmation_required", nonce: "n2", expiresAt: Date.now() + 300000 }) };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n2", user: { id: "u1" }, update: async (p) => updates.push(p) };
  await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(updates[0].ephemeral, false, "the waiting-state message must be forced non-ephemeral so a second admin can see it");
  assert.match(JSON.stringify(updates[0]), /second|waiting/i);
  assert.match(JSON.stringify(updates[0]), /click.*confirm|click the confirm/i);
  assert.doesNotMatch(JSON.stringify(updates[0]), /run.*\/dune server stop yourself|run the command/i, "must not repeat the round-1 advice that doesn't actually work");
});

// [Audit fix: UI/UX, CRITICAL, round 2] This is the test that would have
// caught all three of round 2's structural breaks: a genuinely different
// second admin clicking the same message must actually be let through
// (not rejected as "not yours"), must have THEIR OWN real identity sent
// to Core (not the first admin's), and the action must actually complete.
test("handleWriteButtonInteraction: a genuinely different second admin can complete the dual-confirmation by clicking the same message", async () => {
  resetPendingConfirmations();
  // Simulates the state AFTER the first admin's click already got a 202
  // and re-registered with secondConfirmationPending: true (see Step 3).
  registerRealPendingConfirmation({ nonce: "n4", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real", secondConfirmationPending: true });
  let executeCalledWith = null;
  const adapterClient = { writeExecute: async (actor, body) => { executeCalledWith = { actor, body }; return { ok: true }; } };
  const updates = [];
  const secondAdminInteraction = {
    isButton: () => true, customId: "write:confirm:n4",
    user: { id: "second-admin", username: "second" },
    // [Final-review fix, IMPORTANT 3] This admin must now actually HOLD the
    // entry's tier to get through the ownership gate, not merely be a
    // different user. entry.tier here is "owner", and owner is derived
    // exclusively from real Discord guild ownership (rbac.js), so the
    // mock carries a real guild.ownerId matching this clicker.
    guild: { ownerId: "second-admin" },
    guildId: "g1", channelId: "c1", member: { roles: { cache: new Map() } },
    update: async (p) => updates.push(p)
  };
  const handled = await handleWriteButtonInteraction(secondAdminInteraction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true, "a genuinely different admin must not be rejected as 'not yours'");
  assert.equal(executeCalledWith.actor.userId, "second-admin", "Core must be told the REAL, current clicker's identity, never the first admin's");
  assert.match(JSON.stringify(updates[0]), /executed|success/i);
});

test("handleWriteButtonInteraction: the SAME admin cannot provide both confirmations -- rejected client-side before ever calling Core", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n5", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real", secondConfirmationPending: true });
  let executeCalled = false;
  const adapterClient = { writeExecute: async () => { executeCalled = true; return { ok: true }; } };
  const replies = [];
  const sameAdminInteraction = { isButton: () => true, customId: "write:confirm:n5", user: { id: "first-admin" }, reply: async (p) => replies.push(p) };
  const handled = await handleWriteButtonInteraction(sameAdminInteraction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(executeCalled, false, "Core must never be called -- this is rejected client-side, matching Core's own second_confirmation_same_actor check");
  assert.match(JSON.stringify(replies[0]), /different administrator/i);
});

test("handleWriteButtonInteraction: writeExecute throwing a mapped error shows the specific error, not a generic failure", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n3", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  const { AdapterHttpError } = await import("../src/adapterClient.js");
  const adapterClient = { writeExecute: async () => { throw new AdapterHttpError("HTTP 410", { status: 410, route: "write-execute", body: { ok: false, code: "nonce_not_found", error: "gone" } }); } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n3", user: { id: "u1" }, update: async (p) => updates.push(p) };
  await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.match(JSON.stringify(updates[0]), /expired/i);
});

test("handleWriteButtonInteraction: a customId key containing a colon is not truncated", async () => {
  // [Audit fix: Security/QA, MEDIUM] a naive split(":") would silently
  // truncate this key -- prove the real (indexOf-based) parsing doesn't.
  resetPendingConfirmations();
  const keyWithColon = "abc:def-123";
  registerRealPendingConfirmation({ nonce: keyWithColon, action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  const adapterClient = { writeExecute: async (actor, body) => { assert.equal(body.nonce, keyWithColon); return { ok: true }; } };
  const interaction = { isButton: () => true, customId: `write:confirm:${keyWithColon}`, user: { id: "u1" }, update: async () => {} };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
});

// [Audit fix: Security/Architect, MEDIUM round 3] A legacy stub entry
// (created via the pre-existing createPendingConfirmation(), which never
// sets a `kind` field -- unlike registerRealPendingConfirmation()'s
// "real"/"self-update" entries) must confirm into the same scaffolded
// response it always has, and must NEVER reach adapterClient.writeExecute
// with a bogus, non-Core action name.
test("handleWriteButtonInteraction: a legacy stub confirmation (no kind field) reports the scaffolded status, never calling adapterClient", async () => {
  resetPendingConfirmations();
  // createPendingConfirmation must already be imported at the top of this
  // test file -- it's the pre-existing legacy registration function this
  // suite tested before this plan; not new to Task 5.
  createPendingConfirmation({ idempotencyKey: "n6", action: "maintenance:set-note", tier: "admin", risk: "low", userId: "u1", onTimeout: () => {} });
  let executeCalled = false;
  const adapterClient = { writeExecute: async () => { executeCalled = true; return { ok: true }; } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n6", user: { id: "u1" }, update: async (p) => updates.push(p) };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(executeCalled, false, "a legacy stub entry must never reach adapterClient.writeExecute");
  assert.match(JSON.stringify(updates[0]), /not executed|scaffolded|awaiting upstream/i);
});

// ─── Final whole-branch review fixes ────────────────────────────────────

// [Final-review fix, CRITICAL 1] AdapterClient.writeExecute(actor, body,
// guildId) resolves the CALLING guild's own Core config (base URL + adapter
// token) from its third argument. The confirm branch omitted it entirely,
// so in multi-tenant mode every confirmed write was executed against the
// process-wide default Core instance instead of the tenant's own -- a
// cross-tenant misrouting of a real mutation. writeHandler.js's sibling
// writePreview() call already passed it, which is why preview and execute
// could target two different Cores for the same command.
test("handleWriteButtonInteraction: confirm passes the interaction's guildId to writeExecute so multi-tenant writes reach the right Core", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n-guild", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  let capturedGuildId = "NEVER SET";
  const adapterClient = { writeExecute: async (actor, body, guildId) => { capturedGuildId = guildId; return { ok: true }; } };
  const interaction = {
    isButton: () => true, customId: "write:confirm:n-guild",
    user: { id: "u1", username: "u" }, guildId: "guild-abc", channelId: "c1",
    update: async () => {}
  };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(capturedGuildId, "guild-abc", "writeExecute's third argument must be the clicking interaction's guildId, not undefined");
});

// [Final-review fix, IMPORTANT 3] The dual-confirmation waiting-state
// message is deliberately PUBLIC so a genuinely different admin can
// complete it -- which means every member of the guild can click its
// buttons too. Before this fix, an unauthorized member's Confirm click ran
// clearPendingConfirmation() before ever reaching Core (which then
// correctly refused them), permanently destroying the pending entry and
// forcing the real second admin to start over.
test("handleWriteButtonInteraction: an unauthorized member's Confirm click during the second-confirmation window is rejected AND leaves the pending entry intact for the real second admin", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n-unauth", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real", secondConfirmationPending: true });

  let executeCalls = 0;
  const adapterClient = { writeExecute: async () => { executeCalls += 1; return { ok: true }; } };

  const replies = [];
  const randomMember = {
    isButton: () => true, customId: "write:confirm:n-unauth",
    user: { id: "random-member", username: "rando" },
    guild: { ownerId: "real-second-admin" }, guildId: "g1", channelId: "c1",
    member: { roles: [] },
    reply: async (p) => replies.push(p),
    update: async () => { throw new Error("must never update the public message on a rejected click"); }
  };
  const handledRejection = await handleWriteButtonInteraction(randomMember, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handledRejection, true);
  assert.equal(executeCalls, 0, "an unauthorized clicker must be refused client-side, never forwarded to Core");
  assert.equal(replies[0].ephemeral, true);
  assert.match(JSON.stringify(replies[0]), /not authorized/i);
  assert.ok(getPendingConfirmation("n-unauth"), "the pending confirmation must SURVIVE a rejected click -- destroying it is the bug being fixed");

  // ...and the real second admin (the guild owner, i.e. genuinely owner-tier)
  // can still complete the very same pending confirmation afterwards.
  const updates = [];
  const realSecondAdmin = {
    isButton: () => true, customId: "write:confirm:n-unauth",
    user: { id: "real-second-admin", username: "second" },
    guild: { ownerId: "real-second-admin" }, guildId: "g1", channelId: "c1",
    member: { roles: [] },
    update: async (p) => updates.push(p)
  };
  const handledSuccess = await handleWriteButtonInteraction(realSecondAdmin, adapterClient, WRITES_ENABLED_CONFIG, null);
  assert.equal(handledSuccess, true);
  assert.equal(executeCalls, 1, "the real second admin's click must still reach Core");
  assert.match(JSON.stringify(updates[0]), /executed|success/i);
});

// [Final-review fix, IMPORTANT 3] Cancel was strictly worse than Confirm:
// it destroyed the pending confirmation with no authorization check of any
// kind, so any guild member could kill another admin's in-flight
// dual-confirmation outright.
test("handleWriteButtonInteraction: an unauthorized member's Cancel click during the second-confirmation window is rejected and does not destroy the pending entry", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n-unauth-cancel", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real", secondConfirmationPending: true });

  const replies = [];
  const randomMember = {
    isButton: () => true, customId: "write:cancel:n-unauth-cancel",
    user: { id: "random-member", username: "rando" },
    guild: { ownerId: "real-second-admin" }, guildId: "g1", channelId: "c1",
    member: { roles: [] },
    reply: async (p) => replies.push(p),
    update: async () => { throw new Error("must never update the public message on a rejected cancel"); }
  };
  const handled = await handleWriteButtonInteraction(randomMember, {}, WRITES_ENABLED_CONFIG, null);
  assert.equal(handled, true);
  assert.equal(replies[0].ephemeral, true);
  assert.match(JSON.stringify(replies[0]), /not authorized/i);
  assert.ok(getPendingConfirmation("n-unauth-cancel"), "an unauthorized cancel must not be able to kill a pending dual-confirmation");
});

// [Final-review fix, MINOR 7] `setTimeout(fn, NaN)` fires on the next timer
// tick, so a malformed/missing expiresAt from Core silently deleted the
// entry before the user could ever click Confirm -- every button press
// would then report "Confirmation Expired" with nothing explaining why.
test("registerRealPendingConfirmation: a missing or non-numeric expiresAt falls back to the local confirmation window instead of expiring immediately", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n-noexp", action: "player.kick", tier: "admin", userId: "u1", kind: "real" });
  registerRealPendingConfirmation({ nonce: "n-badexp", action: "player.kick", tier: "admin", userId: "u1", expiresAt: "soon", kind: "real" });
  registerRealPendingConfirmation({ nonce: "n-pastexp", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() - 5000, kind: "real" });

  // Two full timer ticks: a NaN/0/negative delay would have fired by now.
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.ok(getPendingConfirmation("n-noexp"), "a missing expiresAt must not delete the entry immediately");
  assert.ok(getPendingConfirmation("n-badexp"), "a non-numeric expiresAt must not delete the entry immediately");
  assert.ok(getPendingConfirmation("n-pastexp"), "an already-past expiresAt must not delete the entry immediately");
  assert.ok(getPendingConfirmation("n-noexp").expiresAt > Date.now(), "the stored expiry must be the sane fallback, not the bad input");
});

// [Final-review fix, MINOR 8] The legacy stub path audits its own expiry
// (writeTimeoutAuditEvent via createPendingConfirmation's onTimeout); the
// real/self-update path had no timeout audit at all, so a pending write
// that simply expired unclicked left no trace in the audit stream.
test("registerRealPendingConfirmation: a real pending confirmation that expires unclicked emits a timeout audit event", async () => {
  resetPendingConfirmations();
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try {
    registerRealPendingConfirmation({ nonce: "n-timeout-audit", action: "player.kick", tier: "admin", userId: "u-timeout", expiresAt: Date.now() + 20, kind: "real" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    console.log = originalLog;
  }
  assert.equal(getPendingConfirmation("n-timeout-audit"), undefined, "the entry must still be removed on expiry");
  const audit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((e) => e && e.idempotencyKey === "n-timeout-audit");
  assert.ok(audit, "an audit event must be emitted when a real pending confirmation expires");
  assert.equal(audit.result, "timeout");
  assert.equal(audit.action, "player.kick");
  assert.equal(audit.actor.userId, "u-timeout");
});

// [Final-review fix, IMPORTANT 4] The transition into the
// waiting-on-a-second-administrator state was the one outcome of the
// confirm branch that produced no audit line at all -- a real Repudiation
// gap ("who gave the first of the two required confirmations?").
test("handleWriteButtonInteraction: a 202 second_confirmation_required response is itself audited", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n-202-audit", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real" });
  const adapterClient = { writeExecute: async () => ({ ok: true, code: "second_confirmation_required", nonce: "n-202-audit", expiresAt: Date.now() + 300000 }) };
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try {
    const interaction = {
      isButton: () => true, customId: "write:confirm:n-202-audit",
      user: { id: "first-admin", username: "first" }, guildId: "g1", channelId: "c1",
      update: async () => {}
    };
    await handleWriteButtonInteraction(interaction, adapterClient, WRITES_ENABLED_CONFIG, null);
  } finally {
    console.log = originalLog;
  }
  const audit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((e) => e && e.result === "second-confirmation-required");
  assert.ok(audit, "the waiting-state transition must emit its own audit event");
  assert.equal(audit.action, "server.stop");
  assert.equal(audit.actor.userId, "first-admin", "the audit must name the admin who gave the FIRST confirmation");
  assert.equal(audit.idempotencyKey, "n-202-audit");
});
