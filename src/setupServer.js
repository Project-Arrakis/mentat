import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { logInfo, logError } from "./logger.js";
import {
  createDatabase,
  createOauthSession,
  getOauthSession,
  updateOauthSession,
  deleteOauthSession,
  upsertGuild,
  getGuild,
  addGuildRole,
  updateGuildSettings,
  getStatsSnapshot
} from "./database.js";
import { esc } from "./htmlEscape.js";
import { renderPage, errorPage } from "./setupLayout.js";

const DISCORD_OAUTH_URL = "https://discord.com/api/v10/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/v10/users/@me";

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

export function createSetupServer(config) {
  const app = express();
  const db = createDatabase(config.dbPath);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static("public"));

  // CORS — allow the landing page (acp.darkdante.org) to fetch public API endpoints.
  // No auth endpoints are exposed here; all are read-only public data.
  const ALLOWED_ORIGINS = [
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
        <p style="color:var(--muted);font-size:15px;margin-bottom:20px;">This server hosts the Arrakis Control Panel setup flow, which connects a Discord server to its Dune Awakening game console.</p>
        <a href="/setup" class="btn">Continue to Setup</a>
      </section>`;
    res.send(renderPage("Arrakis Control Panel", body, {
      heading: "Arrakis Control Panel",
      subtitle: "Arrakis is where you go to die.",
      hero: true,
      center: true
    }));
  });

  // ── Sign-in page ──────────────────────────────────────────────────

  app.get("/setup", (req, res) => {
    const { guildId } = req.query;
    const state = randomBytes(16).toString("hex");

    createOauthSession(db, {
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
    res.send(renderPage("ACP Setup", body, {
      heading: "Arrakis Control Panel",
      subtitle: "Connect your Discord server to your game console.",
      hero: true,
      center: true
    }));
  });

  // ── OAuth callback / configuration form ───────────────────────────

  app.get("/oauth/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) return errorPage(res, 400, "OAuth Error", `Discord returned an error: ${error}`);

    const session = getOauthSession(db, state);
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
      updateOauthSession(db, state, {
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

        <div id="form-error" class="notification notification--error" role="alert">
          <span class="notification__icon">!</span>
          <div class="notification__body">
            <div class="notification__title">Error</div>
            <div id="form-error-msg"></div>
          </div>
        </div>

        <div id="form-success" class="notification notification--success" role="status">
          <span class="notification__icon">&#x2714;</span>
          <div class="notification__body">
            <div class="notification__title">Connected</div>
            <div id="form-success-msg">Your server has been connected. Use <code>/dune core help</code> in Discord.</div>
          </div>
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
            <div class="field">
              <label for="consoleUrl">Console URL</label>
              <input type="url" name="consoleUrl" id="consoleUrl" placeholder="http://your-server:8088" required>
              <div class="hint">Your Dune Docker Console WebUI address</div>
            </div>
            <div class="field">
              <label for="adapterToken">Adapter Token</label>
              <div class="token-row">
                <input type="text" name="adapterToken" id="adapterToken" placeholder="your-adapter-token" required>
                <button type="button" class="btn btn--sm" onclick="generateToken()">Generate</button>
              </div>
              <div class="hint">
                <strong>Enable the adapter first:</strong> In your Dune Docker <code>.env</code>, set:<br>
                <code>DUNE_DISCORD_ADAPTER_ENABLED=true</code><br>
                <code>DUNE_BOT_API_TOKEN_FILE=/repo/runtime/secrets/discord-adapter-token.txt</code><br>
                Then restart the console. The token is in that file — copy it here.
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>Step 3: Role Configuration</h2>
            <div class="field">
              <label for="ownerRoleId">Owner Role <em>(optional)</em></label>
              <input type="text" name="ownerRoleId" id="ownerRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use owner-tier actions (backups, restarts, updates) when writes are enabled</div>
            </div>
            <div class="field">
              <label for="adminRoleId">Admin Role</label>
              <input type="text" name="adminRoleId" id="adminRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use admin commands</div>
            </div>
            <div class="field">
              <label for="moderatorRoleId">Moderator Role <em>(optional)</em></label>
              <input type="text" name="moderatorRoleId" id="moderatorRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use read-only commands and future moderation tools</div>
            </div>
            <div class="field">
              <label for="observerRoleId">Player Role</label>
              <input type="text" name="observerRoleId" id="observerRoleId" placeholder="Discord role ID">
              <div class="hint">Members can use read-only commands</div>
            </div>
          </section>

          <div class="btn--text-center" style="margin-top:8px;">
            <button type="submit" id="submit-btn" class="btn">Connect Server</button>
          </div>
        </form>`;

      res.send(renderPage("ACP Setup — Configure Server", body));

    } catch (err) {
      errorPage(res, 500, "Setup Error", err.message);
    }
  });

  // ── Registration endpoint ─────────────────────────────────────────

  app.post("/setup/register", async (req, res) => {
    try {
      const { discordUserId, guildId, consoleUrl, adapterToken, ownerRoleId, adminRoleId, moderatorRoleId, observerRoleId } = req.body;

      if (!guildId || !consoleUrl || !adapterToken) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const guildName = req.body.guildName || "Unknown";

      upsertGuild(db, {
        guildId,
        guildName,
        consoleUrl,
        adapterToken,
        status: "active"
      });

      if (ownerRoleId) addGuildRole(db, guildId, "owner", ownerRoleId);
      if (moderatorRoleId) addGuildRole(db, guildId, "moderator", moderatorRoleId);
      if (adminRoleId) addGuildRole(db, guildId, "admin", adminRoleId);
      if (observerRoleId) addGuildRole(db, guildId, "observer", observerRoleId);

      updateGuildSettings(db, guildId, {
        rbac_mode: "restricted",
        default_ephemeral: 1
      });

      res.json({ ok: true, guildId, guildName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Health / Stats ────────────────────────────────────────────────

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "acp-setup" });
  });

  app.get("/api/version", (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ version: "1.0.0-rc.3", name: "arrakis-control-panel" });
  });

  app.get("/api/live-stats", (req, res) => {
    try {
      const stats = getStatsSnapshot(db);
      if (!stats) {
        return res.status(503).json({ error: "No stats collected yet" });
      }
      res.set("Cache-Control", "public, max-age=120");
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: "Stats snapshot unavailable", details: err.message });
    }
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
