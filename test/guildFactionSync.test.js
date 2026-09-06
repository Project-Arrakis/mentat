import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, upsertGuild, recordGuildMemberActivity, getGuildFaction, setGuildFaction } from "../src/database.js";
import { syncGuildFactionTheme } from "../src/guildFactionSync.js";

function mockAdapterClient(tallyOrError) {
  const calls = [];
  return {
    calls,
    async guildFactionSummary(actor, discordUserIds, guildId) {
      calls.push({ actor, discordUserIds, guildId });
      if (tallyOrError instanceof Error) throw tallyOrError;
      return { ok: true, tally: tallyOrError, consideredCount: Object.values(tallyOrError || {}).reduce((a, b) => a + b, 0) };
    }
  };
}

function setup() {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  return db;
}

const actor = { userId: "user-1", guildId: "g1", channelId: "channel-1", roleIds: ["role-observer"] };

test("syncGuildFactionTheme sets the guild's faction to the majority tallied faction", async () => {
  const db = setup();
  recordGuildMemberActivity(db, "g1", "user-1");
  recordGuildMemberActivity(db, "g1", "user-2");
  const adapterClient = mockAdapterClient({ "House Atreides": 3, "House Harkonnen": 1 });

  await syncGuildFactionTheme(db, adapterClient, actor, "g1");

  assert.equal(getGuildFaction(db, "g1"), "atreides");
  assert.deepEqual(adapterClient.calls[0].discordUserIds.sort(), ["user-1", "user-2"]);
  assert.equal(adapterClient.calls[0].guildId, "g1");
});

test("syncGuildFactionTheme does not touch the setting when the tally is tied", async () => {
  const db = setup();
  setGuildFaction(db, "g1", "fremen");
  recordGuildMemberActivity(db, "g1", "user-1");
  const adapterClient = mockAdapterClient({ "House Atreides": 2, "House Harkonnen": 2 });

  await syncGuildFactionTheme(db, adapterClient, actor, "g1");

  assert.equal(getGuildFaction(db, "g1"), "fremen", "a tie must never overwrite the existing setting");
});

test("syncGuildFactionTheme does not touch the setting when the tally is empty", async () => {
  const db = setup();
  setGuildFaction(db, "g1", "harkonnen");
  recordGuildMemberActivity(db, "g1", "user-1");
  const adapterClient = mockAdapterClient({});

  await syncGuildFactionTheme(db, adapterClient, actor, "g1");

  assert.equal(getGuildFaction(db, "g1"), "harkonnen");
});

test("syncGuildFactionTheme ignores a faction name that doesn't loosely match one of the three known houses, rather than writing an arbitrary string", async () => {
  const db = setup();
  recordGuildMemberActivity(db, "g1", "user-1");
  const adapterClient = mockAdapterClient({ "Some Unrecognized Guild Faction": 5 });

  await syncGuildFactionTheme(db, adapterClient, actor, "g1");

  assert.equal(getGuildFaction(db, "g1"), "");
});

test("syncGuildFactionTheme is a no-op (no adapter call at all) when no Discord users have been recorded as active in this guild", async () => {
  const db = setup();
  const adapterClient = mockAdapterClient({ "House Atreides": 1 });

  await syncGuildFactionTheme(db, adapterClient, actor, "g1");

  assert.equal(adapterClient.calls.length, 0);
  assert.equal(getGuildFaction(db, "g1"), "");
});

test("syncGuildFactionTheme swallows an adapter error rather than throwing -- this is a best-effort side effect", async () => {
  const db = setup();
  recordGuildMemberActivity(db, "g1", "user-1");
  const adapterClient = mockAdapterClient(new Error("adapter unreachable"));

  await assert.doesNotReject(() => syncGuildFactionTheme(db, adapterClient, actor, "g1"));
});

test("syncGuildFactionTheme is a no-op when the adapter reports ok: false", async () => {
  const db = setup();
  recordGuildMemberActivity(db, "g1", "user-1");
  const adapterClient = { async guildFactionSummary() { return { ok: false, code: "not_authorized" }; } };

  await syncGuildFactionTheme(db, adapterClient, actor, "g1");

  assert.equal(getGuildFaction(db, "g1"), "");
});

test("syncGuildFactionTheme is a no-op with no db or no guildId", async () => {
  const db = setup();
  const adapterClient = mockAdapterClient({ "House Atreides": 1 });
  await syncGuildFactionTheme(null, adapterClient, actor, "g1");
  await syncGuildFactionTheme(db, adapterClient, actor, "");
  assert.equal(adapterClient.calls.length, 0);
});
