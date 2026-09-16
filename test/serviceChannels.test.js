// serviceChannels.test.js (mentat#372): DB accessor tests for the
// generalized service duty/apply component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { getServiceChannel, setServiceChannel, listServiceChannels } from "../src/serviceChannels.js";

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
