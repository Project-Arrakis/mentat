// autoInvite.test.js -- mentat#343 (Phase 1 of the hosted-bot auto-invite
// design, dune-awakening-selfhost-docker#832). Real HTTP integration tests
// spawning the actual Express server, matching setupServer.test.js's own
// withApp() convention -- not unit tests calling internal functions
// directly, since the whole point of this phase is the route-level
// contract (fail-closed proxy-secret check, real HTTP status codes).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSetupServer } from "../src/setupServer.js";
import { _resetEphemeralStateForTests } from "../src/database.js";
import { resetConsoleRegistrationRateLimiterForTests } from "../src/consoleRegistrationRateLimit.js";

test.beforeEach(() => {
  _resetEphemeralStateForTests();
  resetConsoleRegistrationRateLimiterForTests({});
});

const PROXY_SECRET = "a-real-secret-that-is-at-least-32-chars-long";

function fetchImplStub({
  tokenOk = true,
  accessToken = "discord-access-token",
  ownedGuildId = "111111111111111111",
  ownedGuildName = "Real Guild",
  discordUserId = "999999999999999999"
} = {}) {
  return async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/oauth2/token")) {
      if (!tokenOk) return { ok: false, json: async () => ({ error: "invalid_grant" }) };
      return { ok: true, json: async () => ({ access_token: accessToken }) };
    }
    if (urlStr.includes("/users/@me/guilds")) {
      return { ok: true, json: async () => ([{ id: ownedGuildId, name: ownedGuildName, owner: true }]) };
    }
    if (urlStr.includes("/users/@me")) {
      return { ok: true, json: async () => ({ id: discordUserId }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

function makeApp(overrides = {}) {
  return createSetupServer({
    dbPath: ":memory:",
    discordClientId: "sahir-venn-client-id",
    discordClientSecret: "sahir-venn-client-secret",
    baseUrl: "http://localhost:3100",
    autoInviteRedirectUri: "https://mentat-link.darkdante.org/api/consoles/auto-invite/callback",
    autoInviteReturnBaseUrl: "https://mentat-link.darkdante.org",
    fetchImpl: fetchImplStub(overrides.fetchStubOpts),
    ...overrides
  });
}

async function withAutoInviteApp(overrides, fn) {
  const app = makeApp(overrides);
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

async function startSession(base, headers = { "x-mentat-proxy-secret": PROXY_SECRET }) {
  const res = await fetch(`${base}/api/consoles/auto-invite/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ consoleUrl: "https://console.test", adapterToken: "adapter-token-123" })
  });
  return res;
}

// callbackRedirectFields: Phase 3 changed /auto-invite/callback from
// returning JSON directly to issuing a signed 302 redirect toward
// mentat-link's bounce page (design doc §4.1/§4.4) -- fetch() with
// `redirect: "manual"` so the Location header's query params (the signed
// payload fields) can be inspected directly, without needing
// mentat-link's own /return endpoint to exist for these mentat-only tests.
async function callbackRedirectFields(base, query) {
  const res = await fetch(`${base}/api/consoles/auto-invite/callback?${query}`, { redirect: "manual" });
  assert.equal(res.status, 302, "the callback route must always redirect, never return raw JSON");
  const location = res.headers.get("location");
  assert.ok(location, "a 302 must carry a Location header");
  const url = new URL(location);
  return Object.fromEntries(url.searchParams.entries());
}

// ─── /auto-invite/start: fail-closed proxy-secret gate (issue #844) ──────

test("POST /auto-invite/start is REJECTED (403) when MENTAT_PROXY_SHARED_SECRET is not configured at all -- run against a harness that does NOT pre-set it, to actually exercise the fail-closed default rather than only the happy-path-configured case", async () => {
  delete process.env.MENTAT_PROXY_SHARED_SECRET;
  await withAutoInviteApp({}, async (base) => {
    const res = await startSession(base, {});
    assert.equal(res.status, 403);
  });
});

test("POST /auto-invite/start is rejected (403) when the secret IS configured but the caller presents a wrong/missing header", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const wrongHeader = await startSession(base, { "x-mentat-proxy-secret": "wrong-secret" });
      assert.equal(wrongHeader.status, 403);
      const noHeader = await startSession(base, {});
      assert.equal(noHeader.status, 403);
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("POST /auto-invite/start succeeds (200, returns an opaque state) when the secret matches", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const res = await startSession(base);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.state, "string");
      assert.ok(body.state.length > 0);
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("POST /auto-invite/start rejects a request missing consoleUrl/adapterToken with 400, not a crash", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const res = await fetch(`${base}/api/consoles/auto-invite/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mentat-proxy-secret": PROXY_SECRET },
        body: JSON.stringify({})
      });
      assert.equal(res.status, 400);
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// ─── /auto-invite/callback: exempt from the proxy-secret gate ────────────

test("GET /auto-invite/callback is exempt from the proxy-secret gate -- Discord's own redirect can never carry that header", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const startRes = await startSession(base);
      const { state } = await startRes.json();
      // No x-mentat-proxy-secret header on this request at all.
      const fields = await callbackRedirectFields(base, `code=abc&state=${state}&guild_id=111111111111111111`);
      assert.equal(fields.ok, "true");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// ─── /auto-invite/callback: the full happy path stages a pending owner
// confirmation, never calls upsertGuild() ─────────────────────────────────

test("happy path: /start then /callback stages a pending owner confirmation and does NOT write the guild to the DB (upsertGuild is a later phase's job)", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const startRes = await startSession(base);
      const { state } = await startRes.json();

      const fields = await callbackRedirectFields(base, `code=real-code&state=${state}&guild_id=111111111111111111`);
      assert.equal(fields.ok, "true");
      assert.equal(fields.guildName, "Real Guild");
      assert.equal(fields.state, state);
      // confirmationId is deliberately NOT part of the signed redirect
      // payload (design doc §4.1/§4.4) -- it's DM'd server-side to the
      // verified owner only, never exposed to the browser, which would
      // otherwise let an observer of this redirect forge a confirm/deny
      // link for a guild they don't own.
      assert.equal(fields.confirmationId, undefined);
      assert.ok(fields.sig && fields.sig.length > 0, "the redirect must be signed");

      // The app's own in-memory DB is a separate instance per createSetupServer()
      // call and not directly reachable from here, but the crucial assertion is
      // structural: autoInvite.js must never import or call upsertGuild() at all
      // -- confirmed by a source-pattern check, the same convention this
      // codebase already uses for verifying an event-handler's routing shape
      // (see test/interactionRouting.test.js).
      const { readFile } = await import("node:fs/promises");
      const src = await readFile(new URL("../src/autoInvite.js", import.meta.url), "utf8");
      assert.doesNotMatch(src, /import\s*\{[^}]*upsertGuild/, "Phase 1's autoInvite.js must never import upsertGuild -- if it's never imported, it structurally cannot be called; that write is the owner-confirmation gate's job, a later phase");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// ─── Replay-after-consume (issue #836) -- the core CSRF/replay defense ───

test("replay-after-consume: a second /callback hit with an already-consumed state gets the expired response, never a second successful registration", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const startRes = await startSession(base);
      const { state } = await startRes.json();

      const first = await callbackRedirectFields(base, `code=real-code&state=${state}&guild_id=111111111111111111`);
      assert.equal(first.ok, "true");

      const replay = await callbackRedirectFields(base, `code=real-code&state=${state}&guild_id=111111111111111111`);
      assert.equal(replay.ok, "false");
      assert.equal(replay.reason, "expired");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("a /callback hit with a state that was never staged (guessed/leaked) gets the expired response, fails closed", async () => {
  // The signed-redirect step (Phase 3) needs the shared secret configured
  // even on a failure path, since the callback route always signs SOME
  // response -- see the dedicated "signing itself fails closed" test
  // below for the secret-unconfigured case specifically.
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const fields = await callbackRedirectFields(base, "code=x&state=never-existed&guild_id=111111111111111111");
      assert.equal(fields.ok, "false");
      assert.equal(fields.reason, "expired");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// ─── Layer 2 audit finding, CRITICAL: signing itself must fail closed when
// MENTAT_PROXY_SHARED_SECRET is unconfigured -- an empty secret would
// otherwise make BOTH mentat and mentat-link derive the same publicly-
// computable key, letting anyone forge a validly-"signed" redirect ───────

test("when MENTAT_PROXY_SHARED_SECRET is unconfigured, /callback returns a plain 503 error -- never a redirect signed with a predictable key", async () => {
  delete process.env.MENTAT_PROXY_SHARED_SECRET;
  await withAutoInviteApp({}, async (base) => {
    const res = await fetch(`${base}/api/consoles/auto-invite/callback?code=x&state=never-existed&guild_id=111111111111111111`, { redirect: "manual" });
    assert.equal(res.status, 503, "must fail closed with a plain error, not a 302 signed with a known, predictable key");
    assert.equal(res.headers.get("location"), null, "must never issue a redirect at all in this state");
  });
});

// ─── Every terminal path deletes the session, including discord_unreachable
// (issue #836's round-2 correction) ────────────────────────────────────────

test("operator-cancelled path (error=access_denied) consumes the session -- a subsequent replay also gets 'expired', not a stale 'denied'", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({}, async (base) => {
      const startRes = await startSession(base);
      const { state } = await startRes.json();

      const cancelled = await callbackRedirectFields(base, `state=${state}&error=access_denied`);
      assert.equal(cancelled.ok, "false");
      assert.equal(cancelled.reason, "denied");

      const replay = await callbackRedirectFields(base, `state=${state}&error=access_denied`);
      assert.equal(replay.reason, "expired");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("ownership-check-failed path (token proves ownership of a DIFFERENT guild) is rejected as not_owner and consumes the session", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({ fetchStubOpts: { ownedGuildId: "222222222222222222" } }, async (base) => {
      const startRes = await startSession(base);
      const { state } = await startRes.json();

      // Requests guild 111... but the token's own /users/@me/guilds only
      // proves ownership of 222... -- the exact session-fixation/guild-hijack
      // shape this whole gate exists to reject.
      const fields = await callbackRedirectFields(base, `code=x&state=${state}&guild_id=111111111111111111`);
      assert.equal(fields.ok, "false");
      assert.equal(fields.reason, "not_owner");

      const replay = await callbackRedirectFields(base, `code=x&state=${state}&guild_id=111111111111111111`);
      assert.equal(replay.reason, "expired");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("discord_unreachable path (token exchange fails) consumes the session too -- round-2 correction, this path must not be left un-deleted", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  try {
    await withAutoInviteApp({ fetchStubOpts: { tokenOk: false } }, async (base) => {
      const startRes = await startSession(base);
      const { state } = await startRes.json();

      const fields = await callbackRedirectFields(base, `code=x&state=${state}&guild_id=111111111111111111`);
      assert.equal(fields.ok, "false");
      assert.equal(fields.reason, "discord_unreachable");

      const replay = await callbackRedirectFields(base, `code=x&state=${state}&guild_id=111111111111111111`);
      assert.equal(replay.reason, "expired");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("global rate limit on /auto-invite/start returns 429 with Retry-After once exhausted", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  // globalMax: 2 -- recordBucket() blocks starting from the attempt that
  // reaches maxAttempts itself (inclusive), so max:1 would block the very
  // FIRST call; max:2 is what actually produces "first succeeds, second
  // is blocked."
  resetConsoleRegistrationRateLimiterForTests({ globalMax: 2 });
  try {
    await withAutoInviteApp({}, async (base) => {
      const first = await startSession(base);
      assert.equal(first.status, 200);
      const second = await startSession(base);
      assert.equal(second.status, 429);
      assert.ok(second.headers.get("retry-after"));
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
    resetConsoleRegistrationRateLimiterForTests({});
  }
});

// ─── Layer 2 audit finding: a malformed JSON body must not bypass EITHER
// the fail-closed proxy-secret gate OR the global rate limiter (the exact
// bug class already fixed once for /api/consoles/register -- see
// consoleRegistration.test.js's own "still counts toward the global rate
// limit" tests) ──────────────────────────────────────────────────────────

test("a malformed-JSON POST to /auto-invite/start without the proxy secret is still rejected 403, not silently let through", async () => {
  delete process.env.MENTAT_PROXY_SHARED_SECRET;
  await withAutoInviteApp({}, async (base) => {
    const res = await fetch(`${base}/api/consoles/auto-invite/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json"
    });
    assert.equal(res.status, 403, "a malformed body must not bypass the fail-closed proxy-secret gate");
  });
});

test("a malformed-JSON POST to /auto-invite/start (with a valid secret) returns 400, not 500, and still counts toward the global rate limit", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = PROXY_SECRET;
  resetConsoleRegistrationRateLimiterForTests({ globalMax: 2, globalWindow: 60_000, globalBlock: 60_000 });
  try {
    await withAutoInviteApp({}, async (base) => {
      const first = await fetch(`${base}/api/consoles/auto-invite/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mentat-proxy-secret": PROXY_SECRET },
        body: "{not valid json"
      });
      assert.equal(first.status, 400, "a malformed body must fail normal validation with 400, not crash with a 500");

      // globalMax is 2: if the first (malformed-body) request had NOT been
      // recorded by the global rate limiter (the bug this test guards
      // against), this second, well-formed request would still see count=1
      // and succeed (200, not 429). Seeing 429 here proves the first
      // request really was counted.
      const second = await startSession(base);
      assert.equal(second.status, 429, "the first (malformed-body) request must have incremented the global rate-limit bucket");
    });
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
    resetConsoleRegistrationRateLimiterForTests({});
  }
});
