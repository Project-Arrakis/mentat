// actorSignature.js -- bot-side counterpart to Core's
// console/api/src/integrations/discord/actorSignature.js
// (dune-awakening-selfhost-docker, FINDING-LINK-1).
//
// Core's adapter accepts an OPTIONAL, opt-in HMAC signature over each
// request's actor object, distinct from the transport bearer token.
// Without it, the bearer token alone is a "master credential" -- anyone
// holding it can claim to be any Discord user with any role, since
// actor.userId/roleIds/etc. are otherwise unauthenticated JSON body
// claims (see docs/security/discord-player-link-hardening.md in Core).
//
// This bot has NEVER sent this signature (confirmed 2026-07-26 --
// zero references anywhere in this repo before this file), which is
// exactly why Core's verification defaults to opt-in: making it
// mandatory on Core's side before this existed would have broken every
// real request from this bot immediately. This file is step 1 of 2 --
// bot-side signing, deployed and verified working FIRST, before Core's
// default is ever flipped to mandatory in a separate change.
//
// MUST compute a byte-identical signature to Core's
// canonicalActorSignaturePayload()/signActorPayload() -- both sides use
// the same algorithm independently (this repo cannot import Core's
// module directly; they are separate deployments). Keep this file in
// sync with actorSignature.js in dune-awakening-selfhost-docker if that
// algorithm ever changes -- a mismatch here means every real, legitimate
// request fails signature verification the moment Core requires it.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const SIGNATURE_HEADER = "x-dune-actor-signature";
const TIMESTAMP_HEADER = "x-dune-actor-timestamp";

// Must match Core's SIGNED_ACTOR_FIELDS exactly, same order. This is the
// default field set for the shared/generic routes (link, verify, unlink) --
// the write bridge's own two routes use WRITE_BRIDGE_SIGNED_ACTOR_FIELDS
// below instead, passed explicitly.
const SIGNED_ACTOR_FIELDS = ["userId", "guildId", "channelId", "roleIds", "interactionId"];

// CRITICAL FIX: must match Core's WRITE_BRIDGE_SIGNED_ACTOR_FIELDS exactly
// (console/api/src/integrations/discord/actorSignature.js) -- same fields,
// same order, including trailing "action". Before this export existed,
// writeExecute()/writePreview() (adapterClient.js) signed with the generic
// SIGNED_ACTOR_FIELDS above via the plain signedHeaders() helper, which is
// a COMPLETELY DIFFERENT field set than what Core's write/preview and
// write/execute routes verify against -- every real write-bridge call would
// fail with invalid_actor_signature (403) the moment DUNE_DISCORD_ACTOR_SECRET
// was configured on both sides (a required prerequisite for the write
// bridge to work at all, since Core's verification is `required: true` for
// these two routes specifically, not opt-in like every other route).
// Verified directly: computing both sides' canonical strings for the same
// (actor, timestamp, route) with the old scheme produced two completely
// different strings.
//
// `action` is included specifically because write/preview and write/execute
// are the SAME route for every action -- without it, a captured,
// legitimately-signed envelope could be replayed with a different
// action/params within the freshness window and still verify.
//
// CRITICAL FIX (issue #1070/Core's own issue #1070, closes a live drift
// found the hard way -- test/actorSignature.test.js's own live cross-repo
// check silently no-op'd for months because this machine had no sibling
// Core checkout at the hardcoded path it originally used, so this array
// falling out of sync with Core's real WRITE_BRIDGE_SIGNED_ACTOR_FIELDS
// went undetected): `params` was missing here even though Core's route
// handler has signed it for a while now. Without it, every real
// write/preview and write/execute request from this bot fails
// verification outright once DUNE_DISCORD_ACTOR_SECRET is configured on
// both sides (which it is in production -- confirmed on the bot VM) --
// this is not a narrow gap, it silently breaks the entire write-command
// bridge. Beyond the functional break, omitting `params` from the SIGNED
// payload is itself the vulnerability Core's fix closed: an attacker
// positioned to observe (not forge) one legitimately-signed write/preview
// envelope could replay it with different params substituted and still
// pass verification, since nothing about the signed payload depended on
// params. See Core's actorSignature.js for the full writeup.
export const WRITE_BRIDGE_SIGNED_ACTOR_FIELDS = ["userId", "username", "roleIds", "guildId", "channelId", "roleSnapshotAt", "action", "params"];

export function actorSignatureSecret(env = process.env) {
  const direct = env.DUNE_DISCORD_ACTOR_SECRET || "";
  if (direct) return String(direct).trim();
  const file = env.DUNE_DISCORD_ACTOR_SECRET_FILE || "";
  if (!file) return "";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

// Deep, key-sorted canonicalization for an object-valued signed field (used
// by `params`, the write bridge's only object-typed field) -- ported
// verbatim from Core's own canonicalizeValue(), including its issue #1073
// prototype-pollution fix. Plain `String(value)` on an object collapses
// every distinct object to the literal string "[object Object]", which
// would make signing an object field a complete no-op (every possible
// params payload would canonicalize identically, defeating the whole point
// of including it). Object keys are sorted recursively so the same logical
// params object signs identically regardless of property insertion order;
// array ELEMENT order is preserved as-is (a params array's order can be
// semantically meaningful, unlike roleIds's own deliberate sort-as-a-set
// behavior below).
//
// `sorted` must NOT be a plain `{}` -- JSON.parse creates a "__proto__" key
// as a real own enumerable property (CreateDataProperty, not [[Set]]), so a
// params object with a literal "__proto__" key genuinely has it in
// Object.keys(value). But a plain object literal inherits Object.prototype's
// own "__proto__" ACCESSOR, so `sorted[key] = ...` for that one key would
// invoke the inherited setter instead of creating an own property --
// silently dropping that key (and its whole subtree) from the canonical
// string that gets signed, while it remains a real own property everywhere
// else params is read. Object.create(null) has no prototype at all, so
// every key -- including "__proto__" -- is an ordinary own-property
// assignment here, at every nesting depth via this same recursive call.
function canonicalizeValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === "object") {
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalizeValue(value[key]);
    return sorted;
  }
  return value;
}

// Must match Core's canonicalActorSignaturePayload() exactly -- same
// field order, same array-sort/stringify behavior, same delimiter shape.
// `fields` defaults to the shared array for backward compatibility with
// every existing caller; the write bridge passes WRITE_BRIDGE_SIGNED_ACTOR_FIELDS
// explicitly, matching Core's own canonicalActorSignaturePayload() signature.
export function canonicalActorSignaturePayload(actorPayload = {}, timestamp, route = "", fields = SIGNED_ACTOR_FIELDS) {
  const canonical = {};
  for (const key of fields) {
    const value = actorPayload?.[key];
    if (Array.isArray(value)) {
      canonical[key] = [...value].map(String).sort();
    } else if (value && typeof value === "object") {
      canonical[key] = canonicalizeValue(value);
    } else {
      canonical[key] = String(value ?? "");
    }
  }
  return `${timestamp}.${String(route)}.${JSON.stringify(canonical)}`;
}

export function signActorPayload(actorPayload, secret, timestamp = Math.floor(Date.now() / 1000), route = "", fields = SIGNED_ACTOR_FIELDS) {
  const message = canonicalActorSignaturePayload(actorPayload, timestamp, route, fields);
  const signature = createHmac("sha256", String(secret)).update(message).digest("hex");
  return { signature, timestamp };
}

// signedHeaders: returns the two headers to attach to a request, or an
// empty object if no secret is configured (this bot then sends an
// unsigned request, exactly as it always has -- Core's opt-in
// verification no-ops in that case, so this is fully backward
// compatible with any deployment that hasn't configured
// DUNE_DISCORD_ACTOR_SECRET yet).
//
// `route` MUST be the full adapter path (e.g.
// "/api/integrations/discord/players/link"), matching exactly what
// Core's routes.js passes as `route: path` to verifyActorSignature() --
// NOT this bot's internal route key (e.g. "players-link"). Passing the
// wrong value here means every signed request fails verification.
export function signedHeaders(actorPayload, route, env = process.env) {
  const secret = actorSignatureSecret(env);
  if (!secret) return {};
  const { signature, timestamp } = signActorPayload(actorPayload, secret, Math.floor(Date.now() / 1000), route);
  return {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: String(timestamp)
  };
}

// Write-bridge-specific counterpart to signedHeaders(): signs with
// WRITE_BRIDGE_SIGNED_ACTOR_FIELDS (matching Core's write/preview and
// write/execute verification) instead of the generic SIGNED_ACTOR_FIELDS,
// and merges `action`/`params` into the signed payload -- both live
// alongside `actor` in the request body, not inside actorPayload itself,
// so they must be merged in here rather than expected to already be
// properties of the actor object. `route` MUST be the full adapter path
// (e.g. "/api/integrations/discord/write/preview"), same requirement as
// signedHeaders() above. `params` is optional (write/execute's own request
// body carries none of significance beyond the nonce -- see Core's own
// comment on WRITE_BRIDGE_SIGNED_ACTOR_FIELDS) and defaults to undefined,
// which canonicalizes identically on both sides via the same `String(value
// ?? "")` fallback every other unset field already uses.
export function writeBridgeSignedHeaders(actorPayload, route, action, params, env = process.env) {
  const secret = actorSignatureSecret(env);
  if (!secret) return {};
  const { signature, timestamp } = signActorPayload(
    { ...actorPayload, action, params },
    secret,
    Math.floor(Date.now() / 1000),
    route,
    WRITE_BRIDGE_SIGNED_ACTOR_FIELDS
  );
  return {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: String(timestamp)
  };
}

export const ACTOR_SIGNATURE_HEADER = SIGNATURE_HEADER;
export const ACTOR_TIMESTAMP_HEADER = TIMESTAMP_HEADER;
