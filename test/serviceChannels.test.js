// serviceChannels.test.js (mentat#372): DB accessor tests for the
// generalized service duty/apply component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { getServiceChannel, setServiceChannel, listServiceChannels, setDutyStatus, clearDutyStatus, listOnDuty, isOnDuty, createApplication, getPendingApplication, setApplicationReviewMessage, getApplication, resolveApplication } from "../src/serviceChannels.js";

function fakeDb() {
  return createDatabase(":memory:");
}

const GUILD_ID = "111111111111111111";

test("setServiceChannel then getServiceChannel round-trips all fields", () => {
  const db = fakeDb();
  setServiceChannel(db, GUILD_ID, "water-seller", {
    channelId: "chan-1", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true
  });
  const row = getServiceChannel(db, GUILD_ID, "water-seller");
  assert.equal(row.channel_id, "chan-1");
  assert.equal(row.role_id, "role-1");
  assert.equal(row.review_channel_id, "review-1");
  assert.equal(row.requires_review, 1);
});

test("getServiceChannel returns undefined for an unknown service", () => {
  const db = fakeDb();
  assert.equal(getServiceChannel(db, GUILD_ID, "nonexistent"), undefined);
});

test("setServiceChannel is idempotent -- calling it twice for the same guild+service updates in place, no duplicate row", () => {
  const db = fakeDb();
  setServiceChannel(db, GUILD_ID, "water-seller", { channelId: "chan-1", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true });
  setServiceChannel(db, GUILD_ID, "water-seller", { channelId: "chan-2", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true });
  assert.equal(getServiceChannel(db, GUILD_ID, "water-seller").channel_id, "chan-2");
  assert.equal(listServiceChannels(db, GUILD_ID).length, 1);
});

test("listServiceChannels returns every service for a guild, none for another guild", () => {
  const db = fakeDb();
  setServiceChannel(db, GUILD_ID, "water-seller", { channelId: "chan-1", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true });
  setServiceChannel(db, GUILD_ID, "smuggler", { channelId: "chan-2", roleId: "role-2", reviewChannelId: "review-1", requiresReview: true });
  setServiceChannel(db, "other-guild", "water-seller", { channelId: "chan-3", roleId: "role-3", reviewChannelId: "review-3", requiresReview: true });
  const rows = listServiceChannels(db, GUILD_ID);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.service_key).sort(), ["smuggler", "water-seller"]);
});

test("setDutyStatus then isOnDuty/listOnDuty reflect the new row", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), true);
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-2"), false);
  assert.deepEqual(listOnDuty(db, GUILD_ID, "water-seller").map(r => r.user_id), ["user-1"]);
});

test("setDutyStatus is idempotent -- calling it twice for the same user doesn't duplicate", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(listOnDuty(db, GUILD_ID, "water-seller").length, 1);
});

test("clearDutyStatus removes the row", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  clearDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), false);
  assert.deepEqual(listOnDuty(db, GUILD_ID, "water-seller"), []);
});

test("listOnDuty scopes by service_key -- a duty row for a different service doesn't leak in", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  setDutyStatus(db, GUILD_ID, "smuggler", "user-1");
  assert.equal(listOnDuty(db, GUILD_ID, "water-seller").length, 1);
  assert.equal(listOnDuty(db, GUILD_ID, "smuggler").length, 1);
});

test("createApplication succeeds and getPendingApplication finds it", () => {
  const db = fakeDb();
  const result = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "Muad'Dib", proofLink: "https://example.test/proof" });
  assert.equal(result.ok, true);
  assert.equal(result.application.character_name, "Muad'Dib");
  assert.equal(result.application.status, "pending");
  const pending = getPendingApplication(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(pending.id, result.application.id);
});

test("createApplication rejects a second pending application for the same guild+service+applicant -- the real race guard, not just a pre-check", () => {
  const db = fakeDb();
  const first = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  assert.equal(first.ok, true);
  const second = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "B", proofLink: null });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_pending");
});

test("createApplication allows a new pending application once the prior one is resolved", () => {
  const db = fakeDb();
  const first = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  resolveApplication(db, GUILD_ID, first.application.id, { status: "denied", reviewedBy: "admin-1" });
  const second = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "B", proofLink: null });
  assert.equal(second.ok, true);
});

test("setApplicationReviewMessage then getApplication reflects the stored message ID", () => {
  const db = fakeDb();
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  setApplicationReviewMessage(db, application.id, "review-msg-1");
  assert.equal(getApplication(db, application.id).review_message_id, "review-msg-1");
});

test("resolveApplication updates status/reviewedBy/reviewedAt and returns the row", () => {
  const db = fakeDb();
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  const resolved = resolveApplication(db, GUILD_ID, application.id, { status: "approved", reviewedBy: "admin-1" });
  assert.equal(resolved.status, "approved");
  assert.equal(resolved.reviewed_by, "admin-1");
  assert.ok(resolved.reviewed_at);
});

test("resolveApplication returns null for an application belonging to a different guild -- cross-tenant guard", () => {
  const db = fakeDb();
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  const resolved = resolveApplication(db, "some-other-guild", application.id, { status: "approved", reviewedBy: "admin-1" });
  assert.equal(resolved, null);
  assert.equal(getApplication(db, application.id).status, "pending");
});
