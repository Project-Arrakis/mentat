// steamLinkServer.js — Express app implementing the Discord OAuth2
// "connections"-scope verification path for /dune player link
// <character-name>. This is offered automatically, server-side, only for
// characters that already have a Steam ID on file — see
// docs/steam-link-design.md, docs/steam-link-architecture.md, and
// docs/steam-link-security-review.md for the full design and the
// FINDING-STEAM-* items this implementation must satisfy.
//
// Started UNCONDITIONALLY in index.js (not gated behind config.multiTenant
// like setupServer.js is) — see docs/steam-link-architecture.md's
// Single-Tenant Deployment Note for why.
//
// NOTE ON CORE INTEGRATION: the actual matchSteamCandidate() /
// linkAccountViaSteam() adapter calls this module makes depend on new
// Core-side route(s) (/players/accounts/match-steam,
// /players/accounts/link-steam) that are tracked as UNMERGED_ROUTES in
// adapterClient.js pending a separate Core-repo PR (see
// docs/steam-link-implementation-prompt.md Part 1). Everything in THIS
// file that talks only to Discord's own API (state validation, token
// exchange, connections fetch) is fully independent of that and works
// today; only the callback's final match/link/fallback step will return
// the UNMERGED_ROUTES error until Core ships its half.
//
// Unlike the design's first revision, there is NO /steam-link/select
// route here — a session is always scoped to exactly one, already-named
// character (see steamLinkStore.js), so /steam-link/callback resolves
// directly to one of three outcomes (match, no-match, conflict) with
// nothing for the player to choose between.

import express from "express";
import { esc } from "./htmlEscape.js";
import {
  getSteamLinkSession,
  consumeSteamLinkSession
} from "./steamLinkStore.js";
import { logError } from "./logger.js";

const DISCORD_OAUTH_URL = "https://discord.com/api/v10/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_CONNECTIONS_URL = "https://discord.com/api/v10/users/@me/connections";
// Steam's SteamID64 identifiers are always 17 decimal digits. Discord's
// Connection Object `id` field is the raw platform account ID for a Steam
// connection (verified against
// https://discord.com/developers/docs/resources/user#connection-object-connection-structure,
// 2026-07-24 — see docs/steam-link-grc.md's Data-Drift section for the
// citation requirement this comment satisfies).
const STEAM_ID64_PATTERN = /^[0-9]{17}$/;

const PAGE_STYLE = `
  :root {
    --bg-deep: #0d0f12; --bg-board: #1a1510; --parchment: #f5e6c8;
    --sand-light: #ffd08a; --sand-mid: #c68b4a; --spice-glow: #e8a84c;
    --text-light: #f3efe7; --muted: #ad9f89; --border-strong: #4d4032;
    --font-heading: 'Marcellus', serif; --font-body: 'Inter', sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font-body); background: var(--bg-deep); color: var(--text-light); line-height: 1.6; min-height: 100vh; }
  .page-wrapper { max-width: 640px; margin: 0 auto; padding: 40px 20px 60px; }
  h1 { font-family: var(--font-heading); font-size: clamp(24px, 4vw, 34px); color: var(--sand-light); margin-bottom: 16px; }
  .panel { background: var(--bg-board); border: 1px solid var(--border-strong); border-radius: 12px; padding: 24px; margin-bottom: 16px; }
  .panel p { color: var(--muted); margin-bottom: 12px; }
`;

function renderPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — ACP Steam Link</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="page-wrapper">
    <h1>${esc(title)}</h1>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function errorPage(res, status, title, message) {
  return res.status(status).send(renderPage(title, `<div class="panel"><p>${esc(message)}</p></div>`));
}

// resolveSteamConnections: exchanges the OAuth code for a token, fetches
// /users/@me/connections, and returns only type==="steam" connections.
// NEVER logs or persists the access token beyond this function's own
// execution (FINDING-STEAM-6) — the token exists only in this function's
// local scope and is discarded when it returns.
async function resolveSteamConnections({ code, redirectUri, config, fetchImpl }) {
  const tokenRes = await fetchImpl(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  });
  if (!tokenRes.ok) {
    // Deliberately do not include the response body in the thrown error --
    // it may echo back request parameters. Log only the status code.
    throw new Error(`steam_link.token_exchange_failed status=${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error("steam_link.token_exchange_missing_access_token");

  try {
    const connectionsRes = await fetchImpl(DISCORD_CONNECTIONS_URL, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!connectionsRes.ok) {
      throw new Error(`steam_link.connections_fetch_failed status=${connectionsRes.status}`);
    }
    const connections = await connectionsRes.json();
    return (Array.isArray(connections) ? connections : []).filter((c) => c?.type === "steam");
  } finally {
    // accessToken goes out of scope here; nothing further in this module
    // ever holds a reference to it. See the module-level comment and
    // FINDING-STEAM-6 for why this is a hard requirement, not a style
    // preference.
  }
}

// findLinkedCharacterName: linkAccountViaSteamProvider()'s response is
// { ok, accounts } (listLinkedAccounts()'s full row set for this Discord
// user, snake_case character_name field) — find the row matching the
// character that was just linked, rather than assuming it's accounts[0].
function findLinkedCharacterName(linkResult, playerControllerId) {
  const accounts = Array.isArray(linkResult?.accounts) ? linkResult.accounts : [];
  const match = accounts.find((a) => String(a.player_controller_id) === String(playerControllerId));
  return match?.character_name || "your character";
}

// editOriginalInteraction: pushes an update into the Discord interaction
// that started this flow, using the stored interaction token (works up to
// 15 minutes after the original interaction, per Discord's
// webhook-message-edit semantics — does not require the original
// Interaction object to still be in memory).
async function editOriginalInteraction({ client, fetchImpl, session, embed }) {
  if (!session.interactionToken || !client?.application?.id) return;
  try {
    // PATCH /webhooks/{application.id}/{interaction.token}/messages/@original
    // authenticates via the interaction token embedded in the URL path
    // itself (per Discord's own docs: "functions the same as Edit
    // Webhook Message") — no Authorization header is needed or sent.
    // Confirmed directly against
    // https://discord.com/developers/docs/interactions/receiving-and-responding#edit-original-interaction-response,
    // 2026-07-24.
    await fetchImpl(
      `https://discord.com/api/v10/webhooks/${client.application.id}/${session.interactionToken}/messages/@original`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "", embeds: [embed], components: [] })
      }
    );
  } catch (err) {
    // The underlying link/whisper action already succeeded server-side; a
    // failure to edit the original Discord message is a cosmetic/UX gap,
    // not a correctness failure. Log and continue.
    logError("steam_link.original_interaction_edit_failed", err);
  }
}

export function createSteamLinkServer({ config, adapterClient, client, fetchImpl = globalThis.fetch } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const redirectUri = `${config.steamLink.baseUrl}/steam-link/callback`;

  app.get("/steam-link/start", (req, res) => {
    const { state } = req.query;
    const session = state ? getSteamLinkSession(String(state)) : undefined;
    if (!session) {
      return errorPage(res, 400, "Link Expired",
        "This link has expired or is invalid. Run /dune player link <character-name> again in Discord.");
    }

    const authUrl = new URL(DISCORD_OAUTH_URL);
    authUrl.searchParams.set("client_id", config.discord.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "identify connections");
    authUrl.searchParams.set("state", session.state);
    res.redirect(authUrl.toString());
  });

  app.get("/steam-link/callback", async (req, res) => {
    const { code, state, error } = req.query;

    // FINDING-STEAM-1: single-use enforcement. This is the ONLY place a
    // session's consumedAt is set — a second request with the same state
    // (replay) is rejected here, before any further work happens. Note
    // this also resolves the specific playerControllerId/characterName
    // this whole callback is scoped to (FINDING-STEAM-1/-2) — every
    // decision below reads from THIS session object, never from the
    // request itself.
    const session = consumeSteamLinkSession(String(state || ""));
    if (!session) {
      return errorPage(res, 400, "Link Expired",
        "This link has expired or has already been used. Run /dune player link <character-name> again in Discord.");
    }

    if (error) {
      // Player denied the OAuth consent screen. Per Design doc's Error UX
      // table, auto-fall-back to the whisper path using the character
      // already known from the session -- the player never has to re-run
      // the command.
      return sendWhisperFallbackAndRespond({
        res, adapterClient, client, fetchImpl, session,
        pageTitle: "Linking Cancelled",
        pageMessage: "Linking via Steam was cancelled — we sent a verification code to your character in-game instead."
      });
    }
    if (!code) {
      return errorPage(res, 400, "Invalid Request", "Missing code parameter.");
    }

    let steamConnections;
    try {
      steamConnections = await resolveSteamConnections({ code: String(code), redirectUri, config, fetchImpl });
    } catch (err) {
      logError("steam_link.callback_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't complete the sign-in with Discord. Please try again in a moment.");
    }

    const steamId64List = steamConnections
      .map((c) => String(c.id || ""))
      .filter((id) => STEAM_ID64_PATTERN.test(id));

    // FINDING-STEAM-2: the match check always targets session.playerControllerId
    // -- the ONE character this session was scoped to at
    // /dune player link <character-name> time -- never anything derived
    // from this request. There is no candidate list to choose from.
    let matched = false;
    try {
      const actor = { userId: session.discordUserId, guildId: session.guildId };
      const result = await adapterClient.matchSteamCandidate(
        actor, session.playerControllerId, steamId64List, session.guildId
      );
      matched = Boolean(result?.matched);
    } catch (err) {
      logError("steam_link.match_check_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't verify your Steam account right now. Please try again in a moment.");
    }

    if (!matched) {
      return sendWhisperFallbackAndRespond({
        res, adapterClient, client, fetchImpl, session,
        pageTitle: "Sent a Verification Code Instead",
        pageMessage: `We checked your linked Steam account(s) but couldn't confirm ${session.characterName || "that character"} that way. ` +
          `We've sent a verification code to ${session.characterName || "your character"} in-game via whisper instead — ` +
          "check your whispers and run /dune player verify <code> to complete the link."
      });
    }

    let linkResult;
    try {
      const actor = { userId: session.discordUserId, guildId: session.guildId };
      linkResult = await adapterClient.linkAccountViaSteam(actor, session.playerControllerId, session.guildId);
    } catch (err) {
      // FINDING-STEAM-3: the conflict error from linkAdditionalAccount()
      // (via linkAccountViaSteamProvider()) is already generic ("already
      // linked to another Discord account") with no other-user identifying
      // detail — pass it through UNCHANGED. Per the Design doc's Error UX
      // table, do NOT trigger a whisper fallback in this specific case --
      // the character is already claimed by someone else, so a whisper
      // code could never successfully complete a NEW link and would be
      // actively misleading to send.
      const message = err?.body?.error || err?.message || "This character is already linked to a different Discord account.";
      return errorPage(res, 409, "Unable to Link", String(message));
    }

    await editOriginalInteraction({
      client, fetchImpl, session,
      embed: {
        title: "🔗 Character Linked",
        // Matches embedFormat.js's own DUNE_COLORS.success value exactly,
        // so a Steam-linked success embed renders with the identical
        // color as the whisper-flow's formatLinkEmbed().
        description: `Linked as **${esc(findLinkedCharacterName(linkResult, session.playerControllerId))}** via Steam.\nUse \`/dune data inventory\` to view your inventory.`,
        color: 0x2ECC71
      }
    });

    res.send(renderPage("Linked!", `<div class="panel"><p>Your character is now linked. You can close this tab and return to Discord.</p></div>`));
  });

  // sendWhisperFallbackAndRespond: shared by the "player denied consent"
  // and "no Steam match" paths -- both resolve to the same outcome (send
  // the whisper now, using the character already known from the session,
  // and tell the player to check their whispers), just reached via
  // different callback conditions. See Design doc's "Why Auto-Fallback"
  // section for why this doesn't just show an error and ask the player to
  // re-run the command.
  async function sendWhisperFallbackAndRespond({ res, adapterClient, client, fetchImpl, session, pageTitle, pageMessage }) {
    try {
      const actor = { userId: session.discordUserId, guildId: session.guildId };
      await adapterClient.playerLinkStart(actor, session.characterName, session.guildId);
    } catch (err) {
      logError("steam_link.whisper_fallback_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't send a verification code right now. Please try again in a moment.");
    }

    await editOriginalInteraction({
      client, fetchImpl, session,
      embed: {
        title: "🔗 Character Link Started",
        description: `We sent a verification code to **${esc(session.characterName || "your character")}** in-game via whisper. ` +
          "Use `/dune player verify <code>` to complete the link. Codes expire after 5 minutes.",
        color: 0x2ECC71
      }
    });

    return res.send(renderPage(pageTitle, `<div class="panel"><p>${esc(pageMessage)}</p></div>`));
  }

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "acp-steam-link", enabled: config.steamLink.enabled });
  });

  return app;
}
