import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { postOrEditLiveMessage } from "../src/liveMessage.js";

// liveMessage.js (mentat#370): the shared "bot edits its own message in
// place" infrastructure -- confirmed by direct exploration this session
// that nothing in this bot did this before, so this is new shared code
// with no prior test to model, not an extension of an existing suite.

function fakeChannel({ id, isTextBased = true, sendResult, fetchMessage, sendError, fetchError } = {}) {
  const sent = [];
  return {
    id,
    isTextBased: () => isTextBased,
    send: async (content) => {
      if (sendError) throw sendError;
      sent.push(content);
      return sendResult || { id: "new-message-id" };
    },
    messages: {
      fetch: async (messageId) => {
        if (fetchError) throw fetchError;
        return fetchMessage ? fetchMessage(messageId) : { id: messageId, edit: async () => {} };
      }
    },
    _sent: sent
  };
}

function fakeClient(channelsById) {
  return {
    channels: {
      fetch: async (id) => {
        const channel = channelsById[id];
        if (!channel) throw new Error(`no channel registered for ${id}`);
        return channel;
      }
    }
  };
}

test("postOrEditLiveMessage posts a fresh message and records it when nothing exists yet", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel({ id: "channel-1", sendResult: { id: "message-1" } });
  const client = fakeClient({ "channel-1": channel });

  const result = await postOrEditLiveMessage({ client, db, guildId: "guild-1", channelId: "channel-1", messageKey: "coriolis", content: "hello" });

  assert.equal(result.edited, false);
  assert.equal(result.messageId, "message-1");
  assert.deepEqual(channel._sent, ["hello"]);
});

test("postOrEditLiveMessage edits the previously-recorded message instead of posting a new one", async () => {
  const db = createDatabase(":memory:");
  const editCalls = [];
  const channel = fakeChannel({
    id: "channel-1",
    fetchMessage: (messageId) => ({ id: messageId, edit: async (content) => editCalls.push({ messageId, content }) })
  });
  const client = fakeClient({ "channel-1": channel });

  // Seed a prior post the same way a first call would have.
  await postOrEditLiveMessage({ client, db, guildId: "guild-1", channelId: "channel-1", messageKey: "coriolis", content: "first" });
  const result = await postOrEditLiveMessage({ client, db, guildId: "guild-1", channelId: "channel-1", messageKey: "coriolis", content: "second" });

  assert.equal(result.edited, true);
  assert.equal(channel._sent.length, 1, "the second call must not post a new message");
  assert.equal(editCalls.length, 1, "the second call must edit exactly once");
  assert.equal(editCalls[0].content, "second");
  assert.equal(editCalls[0].messageId, result.messageId);
});

test("postOrEditLiveMessage falls back to posting a fresh message when the recorded message is gone", async () => {
  const db = createDatabase(":memory:");
  const goneChannel = fakeChannel({ id: "channel-1", fetchError: new Error("Unknown Message") });
  const client = fakeClient({ "channel-1": goneChannel });

  // Seed a stale pointer directly (simulating a message deleted after the
  // last successful post).
  const { setLiveMessage } = await import("../src/database.js");
  setLiveMessage(db, "guild-1", "coriolis", "channel-1", "deleted-message-id");

  const result = await postOrEditLiveMessage({ client, db, guildId: "guild-1", channelId: "channel-1", messageKey: "coriolis", content: "fresh" });

  assert.equal(result.edited, false, "a stale pointer must fall back to posting fresh, not throw");
  assert.deepEqual(goneChannel._sent, ["fresh"]);
});

test("postOrEditLiveMessage throws a clear error when the target channel is not text-based or missing", async () => {
  const db = createDatabase(":memory:");
  const nonTextChannel = fakeChannel({ id: "channel-1", isTextBased: false });
  const client = fakeClient({ "channel-1": nonTextChannel });

  await assert.rejects(
    postOrEditLiveMessage({ client, db, guildId: "guild-1", channelId: "channel-1", messageKey: "coriolis", content: "hello" }),
    /not text-based/
  );
});
