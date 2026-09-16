// serviceComponent.test.js (mentat#372): the generalized On Duty/Off
// Duty/Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { setDutyStatus, setServiceChannel, isOnDuty } from "../src/serviceChannels.js";
import { buildServiceStatusEmbed, handleServiceButtonInteraction } from "../src/serviceComponent.js";
import { updateGuildSettings, upsertGuild } from "../src/database.js";

function fakeDb() { return createDatabase(":memory:"); }
const GUILD_ID = "111111111111111111";

test("buildServiceStatusEmbed shows the plan's exact empty-roster string when no one is on duty", () => {
  const db = fakeDb();
  const { embeds } = buildServiceStatusEmbed(db, GUILD_ID, "water-seller", "Water-Seller");
  const description = embeds[0].data.description || "";
  const fieldsText = JSON.stringify(embeds[0].data.fields || []);
  assert.ok((description + fieldsText).includes("No one currently on duty"));
});

test("buildServiceStatusEmbed lists on-duty members when present", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  const { embeds } = buildServiceStatusEmbed(db, GUILD_ID, "water-seller", "Water-Seller");
  const fieldsText = JSON.stringify(embeds[0].data.fields || []);
  assert.ok(fieldsText.includes("user-1"));
});

test("buildServiceStatusEmbed returns exactly 3 buttons: On Duty, Off Duty, Apply, with serviceKey-scoped customIds", () => {
  const db = fakeDb();
  const { components } = buildServiceStatusEmbed(db, GUILD_ID, "water-seller", "Water-Seller");
  const buttons = components[0].components;
  assert.equal(buttons.length, 3);
  const customIds = buttons.map(b => b.data.custom_id);
  assert.deepEqual(customIds, ["service:onduty:water-seller", "service:offduty:water-seller", "service:apply:water-seller"]);
});

function stageService(db, overrides = {}) {
  // A real deployment only ever provisions a service channel for an
  // already-registered guild -- a guild_settings row (needed by
  // toggleGenericOnDutyRole's getGuildSettings/updateGuildSettings calls)
  // is created as a side effect of upsertGuild(), matching how a guild
  // actually comes to exist in this bot.
  upsertGuild(db, { guildId: GUILD_ID, guildName: "Test Guild", consoleUrl: "https://console.test", adapterToken: "token", status: "active" });
  setServiceChannel(db, GUILD_ID, "water-seller", {
    channelId: "chan-1", roleId: "role-water-seller", reviewChannelId: "review-1", requiresReview: true, ...overrides
  });
}

function fakeChannel(sent = []) {
  return {
    isTextBased: () => true,
    send: async (payload) => { const id = `msg-${sent.length + 1}`; sent.push({ id, payload }); return { id }; },
    messages: { fetch: async () => { throw new Error("not found"); } }
  };
}

function fakeClient(sent = []) {
  return { channels: { fetch: async () => fakeChannel(sent) } };
}

test("handleServiceButtonInteraction returns false for a customId it doesn't own", async () => {
  const db = fakeDb();
  const fakeInteraction = { isButton: () => true, customId: "write:confirm:something" };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, false);
});

test("onduty without the role is rejected ephemerally, no DB write, and names the fix", async () => {
  const db = fakeDb();
  stageService(db);
  const replies = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:onduty:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    reply: async (payload) => { replies.push(payload); }
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].ephemeral);
  assert.match(replies[0].content, /Apply/);
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), false);
});

test("onduty with the role writes service_duty_status, grants the generic On Duty role if configured, and refreshes the pinned embed", async () => {
  const db = fakeDb();
  stageService(db);
  updateGuildSettings(db, GUILD_ID, { on_duty_role_id: "generic-on-duty-role" });
  const added = [];
  const sent = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:onduty:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() }, add: async (roleId) => added.push(roleId) } },
    reply: async () => {}
  };
  const client = fakeClient(sent);
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, client);
  assert.equal(handled, true);
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), true);
  assert.deepEqual(added, ["generic-on-duty-role"]);
  assert.equal(sent.length, 1, "must post/refresh the pinned status message");
});

test("offduty clears service_duty_status and removes the generic On Duty role", async () => {
  const db = fakeDb();
  stageService(db);
  updateGuildSettings(db, GUILD_ID, { on_duty_role_id: "generic-on-duty-role" });
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  const removed = [];
  const sent = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:offduty:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() }, remove: async (roleId) => removed.push(roleId) } },
    reply: async () => {}
  };
  const client = fakeClient(sent);
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, client);
  assert.equal(handled, true);
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), false);
  assert.deepEqual(removed, ["generic-on-duty-role"]);
});

test("onduty when on_duty_role_id is unset (default '') skips the generic-role toggle without error", async () => {
  const db = fakeDb();
  stageService(db);
  const sent = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:onduty:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() }, add: async () => { throw new Error("must not be called"); } } },
    reply: async () => {}
  };
  const client = fakeClient(sent);
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, client);
  assert.equal(handled, true);
});

test("apply when the user already holds the role is rejected ephemerally before any modal is shown", async () => {
  const db = fakeDb();
  stageService(db);
  const replies = [];
  const shownModals = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:apply:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload),
    showModal: async (modal) => shownModals.push(modal)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(shownModals.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /already/i);
});

test("apply with an existing pending application is rejected ephemerally, no modal shown", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication } = await import("../src/serviceChannels.js");
  createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  const replies = [];
  const shownModals = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:apply:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload),
    showModal: async (modal) => shownModals.push(modal)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(shownModals.length, 0);
  assert.match(replies[0].content, /pending/i);
});

test("apply with no role and no pending application shows the modal with the right customId", async () => {
  const db = fakeDb();
  stageService(db);
  const shownModals = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:apply:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    showModal: async (modal) => shownModals.push(modal)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(shownModals.length, 1);
  assert.equal(shownModals[0].data.custom_id, "service:applymodal:water-seller");
});
