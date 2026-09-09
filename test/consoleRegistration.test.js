import assert from "node:assert/strict";
import test from "node:test";
import { verifyAndRegisterConsole } from "../src/consoleRegistration.js";
import { resetConsoleRegistrationRateLimiterForTests } from "../src/consoleRegistrationRateLimit.js";
import { createDatabase, getGuild } from "../src/database.js";

function fakeDb() {
  return createDatabase(":memory:");
}

test("rejects a malformed token/guildId with zero calls to Discord", async () => {
  resetConsoleRegistrationRateLimiterForTests({});
  let discordCalled = false;
  const fetchImpl = async () => { discordCalled = true; return { ok: true, json: async () => ([]) }; };
  const result = await verifyAndRegisterConsole(fakeDb(), { guildId: "not-a-snowflake", discordAccessToken: "x", consoleUrl: "https://example.test", adapterToken: "tok" }, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(discordCalled, false, "a malformed guildId must be rejected before any Discord call");
});

test("registers successfully when the forwarded token proves ownership of the submitted guildId", async () => {
  resetConsoleRegistrationRateLimiterForTests({});
  const db = fakeDb();
  const fetchImpl = async (url) => {
    if (url.includes("/users/@me/guilds")) return { ok: true, json: async () => ([{ id: "111111111111111111", name: "Real Guild", owner: true }]) };
    return { ok: true, json: async () => ({ id: "999999999999999999" }) };
  };
  const result = await verifyAndRegisterConsole(db, { guildId: "111111111111111111", discordAccessToken: "tok", consoleUrl: "https://example.test", adapterToken: "adaptertoken" }, { fetchImpl });
  assert.equal(result.ok, true);
  const stored = getGuild(db, "111111111111111111");
  assert.equal(stored.status, "active");
  assert.equal(stored.console_url, "https://example.test");
});

test("rejects when the forwarded token proves ownership of a DIFFERENT guild than the one submitted (the single most important negative test)", async () => {
  resetConsoleRegistrationRateLimiterForTests({});
  const db = fakeDb();
  const fetchImpl = async (url) => {
    if (url.includes("/users/@me/guilds")) return { ok: true, json: async () => ([{ id: "333333333333333333", name: "A Different Guild I Really Own", owner: true }]) };
    return { ok: true, json: async () => ({ id: "999999999999999999" }) };
  };
  const result = await verifyAndRegisterConsole(db, { guildId: "111111111111111111", discordAccessToken: "tok", consoleUrl: "https://attacker.test", adapterToken: "x" }, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(getGuild(db, "111111111111111111"), undefined, "the victim guild must not be registered");
});

test("rejects an expired/invalid token (Discord itself returns non-200)", async () => {
  resetConsoleRegistrationRateLimiterForTests({});
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const result = await verifyAndRegisterConsole(fakeDb(), { guildId: "111111111111111111", discordAccessToken: "expired", consoleUrl: "https://example.test", adapterToken: "x" }, { fetchImpl });
  assert.equal(result.ok, false);
});

test("never logs or persists the forwarded discordAccessToken anywhere", async () => {
  resetConsoleRegistrationRateLimiterForTests({});
  const db = fakeDb();
  const fetchImpl = async (url) => {
    if (url.includes("/users/@me/guilds")) return { ok: true, json: async () => ([{ id: "111111111111111111", name: "G", owner: true }]) };
    return { ok: true, json: async () => ({ id: "999999999999999999" }) };
  };
  const secretToken = "super-secret-live-discord-token-value";
  await verifyAndRegisterConsole(db, { guildId: "111111111111111111", discordAccessToken: secretToken, consoleUrl: "https://example.test", adapterToken: "x" }, { fetchImpl });
  const stored = getGuild(db, "111111111111111111");
  assert.ok(!JSON.stringify(stored).includes(secretToken));
});
