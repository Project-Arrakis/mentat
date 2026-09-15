import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelType, PermissionsBitField } from "discord.js";
import {
  ROLES,
  CATEGORIES,
  VOICE_CHANNELS,
  planRoles,
  planCategoriesAndChannels,
  planVoiceChannels,
  permissionOverwritesFor
} from "../scripts/chronicles-of-kanly-phase0-provision.js";

test("planRoles proposes every ROLES entry when the guild has none of them yet", () => {
  const plan = planRoles([]);
  assert.equal(plan.length, ROLES.length);
  assert.deepEqual(plan.map((item) => item.name), ROLES.map((role) => role.name));
  assert.ok(plan.every((item) => item.type === "create-role"));
});

test("planRoles is idempotent -- proposes nothing once every role already exists", () => {
  const existingRoles = ROLES.map((role) => ({ name: role.name }));
  const plan = planRoles(existingRoles);
  assert.deepEqual(plan, []);
});

test("planRoles only proposes the roles actually missing", () => {
  const existingRoles = [{ name: ROLES[0].name }, { name: ROLES[1].name }];
  const plan = planRoles(existingRoles);
  assert.equal(plan.length, ROLES.length - 2);
  assert.ok(!plan.some((item) => item.name === ROLES[0].name || item.name === ROLES[1].name));
});

test("planRoles carries mentionable through for the notification roles", () => {
  const plan = planRoles([]);
  const coriolisWatch = plan.find((item) => item.name === "🌪️ Coriolis Watch");
  const naib = plan.find((item) => item.name === "🏛️ Naib");
  assert.equal(coriolisWatch.mentionable, true);
  assert.equal(naib.mentionable, false);
});

test("planCategoriesAndChannels proposes every category and channel from a clean guild", () => {
  const plan = planCategoriesAndChannels([]);
  const categoryItems = plan.filter((item) => item.type === "create-category");
  const channelItems = plan.filter((item) => item.type === "create-text-channel");
  assert.equal(categoryItems.length, CATEGORIES.length);
  const expectedChannelCount = CATEGORIES.reduce((total, category) => total + category.channels.length, 0);
  assert.equal(channelItems.length, expectedChannelCount);
});

test("planCategoriesAndChannels includes #pledge-your-house under Arrival (meta#71 doc fix)", () => {
  const plan = planCategoriesAndChannels([]);
  const pledge = plan.find((item) => item.type === "create-text-channel" && item.name === "pledge-your-house");
  assert.ok(pledge, "pledge-your-house should be planned");
  assert.equal(pledge.categoryName, "📜 Arrival");
});

test("planCategoriesAndChannels skips a category that already exists by name", () => {
  const existingChannels = [{ type: ChannelType.GuildCategory, name: "📜 Arrival", id: "cat-1" }];
  const plan = planCategoriesAndChannels(existingChannels);
  assert.ok(!plan.some((item) => item.type === "create-category" && item.name === "📜 Arrival"));
  // Its channels are still missing (none of them exist under cat-1 yet) and must still be planned.
  const arrivalChannelNames = CATEGORIES.find((c) => c.name === "📜 Arrival").channels.map((c) => c.name);
  for (const name of arrivalChannelNames) {
    assert.ok(plan.some((item) => item.type === "create-text-channel" && item.name === name));
  }
});

test("planCategoriesAndChannels does not re-plan a channel that already exists under its real category id", () => {
  const existingChannels = [
    { type: ChannelType.GuildCategory, name: "📜 Arrival", id: "cat-1" },
    { type: ChannelType.GuildText, name: "welcome", id: "chan-1", parentId: "cat-1" }
  ];
  const plan = planCategoriesAndChannels(existingChannels);
  assert.ok(!plan.some((item) => item.type === "create-text-channel" && item.name === "welcome"));
});

test("planCategoriesAndChannels is fully idempotent once everything exists", () => {
  const existingChannels = [];
  for (const [index, category] of CATEGORIES.entries()) {
    const categoryId = `cat-${index}`;
    existingChannels.push({ type: ChannelType.GuildCategory, name: category.name, id: categoryId });
    for (const channel of category.channels) {
      existingChannels.push({ type: ChannelType.GuildText, name: channel.name, parentId: categoryId });
    }
  }
  assert.deepEqual(planCategoriesAndChannels(existingChannels), []);
});

test("planVoiceChannels proposes every VOICE_CHANNELS entry when none exist, and none once they all do", () => {
  const empty = planVoiceChannels([]);
  assert.equal(empty.length, VOICE_CHANNELS.length);
  const full = planVoiceChannels(VOICE_CHANNELS.map((voice) => ({ type: ChannelType.GuildVoice, name: voice.name })));
  assert.deepEqual(full, []);
});

test("permissionOverwritesFor returns undefined for an unlocked category/channel", () => {
  const fakeGuild = { roles: { everyone: { id: "everyone-id" } } };
  assert.equal(permissionOverwritesFor(null, new Map(), fakeGuild), undefined);
  assert.equal(permissionOverwritesFor([], new Map(), fakeGuild), undefined);
});

test("permissionOverwritesFor denies @everyone and allows every named role", () => {
  const fakeGuild = { roles: { everyone: { id: "everyone-id" } } };
  const roleByName = new Map([
    ["🏛️ Naib", { id: "naib-id" }],
    ["🗡️ Fedaykin", { id: "fedaykin-id" }]
  ]);
  const overwrites = permissionOverwritesFor(["🏛️ Naib", "🗡️ Fedaykin"], roleByName, fakeGuild);
  assert.deepEqual(overwrites, [
    { id: "everyone-id", deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: "naib-id", allow: [PermissionsBitField.Flags.ViewChannel] },
    { id: "fedaykin-id", allow: [PermissionsBitField.Flags.ViewChannel] }
  ]);
});

test("permissionOverwritesFor throws when a locked-to role hasn't been created yet -- role creation must precede channel creation", () => {
  const fakeGuild = { roles: { everyone: { id: "everyone-id" } } };
  assert.throws(
    () => permissionOverwritesFor(["🦅 House Atreides"], new Map(), fakeGuild),
    /House Atreides.*was not found\/created/
  );
});
