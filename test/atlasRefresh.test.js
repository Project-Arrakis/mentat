import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { getLiveMessage } from "../src/database.js";
import { atlasRefresher } from "../src/atlasRefresh.js";

// atlasRefresh.js (mentat#376): the first real caller of liveMessage.js's
// postOrEditLiveMessage() -- #370 shipped that utility unused.

function fakeChannel({ id, guildId, isTextBased = true, fetchMessage } = {}) {
  const sent = [];
  return {
    id,
    guildId,
    isTextBased: () => isTextBased,
    send: async (content) => { sent.push(content); return { id: "message-1" }; },
    messages: { fetch: async (messageId) => (fetchMessage ? fetchMessage(messageId) : { id: messageId, edit: async () => {} }) },
    _sent: sent
  };
}

function fakeClient(channelsById) {
  return { channels: { fetch: async (id) => { const c = channelsById[id]; if (!c) throw new Error(`no channel ${id}`); return c; } } };
}

test("atlasRefresher posts a fresh atlas embed and records it under the channel's real guild id", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel({ id: "channel-1", guildId: "guild-1" });
  const client = fakeClient({ "channel-1": channel });
  const seenCalls = [];
  const adapterClient = {
    atlas: async (actor, guildId) => {
      seenCalls.push({ actor, guildId });
      return { ok: true, coriolisSeed: "cor-6", coriolisNextCycleAt: null, sietches: { HaggaBasin: [], DeepDesert: [] } };
    }
  };

  const refresher = atlasRefresher({ adapterClient, client, db, channelId: "channel-1" });
  await refresher.refresh();

  // Real bug, caught live on first deploy (2026-09-18): the channel's real
  // guildId MUST be passed as AdapterClient.atlas()'s own second argument,
  // not just embedded in the actor object -- request() resolves each
  // guild's Core base URL from that second argument specifically, falling
  // back to a literal placeholder host (causing every refresh to fail with
  // a generic "fetch failed") when it's omitted.
  assert.equal(seenCalls[0].guildId, "guild-1");
  assert.equal(seenCalls[0].actor.guildId, "guild-1");

  assert.equal(channel._sent.length, 1);
  assert.ok(channel._sent[0].embeds?.[0], "must send a Discord embed, not a plain string");
  const recorded = getLiveMessage(db, "guild-1", "atlas");
  assert.equal(recorded.channel_id, "channel-1");
});

test("atlasRefresher edits the previous message in place on a second refresh", async () => {
  const db = createDatabase(":memory:");
  const editCalls = [];
  const channel = fakeChannel({
    id: "channel-1",
    guildId: "guild-1",
    fetchMessage: (messageId) => ({ id: messageId, edit: async (content) => editCalls.push(content) })
  });
  const client = fakeClient({ "channel-1": channel });
  const adapterClient = { atlas: async () => ({ ok: true, coriolisSeed: "cor-6", coriolisNextCycleAt: null, sietches: { HaggaBasin: [], DeepDesert: [] } }) };

  const refresher = atlasRefresher({ adapterClient, client, db, channelId: "channel-1" });
  await refresher.refresh();
  await refresher.refresh();

  assert.equal(channel._sent.length, 1, "the second refresh must edit, not post again");
  assert.equal(editCalls.length, 1);
});

test("atlasRefresher reports (not throws) when the adapter call fails, via onError", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel({ id: "channel-1", guildId: "guild-1" });
  const client = fakeClient({ "channel-1": channel });
  const adapterClient = { atlas: async () => { throw new Error("adapter unreachable"); } };
  const errors = [];

  const refresher = atlasRefresher({ adapterClient, client, db, channelId: "channel-1", onError: (e) => errors.push(e) });
  await refresher.refresh();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /adapter unreachable/);
  assert.equal(channel._sent.length, 0, "a failed adapter call must not post a broken/empty message");
});

test("atlasRefresher reports a clear error when the configured channel is not a guild text channel", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel({ id: "channel-1", guildId: undefined });
  const client = fakeClient({ "channel-1": channel });
  const adapterClient = { atlas: async () => ({ ok: true, sietches: {} }) };
  const errors = [];

  const refresher = atlasRefresher({ adapterClient, client, db, channelId: "channel-1", onError: (e) => errors.push(e) });
  await refresher.refresh();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /not a guild text channel/);
});
