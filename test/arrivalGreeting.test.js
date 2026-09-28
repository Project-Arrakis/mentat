import assert from "node:assert/strict";
import { test } from "node:test";
import { postArrivalGreeting, startArrivalGreeter } from "../src/arrivalGreeting.js";

// arrivalGreeting.js (real gap found 2026-09-27): YAGPDB's verification
// gate is entirely DM-based with no in-server fallback -- a member whose
// DMs are closed gets zero signal anything else is required. This posts an
// immediate, in-server nudge on join, mentioning the new member directly.

function fakeChannel({ isTextBased = true } = {}) {
  const sent = [];
  return {
    isTextBased: () => isTextBased,
    send: async (content) => { sent.push(content); return { id: "message-1" }; },
    _sent: sent
  };
}

test("postArrivalGreeting mentions the new member and links back to the pinned explanation", async () => {
  const channel = fakeChannel();
  await postArrivalGreeting({ member: { id: "user-1" }, channelFetcher: async () => channel });

  assert.equal(channel._sent.length, 1);
  assert.equal(channel._sent[0].content, "<@user-1>");
  assert.ok(channel._sent[0].embeds?.[0], "must send a Discord embed, not a plain string");
  assert.match(channel._sent[0].embeds[0].toJSON().description, /pinned message/);
});

test("postArrivalGreeting does nothing if the configured channel is not a guild text channel", async () => {
  const channel = fakeChannel({ isTextBased: false });
  await postArrivalGreeting({ member: { id: "user-1" }, channelFetcher: async () => channel });

  assert.equal(channel._sent.length, 0);
});

test("startArrivalGreeter is inactive with no channel configured", () => {
  const greeter = startArrivalGreeter({ client: { on() {}, off() {} }, channelId: undefined });
  assert.equal(greeter.active, false);
});

test("startArrivalGreeter registers a guildMemberAdd listener that posts to the configured channel", async () => {
  const channel = fakeChannel();
  let registeredHandler;
  const client = {
    on: (event, handler) => { if (event === "guildMemberAdd") registeredHandler = handler; },
    off: () => {},
    channels: { fetch: async () => channel }
  };

  const greeter = startArrivalGreeter({ client, channelId: "channel-1" });
  assert.equal(greeter.active, true);
  assert.equal(typeof registeredHandler, "function");

  await registeredHandler({ id: "user-2" });

  assert.equal(channel._sent.length, 1);
  assert.equal(channel._sent[0].content, "<@user-2>");
});

test("startArrivalGreeter reports (not throws) when posting the greeting fails", async () => {
  const client = {
    on: (event, handler) => { if (event === "guildMemberAdd") client._handler = handler; },
    off: () => {},
    channels: { fetch: async () => { throw new Error("channel unreachable"); } }
  };
  const errors = [];

  const greeter = startArrivalGreeter({ client, channelId: "channel-1", onError: (e) => errors.push(e) });
  assert.equal(greeter.active, true);
  await client._handler({ id: "user-3" });

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /channel unreachable/);
});

test("startArrivalGreeter's stop() removes the listener", () => {
  const offCalls = [];
  const client = { on() {}, off: (event, handler) => offCalls.push({ event, handler }) };
  const greeter = startArrivalGreeter({ client, channelId: "channel-1" });
  greeter.stop();
  assert.equal(offCalls.length, 1);
  assert.equal(offCalls[0].event, "guildMemberAdd");
});
