import assert from "node:assert/strict";
import test from "node:test";
import { verifyAndRegisterConsole } from "../src/consoleRegistration.js";
import { resetConsoleRegistrationRateLimiterForTests } from "../src/consoleRegistrationRateLimit.js";
import { createDatabase, getGuild } from "../src/database.js";
import { createSetupServer } from "../src/setupServer.js";

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
  // Fix-round-1 should-fix regression: the real guild name Discord's own
  // /users/@me/guilds response carries must be stored, not a hardcoded
  // "Unknown" that would clobber a name /setup/register already resolved.
  assert.equal(stored.guild_name, "Real Guild");
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
  // Strengthened per fix-round-1 review: pin the specific rejection reason
  // so this test can't pass for the wrong reason (e.g. a bug that
  // accidentally rejects everything).
  assert.equal(result.reason, "guild_not_owned");
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

// Fix-round-1 Important #3 regression: verifies the real timeout wiring
// end-to-end -- a hung Discord call must actually be aborted (via the
// AbortSignal handed to fetchImpl) rather than pinning the request open
// forever. Uses an injectable `timeoutMs` (default DISCORD_FETCH_TIMEOUT_MS
// in production) so this test can force a near-instant abort instead of
// waiting out the real 10s production timeout.
test("aborts and reports discord_unreachable when the Discord call hangs past the timeout", async () => {
  resetConsoleRegistrationRateLimiterForTests({});
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
  const result = await verifyAndRegisterConsole(
    fakeDb(),
    { guildId: "111111111111111111", discordAccessToken: "tok", consoleUrl: "https://example.test", adapterToken: "x" },
    { fetchImpl, timeoutMs: 20 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "discord_unreachable");
});

// ─── HTTP-level regression tests (fix round 1) ─────────────────────────

async function withRegistrationApp(fn) {
  const app = createSetupServer({
    dbPath: ":memory:",
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100"
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("POST /api/consoles/register with a non-JSON body returns the normal 403, not a 500, and still counts toward the global rate limit", async () => {
  // Fix-round-1 Important #1: previously, `const { guildId, ... } = req.body`
  // with no fallback threw when express.json() left req.body `undefined`
  // (any Content-Type that isn't application/json -- a plain string body,
  // as sent below, defaults to text/plain under Node's fetch). That crash
  // happened BEFORE verifyAndRegisterConsole (and therefore
  // recordGlobalConsoleRegistrationAttempt) ever ran, so this whole request
  // class was invisible to the endpoint's global rate-limit ceiling.
  resetConsoleRegistrationRateLimiterForTests({ globalMax: 2, globalWindow: 60_000, globalBlock: 60_000 });
  await withRegistrationApp(async (base) => {
    const first = await fetch(`${base}/api/consoles/register`, {
      method: "POST",
      body: "guildId=111111111111111111"
    });
    assert.equal(first.status, 403, "a non-JSON body must fail normal validation with 403, not crash with a 500");

    // globalMax is 2: if the first (non-JSON-body) request had NOT been
    // recorded by the global rate limiter (the bug this test guards
    // against), this second request would still see count=1 and be
    // allowed (403 again, not 429). Seeing 429 here proves the first
    // request really was counted.
    const second = await fetch(`${base}/api/consoles/register`, {
      method: "POST",
      body: "guildId=111111111111111111"
    });
    assert.equal(second.status, 429, "the first (non-JSON-body) request must have incremented the global rate-limit bucket");
  });
});
