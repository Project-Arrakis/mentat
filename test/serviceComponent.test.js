// serviceComponent.test.js (mentat#372): the generalized On Duty/Off
// Duty/Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { setDutyStatus } from "../src/serviceChannels.js";
import { buildServiceStatusEmbed } from "../src/serviceComponent.js";

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
