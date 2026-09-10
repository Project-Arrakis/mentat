// autoInvite.js -- mentat-side staging logic for the hosted-bot auto-invite
// flow (mentat#343, Phase 1 of dune-awakening-selfhost-docker#832's design,
// docs/design/hosted-bot-auto-invite-and-role-picker-l1-design-2026-09-10.md
// §4.1/§4.4). Two responsibilities:
//   - stageAutoInviteSession(): POST /auto-invite/start's business logic --
//     mint an opaque state, remember {consoleUrl, adapterToken} against it.
//   - handleAutoInviteCallback(): GET /auto-invite/callback's business
//     logic -- consume the staged session, exchange Discord's authorization
//     code, independently re-verify guild ownership (reusing
//     consoleRegistration.js's verifyGuildOwnership(), NOT a re-derived
//     copy of that logic), and stage a pendingOwnerConfirmation record.
//
// This file deliberately never calls upsertGuild() -- that only happens
// from the owner-confirmation gate (Phase 2, tracked separately), on an
// explicit Confirm interaction. A pending, unconfirmed record is the most
// this file's own success path ever produces.
import { randomBytes } from "node:crypto";
import {
  createAutoInviteSession,
  getAutoInviteSession,
  deleteAutoInviteSession,
  createPendingOwnerConfirmation
} from "./database.js";
import { verifyGuildOwnership } from "./consoleRegistration.js";
import { logInfo, logError } from "./logger.js";

const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_FETCH_TIMEOUT_MS = 10000;

export function stageAutoInviteSession({ consoleUrl, adapterToken }) {
  const state = randomBytes(16).toString("hex");
  createAutoInviteSession({ state, consoleUrl, adapterToken });
  return state;
}

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(DISCORD_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.access_token === "string" && body.access_token.length > 0 ? body.access_token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// handleAutoInviteCallback: the full accept/reject/stage decision for
// GET /auto-invite/callback. Returns a discriminated result:
//   { ok: true, state, guildId, guildName, confirmationId }
//   { ok: false, reason, state }
// `reason` matches the design doc's own §4.2 vocabulary where a direct
// mapping exists (denied, not_owner, expired, discord_unreachable);
// verifyGuildOwnership()'s other, rarer failure reasons (malformed_token,
// invalid_token, rate_limited) are passed through unchanged rather than
// forced into that vocabulary, since the design doc doesn't enumerate
// them for this specific route and collapsing them would lose real
// diagnostic information.
//
// Every branch past the initial session lookup deletes the auto-invite
// session -- design doc issue #836, no path (including
// discord_unreachable) may leave it lingering for a replay attempt.
export async function handleAutoInviteCallback(
  { code, state, guildId, error },
  { clientId, clientSecret, redirectUri, fetchImpl = globalThis.fetch, timeoutMs = DISCORD_FETCH_TIMEOUT_MS } = {}
) {
  const session = getAutoInviteSession(state);
  if (!session) {
    // Fails CLOSED -- never falls through to a "trust it anyway" path
    // (design doc §4.2 Path C). Nothing to delete; it was already
    // missing/expired/already-consumed.
    return { ok: false, reason: "expired", state };
  }

  // Layer 2 audit finding (mentat#343): deleting the session only after
  // the async token-exchange/ownership-verification calls below left a
  // real TOCTOU window -- two near-simultaneous requests for the same
  // `state` could both pass the getAutoInviteSession() read above before
  // either await point ran, both proceeding to call Discord concurrently.
  // Deleting synchronously, immediately after the read and before ANY
  // `await`, makes the read-then-consume atomic with respect to Node's
  // single-threaded event loop -- no other request can interleave between
  // this line and the read two lines up. Every branch below already has
  // everything it needs from the local `session` object.
  deleteAutoInviteSession(state);

  if (error) {
    // Path A -- operator cancelled on Discord's own consent screen.
    return { ok: false, reason: "denied", state };
  }

  if (typeof code !== "string" || code.length === 0 || typeof guildId !== "string" || guildId.length === 0) {
    return { ok: false, reason: "invalid_callback", state };
  }

  const accessToken = await exchangeCodeForToken({ code, clientId, clientSecret, redirectUri, fetchImpl, timeoutMs });
  if (!accessToken) {
    logError("auto_invite.discord_unreachable", new Error("token exchange failed"), { state });
    return { ok: false, reason: "discord_unreachable", state };
  }

  const verification = await verifyGuildOwnership({ guildId, discordAccessToken: accessToken }, { fetchImpl, timeoutMs });

  if (!verification.ok) {
    const reason = verification.reason === "guild_not_owned" ? "not_owner" : verification.reason;
    return { ok: false, reason, state };
  }

  const confirmationId = randomBytes(16).toString("hex");
  createPendingOwnerConfirmation({
    confirmationId,
    guildId,
    guildName: verification.matchedGuild.name,
    consoleUrl: session.console_url,
    adapterToken: session.adapter_token,
    ownerId: verification.discordUserId
  });

  logInfo("auto_invite.pending_owner_confirmation_staged", { guildId, confirmationId });

  return {
    ok: true,
    state,
    guildId,
    guildName: verification.matchedGuild.name,
    confirmationId
  };
}
