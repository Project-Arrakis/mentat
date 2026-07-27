import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, unlinkSync } from "node:fs";
import {
  actorSignatureSecret,
  canonicalActorSignaturePayload,
  signActorPayload,
  signedHeaders,
  ACTOR_SIGNATURE_HEADER,
  ACTOR_TIMESTAMP_HEADER
} from "../src/actorSignature.js";

test("actorSignatureSecret reads from DUNE_DISCORD_ACTOR_SECRET", () => {
  assert.equal(actorSignatureSecret({ DUNE_DISCORD_ACTOR_SECRET: "  my-secret  " }), "my-secret");
});

test("actorSignatureSecret reads from DUNE_DISCORD_ACTOR_SECRET_FILE when the direct env var is unset", () => {
  const tokenFile = "/tmp/actor-signature-secret-test.txt";
  writeFileSync(tokenFile, "file-secret\n");
  try {
    assert.equal(actorSignatureSecret({ DUNE_DISCORD_ACTOR_SECRET_FILE: tokenFile }), "file-secret");
  } finally {
    unlinkSync(tokenFile);
  }
});

test("actorSignatureSecret returns empty string when neither is configured (the default, backward-compatible state)", () => {
  assert.equal(actorSignatureSecret({}), "");
});

test("actorSignatureSecret returns empty string when DUNE_DISCORD_ACTOR_SECRET_FILE points at a nonexistent file", () => {
  assert.equal(actorSignatureSecret({ DUNE_DISCORD_ACTOR_SECRET_FILE: "/tmp/does-not-exist-actor-secret.txt" }), "");
});

test("canonicalActorSignaturePayload sorts roleIds so array ordering never changes the signed message", () => {
  const a = canonicalActorSignaturePayload({ userId: "u1", roleIds: ["role-b", "role-a"] }, 100, "/route");
  const b = canonicalActorSignaturePayload({ userId: "u1", roleIds: ["role-a", "role-b"] }, 100, "/route");
  assert.equal(a, b);
});

test("canonicalActorSignaturePayload only includes the fixed signed-field set, ignoring extra actor fields", () => {
  const withExtra = canonicalActorSignaturePayload({ userId: "u1", guildId: "g1", channelId: "c1", roleIds: [], interactionId: "i1", username: "should-be-ignored" }, 100, "/route");
  const withoutExtra = canonicalActorSignaturePayload({ userId: "u1", guildId: "g1", channelId: "c1", roleIds: [], interactionId: "i1" }, 100, "/route");
  assert.equal(withExtra, withoutExtra, "username is not a signed field and must not affect the canonical payload");
});

test("canonicalActorSignaturePayload changes when the route changes, even with identical actor fields", () => {
  const a = canonicalActorSignaturePayload({ userId: "u1" }, 100, "/route-a");
  const b = canonicalActorSignaturePayload({ userId: "u1" }, 100, "/route-b");
  assert.notEqual(a, b, "binding the route into the signature prevents cross-route replay of a captured envelope");
});

test("signActorPayload produces a signature byte-identical to a known-good vector (regression: prevents silent algorithm drift from Core's implementation)", () => {
  // This exact input/output pair was independently cross-checked against
  // dune-awakening-selfhost-docker's real actorSignature.js implementation
  // (2026-07-26) -- both sides produced this identical HMAC-SHA256 hex
  // digest for the same inputs. If this test ever fails after an edit to
  // this file, that edit broke bot/Core signature compatibility and every
  // real signed request will fail verification the moment Core requires
  // signing.
  const actor = { userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-b", "role-a"], interactionId: "int-1" };
  const result = signActorPayload(actor, "test-secret-shared-between-bot-and-core", 1234567890, "/api/integrations/discord/players/link");
  assert.equal(result.signature, "8bcca24f177cfd5f729bf9adf96cc5f7b1a31531eeddb23da000063cb6dcf524");
  assert.equal(result.timestamp, 1234567890);
});

test("signedHeaders returns empty object when no secret is configured (fully backward compatible -- unsigned requests keep working exactly as before)", () => {
  const headers = signedHeaders({ userId: "u1" }, "/route", {});
  assert.deepEqual(headers, {});
});

test("signedHeaders returns the two real headers when a secret is configured", () => {
  const headers = signedHeaders({ userId: "u1", guildId: "g1" }, "/api/integrations/discord/players/link", { DUNE_DISCORD_ACTOR_SECRET: "secret" });
  assert.ok(headers[ACTOR_SIGNATURE_HEADER], "should include the signature header");
  assert.ok(headers[ACTOR_TIMESTAMP_HEADER], "should include the timestamp header");
  assert.match(headers[ACTOR_SIGNATURE_HEADER], /^[0-9a-f]{64}$/, "signature should be a 64-char hex HMAC-SHA256 digest");
});

test("signedHeaders produces a signature that verifies successfully against Core's real verifyActorSignature() (live cross-repo integration check)", async () => {
  // This is not a mock -- it imports and calls the ACTUAL Core
  // implementation directly, proving the two independently-maintained
  // algorithms (this repo cannot import Core's module across repos) stay
  // byte-compatible. If dune-awakening-selfhost-docker's local clone is
  // unavailable in a given environment, this test is skipped rather than
  // failed, since it depends on a sibling repo being checked out locally.
  let verifyActorSignature;
  try {
    ({ verifyActorSignature } = await import("/home/darkdante/projects/dune/dune-awakening-selfhost-docker/console/api/src/integrations/discord/actorSignature.js"));
  } catch {
    return; // sibling repo not available in this environment -- skip, don't fail.
  }

  const actor = { userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"], interactionId: "int-1" };
  const route = "/api/integrations/discord/players/link";
  const headers = signedHeaders(actor, route, { DUNE_DISCORD_ACTOR_SECRET: "shared-secret-123" });

  const result = verifyActorSignature({
    actorPayload: actor,
    headers,
    config: { discordActorSecret: "shared-secret-123" },
    route
  });
  assert.deepEqual(result, { verified: true, required: true });
});

test("signedHeaders' signature is correctly rejected by Core's real verifyActorSignature() when the secrets differ", async () => {
  let verifyActorSignature;
  try {
    ({ verifyActorSignature } = await import("/home/darkdante/projects/dune/dune-awakening-selfhost-docker/console/api/src/integrations/discord/actorSignature.js"));
  } catch {
    return;
  }

  const actor = { userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"], interactionId: "int-1" };
  const route = "/api/integrations/discord/players/link";
  const headers = signedHeaders(actor, route, { DUNE_DISCORD_ACTOR_SECRET: "wrong-secret" });

  assert.throws(
    () => verifyActorSignature({ actorPayload: actor, headers, config: { discordActorSecret: "shared-secret-123" }, route }),
    (error) => error.code === "invalid_actor_signature"
  );
});
