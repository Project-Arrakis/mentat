// serviceComponent.test.js (mentat#372): the generalized On Duty/Off
// Duty/Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { setDutyStatus, setServiceChannel, isOnDuty } from "../src/serviceChannels.js";
import { buildServiceStatusEmbed, handleServiceButtonInteraction, handleServiceModalSubmit } from "../src/serviceComponent.js";
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
    reply: async () => {},
    deferReply: async () => {},
    editReply: async () => {}
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
    reply: async () => {},
    deferReply: async () => {},
    editReply: async () => {}
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
    reply: async () => {},
    deferReply: async () => {},
    editReply: async () => {}
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

function fakeModalInteraction({ serviceKey = "water-seller", characterName = "Muad'Dib", proofLink = "https://example.test", userId = "user-1" } = {}) {
  return {
    isModalSubmit: () => true,
    customId: `service:applymodal:${serviceKey}`,
    guildId: GUILD_ID,
    user: { id: userId },
    fields: {
      getTextInputValue: (id) => (id === "characterName" ? characterName : proofLink)
    },
    replied: false,
    reply: async function (payload) { this.replied = true; this._reply = payload; }
  };
}

test("handleServiceModalSubmit returns false for a customId it doesn't own", async () => {
  const db = fakeDb();
  const handled = await handleServiceModalSubmit({ isModalSubmit: () => true, customId: "other:thing:x" }, db, fakeClient());
  assert.equal(handled, false);
});

test("handleServiceModalSubmit creates the application, posts to the review channel with proof_link as plain text (never markdown-link syntax), and acknowledges the applicant", async () => {
  const db = fakeDb();
  stageService(db);
  const sentToReview = [];
  const reviewChannel = {
    isTextBased: () => true,
    send: async (payload) => { sentToReview.push(payload); return { id: "review-msg-1" }; }
  };
  const client = { channels: { fetch: async (id) => (id === "review-1" ? reviewChannel : fakeChannel()) } };
  const interaction = fakeModalInteraction({ proofLink: "[legit](https://phish.test)" });
  const handled = await handleServiceModalSubmit(interaction, db, client);
  assert.equal(handled, true);
  assert.equal(interaction.replied, true);
  assert.match(interaction._reply.content, /DM/i);

  const { getPendingApplication } = await import("../src/serviceChannels.js");
  const pending = getPendingApplication(db, GUILD_ID, "water-seller", "user-1");
  assert.ok(pending);
  assert.equal(pending.review_message_id, "review-msg-1");

  assert.equal(sentToReview.length, 1);
  // Structural check, not a substring search: the raw proof_link text
  // (including its literal "[legit](...)" characters) is expected to
  // still be present -- staff need to see it -- the actual defense is
  // that it's wrapped in a backtick code span, which Discord renders as
  // literal monospace text rather than parsing as a clickable masked
  // link. A substring search for the absence of "[legit](" can never
  // pass while the raw text is preserved (which it must be), so assert
  // the wrapping directly instead.
  const proofField = sentToReview[0].embeds[0].data.fields.find(f => f.name === "Proof Link");
  assert.ok(proofField, "review embed must have a Proof Link field");
  assert.equal(proofField.value, "`[legit](https://phish.test)`", "proof_link must be wrapped in a backtick code span, defanging any markdown link syntax it contains");
});

test("handleServiceModalSubmit rejects a race-losing duplicate submission with a friendly message, not a raw DB error", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication } = await import("../src/serviceChannels.js");
  createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "X", proofLink: null });
  const interaction = fakeModalInteraction();
  const handled = await handleServiceModalSubmit(interaction, db, fakeClient());
  assert.equal(handled, true);
  assert.match(interaction._reply.content, /pending/i);
});

function fakeConfig() {
  return { multiTenant: false, discord: { rbac: { adminRoleIds: ["admin-role"] } } };
}

test("non-admin clicking Approve/Deny gets an explicit ephemeral rejection, no mutation", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  const replies = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    user: { id: "not-an-admin" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient(), fakeConfig());
  assert.equal(handled, true);
  assert.match(replies[0].content, /not authorized/i);
  assert.equal(getApplication(db, application.id).status, "pending");
});

test("admin Approve grants the role, marks approved, edits the review message, best-effort DMs the applicant", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication, setApplicationReviewMessage } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  setApplicationReviewMessage(db, application.id, "review-msg-1");
  const granted = [];
  const dmsSent = [];
  const edits = [];
  const reviewChannel = { isTextBased: () => true, messages: { fetch: async () => ({ edit: async (payload) => edits.push(payload) }) } };
  const client = {
    channels: { fetch: async (id) => (id === "review-1" ? reviewChannel : fakeChannel()) },
    users: { fetch: async (id) => ({ id, send: async (payload) => dmsSent.push({ id, payload }) }) },
    guilds: { fetch: async () => ({ members: { fetch: async () => ({ roles: { add: async (roleId) => granted.push(roleId) } }) } }) }
  };
  const fakeInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    user: { id: "admin-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["admin-role"][Symbol.iterator]() } } },
    client,
    reply: async () => {},
    deferUpdate: async () => {}
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, client, fakeConfig());
  assert.equal(handled, true);
  assert.deepEqual(granted, ["role-water-seller"]);
  assert.equal(getApplication(db, application.id).status, "approved");
  assert.equal(edits.length, 1);
  assert.equal(dmsSent.length, 1);
});

test("Approve/Deny for an application from a different guild is rejected -- cross-tenant guard", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: "other-guild", serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  const replies = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    user: { id: "admin-1" },
    guildId: GUILD_ID, // different guild than the application's own guild_id
    member: { roles: { cache: { keys: () => ["admin-role"][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient(), fakeConfig());
  assert.equal(handled, true);
  assert.equal(getApplication(db, application.id).status, "pending");
});

test("a second Approve/Deny click on an already-resolved application short-circuits before any role-grant/DM/message-edit side effect", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication, setApplicationReviewMessage } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  setApplicationReviewMessage(db, application.id, "review-msg-1");
  const granted = [];
  const dmsSent = [];
  const edits = [];
  const reviewChannel = { isTextBased: () => true, messages: { fetch: async () => ({ edit: async (payload) => edits.push(payload) }) } };
  const client = {
    channels: { fetch: async (id) => (id === "review-1" ? reviewChannel : fakeChannel()) },
    users: { fetch: async (id) => ({ id, send: async (payload) => dmsSent.push({ id, payload }) }) },
    guilds: { fetch: async () => ({ members: { fetch: async () => ({ roles: { add: async (roleId) => granted.push(roleId) } }) } }) }
  };
  const baseInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["admin-role"][Symbol.iterator]() } } },
    client
  };

  // First click: resolves for real.
  const replies1 = [];
  await handleServiceButtonInteraction({ ...baseInteraction, user: { id: "admin-1" }, reply: async (p) => replies1.push(p), deferUpdate: async () => {} }, db, client, fakeConfig());
  assert.equal(getApplication(db, application.id).status, "approved");
  assert.equal(granted.length, 1);
  assert.equal(dmsSent.length, 1);

  // Second click (a double-click, or a different admin racing the first):
  // must short-circuit, never re-run any side effect.
  const replies2 = [];
  const handled = await handleServiceButtonInteraction({ ...baseInteraction, user: { id: "admin-2" }, reply: async (p) => replies2.push(p) }, db, client, fakeConfig());
  assert.equal(handled, true);
  assert.match(replies2[0].content, /already approved/i);
  assert.equal(granted.length, 1, "role must not be granted a second time");
  assert.equal(dmsSent.length, 1, "applicant must not be DMed a second time");
  assert.equal(edits.length, 1, "the review message must not be edited a second time");
  assert.equal(getApplication(db, application.id).reviewed_by, "admin-1", "the original reviewer must not be overwritten");
});
