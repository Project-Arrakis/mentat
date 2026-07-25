import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, getGuild, upsertGuild, createOauthSession, getOauthSession, updateOauthSession } from "../src/database.js";
import { _resetKeyCacheForTests } from "../src/secretsCrypto.js";

const VALID_KEY_HEX = "c".repeat(64);

test.beforeEach(() => {
  _resetKeyCacheForTests();
  delete process.env.ACP_SECRETS_KEY;
  delete process.env.ACP_SECRETS_KEY_FILE;
});

test("upsertGuild/getGuild round-trips adapterToken without an encryption key configured", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "plain-token-value", status: "active" });
  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "plain-token-value");
});

test("adapter_token is not stored as plaintext in the underlying row once a key is configured", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "super-secret-adapter-token", status: "active" });

  const rawRow = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = ?").get("g1");
  assert.equal(rawRow.adapter_token.includes("super-secret-adapter-token"), false);

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "super-secret-adapter-token");
});

test("upsertGuild UPDATE path re-encrypts a changed adapterToken", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "first-token", status: "active" });
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "second-token", status: "active" });

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "second-token");

  const rawRow = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = ?").get("g1");
  assert.equal(rawRow.adapter_token.includes("first-token"), false);
  assert.equal(rawRow.adapter_token.includes("second-token"), false);
});

test("getGuild returns undefined for a guild that does not exist, without throwing", () => {
  const db = createDatabase(":memory:");
  assert.equal(getGuild(db, "does-not-exist"), undefined);
});

test("oauth session access_token is encrypted at rest once a key is configured", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  createOauthSession(db, { state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
  updateOauthSession(db, "state1", { accessToken: "live-discord-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

  const rawRow = db.prepare("SELECT access_token FROM oauth_sessions WHERE state = ?").get("state1");
  assert.equal(rawRow.access_token.includes("live-discord-oauth-token"), false);

  const session = getOauthSession(db, "state1");
  assert.equal(session.access_token, "live-discord-oauth-token");
  assert.equal(session.expires_at, "2030-01-01T00:00:00.000Z");
});

test("oauth session round-trips without an encryption key configured", () => {
  const db = createDatabase(":memory:");
  createOauthSession(db, { state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
  updateOauthSession(db, "state1", { accessToken: "plain-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

  const session = getOauthSession(db, "state1");
  assert.equal(session.access_token, "plain-oauth-token");
});

test("a guild written before a key was configured still reads back correctly (legacy plaintext)", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "legacy-plaintext-token", status: "active" });

  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  _resetKeyCacheForTests();

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "legacy-plaintext-token");
});
