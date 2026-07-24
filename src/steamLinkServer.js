// steamLinkServer.js — Express app implementing the Discord OAuth2
// "connections"-scope flow for /dune player link (no character argument).
// See docs/steam-link-design.md, docs/steam-link-architecture.md, and
// docs/steam-link-security-review.md for the full design and the
// FINDING-STEAM-* items this implementation must satisfy.
//
// Started UNCONDITIONALLY in index.js (not gated behind config.multiTenant
// like setupServer.js is) — see docs/steam-link-architecture.md's
// Single-Tenant Deployment Note for why.
//
// NOTE ON CORE INTEGRATION: the actual resolveSteamCandidates() /
// linkAccountViaSteam() adapter calls this module makes depend on two new
// Core-side routes (/players/accounts/resolve-steam,
// /players/accounts/link-steam) that are tracked as UNMERGED_ROUTES in
// adapterClient.js pending a separate Core-repo PR (see
// docs/steam-link-implementation-prompt.md Part 1). Everything in THIS
// file that talks only to Discord's own API (state validation, token
// exchange, connections fetch) is fully independent of that and works
// today; only the final /steam-link/select step's adapter calls will
// return the UNMERGED_ROUTES error until Core ships its half.

import express from "express";
import { esc } from "./htmlEscape.js";
import {
  getSteamLinkSession,
  consumeSteamLinkSession,
  updateSteamLinkSession
} from "./steamLinkStore.js";
import { logError, logInfo } from "./logger.js";

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
  .candidate-group h3 { font-family: var(--font-heading); color: var(--sand-light); font-size: 16px; margin-bottom: 8px; }
  .candidate-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; margin-bottom: 8px; border: 1px solid var(--border-strong); border-radius: 8px; }
  .candidate-row.disabled { opacity: 0.5; }
  .btn { display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, var(--spice-glow), var(--sand-mid)); color: var(--bg-deep); border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; text-decoration: none; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
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

// resolveServerName: best-effort lookup of the game server's own display
// name (statusData.title, the same field server:status/sendStatusCard()
// already use — see commands.js's "server:status" branch), so the
// "No Characters Found" error can name the specific server a player's
// Steam-linked accounts were checked against. This matters for operators
// running (or players who belong to) more than one Dune server — "no
// character found on this server" is meaningfully less useful than
// "no character found on Tabr-Tau" when a player might have a real
// character on a DIFFERENT server they're also in Discord with. Never
// throws — a status-lookup failure falls back to a generic phrase rather
// than blocking the (already-determined) "no characters found" response
// from rendering at all.
async function resolveServerName({ adapterClient, session }) {
  try {
    const actor = { userId: session.discordUserId, guildId: session.guildId };
    const status = await adapterClient.status(actor, false, session.guildId);
    const title = status?.result?.title || status?.title;
    return title ? `**${title}**` : "this server";
  } catch {
    return "this server";
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
        "This link has expired or is invalid. Run /dune player link again in Discord (no character name).");
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

    if (error) {
      return errorPage(res, 400, "Linking Cancelled",
        "Linking was cancelled. Run /dune player link again (no character name) if you'd like to try.");
    }
    if (!code || !state) {
      return errorPage(res, 400, "Invalid Request", "Missing code or state parameter.");
    }

    // FINDING-STEAM-1: single-use enforcement. This is the ONLY place a
    // session's consumedAt is set for the callback step — a second request
    // with the same state (replay) is rejected here, before any further
    // work (token exchange, adapter calls) happens.
    const session = consumeSteamLinkSession(String(state));
    if (!session) {
      return errorPage(res, 400, "Link Expired",
        "This link has expired or has already been used. Run /dune player link again in Discord (no character name).");
    }

    let steamConnections;
    try {
      steamConnections = await resolveSteamConnections({ code: String(code), redirectUri, config, fetchImpl });
    } catch (err) {
      logError("steam_link.callback_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't complete the sign-in with Discord. Please try again in a moment.");
    }

    if (!steamConnections.length) {
      return errorPage(res, 200, "No Steam Connection Found",
        "No Steam connection found in your Discord account. Add one in Discord Settings → Connections, " +
        "or use /dune player link <character-name> instead.");
    }

    const steamId64List = steamConnections
      .map((c) => String(c.id || ""))
      .filter((id) => STEAM_ID64_PATTERN.test(id));

    // Persist the resolved Steam IDs against the (already-consumed, but
    // still readable) session so /steam-link/select can re-derive the
    // candidate set server-side rather than trusting this page's own
    // rendered list (FINDING-STEAM-2).
    updateSteamLinkSession(session.state, { steamId64List });

    let candidates;
    try {
      const actor = { userId: session.discordUserId, guildId: session.guildId };
      const result = await adapterClient.resolveSteamCandidates(actor, steamId64List, session.guildId);
      candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    } catch (err) {
      logError("steam_link.resolve_candidates_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't look up your characters right now. Please try again in a moment.");
    }

    if (!candidates.length) {
      const serverName = await resolveServerName({ adapterClient, session });
      return errorPage(res, 200, "No Characters Found",
        `We checked your linked Steam account(s) but couldn't find a matching character on ${serverName}. ` +
        "Make sure the Steam account you're logged into the game with is the same one linked in Discord " +
        "Settings → Connections, or use /dune player link <character-name> instead.");
    }

    const rows = candidates.map((c) => `
      <div class="candidate-row">
        <span>${esc(c.character_name || "Unknown")} ${c.online_status ? `(${esc(c.online_status)})` : ""}</span>
        <form method="POST" action="/steam-link/select">
          <input type="hidden" name="state" value="${esc(session.state)}">
          <input type="hidden" name="playerControllerId" value="${esc(c.player_controller_id)}">
          <button type="submit" class="btn">Link this character</button>
        </form>
      </div>`).join("");

    res.send(renderPage("Choose Your Character", `
      <div class="panel">
        <p>You can link more than one — just click each one you want.</p>
        <div class="candidate-group">${rows}</div>
      </div>`));
  });

  app.post("/steam-link/select", async (req, res) => {
    const { state, playerControllerId } = req.body || {};
    if (!state || !playerControllerId) {
      return errorPage(res, 400, "Invalid Request", "Missing required fields.");
    }

    // NOTE: this session was already consumedAt-marked during the callback
    // step above. getSteamLinkSession() does not check consumedAt (it only
    // checks expiry) — this endpoint intentionally reads the already-used
    // session to recover the discordUserId/guildId/steamId64List/etc. it
    // needs, rather than requiring a second single-use token for what is,
    // from the player's perspective, still one continuous linking session.
    // The actual security boundary (FINDING-STEAM-1) is that the state
    // could never be replayed to re-trigger a NEW token exchange/OAuth
    // flow — this endpoint makes no Discord OAuth calls at all, only Core
    // adapter calls gated by the already-completed identity resolution.
    const session = getSteamLinkSession(String(state));
    if (!session || !Array.isArray(session.steamId64List)) {
      return errorPage(res, 400, "Link Expired",
        "This link has expired. Run /dune player link again in Discord (no character name).");
    }

    // FINDING-STEAM-2: re-derive the valid candidate set server-side,
    // RIGHT NOW, rather than trusting that playerControllerId was actually
    // shown to this session on the callback page. A submitted ID not in
    // this freshly-re-derived set is rejected, even if it's a real,
    // valid-looking character ID for some OTHER Steam account.
    let candidates;
    try {
      const actor = { userId: session.discordUserId, guildId: session.guildId };
      const result = await adapterClient.resolveSteamCandidates(actor, session.steamId64List, session.guildId);
      candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    } catch (err) {
      logError("steam_link.select_resolve_failed", err);
      return errorPage(res, 502, "Something Went Wrong", "Please try again in a moment.");
    }

    const isValidCandidate = candidates.some((c) => String(c.player_controller_id) === String(playerControllerId));
    if (!isValidCandidate) {
      return errorPage(res, 400, "Invalid Selection",
        "That character is no longer available to link. Run /dune player link again (no character name).");
    }

    let linkResult;
    try {
      const actor = { userId: session.discordUserId, guildId: session.guildId };
      linkResult = await adapterClient.linkAccountViaSteam(actor, String(playerControllerId), session.guildId);
    } catch (err) {
      // FINDING-STEAM-3: the conflict error from linkAdditionalAccount()
      // (via linkAccountViaSteamProvider()) is already generic ("already
      // linked to another Discord account") with no other-user identifying
      // detail — pass it through UNCHANGED, do not enrich it with any
      // additional lookup that could leak who the conflicting owner is.
      const message = err?.body?.error || err?.message || "Unable to complete linking.";
      return errorPage(res, 409, "Unable to Link", String(message));
    }

    // Success: update the callback page AND push an update into the
    // original Discord interaction that started this flow, using the
    // stored interaction token (works up to 15 minutes after the original
    // interaction, per Discord's webhook-message-edit semantics — does not
    // require the original Interaction object to still be in memory).
    if (session.interactionToken && client?.application?.id) {
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
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              content: "",
              embeds: [{
                title: "🔗 Character Linked",
                // linkAccountViaSteamProvider()'s response shape is
                // { ok, accounts } where accounts is listLinkedAccounts()'s
                // rows -- snake_case character_name, not characterName. The
                // just-linked character is the most recently linked, which
                // (per linkAdditionalAccount()'s ORDER BY is_default desc,
                // linked_at asc) is NOT necessarily accounts[0] once a user
                // has more than one link -- find it by playerControllerId
                // instead of assuming array position.
                description: `Linked as **${esc(findLinkedCharacterName(linkResult, playerControllerId))}** via Steam.\nUse \`/dune data inventory\` to view your inventory.`,
                // Matches embedFormat.js's own DUNE_COLORS.success value
                // exactly, so a Steam-linked success embed renders with the
                // identical color as the whisper-flow's formatLinkEmbed().
                color: 0x2ECC71
              }],
              components: []
            })
          }
        );
      } catch (err) {
        // The link itself already succeeded server-side; a failure to edit
        // the original Discord message is a cosmetic/UX gap, not a
        // correctness failure. Log and continue to the success page.
        logError("steam_link.original_interaction_edit_failed", err);
      }
    }

    res.send(renderPage("Linked!", `<div class="panel"><p>Your character is now linked. You can close this tab and return to Discord.</p></div>`));
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "acp-steam-link", enabled: config.steamLink.enabled });
  });

  return app;
}
