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
  getPendingConfirmation,
  clearPendingConfirmation,
  pendingConfirmationCount,
  resetPendingConfirmations,
  handleWriteButtonInteraction,
  CONFIRMATION_TIMEOUT_MS
} from "../src/writeConfirmation.js";

beforeEach(() => resetPendingConfirmations());

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
  const handled = await handleWriteButtonInteraction(interaction);
  assert.equal(handled, false);
  assert.equal(interaction._update, null);
});

test("handleWriteButtonInteraction shows expired embed for unknown key", async () => {
  const interaction = mockButtonInteraction({ customId: "write:confirm:missing-key" });
  const handled = await handleWriteButtonInteraction(interaction);
  assert.equal(handled, true);
  assert.equal(interaction._update.components.length, 0);
  assert.ok(interaction._update.embeds[0].data.title.includes("Expired"));
});

test("handleWriteButtonInteraction rejects a different user's click", async () => {
  createPendingConfirmation({ idempotencyKey: "key-3", action: "a", tier: "admin", risk: "low", userId: "owner-user" });
  const interaction = mockButtonInteraction({ customId: "write:confirm:key-3", userId: "attacker-user" });
  const handled = await handleWriteButtonInteraction(interaction);
  assert.equal(handled, true);
  assert.equal(interaction._reply.ephemeral, true);
  assert.ok(interaction._reply.embeds[0].data.title.includes("Not Your Confirmation"));
  // The pending confirmation must survive an unauthorized click.
  assert.ok(getPendingConfirmation("key-3"));
});

test("handleWriteButtonInteraction cancel clears the pending entry and shows cancelled", async () => {
  createPendingConfirmation({ idempotencyKey: "key-4", action: "a", tier: "admin", risk: "low", userId: "user-1" });
  const interaction = mockButtonInteraction({ customId: "write:cancel:key-4", userId: "user-1" });
  const handled = await handleWriteButtonInteraction(interaction);
  assert.equal(handled, true);
  assert.equal(getPendingConfirmation("key-4"), undefined);
  assert.ok(interaction._update.embeds[0].data.title.includes("Cancelled"));
  assert.deepEqual(interaction._update.components, []);
});

test("handleWriteButtonInteraction confirm clears the pending entry but never executes", async () => {
  createPendingConfirmation({ idempotencyKey: "key-5", action: "operations:restart-service", tier: "owner", risk: "high", userId: "user-1" });
  const interaction = mockButtonInteraction({ customId: "write:confirm:key-5", userId: "user-1" });
  const handled = await handleWriteButtonInteraction(interaction);
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
