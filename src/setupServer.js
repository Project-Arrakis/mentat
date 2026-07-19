import express from "express";
import { randomBytes } from "node:crypto";
import {
  createDatabase,
  createOauthSession,
  getOauthSession,
  updateOauthSession,
  deleteOauthSession,
  upsertGuild,
  getGuild,
  addGuildRole,
  updateGuildSettings
} from "./database.js";

const DISCORD_OAUTH_URL = "https://discord.com/api/v10/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/v10/users/@me";

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function createSetupServer(config) {
  const app = express();
  const db = createDatabase(config.dbPath);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static("public"));

  const redirectUri = config.oauthRedirectUri || `${config.baseUrl}/oauth/callback`;

  app.get("/setup", (req, res) => {
    const { guildId } = req.query;
    const state = randomBytes(16).toString("hex");

    const authUrl = new URL(DISCORD_OAUTH_URL);
    authUrl.searchParams.set("client_id", config.discordClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "identify guilds");
    authUrl.searchParams.set("state", state);
    if (guildId) authUrl.searchParams.set("guild_id", guildId);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>ACP Setup</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; background: #1a1a2e; color: #eee; }
          .card { background: #16213e; border-radius: 8px; padding: 24px; margin: 20px 0; }
          h1 { color: #e2b857; }
          label { display: block; margin: 12px 0 4px; font-weight: 600; }
          input, select { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #333; background: #0f3460; color: #eee; }
          button { background: #e2b857; color: #1a1a2e; border: none; padding: 12px 24px; border-radius: 4px; font-weight: 600; cursor: pointer; margin-top: 16px; }
          button:hover { background: #d4a843; }
          .hint { font-size: 0.85em; color: #888; margin: 4px 0 12px; }
          a { color: #e2b857; }
        </style>
      </head>
      <body>
        <h1>🐛 ACP Setup</h1>
        <div class="card">
          <p>Connect your Discord server to your Dune Awakening console.</p>
          <a href="${authUrl.toString()}">
            <button>Sign in with Discord</button>
          </a>
        </div>
      </body>
      </html>
    `);
  });

  app.get("/oauth/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(`OAuth error: ${esc(error)}`);
    }

    const session = getOauthSession(db, state);
    if (!session) {
      return res.status(400).send("Invalid or expired session. Please start over.");
    }

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

      if (!tokenRes.ok) {
        throw new Error("Token exchange failed");
      }

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
      const ownedGuilds = guilds.filter(g => (g.permissions & 0x20) === 0x20);

      const userName = esc(user.global_name || user.username);
      const userId = esc(user.id);
      const accessToken = esc(tokenData.access_token);
      const guildOptions = ownedGuilds.map(g =>
        `<option value="${esc(g.id)}">${esc(g.name)}</option>`
      ).join("");

      // All user-controlled values are HTML-escaped via esc() before embedding.
      res.send(` // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
        <!DOCTYPE html>
        <html>
        <head>
          <title>ACP Setup — Configure Server</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; background: #1a1a2e; color: #eee; }
            .card { background: #16213e; border-radius: 8px; padding: 24px; margin: 20px 0; }
            h1 { color: #e2b857; }
            h2 { color: #e2b857; font-size: 1.1em; }
            label { display: block; margin: 12px 0 4px; font-weight: 600; }
            input, select { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #333; background: #0f3460; color: #eee; box-sizing: border-box; }
            button { background: #e2b857; color: #1a1a2e; border: none; padding: 12px 24px; border-radius: 4px; font-weight: 600; cursor: pointer; margin-top: 16px; }
            button:hover { background: #d4a843; }
            .hint { font-size: 0.85em; color: #888; margin: 4px 0 12px; }
            .step { margin: 16px 0; }
          </style>
        </head>
        <body>
          <h1>🐛 Configure Your Server</h1>
          <p>Welcome, ${userName}!</p> /* nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format */

          <form id="setup-form" action="/setup/register" method="POST">
            <input type="hidden" name="discordUserId" value="${userId}"> /* nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format */
            <input type="hidden" name="accessToken" value="${accessToken}"> /* nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format */

            <div class="card">
              <h2>Step 1: Select Server</h2>
              <label for="guildId">Discord Server</label>
              <select name="guildId" id="guildId" required>
                <option value="">— Select a server —</option>
                ${guildOptions} <!-- nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -->
              </select>
            </div>

            <div class="card">
              <h2>Step 2: Console Connection</h2>
              <label for="consoleUrl">Console URL</label>
              <input type="url" name="consoleUrl" id="consoleUrl" placeholder="http://your-server:8088" required>
              <div class="hint">Your Dune Awakening console WebUI address</div>

              <label for="adapterToken">Adapter Token</label>
              <input type="text" name="adapterToken" id="adapterToken" placeholder="your-adapter-token" required>
              <div class="hint">Must match the token in your console's bot-api-token.txt</div>
            </div>

            <div class="card">
              <h2>Step 3: Role Configuration</h2>
              <label for="observerRoleId">Observer Role ID</label>
              <input type="text" name="observerRoleId" id="observerRoleId" placeholder="Discord role ID">
              <div class="hint">Members with this role can use read-only commands</div>

              <label for="adminRoleId">Admin Role ID</label>
              <input type="text" name="adminRoleId" id="adminRoleId" placeholder="Discord role ID">
              <div class="hint">Members with this role can use admin commands</div>
            </div>

            <button type="submit">Connect Server</button>
          </form>

          <script>
            function escHtml(str) {
              return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
            }
            document.getElementById('setup-form').addEventListener('submit', async (e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const res = await fetch('/setup/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(formData))
              });
              const data = await res.json();
              if (res.ok) {
                document.body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><h1>✅ Connected!</h1><p>Your server "' + escHtml(data.guildName) + '" is now connected to ACP.</p><p>Use <code>/dune core help</code> in Discord to see available commands.</p></div>';
              } else {
                alert('Error: ' + (data.error || 'Unknown error'));
              }
            });
          </script>
        </body>
        </html>
      `);
    } catch (err) {
      res.status(500).send(`Setup error: ${esc(err.message)}`);
    }
  });

  app.post("/setup/register", async (req, res) => {
    try {
      const { discordUserId, guildId, consoleUrl, adapterToken, observerRoleId, adminRoleId } = req.body;

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

      if (observerRoleId) addGuildRole(db, guildId, "observer", observerRoleId);
      if (adminRoleId) addGuildRole(db, guildId, "admin", adminRoleId);

      updateGuildSettings(db, guildId, {
        rbac_mode: "restricted",
        default_ephemeral: 1
      });

      res.json({ ok: true, guildId, guildName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "acp-setup" });
  });

  return app;
}
