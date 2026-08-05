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
// NOTE ON CORE INTEGRATION: the callback's final match/link step calls
// adapterClient.linkAccountViaSteam(), which is now a real, live Core
// route (dune-awakening-selfhost-docker#130/FINDING-LINK-7,
// /players/accounts/link-steam) as of 2026-07-26 -- this is no longer
// blocked on Core-side work. Core folds the Steam-ID match check and the
// link into that single call (see linkAccountViaSteam()'s own comment in
// adapterClient.js for why there is no separate match-only call). This
// feature is still not reachable by a real user in production, though --
// the bot's own OAuth callback server (this file, port 3101) has no
// Cloudflare Tunnel ingress rule on the live OCI deployment; see
// arrakis-control-panel#86 for that separate, independent gap.
//
// Unlike the design's first revision, there is NO /steam-link/select
// route here — a session is always scoped to exactly one, already-named
// character (see steamLinkStore.js), so /steam-link/callback resolves
// directly to one of three outcomes (match, no-match, conflict) with
// nothing for the player to choose between.
//
// FINDING-STEAM-4/-7 (added 2026-07-26): both public endpoints are now
// rate-limited (see steamLinkRateLimit.js), and the callback now verifies
// the completing Discord user matches the session's original user via
// /users/@me, rather than trusting only the state token's validity. See
// the inline comments at each site for the full rationale.

import express from "express";
import { esc } from "./htmlEscape.js";
import {
  getSteamLinkSession,
  consumeSteamLinkSession
} from "./steamLinkStore.js";
import {
  checkSteamLinkRateLimit,
  recordSteamLinkAttempt
} from "./steamLinkRateLimit.js";
import { logError } from "./logger.js";

const DISCORD_OAUTH_URL = "https://discord.com/api/v10/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/v10/users/@me";
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
// /users/@me (to identify who actually completed this OAuth flow) and
// /users/@me/connections, and returns the completing user's Discord ID
// alongside only type==="steam" connections.
// NEVER logs or persists the access token beyond this function's own
// execution (FINDING-STEAM-6) — the token exists only in this function's
// local scope and is discarded when it returns.
//
// FINDING-STEAM-7: prior to this, the callback validated only the `state`
// CSRF token and never confirmed the Discord user completing the OAuth
// flow was the same user who started it -- every downstream action simply
// trusted session.discordUserId. state-token entropy (128-bit, single-use,
// short expiry) made this hard to exploit in practice, but a leaked
// not-yet-consumed state value (logged, referrer-leaked, shared link)
// could otherwise let a different Discord user complete someone else's
// link. Fetching /users/@me and returning the completing user's real ID
// lets the caller reject a mismatch explicitly instead of trusting the
// session alone.
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
    const userRes = await fetchImpl(DISCORD_USER_URL, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) {
      throw new Error(`steam_link.identify_fetch_failed status=${userRes.status}`);
    }
    const userData = await userRes.json();
    const completingUserId = userData?.id ? String(userData.id) : "";
    if (!completingUserId) throw new Error("steam_link.identify_missing_user_id");

    const connectionsRes = await fetchImpl(DISCORD_CONNECTIONS_URL, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!connectionsRes.ok) {
      throw new Error(`steam_link.connections_fetch_failed status=${connectionsRes.status}`);
    }
    const connections = await connectionsRes.json();
    const steamConnections = (Array.isArray(connections) ? connections : []).filter((c) => c?.type === "steam");
    return { completingUserId, steamConnections };
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

    // FINDING-STEAM-4: rate limit before doing any session lookup, keyed
    // by the state token itself (see steamLinkRateLimit.js for why state
    // rather than IP). A missing/garbage state is still a real attempt for
    // rate-limiting purposes -- record it under the raw (possibly empty)
    // key rather than skipping the check.
    const rateKey = String(state || "");
    const rate = recordSteamLinkAttempt(rateKey);
    if (!rate.allowed) {
      res.set("retry-after", String(rate.retryAfterSeconds));
      return errorPage(res, 429, "Too Many Attempts",
        "Too many attempts. Please wait a few minutes and run /dune player link <character-name> again.");
    }

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

    // FINDING-STEAM-4: same rate limit as /steam-link/start, keyed by the
    // same state token -- both endpoints share one attempt budget per
    // session, since a single real link attempt normally hits each of them
    // exactly once.
    const rateKey = String(state || "");
    const rate = recordSteamLinkAttempt(rateKey);
    if (!rate.allowed) {
      res.set("retry-after", String(rate.retryAfterSeconds));
      return errorPage(res, 429, "Too Many Attempts",
        "Too many attempts. Please wait a few minutes and run /dune player link <character-name> again.");
    }

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

    let completingUserId, steamConnections;
    try {
      ({ completingUserId, steamConnections } = await resolveSteamConnections({ code: String(code), redirectUri, config, fetchImpl }));
    } catch (err) {
      logError("steam_link.callback_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't complete the sign-in with Discord. Please try again in a moment.");
    }

    // FINDING-STEAM-7: reject if the Discord user who just completed this
    // OAuth flow isn't the same user who started it. The state token was
    // already validated above (consumeSteamLinkSession), but that only
    // proves this is a not-yet-used, not-yet-expired session -- it doesn't
    // prove WHO is completing it. Treat a mismatch as a security event
    // (logged), not a silent retry prompt.
    if (completingUserId !== String(session.discordUserId || "")) {
      logError("steam_link.identity_mismatch", new Error("completing user does not match session owner"), {
        sessionGuildId: session.guildId
      });
      return errorPage(res, 403, "Account Mismatch",
        "The Discord account you signed in with doesn't match the account that started this link. Run /dune player link <character-name> again with the correct Discord account.");
    }

    const steamId64List = steamConnections
      .map((c) => String(c.id || ""))
      .filter((id) => STEAM_ID64_PATTERN.test(id));

    // FINDING-STEAM-2: the match check always targets session.playerControllerId
    // -- the ONE character this session was scoped to at
    // /dune player link <character-name> time -- never anything derived
    // from this request. There is no candidate list to choose from.
    //
    // Core's actual implementation (linkAccountViaSteamProvider(), see
    // dune-awakening-selfhost-docker#130/FINDING-LINK-7) performs the
    // match check AND the link in ONE call, not two -- an earlier draft of
    // this feature specced a separate matchSteamCandidate() route, but a
    // pre-implementation security review found that shape would have
    // created a character-enumeration oracle (a target-unbound route
    // gated only by capability tier, not actor ownership), so Core folded
    // the match into the single, actor-bound link-steam call instead.
    // adapterClient.matchSteamCandidate() / the standalone match-steam
    // route never existed as separate things server-side -- calling this
    // as two sequential requests (as an earlier draft of this file did)
    // would throw "Unsupported adapter route" on the first call.
    let linkResult;
    try {
      // Built from the FULL session (username/channelId/roleIds included,
      // captured at session-creation time in commands.js) -- Core's
      // normalizeDiscordActor() hard-requires username/channelId on every
      // actor object, and requireSelfScopedCapability() needs real
      // roleIds to resolve tier correctly. A userId/guildId-only actor
      // (the pre-2026-07-26 shape) always failed with a 400.
      const actor = {
        userId: session.discordUserId,
        username: session.username,
        guildId: session.guildId,
        channelId: session.channelId,
        roleIds: session.roleIds
      };
      linkResult = await adapterClient.linkAccountViaSteam(
        actor, session.playerControllerId, steamId64List, session.guildId
      );
    } catch (err) {
      // FINDING-STEAM-3: the conflict error from linkAdditionalAccount()
      // (via linkAccountViaSteamProvider()) is already generic ("already
      // linked to another Discord account") with no other-user identifying
      // detail — pass it through UNCHANGED. Per the Design doc's Error UX
      // table, do NOT trigger a whisper fallback in this specific case --
      // the character is already claimed by someone else, so a whisper
      // code could never successfully complete a NEW link and would be
      // actively misleading to send.
      // AdapterHttpError (adapterClient.js) sets .status (an HTTP status
      // code) and .body (the parsed JSON response), NOT .statusCode/.code
      // -- those property names belong to Core's OWN internal error object
      // (duneDb.js's thrown Error, policyError()'s return value), which is
      // already serialized into { ok: false, code, error } by
      // discordSafeError() before it ever reaches this process. Checking
      // the wrong property names here would silently never match a real
      // conflict response.
      if (err?.status === 409 || err?.body?.code === "character_already_linked") {
        const message = err?.body?.error || err?.message || "This character is already linked to a different Discord account.";
        return errorPage(res, 409, "Unable to Link", String(message));
      }
      logError("steam_link.match_check_failed", err);
      return errorPage(res, 502, "Something Went Wrong",
        "We couldn't verify your Steam account right now. Please try again in a moment.");
    }

    if (!linkResult?.matched) {
      return sendWhisperFallbackAndRespond({
        res, adapterClient, client, fetchImpl, session,
        pageTitle: "Sent a Verification Code Instead",
        pageMessage: `We checked your linked Steam account(s) but couldn't confirm ${session.characterName || "that character"} that way. ` +
          `We've sent a verification code to ${session.characterName || "your character"} in-game via whisper instead — ` +
          "check your whispers and run /dune player verify <code> to complete the link."
      });
    }

    // FIX (2026-07-27, found via a real live report -- same gap as
    // embedFormat.js's formatLinkEmbed(), a separate code path that
    // needed the identical fix): Core's linkAccountViaSteamProvider()
    // short-circuits a re-link of an already-linked character with
    // { ok: true, matched: true, alreadyLinked: true, accounts }, no
    // real link write. This still fell into this success branch (since
    // matched: true), but always showed the same "Character Linked"
    // text as a genuine fresh link, with no indication nothing new
    // actually happened.
    const characterName = esc(findLinkedCharacterName(linkResult, session.playerControllerId));
    await editOriginalInteraction({
      client, fetchImpl, session,
      embed: linkResult?.alreadyLinked
        ? {
            title: "🔗 Already Linked",
            description: `You are already linked as **${characterName}**.`,
            color: 0xC2A44E // matches embedFormat.js's DUNE_COLORS.spice
          }
        : {
            title: "🔗 Character Linked",
            // Matches embedFormat.js's own DUNE_COLORS.success value exactly,
            // so a Steam-linked success embed renders with the identical
            // color as the whisper-flow's formatLinkEmbed().
            description: `Linked as **${characterName}** via Steam.\nUse \`/dune data inventory\` to view your inventory.`,
            color: 0x2ECC71
          }
    });

    res.send(linkResult?.alreadyLinked
      ? renderPage("Already Linked", `<div class="panel"><p>You're already linked as ${characterName}. You can close this tab and return to Discord.</p></div>`)
      : renderPage("Linked!", `<div class="panel"><p>Your character is now linked. You can close this tab and return to Discord.</p></div>`));
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
      // Same fixes as the actor object above: full session fields, not
      // just userId/guildId (real 400 bug, found 2026-07-26). Also:
      // playerLink() is the correct method here, not playerLinkStart() --
      // playerLinkStart() hits Core's still-unmerged player-links-start
      // (V2) route; playerLink() hits the real, live players-link (V1)
      // route (linkPlayerProvider()). This is the exact same
      // wrong-method bug fixed in commands.js's player:link handler
      // earlier tonight -- this second call site was missed at the time.
      const actor = {
        userId: session.discordUserId,
        username: session.username,
        guildId: session.guildId,
        channelId: session.channelId,
        roleIds: session.roleIds
      };
      await adapterClient.playerLink(actor, session.characterName, session.guildId);
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
