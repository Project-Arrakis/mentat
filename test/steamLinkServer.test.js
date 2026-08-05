import assert from "node:assert/strict";
import { test } from "node:test";
import { createSteamLinkServer } from "../src/steamLinkServer.js";
import {
  createSteamLinkSession,
  resetSteamLinkStoreForTests,
  debugPeekSteamLinkSession
} from "../src/steamLinkStore.js";
import { resetSteamLinkRateLimiterForTests } from "../src/steamLinkRateLimit.js";

const BASE_CONFIG = {
  discord: { clientId: "test-client-id", clientSecret: "test-client-secret" },
  steamLink: { baseUrl: "http://127.0.0.1:0", enabled: true }
};

function baseSessionArgs(overrides = {}) {
  return {
    discordUserId: "user-1",
    username: "TestUser",
    guildId: "guild-1",
    channelId: "channel-1",
    roleIds: ["observer-role-id"],
    interactionToken: "token-1",
    commandInteractionId: "interaction-1",
    playerControllerId: "pc-1",
    characterName: "TestCharacter",
    ...overrides
  };
}

function makeMockAdapterClient(overrides = {}) {
  return {
    // linkAccountViaSteam is a SINGLE call doing match+link together (see
    // adapterClient.js's own comment) -- there is no separate
    // matchSteamCandidate() call/route.
    async linkAccountViaSteam() {
      return { ok: true, matched: true, accounts: [{ player_controller_id: "pc-1", character_name: "TestCharacter" }] };
    },
    // playerLink() (not playerLinkStart()) is the correct whisper-fallback
    // method -- see steamLinkServer.js's sendWhisperFallbackAndRespond()
    // comment for why (playerLinkStart() hits Core's still-unmerged
    // player-links-start route).
    async playerLink() {
      return { ok: true, result: { linked: true, code: "ACP-TEST123" } };
    },
    ...overrides
  };
}

// makeFetchImpl: routes fetch calls to canned Discord API responses by URL,
// so tests never make real network calls. `overrides` maps a URL substring
// to a function producing a Response-shaped object.
function makeFetchImpl(overrides = {}) {
  return async (url) => {
    const urlString = String(url);
    for (const [match, handler] of Object.entries(overrides)) {
      if (urlString.includes(match)) return handler(urlString);
    }
    throw new Error(`Unhandled fetch in test: ${urlString}`);
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function defaultFetchOverrides(overrides = {}) {
  return {
    "oauth2/token": () => jsonResponse(200, { access_token: "fake-access-token" }),
    "users/@me/connections": () => jsonResponse(200, [{ type: "steam", id: "12345678901234567" }]),
    "users/@me": () => jsonResponse(200, { id: "user-1" }),
    "webhooks/": () => jsonResponse(200, {}),
    ...overrides
  };
}

async function withServer(fn, { adapterClient, fetchOverrides } = {}) {
  const app = createSteamLinkServer({
    config: BASE_CONFIG,
    adapterClient: adapterClient || makeMockAdapterClient(),
    client: { application: { id: "app-1" } },
    fetchImpl: makeFetchImpl(defaultFetchOverrides(fetchOverrides))
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

test.beforeEach(() => {
  resetSteamLinkStoreForTests();
  resetSteamLinkRateLimiterForTests();
});

test("GET /health reports the service and enabled flag", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.service, "acp-steam-link");
    assert.equal(body.enabled, true);
  });
});

test("GET /steam-link/start with an unknown state returns 400", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/start?state=does-not-exist`, { redirect: "manual" });
    assert.equal(res.status, 400);
  });
});

test("GET /steam-link/start with a valid state redirects to Discord's OAuth URL", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/start?state=${session.state}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(location.startsWith("https://discord.com/api/v10/oauth2/authorize"));
    assert.ok(location.includes(`state=${session.state}`));
    assert.ok(location.includes("scope=identify+connections"));
  });
});

test("GET /steam-link/callback with an unknown/expired state returns 400", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=does-not-exist&code=abc`);
    assert.equal(res.status, 400);
  });
});

test("GET /steam-link/callback is single-use: a replayed state on the second request is rejected (FINDING-STEAM-1)", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    assert.equal(second.status, 400);
  });
});

test("GET /steam-link/callback rejects when the completing Discord user does not match the session's user (FINDING-STEAM-7)", async () => {
  const session = createSteamLinkSession(baseSessionArgs({ discordUserId: "user-1" }));
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    const body = await res.text();
    assert.equal(res.status, 403);
    assert.ok(body.includes("Account Mismatch"));
  }, {
    fetchOverrides: {
      "users/@me": () => jsonResponse(200, { id: "a-completely-different-user" })
    }
  });
});

test("GET /steam-link/callback succeeds when the completing user matches the session's user", async () => {
  const session = createSteamLinkSession(baseSessionArgs({ discordUserId: "user-1" }));
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes("Linked!"));
  }, {
    fetchOverrides: {
      "users/@me": () => jsonResponse(200, { id: "user-1" })
    }
  });
});

// FIX (2026-07-27, found via a real live report): re-linking a
// character already linked via Steam-link showed the identical
// "🔗 Character Linked" success message as a genuine fresh link, with no
// indication that nothing new actually happened -- Core's
// linkAccountViaSteamProvider() short-circuits this case with
// { alreadyLinked: true, matched: true }, but this code path never
// checked that field before this fix, always rendering the same
// generic "Linked!" page regardless. This exact gap -- a real function
// with a real, live user-facing bug -- had ZERO test coverage before
// this fix, for either the Discord embed content or this response
// page's text, which is exactly why it shipped unnoticed. This test
// closes that gap directly, following the same real-server pattern
// already used by every other test in this file.
test("GET /steam-link/callback shows an 'Already Linked' page, not the generic 'Linked!' page, when Core reports alreadyLinked: true", async () => {
  const session = createSteamLinkSession(baseSessionArgs({ discordUserId: "user-1" }));
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes("Already Linked"), "should show a distinct page for an already-linked re-link");
    assert.ok(!body.includes("Linked!"), "must not show the generic fresh-link success text");
  }, {
    adapterClient: makeMockAdapterClient({
      async linkAccountViaSteam() {
        return { ok: true, matched: true, alreadyLinked: true, accounts: [{ player_controller_id: "pc-1", character_name: "Sihaya" }] };
      }
    }),
    fetchOverrides: {
      "users/@me": () => jsonResponse(200, { id: "user-1" })
    }
  });
});

test("GET /steam-link/callback's actor object sent to Core includes username/channelId/roleIds, not just userId/guildId (regression, real bug found 2026-07-26)", async () => {
  // Core's normalizeDiscordActor() hard-requires username and channelId
  // on EVERY actor object -- an actor built with only userId/guildId
  // (this file's shape before this fix) always failed with a real 400
  // "actor.username is required" error on every genuine link-steam
  // attempt in production. This test asserts the full actor shape is
  // forwarded, so this specific regression can't silently reappear.
  const session = createSteamLinkSession(baseSessionArgs({
    discordUserId: "user-1",
    username: "RealDiscordUsername",
    channelId: "real-channel-id",
    roleIds: ["real-role-id"]
  }));
  let receivedActor = null;
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    assert.equal(res.status, 200);
    assert.ok(receivedActor, "linkAccountViaSteam should have been called");
    assert.equal(receivedActor.userId, "user-1");
    assert.equal(receivedActor.username, "RealDiscordUsername");
    assert.equal(receivedActor.guildId, "guild-1");
    assert.equal(receivedActor.channelId, "real-channel-id");
    assert.deepEqual(receivedActor.roleIds, ["real-role-id"]);
  }, {
    adapterClient: makeMockAdapterClient({
      async linkAccountViaSteam(actor) {
        receivedActor = actor;
        return { ok: true, matched: true, accounts: [{ player_controller_id: "pc-1", character_name: "TestCharacter" }] };
      }
    }),
    fetchOverrides: {
      "users/@me": () => jsonResponse(200, { id: "user-1" })
    }
  });
});

test("GET /steam-link/callback with error=access_denied falls back to the whisper flow", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  let whisperCalled = false;
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&error=access_denied`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes("Linking Cancelled"));
    assert.equal(whisperCalled, true);
  }, {
    adapterClient: makeMockAdapterClient({
      async playerLink() {
        whisperCalled = true;
        return { ok: true, result: { linked: true, code: "ACP-TEST123" } };
      }
    })
  });
});

test("GET /steam-link/callback with no Steam match falls back to the whisper flow", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes("Sent a Verification Code Instead"));
  }, {
    adapterClient: makeMockAdapterClient({
      async linkAccountViaSteam() {
        return { ok: false, matched: false };
      }
    })
  });
});

test("GET /steam-link/callback returns 409 without a whisper fallback when the character is already linked to another account", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  let whisperCalled = false;
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    const body = await res.text();
    assert.equal(res.status, 409);
    assert.ok(body.includes("already linked to a different Discord account"));
    assert.equal(whisperCalled, false);
  }, {
    adapterClient: makeMockAdapterClient({
      async linkAccountViaSteam() {
        // Real shape of an AdapterHttpError from a Core 409 conflict
        // response (see adapterClient.js's AdapterHttpError class and
        // Core's discordSafeError() serialization) -- .status and .body,
        // not .statusCode/.code, which belong to Core's OWN internal
        // error object before it's serialized into the HTTP response body.
        const err = new Error("Adapter players-accounts-link-steam returned HTTP 409.");
        err.status = 409;
        err.body = { ok: false, code: "character_already_linked", error: "This character is already linked to a different Discord account." };
        throw err;
      },
      async playerLink() {
        whisperCalled = true;
        return { ok: true };
      }
    })
  });
});

test("GET /steam-link/callback missing code returns 400", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}`);
    assert.equal(res.status, 400);
  });
});

test("rate limiting: /steam-link/start blocks after repeated attempts with the same state (FINDING-STEAM-4)", async () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 3 });
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    let lastStatus;
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`${baseUrl}/steam-link/start?state=${session.state}`, { redirect: "manual" });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  });
});

test("rate limiting: /steam-link/start and /steam-link/callback share one attempt budget per state", async () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 2 });
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/steam-link/start?state=${session.state}`, { redirect: "manual" });
    const res = await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    assert.equal(res.status, 429);
  });
});

test("rate limiting: a different state's attempts are not affected by another state's block", async () => {
  resetSteamLinkRateLimiterForTests({ maxAttempts: 2 });
  const sessionA = createSteamLinkSession(baseSessionArgs());
  const sessionB = createSteamLinkSession(baseSessionArgs({ playerControllerId: "pc-2" }));
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/steam-link/start?state=${sessionA.state}`, { redirect: "manual" });
    await fetch(`${baseUrl}/steam-link/start?state=${sessionA.state}`, { redirect: "manual" });
    const blockedRes = await fetch(`${baseUrl}/steam-link/start?state=${sessionA.state}`, { redirect: "manual" });
    assert.equal(blockedRes.status, 429);

    const otherRes = await fetch(`${baseUrl}/steam-link/start?state=${sessionB.state}`, { redirect: "manual" });
    assert.equal(otherRes.status, 302);
  });
});

test("the OAuth access token is never persisted onto the session object (FINDING-STEAM-6)", async () => {
  const session = createSteamLinkSession(baseSessionArgs());
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/steam-link/callback?state=${session.state}&code=abc`);
    const peeked = debugPeekSteamLinkSession(session.state);
    const serialized = JSON.stringify(peeked);
    assert.ok(!serialized.includes("fake-access-token"));
  });
});
