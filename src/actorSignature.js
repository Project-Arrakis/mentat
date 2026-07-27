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

// Must match Core's SIGNED_ACTOR_FIELDS exactly, same order.
const SIGNED_ACTOR_FIELDS = ["userId", "guildId", "channelId", "roleIds", "interactionId"];

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

// Must match Core's canonicalActorSignaturePayload() exactly -- same
// field order, same array-sort/stringify behavior, same delimiter shape.
export function canonicalActorSignaturePayload(actorPayload = {}, timestamp, route = "") {
  const fields = {};
  for (const key of SIGNED_ACTOR_FIELDS) {
    const value = actorPayload?.[key];
    fields[key] = Array.isArray(value) ? [...value].map(String).sort() : String(value ?? "");
  }
  return `${timestamp}.${String(route)}.${JSON.stringify(fields)}`;
}

export function signActorPayload(actorPayload, secret, timestamp = Math.floor(Date.now() / 1000), route = "") {
  const message = canonicalActorSignaturePayload(actorPayload, timestamp, route);
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

export const ACTOR_SIGNATURE_HEADER = SIGNATURE_HEADER;
export const ACTOR_TIMESTAMP_HEADER = TIMESTAMP_HEADER;
