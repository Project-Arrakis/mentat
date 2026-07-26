// steamLinkStore.js — state-token storage for the Discord-connections-based
// Steam linking verification path of /dune player link <character-name>.
// See docs/steam-link-architecture.md and docs/steam-link-security-review.md
// (FINDING-STEAM-1) for the full design and security rationale.
//
// Each session is scoped to ONE specific, already-named character
// (playerControllerId/characterName captured at /dune player link
// <character-name> time) -- this is NOT a list to resolve candidates
// from. See FINDING-STEAM-1/-2 for why binding the session to a single
// character up front, rather than resolving candidates after the OAuth
// callback, is a hard security requirement as well as a UX simplification.
//
// In-memory by default (a plain Map, matching cooldown.js's own module-level
// singleton pattern) so this works in single-tenant mode without requiring
// a SQLite db to be open at all. Every session is short-lived (10 minutes)
// and single-use, so in-memory-only storage is an accepted, documented
// limitation (matching Core's own login-rate-limiter precedent) — a lost
// session on process restart just means the player has to click the
// "Link via Steam" button again, which is a low-cost failure mode.

import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes, matching the Design doc's stated UX.
const MAX_SESSIONS = 5000; // Bounded growth guard — see pruneExpired().

const sessions = new Map();

// createSteamLinkSession: generates a new, single-use, expiring state token
// and stores the session data needed to (a) route the eventual callback
// back to the correct Discord interaction, and (b) resolve the Steam-ID
// match check against the ONE specific character this session is for.
// Matches setupServer.js's existing randomBytes(16).toString("hex")
// state-generation pattern exactly (128 bits, not a predictable value).
export function createSteamLinkSession({
  discordUserId, username, guildId, channelId, roleIds, interactionToken, commandInteractionId,
  playerControllerId, characterName, ttlMs = DEFAULT_TTL_MS
} = {}) {
  if (!discordUserId) throw new Error("discordUserId is required to create a Steam-link session.");
  if (!playerControllerId) throw new Error("playerControllerId is required to create a Steam-link session.");

  if (sessions.size >= MAX_SESSIONS) pruneExpired();

  const state = randomBytes(16).toString("hex");
  const now = Date.now();
  const session = {
    state,
    discordUserId: String(discordUserId),
    // username/channelId/roleIds: added 2026-07-26 after a real, live
    // bug -- every Core adapter call this module's callback handler makes
    // builds its own actor object, and Core's normalizeDiscordActor()
    // hard-requires username and channelId (not just userId/guildId).
    // Without these captured here at session-creation time (when they're
    // available from the real Discord interaction), the callback handler
    // has no way to reconstruct a valid actor after the OAuth redirect
    // round-trip -- every real link-steam call was guaranteed to fail
    // with a 400 "actor.username is required" error. roleIds matters too:
    // requireSelfScopedCapability() checks the actor's role tier, so an
    // actor with an empty roleIds list would be rejected as public tier
    // regardless of the real Discord user's actual roles.
    username: username ? String(username) : "unknown",
    guildId: guildId ? String(guildId) : null,
    channelId: channelId ? String(channelId) : null,
    roleIds: Array.isArray(roleIds) ? roleIds.map(String) : [],
    interactionToken: interactionToken || null,
    commandInteractionId: commandInteractionId || null,
    // The single character this session is scoped to (Security Review
    // FINDING-STEAM-1/-2) — the callback handler must resolve its
    // Steam-ID match check against THIS value only, never anything
    // client-supplied.
    playerControllerId: String(playerControllerId),
    characterName: characterName ? String(characterName) : null,
    createdAt: now,
    expiresAt: now + ttlMs,
    consumedAt: null
  };
  sessions.set(state, session);
  return session;
}

// getSteamLinkSession: read-only lookup, does NOT mark the session consumed.
// Returns undefined if the state is unknown or expired (expired sessions
// are treated as not-found, not returned-but-flagged, so callers can't
// accidentally skip the expiry check).
export function getSteamLinkSession(state) {
  const session = sessions.get(state);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(state);
    return undefined;
  }
  return session;
}

// consumeSteamLinkSession: atomically checks validity AND marks the session
// consumed in a single call, per FINDING-STEAM-1's single-use requirement.
// Returns the session on first successful use; returns undefined for an
// unknown, expired, or ALREADY-consumed state. There is no separate
// "check then mark" pair of calls anywhere in this module — that shape is
// exactly the race window FINDING-STEAM-1 warns against.
export function consumeSteamLinkSession(state) {
  const session = sessions.get(state);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(state);
    return undefined;
  }
  if (session.consumedAt) return undefined;
  session.consumedAt = Date.now();
  return session;
}

// pruneExpired: removes all expired sessions (consumed or not). Called
// opportunistically when the map grows large; not on a timer, matching
// cooldown.js's own lazy-pruning convention (pruneCooldownMap()).
export function pruneExpired() {
  const now = Date.now();
  for (const [state, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(state);
  }
}

// For tests only — resets all in-memory state between test cases.
export function resetSteamLinkStoreForTests() {
  sessions.clear();
}

// For tests only — direct read without expiry/consumed-state side effects,
// used to assert on internal session shape without going through the
// public get/consume functions.
export function debugPeekSteamLinkSession(state) {
  return sessions.get(state);
}
