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

    // Store the session so the callback can validate it
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

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>ACP Setup</title>
        <style>
          :root {
            color-scheme: light dark;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.5;
          }
          body {
            margin: 0;
            color: #18202a;
            background: #f6f7f9;
          }
          main {
            max-width: 920px;
            margin: 0 auto;
            padding: 32px 20px 48px;
          }
          h1 {
            margin: 0 0 8px;
            font-size: 28px;
            line-height: 1.15;
          }
          h2 {
            margin: 28px 0 8px;
            font-size: 18px;
          }
          p, li {
            font-size: 15px;
          }
          code {
            padding: 2px 5px;
            border-radius: 4px;
            background: #e7ebf0;
          }
          .panel {
            margin-top: 20px;
            padding: 18px;
            border: 1px solid #d9dee6;
            border-radius: 8px;
            background: #ffffff;
          }
          .btn {
            display: inline-block;
            background: #c4883a;
            color: #fff;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            text-decoration: none;
            margin-top: 12px;
          }
          .btn:hover {
            background: #b07830;
          }
          @media (prefers-color-scheme: dark) {
            body {
              color: #e7edf5;
              background: #111820;
            }
            .panel {
              border-color: #303b49;
              background: #18222d;
            }
            code {
              background: #263241;
            }
            .btn {
              background: #c4883a;
              color: #111820;
            }
            .btn:hover {
              background: #d4984a;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Arrakis Control Panel</h1>
          <p>Connect your Discord server to your game console.</p>
          <section class="panel">
            <h2>Sign In</h2>
            <p>Sign in with Discord to configure your server.</p>
            <a href="${authUrl.toString()}" class="btn">Sign in with Discord</a>
          </section>
        </main>
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
      let ownedGuilds = guilds.filter(g => g.owner === true || (BigInt(g.permissions || 0) & 0x8n) === 0x8n);
      if (ownedGuilds.length === 0) ownedGuilds = guilds;

      const userName = esc(user.global_name || user.username);
      const userId = esc(user.id);
      const accessToken = esc(tokenData.access_token);
      const guildOptions = ownedGuilds.map(g =>
        `<option value="${esc(g.id)}">${esc(g.name)}</option>`
      ).join("");

      // All user-controlled values are HTML-escaped via esc() before embedding.
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ACP Setup — Configure Server</title>
          <style>
            :root {
              color-scheme: light dark;
              font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              line-height: 1.5;
            }
            body {
              margin: 0;
              color: #18202a;
              background: #f6f7f9;
            }
            main {
              max-width: 920px;
              margin: 0 auto;
              padding: 32px 20px 48px;
            }
            h1 {
              margin: 0 0 8px;
              font-size: 28px;
              line-height: 1.15;
            }
            h2 {
              margin: 28px 0 8px;
              font-size: 18px;
            }
            p, li {
              font-size: 15px;
            }
            code {
              padding: 2px 5px;
              border-radius: 4px;
              background: #e7ebf0;
            }
            .panel {
              margin-top: 20px;
              padding: 18px;
              border: 1px solid #d9dee6;
              border-radius: 8px;
              background: #ffffff;
            }
            label {
              display: block;
              margin: 12px 0 4px;
              font-weight: 600;
              font-size: 14px;
            }
            input, select {
              width: 100%;
              padding: 8px 10px;
              border-radius: 4px;
              border: 1px solid #d9dee6;
              background: #fff;
              color: #18202a;
              box-sizing: border-box;
              font-size: 14px;
            }
            .hint {
              font-size: 13px;
              color: #6b7a8d;
              margin: 4px 0 12px;
            }
            .btn {
              display: inline-block;
              background: #c4883a;
              color: #fff;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              font-weight: 600;
              font-size: 15px;
              cursor: pointer;
              margin-top: 16px;
            }
            .btn:hover {
              background: #b07830;
            }
            .token-row {
              display: flex;
              gap: 8px;
            }
            .token-row input {
              flex: 1;
            }
            .btn-sm {
              padding: 8px 12px;
              font-size: 13px;
              margin-top: 0;
              white-space: nowrap;
            }
            @media (prefers-color-scheme: dark) {
              body {
                color: #e7edf5;
                background: #111820;
              }
              .panel {
                border-color: #303b49;
                background: #18222d;
              }
              code {
                background: #263241;
              }
              input, select {
                border-color: #303b49;
                background: #222d3a;
                color: #e7edf5;
              }
              .hint {
                color: #8a9bb5;
              }
              .btn {
                background: #c4883a;
                color: #111820;
              }
              .btn:hover {
                background: #d4984a;
              }
            }
          </style>
        </head>
        <body>
          <main>
            <h1>Configure Your Server</h1>
            <p>Welcome, ${userName}!</p>

            <form id="setup-form" action="/setup/register" method="POST">
              <input type="hidden" name="discordUserId" value="${userId}">
              <input type="hidden" name="accessToken" value="${accessToken}">

              <section class="panel">
                <h2>Step 1: Select Server</h2>
                <label for="guildId">Discord Server</label>
                <select name="guildId" id="guildId" required>
                  <option value="">— Select a server —</option>
                  ${guildOptions}
                </select>
              </section>

              <section class="panel">
                <h2>Step 2: Console Connection</h2>
                <label for="consoleUrl">Console URL</label>
                <input type="url" name="consoleUrl" id="consoleUrl" placeholder="http://your-server:8088" required>
                <div class="hint">Your Dune Docker Console WebUI address</div>

                <label for="adapterToken">Adapter Token</label>
                <div class="token-row">
                  <input type="text" name="adapterToken" id="adapterToken" placeholder="your-adapter-token" required>
                  <button type="button" class="btn btn-sm" onclick="generateToken()">Generate</button>
                </div>
                <div class="hint">
                  <strong>Enable the adapter first:</strong> In your Dune Docker <code>.env</code>, set:<br>
                  <code>DUNE_DISCORD_ADAPTER_ENABLED=true</code><br>
                  <code>DUNE_BOT_API_TOKEN_FILE=/repo/runtime/secrets/discord-adapter-token.txt</code><br>
                  Then restart the console. The token is in that file — copy it here.
                </div>
              </section>

              <section class="panel">
                <h2>Step 3: Role Configuration</h2>
                <label for="observerRoleId">Observer Role ID</label>
                <input type="text" name="observerRoleId" id="observerRoleId" placeholder="Discord role ID">
                <div class="hint">Members with this role can use read-only commands</div>

                <label for="adminRoleId">Admin Role ID</label>
                <input type="text" name="adminRoleId" id="adminRoleId" placeholder="Discord role ID">
                <div class="hint">Members with this role can use admin commands</div>
              </section>

              <button type="submit" class="btn">Connect Server</button>
            </form>
          </main>

          <script>
            function escHtml(str) {
              return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
            }
            function generateToken() {
              const bytes = new Uint8Array(32);
              crypto.getRandomValues(bytes);
              const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
              document.getElementById('adapterToken').value = token;
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
                document.body.innerHTML = '<main style="text-align:center;padding:60px 20px;"><h1>✅ Connected!</h1><p>Your server "' + escHtml(data.guildName) + '" is now connected to ACP.</p><p>Use <code>/dune core help</code> in Discord to see available commands.</p></main>';
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
