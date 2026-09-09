import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logInfo, logError } from "./logger.js";
import {
  createDatabase,
  createOauthSession,
  getOauthSession,
  updateOauthSession,
  upsertGuild,
  getGuild,
  addGuildRole,
  removeGuildRole,
  getGuildRoles,
  updateGuildSettings,
  getStatsSnapshot,
  verifyGuildStatsPushSecret,
  upsertGuildStatsSnapshot,
  setGuildStatsSharingSecret,
  getGuildStatsSharingStatus
} from "./database.js";
import { esc } from "./htmlEscape.js";
import { renderPage, errorPage } from "./setupLayout.js";
import { isEncryptionConfigured } from "./secretsCrypto.js";
import { recordGlobalStatsPushAttempt, recordGuildStatsPushAttempt } from "./statsPushRateLimit.js";

// #215/A2: version comes from package.json — a hardcoded literal here
// drifted two release candidates behind the real version.
const __setupDirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(join(__setupDirname, "..", "package.json"), "utf8")).version;

const DISCORD_OAUTH_URL = "https://discord.com/api/v10/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/v10/users/@me";

// findRoleTierConflict: separation of duties (issue #238, matching Core's
// tier1-upstream design) -- a single Discord role ID may never be mapped to
// two different tiers *at once*. Owner is deliberately excluded from this
// check: it has no role concept at all anymore, so it can never conflict
// with anything. Returns the first conflict found (role ID + both tier
// names) or null when the combined mapping is conflict-free.
//
// `existingRoles` (the shape database.js's getGuildRoles() returns) is
// checked ALONGSIDE the current submission's 3 fields, not just against
// each other -- a code-review finding caught that /setup/register's own
// addGuildRole() calls are purely additive (INSERT OR IGNORE, never clears
// a guild's prior mappings), so a first registration with adminRoleId=X
// followed by a later, unrelated re-registration with moderatorRoleId=X
// would previously pass this check (nothing in THAT request conflicted
// with itself) while silently creating exactly the one-role-two-tiers
// violation this function exists to prevent.
//
// Existing rows whose role_id is ALSO present in the current submission are
// excluded from that comparison, not treated as a conflict -- a second
// code-review finding caught the first fix above as an overcorrection: an
// operator resubmitting an already-mapped role under a *new* tier (e.g.
// promoting a role from moderator to admin) is a deliberate reassignment,
// not two simultaneous tiers for the same role, and /setup/register's own
// register handler removes the role's old-tier row before re-adding it
// under the new one (see the reassignment block there) -- so by the time
// this combined mapping is actually persisted, no real conflict exists.
// Without this exclusion, an operator could never change a role's tier
// through /setup at all: every resubmission would be rejected as
// conflicting with its own prior mapping, with no removeGuildRole route in
// this file to work around it.
export function findRoleTierConflict({ adminRoleId, moderatorRoleId, observerRoleId, existingRoles = [] }) {
  const submitted = [
    ["admin", adminRoleId],
    ["moderator", moderatorRoleId],
    ["observer", observerRoleId]
  ].filter(([, roleId]) => roleId);
  const submittedRoleIds = new Set(submitted.map(([, roleId]) => String(roleId)));

  const mapped = [
    ...submitted,
    ...existingRoles
      .filter((row) => row.role_type !== "owner" && !submittedRoleIds.has(String(row.role_id)))
      .map((row) => [row.role_type, row.role_id])
  ];

  for (let i = 0; i < mapped.length; i++) {
    for (let j = i + 1; j < mapped.length; j++) {
      const [tierA, roleIdA] = mapped[i];
      const [tierB, roleIdB] = mapped[j];
      if (tierA !== tierB && String(roleIdA) === String(roleIdB)) {
        return { roleId: roleIdA, tierA, tierB };
      }
    }
  }
  return null;
}

// Issue #167 fix: POST /api/alerts/relay had zero authentication --
// anyone who discovered the URL could inject arbitrary-looking
// Alertmanager firing/resolved payloads and have them relayed to the
// real configured Discord channel as if they were genuine alerts.
// DUNE_ALERT_RELAY_TOKEN (direct value or _FILE path, same convention
// as DISCORD_BOT_TOKEN/DUNE_DISCORD_ADAPTER_TOKEN elsewhere in this
// repo) is checked against the request's Authorization: Bearer header
// using a constant-time comparison. Deliberately OPT-IN/backward
// compatible, matching this repo's own actorSignature.js precedent for
// exactly this situation (a previously-unauthenticated path being
// hardened without breaking every existing deployment the moment this
// ships): if the token is unset, the route logs a loud warning on
// every request but does not reject it, so an operator who hasn't yet
// updated their Alertmanager config isn't silently locked out of
// alerting. Once DUNE_ALERT_RELAY_TOKEN is set, the check becomes
// mandatory and a request without a matching header is rejected with
// 401 before the payload is ever parsed or relayed.
function alertRelayToken(env = process.env) {
  const direct = env.DUNE_ALERT_RELAY_TOKEN || "";
  if (direct.trim()) return direct.trim();
  const file = env.DUNE_ALERT_RELAY_TOKEN_FILE || "";
  if (!file) return "";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

// Constant-time comparison guards against a timing side-channel that
// would otherwise let an attacker recover the token byte-by-byte by
// measuring response latency across many requests. Buffer.compare()
// length must match before timingSafeEqual() is called (it throws on
// mismatched lengths), so a length check happens first -- this is safe
// because the length itself is not the secret, only the token's value
// is.
function tokenMatches(provided, expected) {
  const providedBuf = Buffer.from(String(provided || ""), "utf8");
  const expectedBuf = Buffer.from(String(expected || ""), "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// Issue #195 fix: the setup form's guild <select> submits only the guild
// id, so the previously-trusted req.body.guildName was always undefined
// and every completed setup persisted (and displayed) "Unknown". Resolve
// the real name server-side from the same Discord OAuth token the flow
// already holds. Best-effort: any failure falls back to "Unknown" rather
// than blocking registration (the name is display-only).
async function resolveGuildName(accessToken, guildId) {
  if (!accessToken || !guildId) return "Unknown";
  try {
    const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!guildsRes.ok) return "Unknown";
    const guilds = await guildsRes.json();
    const match = Array.isArray(guilds) ? guilds.find((g) => g.id === guildId) : null;
    return (match && typeof match.name === "string" && match.name.trim()) || "Unknown";
  } catch {
    return "Unknown";
  }
}

export function createSetupServer(config) {
  const app = express();
  const db = createDatabase(config.dbPath);
  
  // Resolve public directory relative to this file's location
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, "..", "public");

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(publicDir));

  // CORS — allow the landing page to fetch public API endpoints.
  // No auth endpoints are exposed here; all are read-only public data.
  // #224: sentinel.darkdante.org added ahead of the DNS/Tunnel cutover —
  // safe to add early since a CORS allowlist only widens what's
  // accepted, it can't break the still-live acp.darkdante.org origin.
  // Remove the acp.* origins once issue #224's domain migration is
  // verified complete end-to-end.
  const ALLOWED_ORIGINS = [
    "https://sentinel.darkdante.org",
    "https://acp.darkdante.org",
    "https://acp-landing.pages.dev",
    "http://localhost:5173",
    "http://localhost:3000"
  ];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  const redirectUri = config.oauthRedirectUri || `${config.baseUrl}/oauth/callback`;

  // ── Landing page ──────────────────────────────────────────────────

  app.get("/", (req, res) => {
    const body = `
      <section class="panel" style="max-width:480px;margin:0 auto;text-align:center;">
        <p style="color:var(--muted);font-size:15px;margin-bottom:20px;">This server hosts the Mentat setup flow, which connects a Discord server to its Dune Awakening game console.</p>
        <a href="/setup" class="btn">Continue to Setup</a>
      </section>`;
    res.send(renderPage("Dune: Awakening Docker — Mentat", body, {
      heading: "Dune: Awakening Docker — Mentat",
      subtitle: "Connect your Discord server to your game console.",
      hero: true,
      center: true
    }));
  });

  // ── Sign-in page ──────────────────────────────────────────────────

  app.get("/setup", (req, res) => {
    const { guildId } = req.query;
    const state = randomBytes(16).toString("hex");

    createOauthSession({
      state,
      discordUserId: "",
      discordUsername: "",
      guildId: guildId || ""
    });

    const authUrl = new URL(DISCORD_OAUTH_URL);
    authUrl.searchParams.set("client_id", config.discordClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "identify guilds");
    authUrl.searchParams.set("state", state);
    if (guildId) authUrl.searchParams.set("guild_id", guildId);

    const body = `
      <section class="panel" style="max-width:480px;margin:0 auto;text-align:center;">
        <h2>Sign In</h2>
        <p style="margin-bottom:20px;">Sign in with Discord to configure your server.</p>
        <a href="${authUrl.toString()}" class="btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A18.4 18.4 0 0 0 15.8 3l-.2.4a13.1 13.1 0 0 1 4 2 14.2 14.2 0 0 0-5-1.5 14.8 14.8 0 0 0-5.2 0 14.2 14.2 0 0 0-5 1.5 13.1 13.1 0 0 1 4-2L8.2 3a18.4 18.4 0 0 0-4.5 1.4C.9 8.5.1 12.5.5 16.5A18.7 18.7 0 0 0 6 19.2l.7-.9a11.6 11.6 0 0 1-1.8-.9l.4-.3a13.2 13.2 0 0 0 13.4 0l.4.3a11.6 11.6 0 0 1-1.8.9l.7.9a18.7 18.7 0 0 0 5.5-2.7c.5-4.6-.8-8.5-3.2-12.1ZM8.4 14.2c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.2 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>
          Sign in with Discord
        </a>
      </section>`;
    res.send(renderPage("Mentat Setup", body, {
      heading: "Dune: Awakening Docker — Mentat",
      subtitle: "Connect your Discord server to your game console.",
      hero: true,
      center: true
    }));
  });

  // ── OAuth callback / configuration form ───────────────────────────

  app.get("/oauth/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) return errorPage(res, 400, "OAuth Error", `Discord returned an error: ${error}`);

    const session = getOauthSession(state);
    if (!session) return errorPage(res, 400, "Session Expired", "Invalid or expired session. Please start over.");

    try {
      const tokenRes = await fetch(DISCORD_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.discordClientId,
          client_secret: config.discordClientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri
        })
      });

      if (!tokenRes.ok) throw new Error("Token exchange failed");

      const tokenData = await tokenRes.json();
      updateOauthSession(state, {
        accessToken: tokenData.access_token,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      });

      const userRes = await fetch(DISCORD_USER_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json();

      const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const guilds = await guildsRes.json();
      let ownedGuilds = guilds.filter(g => g.owner === true || (BigInt(g.permissions || 0) & 0x8n) === 0x8n);
      if (ownedGuilds.length === 0) ownedGuilds = guilds;

      const userName = esc(user.global_name || user.username);
      const userId = esc(user.id);
      const accessToken = esc(tokenData.access_token);
      const guildOptions = ownedGuilds.map(g =>
        `<option value="${esc(g.id)}">${esc(g.name)}</option>`
      ).join("");

      const body = `
        <div class="page-header" style="text-align:center;margin-bottom:24px;">
          <h1>Configure Your Server</h1>
          <p class="welcome">Welcome, ${userName}!</p>
        </div>

        <form id="setup-form" action="/setup/register" method="POST">
          <input type="hidden" name="discordUserId" value="${userId}">
          <input type="hidden" name="accessToken" value="${accessToken}">

          <section class="panel">
            <h2>Step 1: Select Server</h2>
            <div class="field">
              <label for="guildId">Discord Server</label>
              <select name="guildId" id="guildId" required>
                <option value="">— Select a server —</option>
                ${guildOptions}
              </select>
            </div>
          </section>

          <section class="panel">
            <h2>Step 2: Console Connection</h2>
            <div style="background: rgba(224, 90, 74, 0.12); border: 1px solid rgba(224, 90, 74, 0.3); border-radius: 6px; padding: 12px; margin-bottom: 16px; font-size: 13px; color: #f5aca5; line-height: 1.5;">
              <strong>⚠️ Important:</strong> After enabling the adapter in your Dune Docker <code>.env</code>, you must <em>recreate</em> the console container — a plain restart does not pick up <code>.env</code> changes. From your install directory run <code>dune console restart</code> (or <code>docker compose -f docker-compose.web.yml up -d --force-recreate redblink-dune-docker-console</code>). Without this, authentication will fail.
            </div>
            <div class="field">
              <label for="consoleUrl">Console URL</label>
              <input type="url" name="consoleUrl" id="consoleUrl" placeholder="http://your-server:8088" required>
              <div class="hint">Your Dune Docker Console WebUI address</div>
            </div>
            <div class="field">
              <label for="adapterToken">Adapter Token</label>
              <input type="text" name="adapterToken" id="adapterToken" placeholder="your-adapter-token" required>
              <div class="hint">
                <strong>To set up your token</strong> (the console only accepts the token held in its token file, so the file must exist and this field must contain the same value):<br>
                1. In your Dune Docker <code>.env</code>, set:<br>
                <code>DUNE_DISCORD_ADAPTER_ENABLED=true</code><br>
                <code>DUNE_DISCORD_ADAPTER_TOKEN_FILE=/repo/runtime/secrets/discord-adapter-token.txt</code><br>
                2. <strong>Create the token file</strong> — the console reads it but does not generate it. From your Dune Docker install directory:<br>
                <code>openssl rand -hex 32 &gt; runtime/secrets/discord-adapter-token.txt</code><br>
                <code>chmod 600 runtime/secrets/discord-adapter-token.txt</code><br>
                3. <strong>Recreate the console container</strong> (see warning above)<br>
                4. Paste the same token value here (<code>cat runtime/secrets/discord-adapter-token.txt</code>)
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>Step 3: Role Configuration</h2>
            <div class="hint" style="margin-bottom:12px;">
              There is no "Owner Role" to map — owner-tier access (backups, restarts, updates when
              writes are enabled) always belongs to whoever actually owns this Discord server, the
              same way it works in the Dune Docker console. You (or any future server owner) can
              never be locked out, even with no roles configured below.
            </div>
            <div class="field">
              <label for="adminRoleId">Admin Role <em>(optional)</em></label>
              <input type="text" name="adminRoleId" id="adminRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use admin commands</div>
            </div>
            <div class="field">
              <label for="moderatorRoleId">Moderator Role <em>(optional)</em></label>
              <input type="text" name="moderatorRoleId" id="moderatorRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use read-only commands and future moderation tools</div>
            </div>
            <div class="field">
              <label for="observerRoleId">Player Role <em>(recommended)</em></label>
              <input type="text" name="observerRoleId" id="observerRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use read-only commands. Without it, only members holding one of the roles above (or the real server owner) can use the bot at all</div>
            </div>
            <div class="hint">Each Discord role may only be mapped to one of these tiers — separation of duties, matching the console.</div>
          </section>

          <section class="panel">
            <h2>Step 4: Live Stats Sharing</h2>
            <div class="field" style="display:flex;align-items:flex-start;gap:10px;">
              <input type="checkbox" name="statsSharingEnabled" id="statsSharingEnabled" value="on" style="margin-top:4px;">
              <label for="statsSharingEnabled" style="font-weight:600;">Share this server's live stats publicly</label>
            </div>
            <div class="hint" style="margin-bottom:12px;">
              Players online, spice field count, and sietch count will be shown publicly on the Mentat Link website, visible to any visitor — not just your own server's members. This is entirely optional and off unless you check this box and complete the steps below.
            </div>
            <div class="field">
              <label for="statsPushSecret">Live Stats Sharing Secret</label>
              <input type="text" name="statsPushSecret" id="statsPushSecret" placeholder="your-stats-push-secret">
              <div class="hint">
                Only needed if you checked the box above. From your Dune Docker install directory:<br>
                1. Generate and store the secret on your own console (never in this browser):<br>
                <code>dune stats-push enable</code><br>
                2. Add the printed lines to your Dune Docker <code>.env</code> (alongside your adapter-token settings from Step 2, if you're editing that file in the same session):<br>
                <code>DUNE_MENTAT_STATS_PUSH_URL=...</code><br>
                <code>DUNE_MENTAT_STATS_PUSH_SECRET_FILE=...</code><br>
                3. Recreate the console container (see the warning in Step 2)<br>
                4. Paste the same secret value printed in step 1 here<br>
                <strong>Note:</strong> your console needs outbound HTTPS access to <code>mentat-backend.darkdante.org</code> in addition to any existing egress you've already allowed for the public server directory.
              </div>
            </div>
          </section>

          <div class="btn--text-center" style="margin-top:8px;">
            <button type="submit" id="submit-btn" class="btn">Connect Server</button>
          </div>
        </form>`;

      res.send(renderPage("Mentat Setup — Configure Server", body));

    } catch (err) {
      errorPage(res, 500, "Setup Error", err.message);
    }
  });

  // ── Registration endpoint ─────────────────────────────────────────

  app.post("/setup/register", async (req, res) => {
    try {
      const { discordUserId, guildId, consoleUrl, adapterToken, adminRoleId, moderatorRoleId, observerRoleId, statsSharingEnabled, statsPushSecret } = req.body;

      // #214/U7: this endpoint serves a browser form POST — errors must
      // render a styled page with a way back, not a bare JSON body.
      if (!guildId || !consoleUrl || !adapterToken) {
        return errorPage(res, 400, "Missing Required Fields",
          "Server, console URL, and adapter token are all required. Use your browser's Back button to return to the form — your entries are preserved.");
      }

      // #213/U4's original lockout scenario ("no Admin or Owner mapping ->
      // nobody could administer the bot") is now structurally impossible:
      // owner-tier access always belongs to the real Discord guild owner
      // (issue #238), never a role mapping, so no admin/moderator/observer
      // role is required here at all.

      // Issue #238: separation of duties, matching Core's tier1-upstream
      // design -- a single Discord role may never be mapped to two
      // different tiers. Reject the whole submission and name the
      // conflicting role, rather than silently letting one mapping win.
      const roleConflict = findRoleTierConflict({ adminRoleId, moderatorRoleId, observerRoleId, existingRoles: getGuildRoles(db, guildId) });
      if (roleConflict) {
        return errorPage(res, 400, "Role Configuration Conflict",
          `Discord role ${roleConflict.roleId} is mapped to both ${roleConflict.tierA} and ${roleConflict.tierB}. Each Discord role may only be mapped to one tier — separation of duties, matching the Dune Docker console. Use your browser's Back button and map each role to a single tier.`);
      }

      // Issue #195: resolve the real guild name server-side (the form's
      // <select> submits only the id). Skipped when no OAuth token is
      // present (e.g. API/test callers) — falls back to "Unknown".
      const guildName = await resolveGuildName(req.body.accessToken, guildId);

      upsertGuild(db, {
        guildId,
        guildName,
        consoleUrl,
        adapterToken,
        status: "active"
      });

      // Owner is deliberately never written here -- see the SoD/lockout
      // comments above (issue #238). A pre-existing legacy "owner" row from
      // an install that used the old, now-removed Owner Role field is left
      // untouched in the DB (no destructive migration) but is inert for
      // authorization -- see rbac.js's resolveActorAuthTier.
      //
      // Reassignment (code-review finding): addGuildRole() is purely
      // additive (INSERT OR IGNORE) and this form never pre-populates a
      // guild's existing mappings, so a role being resubmitted under a new
      // tier here must have its OLD tier's row removed first -- otherwise
      // it would end up mapped to both tiers at once (exactly what
      // findRoleTierConflict exists to prevent, and would in fact be
      // rejected on the operator's NEXT /setup submission even though this
      // one is what created the violation). findRoleTierConflict above has
      // already confirmed the new combined mapping is conflict-free once
      // this reassignment happens, so this can run unconditionally for
      // every submitted role ID.
      const submittedRoles = [
        ["moderator", moderatorRoleId],
        ["admin", adminRoleId],
        ["observer", observerRoleId]
      ].filter(([, roleId]) => roleId);
      for (const [tier, roleId] of submittedRoles) {
        for (const otherTier of ["moderator", "admin", "observer"]) {
          if (otherTier !== tier) removeGuildRole(db, guildId, otherTier, roleId);
        }
      }
      for (const [tier, roleId] of submittedRoles) {
        addGuildRole(db, guildId, tier, roleId);
      }

      updateGuildSettings(db, guildId, {
        rbac_mode: "restricted",
        default_ephemeral: 1
      });

      // mentat#276: opt-in only, and deliberately never a silent opt-OUT.
      // The checkbox isn't pre-filled on a resubmission (this is a
      // stateless GET /oauth/callback form, same as every other field
      // here), so treating "box unchecked this time" as "revoke" would
      // silently disable stats sharing on every unrelated resubmission
      // (e.g. an operator just updating a role mapping) -- the exact
      // opposite of the explicit-action-required bar this feature is
      // held to. Revocation is deliberately out of scope for this
      // submission path; it belongs with the "edit my existing guild's
      // settings" entry point already named as follow-up work in the
      // Layer 1 design audit (finding #31), tracked as mentat#312, rather
      // than being inferred here. A checked box with no secret is a
      // no-op, not an error -- the operator hasn't finished the
      // Core-side steps yet.
      const wantsStatsSharing = statsSharingEnabled === "on" || statsSharingEnabled === "true" || statsSharingEnabled === true;
      const trimmedStatsPushSecret = typeof statsPushSecret === "string" ? statsPushSecret.trim() : "";
      if (wantsStatsSharing && trimmedStatsPushSecret) {
        setGuildStatsSharingSecret(db, guildId, trimmedStatsPushSecret);
        logInfo("setup.stats_sharing_enabled", { guildId });
      }

      // Issue #207 (Req 24): do NOT log consoleUrl — even scheme-stripped
      // it identified each tenant's console host/IP:port. guildId is
      // enough for correlation.
      logInfo("setup.guild_configured", { guildId, guildName });

      // #213/U4's original hard "must map Admin or Owner" validation is
      // gone (issue #238 removed the lockout it guarded against -- the real
      // owner always has access now), but a zero-role setup is still worth
      // a visible, non-blocking signal: defense-in-depth in case a future
      // regression in guild-ownership resolution ever ships alongside a
      // guild with no role mappings as a fallback. This does not gate
      // registration.
      if (!moderatorRoleId && !adminRoleId && !observerRoleId) {
        logInfo("setup.zero_roles_configured", { guildId });
      }

      // Issue #198: redirect with the guild id ONLY — the success page
      // looks the stored name up from the DB, so no attacker-chosen (or
      // double-decoded) display text ever rides the query string.
      res.redirect(`/setup/success?guildId=${encodeURIComponent(guildId)}`);
    } catch (err) {
      // #214/U7: styled error page for the browser flow, not raw JSON.
      errorPage(res, 500, "Setup Failed",
        `Something went wrong while saving your configuration: ${err.message}. Use your browser's Back button to return to the form and try again.`);
    }
   });

   // GET /setup/success — Display success page after guild configuration.
   // Issue #198: the display name comes from the DB (looked up by guild
   // id), never from the query string — the old version both rendered
   // attacker-chosen query text on an unauthenticated page and called
   // decodeURIComponent() on a value Express had already percent-decoded
   // (URIError → 500 for any guild name containing a literal '%').
   app.get("/setup/success", (req, res) => {
     const { guildId } = req.query;
     const guild = guildId ? getGuild(db, guildId) : null;
     const displayName = guild?.guild_name || "Your server";
     const statsSharing = guildId ? getGuildStatsSharingStatus(db, guildId) : { enabled: false };

     const body = `
       <div class="success-page">
         <div class="success-icon">✓</div>
         <h1 style="font-size: 28px; margin-bottom: 12px; color: var(--success);">Setup Complete!</h1>
         <p style="color: var(--parchment-dark); font-size: 16px; margin-bottom: 20px;">
           <strong>${esc(displayName)}</strong> is now connected to Mentat.
         </p>
         <div class="panel" style="max-width: 500px; margin: 0 auto 20px;">
           <h2>What's next?</h2>
           <ol style="text-align: left; color: var(--text-light); line-height: 1.8; margin-left: 20px;">
             <li>Go back to Discord</li>
             <li>Assign Discord roles to the four permission tiers (Player, Moderator, Admin, Owner)</li>
             <li>Run <code>/dune core help</code> to see available commands</li>
             <li>Run <code>/dune server status</code> to verify connection to your console</li>
             <li>Live stats sharing: ${statsSharing.enabled ? "enabled — your server's numbers will appear on the public site once your console's first push arrives" : "not enabled"}</li>
           </ol>
         </div>
         <p style="color: var(--muted); font-size: 13px; margin-top: 24px;">
           ${isEncryptionConfigured()
             ? "Your adapter token is encrypted at rest. You can now use slash commands in Discord."
             : "Your adapter token is stored on the bot host (the operator has not configured at-rest encryption — <code>ACP_SECRETS_KEY</code>). You can now use slash commands in Discord."}
         </p>
       </div>`;

     res.send(renderPage("Setup Complete", body, {
       heading: "Dune: Awakening Docker — Mentat",
       hero: true,
       glow: true
     }));
   });

   // ── Health / Stats ────────────────────────────────────────────────

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "mentat-setup" });
  });

  app.get("/api/version", (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ version: PKG_VERSION, name: "mentat" });
  });

  app.get("/api/live-stats", (req, res) => {
    try {
      const stats = getStatsSnapshot();
      if (!stats) {
        return res.status(503).json({ error: "No stats collected yet" });
      }
      res.set("Cache-Control", "public, max-age=120");
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: "Stats snapshot unavailable", details: err.message });
    }
  });

  // POST /api/stats/push (mentat#276): each opted-in operator's own Core
  // console pushes its own aggregate live stats here, replacing the
  // broken synthetic-actor pull this route's sibling function
  // (statsPusher.js's fetchAggregate()) used to attempt against Core's
  // admin-tier ops:activity/ops:resources routes. See the Layer 1
  // Eight-Hats design audit (issue comment on mentat#276) for the full
  // rationale behind every decision in this handler.
  //
  // Auth failure (unknown guild_id, a known guild that never opted in, or
  // a genuinely wrong secret) always returns the exact same 401 body --
  // see verifyGuildStatsPushSecret() in database.js for the matching
  // constant-cost comparison. This route deliberately does NOT reuse
  // alertRelayToken()/the fail-open pattern above: unlike
  // /api/alerts/relay, there is no existing deployment to stay backward
  // compatible with, so this is fail-closed from day one, scoped per
  // guild rather than one global token.
  app.post("/api/stats/push", express.json(), (req, res) => {
    const rawGuildId = req.body?.guildId;
    const guildId = typeof rawGuildId === "string" ? rawGuildId : "";
    const authHeader = req.get("authorization") || "";
    const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    // Global rate limit is checked/recorded BEFORE the auth check touches
    // the DB — this is what actually bounds the synchronous lookup+decrypt
    // cost every request pays regardless of whether its credential turns
    // out to be valid (Layer 1 Architect/Security Architect audit findings
    // C1/#3). Safe to record pre-auth: this bucket has no guild_id key, so
    // it can't be aimed at a specific victim guild.
    const globalResult = recordGlobalStatsPushAttempt();
    if (!globalResult.allowed) {
      res.set("Retry-After", String(globalResult.retryAfterSeconds));
      return res.status(429).json({ error: "rate_limited" });
    }

    if (!verifyGuildStatsPushSecret(db, guildId, providedSecret)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Per-guild rate limit is only ever recorded AFTER auth has already
    // succeeded (Layer 2 /code-review high finding, mentat#276) — guild_id
    // arrives unauthenticated in the request body, and Discord guild IDs
    // are public, not secret. Recording this bucket pre-auth (as an
    // earlier version of this route did) would let anyone who merely
    // knows a victim guild's ID exhaust that specific guild's quota with
    // zero valid credentials, denying its real console's own legitimate
    // pushes. See statsPushRateLimit.js's module comment for the full
    // rationale.
    const guildResult = recordGuildStatsPushAttempt(guildId);
    if (!guildResult.allowed) {
      res.set("Retry-After", String(guildResult.retryAfterSeconds));
      return res.status(429).json({ error: "rate_limited" });
    }

    const { playersOnline, spiceFields, sietches } = req.body || {};
    const accepted = upsertGuildStatsSnapshot(guildId, { playersOnline, spiceFields, sietches });
    if (!accepted) {
      // Non-numeric/negative/absurd field — rejected without touching the
      // previous snapshot value (Layer 1 Security Architect finding #4).
      return res.status(400).json({ error: "invalid_payload" });
    }

    // nextPushSeconds mirrors publicDirectory.js's nextHeartbeatSeconds
    // mechanism (Layer 1 Network audit finding #20) so a future
    // load-based adjustment doesn't require a new field on every
    // already-deployed Core instance. Fixed for now.
    res.json({ ok: true, nextPushSeconds: 90 });
  });

  // Alertmanager → Discord webhook relay. Receives firing/resolved alerts
  // from Prometheus's Alertmanager, reformats into Discord embeds, and posts
  // to the configured DUNE_ALERT_WEBHOOK_URL. If no webhook URL is configured,
  // the endpoint accepts the payload but takes no action (idempotent, safe).
  app.post("/api/alerts/relay", express.json(), async (req, res) => {
    const expectedToken = alertRelayToken();
    if (expectedToken) {
      const authHeader = req.get("authorization") || "";
      const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!tokenMatches(providedToken, expectedToken)) {
        logError("alerts_relay.unauthorized", new Error("Missing or invalid bearer token"), {
          remote: req.ip,
          hasAuthHeader: Boolean(authHeader)
        });
        return res.status(401).json({ error: "Unauthorized — missing or invalid bearer token." });
      }
    } else {
      // Opt-in/backward-compatible (issue #167): logged loudly on every
      // request rather than silently, so an operator who hasn't yet set
      // DUNE_ALERT_RELAY_TOKEN sees this in their logs, but existing
      // deployments are not broken the moment this ships.
      logInfo("alerts_relay.unauthenticated_request_allowed", {
        remote: req.ip,
        warning: "DUNE_ALERT_RELAY_TOKEN is not set -- this endpoint accepts unauthenticated requests. See issue #167."
      });
    }

    const payload = req.body;
    if (!payload || !payload.alerts || !Array.isArray(payload.alerts)) {
      return res.status(400).json({ error: "Invalid Alertmanager payload — expected {alerts: [...]}" });
    }

    const webhookUrl = process.env.DUNE_ALERT_WEBHOOK_URL;
    // Send in batches of 10 embeds (Discord limit per message)
    const EMBED_LIMIT = 10;
    let fired = 0;

    try {
      for (let i = 0; i < payload.alerts.length; i += EMBED_LIMIT) {
        const batch = payload.alerts.slice(i, i + EMBED_LIMIT);
        const embeds = batch.map(function alertToEmbed(alert) {
          const firing = alert.status === "firing";
          return {
            title: `${firing ? "🔥" : "✅"} ${alert.labels.alertname}`,
            description: alert.annotations.description || alert.annotations.summary || "",
            color: alert.labels.severity === "critical" ? 0xe74c3c : 0xf39c12,
            fields: [
              { name: "Instance", value: alert.labels.instance || "unknown", inline: true },
              { name: "Severity", value: alert.labels.severity || "unknown", inline: true },
              { name: firing ? "Firing since" : "Resolved at", value: alert.startsAt, inline: false }
            ],
            timestamp: alert.startsAt
          };
        });

        if (webhookUrl) {
          const discordPayload = JSON.stringify({ embeds });
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: discordPayload
          });
          fired += batch.length;
        }
      }

      res.json({
        ok: true,
        total: payload.alerts.length,
        relayed: fired,
        skipped: payload.alerts.length - fired,
        webhookConfigured: Boolean(webhookUrl)
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message || "Discord relay failed" });
    }
  });

  // GET /api/commands — public command registry for the landing page and docs.
  // Returns all command groups with names, descriptions, and required roles.
  // Used by acp-landing to auto-generate the command reference accordion, so
  // it can never drift from the actual bot implementation.
  app.get("/api/commands", async (_req, res) => {
    try {
      const { getCommandRegistry } = await import("./commands.js");
      res.json(getCommandRegistry());
    } catch (err) {
      res.status(500).json({ error: "Failed to load command registry", details: err.message });
    }
  });

  return app;
}
