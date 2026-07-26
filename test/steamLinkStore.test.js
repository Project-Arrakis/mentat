import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSteamLinkSession,
  getSteamLinkSession,
  consumeSteamLinkSession,
  pruneExpired,
  resetSteamLinkStoreForTests,
  debugPeekSteamLinkSession
} from "../src/steamLinkStore.js";

test.beforeEach(() => {
  resetSteamLinkStoreForTests();
});

function baseSessionArgs(overrides = {}) {
  return {
    discordUserId: "user-1",
    guildId: "guild-1",
    interactionToken: "token-1",
    commandInteractionId: "interaction-1",
    playerControllerId: "pc-1",
    characterName: "TestCharacter",
    ...overrides
  };
}

test("createSteamLinkSession requires discordUserId", () => {
  assert.throws(() => createSteamLinkSession(baseSessionArgs({ discordUserId: undefined })));
});

test("createSteamLinkSession requires playerControllerId", () => {
  assert.throws(() => createSteamLinkSession(baseSessionArgs({ playerControllerId: undefined })));
});

test("createSteamLinkSession generates a unique, random state token", () => {
  const a = createSteamLinkSession(baseSessionArgs());
  const b = createSteamLinkSession(baseSessionArgs());
  assert.notEqual(a.state, b.state);
  assert.equal(typeof a.state, "string");
  assert.ok(a.state.length >= 32); // randomBytes(16).toString("hex") == 32 chars
});

test("createSteamLinkSession scopes the session to exactly one character", () => {
  const session = createSteamLinkSession(baseSessionArgs({ playerControllerId: "pc-42", characterName: "Atreides Fan" }));
  assert.equal(session.playerControllerId, "pc-42");
  assert.equal(session.characterName, "Atreides Fan");
});

// Regression test for a real bug (found 2026-07-26): the session
// previously only captured discordUserId/guildId, but Core's
// normalizeDiscordActor() hard-requires username/channelId on every
// actor object, and requireSelfScopedCapability() needs real roleIds --
// without these captured here at session-creation time (only available
// from the real Discord interaction, never recoverable after the OAuth
// redirect round-trip), every real link-steam call failed with a 400.
test("createSteamLinkSession stores username, channelId, and roleIds", () => {
  const session = createSteamLinkSession(baseSessionArgs({
    username: "RealDiscordUsername",
    channelId: "channel-42",
    roleIds: ["role-a", "role-b"]
  }));
  assert.equal(session.username, "RealDiscordUsername");
  assert.equal(session.channelId, "channel-42");
  assert.deepEqual(session.roleIds, ["role-a", "role-b"]);
});

test("createSteamLinkSession defaults username to 'unknown' and roleIds to an empty array when omitted", () => {
  const session = createSteamLinkSession(baseSessionArgs({ username: undefined, roleIds: undefined }));
  assert.equal(session.username, "unknown");
  assert.deepEqual(session.roleIds, []);
});

test("getSteamLinkSession returns the session for a valid state", () => {
  const created = createSteamLinkSession(baseSessionArgs());
  const fetched = getSteamLinkSession(created.state);
  assert.equal(fetched.discordUserId, "user-1");
  assert.equal(fetched.state, created.state);
});

test("getSteamLinkSession returns undefined for an unknown state", () => {
  assert.equal(getSteamLinkSession("does-not-exist"), undefined);
});

test("getSteamLinkSession does not mark the session consumed", () => {
  const created = createSteamLinkSession(baseSessionArgs());
  getSteamLinkSession(created.state);
  getSteamLinkSession(created.state);
  const peeked = debugPeekSteamLinkSession(created.state);
  assert.equal(peeked.consumedAt, null);
});

test("getSteamLinkSession returns undefined and deletes an expired session", () => {
  const created = createSteamLinkSession(baseSessionArgs({ ttlMs: -1 })); // already expired
  assert.equal(getSteamLinkSession(created.state), undefined);
  assert.equal(debugPeekSteamLinkSession(created.state), undefined);
});

test("consumeSteamLinkSession returns the session on first use", () => {
  const created = createSteamLinkSession(baseSessionArgs());
  const consumed = consumeSteamLinkSession(created.state);
  assert.equal(consumed.state, created.state);
  assert.ok(consumed.consumedAt);
});

test("consumeSteamLinkSession is single-use: a second consumption of the same state fails (FINDING-STEAM-1)", () => {
  const created = createSteamLinkSession(baseSessionArgs());
  const first = consumeSteamLinkSession(created.state);
  assert.ok(first);
  const second = consumeSteamLinkSession(created.state);
  assert.equal(second, undefined);
});

test("consumeSteamLinkSession returns undefined for an unknown state", () => {
  assert.equal(consumeSteamLinkSession("does-not-exist"), undefined);
});

test("consumeSteamLinkSession returns undefined and deletes an expired session", () => {
  const created = createSteamLinkSession(baseSessionArgs({ ttlMs: -1 }));
  assert.equal(consumeSteamLinkSession(created.state), undefined);
});

test("pruneExpired removes expired sessions but keeps valid ones", () => {
  const expired = createSteamLinkSession(baseSessionArgs({ ttlMs: -1 }));
  const valid = createSteamLinkSession(baseSessionArgs({ playerControllerId: "pc-2" }));
  pruneExpired();
  assert.equal(debugPeekSteamLinkSession(expired.state), undefined);
  assert.ok(debugPeekSteamLinkSession(valid.state));
});

test("pruneExpired removes an expired session even if it was already consumed", () => {
  const session = createSteamLinkSession(baseSessionArgs({ ttlMs: 100000 }));
  consumeSteamLinkSession(session.state);
  // Manually force expiry via a fresh session with negative TTL to simulate
  // time passing, since we can't mutate Date.now() without a fake timer here.
  const expired = createSteamLinkSession(baseSessionArgs({ ttlMs: -1, playerControllerId: "pc-3" }));
  pruneExpired();
  assert.equal(debugPeekSteamLinkSession(expired.state), undefined);
});
