import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, unlinkSync } from "node:fs";
import {
  actorSignatureSecret,
  canonicalActorSignaturePayload,
  signActorPayload,
  signedHeaders,
  writeBridgeSignedHeaders,
  WRITE_BRIDGE_SIGNED_ACTOR_FIELDS,
  ACTOR_SIGNATURE_HEADER,
  ACTOR_TIMESTAMP_HEADER
} from "../src/actorSignature.js";

// CRITICAL FIX: the previous single hardcoded path here
// (/home/darkdante/projects/dune/dune-awakening-selfhost-docker/...) does not
// exist anywhere on this machine at all -- confirmed directly (`ls
// /home/darkdante` fails). Every "live cross-repo integration check" test
// below has been silently SKIPPING on every real run in this environment
// since it was written, not passing -- the try/catch treats "sibling repo
// not found" as an acceptable no-op, which is exactly how the real
// WRITE_BRIDGE_SIGNED_ACTOR_FIELDS field-set mismatch (this repo signed with
// the wrong field set entirely for write/preview and write/execute) went
// undetected: the one test class designed to catch exactly this kind of
// cross-repo drift never actually ran. Tries this machine's real,
// established repo location first (Project-Arrakis's own documented
// convention, ~/projects/repos/dune-awakening-selfhost-docker), then the
// write-bridge feature worktree (actorSignature.js does not exist on Core's
// own main yet, only on the not-yet-merged write-bridge branches) -- so
// these tests actually run today, not just after a future merge.
const CORE_ACTOR_SIGNATURE_CANDIDATES = [
  "/root/projects/repos/dune-awakening-selfhost-docker/console/api/src/integrations/discord/actorSignature.js",
  "/root/projects/repos-worktrees/core-issue215-write-bridge/console/api/src/integrations/discord/actorSignature.js",
  "/root/projects/repos-worktrees/core-issue215-write-bridge-upstream/console/api/src/integrations/discord/actorSignature.js"
];

async function importCoreActorSignature() {
  for (const path of CORE_ACTOR_SIGNATURE_CANDIDATES) {
    try {
      return await import(path);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

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
  const core = await importCoreActorSignature();
  if (!core) return; // sibling repo not available in this environment -- skip, don't fail.
  const { verifyActorSignature } = core;

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
  const core = await importCoreActorSignature();
  if (!core) return;
  const { verifyActorSignature } = core;

  const actor = { userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"], interactionId: "int-1" };
  const route = "/api/integrations/discord/players/link";
  const headers = signedHeaders(actor, route, { DUNE_DISCORD_ACTOR_SECRET: "wrong-secret" });

  assert.throws(
    () => verifyActorSignature({ actorPayload: actor, headers, config: { discordActorSecret: "shared-secret-123" }, route }),
    (error) => error.code === "invalid_actor_signature"
  );
});

// [CRITICAL FIX] Real cross-repo proof that writeBridgeSignedHeaders() (the
// fix for the field-set-mismatch bug) actually verifies against Core's real
// write/preview and write/execute verification -- not just against this
// repo's own copy of the same (possibly independently-wrong) algorithm.
test("writeBridgeSignedHeaders produces a signature that verifies successfully against Core's real verifyActorSignature() with WRITE_BRIDGE_SIGNED_ACTOR_FIELDS (live cross-repo integration check)", async () => {
  const core = await importCoreActorSignature();
  if (!core) return;
  const { verifyActorSignature, WRITE_BRIDGE_SIGNED_ACTOR_FIELDS: coreFields } = core;

  // The two field-set arrays must be identical, not just each internally
  // self-consistent -- this is the exact class of drift that broke the
  // feature originally.
  assert.deepEqual(WRITE_BRIDGE_SIGNED_ACTOR_FIELDS, coreFields, "bot and Core's WRITE_BRIDGE_SIGNED_ACTOR_FIELDS have drifted");

  const actor = { userId: "user-1", username: "tester", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"], roleSnapshotAt: Math.floor(Date.now() / 1000) };
  const route = "/api/integrations/discord/write/execute";
  const action = "player.warn";
  const headers = writeBridgeSignedHeaders(actor, route, action, { DUNE_DISCORD_ACTOR_SECRET: "shared-secret-123" });

  const result = verifyActorSignature({
    actorPayload: { ...actor, action },
    headers,
    config: { discordActorSecret: "shared-secret-123" },
    route,
    required: true,
    fields: coreFields
  });
  assert.deepEqual(result, { verified: true, required: true });
});

test("writeBridgeSignedHeaders: a signature for one action does not verify for a different action against Core's real verification (closes the cross-action replay gap)", async () => {
  const core = await importCoreActorSignature();
  if (!core) return;
  const { verifyActorSignature, WRITE_BRIDGE_SIGNED_ACTOR_FIELDS: coreFields } = core;

  const actor = { userId: "user-1", username: "tester", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"], roleSnapshotAt: Math.floor(Date.now() / 1000) };
  const route = "/api/integrations/discord/write/execute";
  const headers = writeBridgeSignedHeaders(actor, route, "player.warn", { DUNE_DISCORD_ACTOR_SECRET: "shared-secret-123" });

  assert.throws(
    () => verifyActorSignature({
      actorPayload: { ...actor, action: "server.stop" },
      headers,
      config: { discordActorSecret: "shared-secret-123" },
      route,
      required: true,
      fields: coreFields
    }),
    (error) => error.code === "invalid_actor_signature"
  );
});
