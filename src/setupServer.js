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
import { esc } from "./htmlEscape.js";

const DISCORD_OAUTH_URL = "https://discord.com/api/v10/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/v10/users/@me";

export function createSetupServer(config) {
  const app = express();
  const db = createDatabase(config.dbPath);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static("public"));

  const redirectUri = config.oauthRedirectUri || `${config.baseUrl}/oauth/callback`;

  // Friendly landing page for the bare domain root. Previously the root
  // fell through to Express's default "Cannot GET /" error page, which
  // looked broken to anyone landing here without a path (bookmark, typo,
  // bare-domain visit). Minimal by design -- this is a setup-flow server,
  // not a marketing site (issue #91). Uses the same dark/sand style as the
  // /setup page above.
  app.get("/", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Arrakis Control Panel</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Marcellus&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg-deep: #0d0f12;
            --bg-board: #1a1510;
            --parchment-dark: #d4c4a0;
            --sand-light: #ffd08a;
            --sand-mid: #c68b4a;
            --spice-glow: #e8a84c;
            --sienna: #6b3a2a;
            --text-light: #f3efe7;
            --muted: #ad9f89;
            --border-strong: #4d4032;
            --font-heading: 'Marcellus', serif;
            --font-body: 'Inter', sans-serif;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font-body);
            background: var(--bg-deep);
            color: var(--text-light);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
          }
          .hero-icon {
            width: 80px; height: 80px;
            margin: 0 auto 20px;
            border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, var(--spice-glow), var(--sand-mid), var(--sienna));
            box-shadow: 0 0 30px rgba(232, 168, 76, 0.3), 0 0 60px rgba(232, 168, 76, 0.15);
          }
          h1 {
            font-family: var(--font-heading);
            font-size: clamp(28px, 5vw, 42px);
            color: var(--sand-light);
            text-align: center;
            margin-bottom: 8px;
            letter-spacing: 0.02em;
          }
          .subtitle {
            font-family: var(--font-heading);
            font-style: italic;
            font-size: 18px;
            color: var(--parchment-dark);
            text-align: center;
            margin-bottom: 32px;
          }
          .panel {
            background: var(--bg-board);
            border: 1px solid var(--border-strong);
            border-radius: 12px;
            padding: 24px;
            max-width: 480px;
            width: 100%;
            text-align: center;
          }
          .panel p {
            color: var(--muted);
            font-size: 15px;
            margin-bottom: 20px;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: linear-gradient(135deg, var(--spice-glow), var(--sand-mid));
            color: var(--bg-deep);
            border: none;
            padding: 14px 28px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 4px 24px rgba(232, 168, 76, 0.3);
          }
          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 36px rgba(232, 168, 76, 0.5);
          }
        </style>
      </head>
      <body>
        <div class="hero-icon" aria-hidden="true"></div>
        <h1>Arrakis Control Panel</h1>
        <p class="subtitle">Arrakis is where you go to die.</p>
        <section class="panel">
          <p>This server hosts the Arrakis Control Panel setup flow, which connects a Discord server to its Dune Awakening game console.</p>
          <a href="/setup" class="btn">Continue to Setup</a>
        </section>
      </body>
      </html>
    `);
  });

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
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Marcellus&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg-deep: #0d0f12;
            --bg-board: #1a1510;
            --parchment: #f5e6c8;
            --parchment-dark: #d4c4a0;
            --sand-light: #ffd08a;
            --sand-mid: #c68b4a;
            --spice-glow: #e8a84c;
            --sienna: #6b3a2a;
            --text-light: #f3efe7;
            --muted: #ad9f89;
            --border: #302b25;
            --border-strong: #4d4032;
            --font-heading: 'Marcellus', serif;
            --font-body: 'Inter', sans-serif;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font-body);
            background: var(--bg-deep);
            color: var(--text-light);
            line-height: 1.6;
            min-height: 100vh;
          }
          .sand-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
          .sand-particle {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 208, 138, 0.35);
            animation: sandDrift linear infinite;
          }
          @keyframes sandDrift {
            0%   { transform: translateX(-5vw) translateY(0); opacity: 0; }
            10%  { opacity: 0.7; }
            90%  { opacity: 0.7; }
            100% { transform: translateX(105vw) translateY(15vh); opacity: 0; }
          }
          .page-wrapper {
            position: relative;
            z-index: 1;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
          }
          .hero-glow {
            position: fixed;
            width: 500px; height: 500px;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            background: radial-gradient(circle, rgba(232, 168, 76, 0.08) 0%, transparent 70%);
            animation: glowPulse 6s ease-in-out infinite alternate;
            pointer-events: none;
            z-index: 0;
          }
          @keyframes glowPulse {
            0% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
          }
          .hero-icon {
            width: 80px; height: 80px;
            margin: 0 auto 20px;
            border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, var(--spice-glow), var(--sand-mid), var(--sienna));
            box-shadow: 0 0 30px rgba(232, 168, 76, 0.3), 0 0 60px rgba(232, 168, 76, 0.15);
            animation: iconFloat 4s ease-in-out infinite alternate;
          }
          @keyframes iconFloat {
            0% { transform: translateY(0); }
            100% { transform: translateY(-6px); }
          }
          h1 {
            font-family: var(--font-heading);
            font-size: clamp(28px, 5vw, 42px);
            color: var(--sand-light);
            text-align: center;
            margin-bottom: 8px;
            letter-spacing: 0.02em;
          }
          .subtitle {
            font-family: var(--font-heading);
            font-style: italic;
            font-size: 18px;
            color: var(--parchment-dark);
            text-align: center;
            margin-bottom: 32px;
          }
          .panel {
            background: var(--bg-board);
            border: 1px solid var(--border-strong);
            border-radius: 12px;
            padding: 24px;
            max-width: 480px;
            width: 100%;
            text-align: center;
          }
          .panel h2 {
            font-family: var(--font-heading);
            font-size: 20px;
            color: var(--sand-light);
            margin-bottom: 12px;
          }
          .panel p {
            color: var(--muted);
            font-size: 15px;
            margin-bottom: 20px;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: linear-gradient(135deg, var(--spice-glow), var(--sand-mid));
            color: var(--bg-deep);
            border: none;
            padding: 14px 28px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 4px 24px rgba(232, 168, 76, 0.3);
          }
          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 36px rgba(232, 168, 76, 0.5);
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="sand-layer" id="sandLayer" aria-hidden="true"></div>
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="page-wrapper">
          <div class="hero-icon" aria-hidden="true"></div>
          <h1>Arrakis Control Panel</h1>
          <p class="subtitle">Connect your Discord server to your game console.</p>
          <section class="panel">
            <h2>Sign In</h2>
            <p>Sign in with Discord to configure your server.</p>
            <a href="${authUrl.toString()}" class="btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A18.4 18.4 0 0 0 15.8 3l-.2.4a13.1 13.1 0 0 1 4 2 14.2 14.2 0 0 0-5-1.5 14.8 14.8 0 0 0-5.2 0 14.2 14.2 0 0 0-5 1.5 13.1 13.1 0 0 1 4-2L8.2 3a18.4 18.4 0 0 0-4.5 1.4C.9 8.5.1 12.5.5 16.5A18.7 18.7 0 0 0 6 19.2l.7-.9a11.6 11.6 0 0 1-1.8-.9l.4-.3a13.2 13.2 0 0 0 13.4 0l.4.3a11.6 11.6 0 0 1-1.8.9l.7.9a18.7 18.7 0 0 0 5.5-2.7c.5-4.6-.8-8.5-3.2-12.1ZM8.4 14.2c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.2 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>
              Sign in with Discord
            </a>
          </section>
        </div>
        <script>
          (function() {
            const layer = document.getElementById('sandLayer');
            if (!layer) return;
            for (let i = 0; i < 20; i++) {
              const p = document.createElement('div');
              p.className = 'sand-particle';
              const size = Math.random() * 4 + 2;
              p.style.cssText = 'width:' + size + 'px;height:' + size + 'px;top:' + (Math.random() * 100) + '%;left:' + (Math.random() * -10) + '%;animation-duration:' + (Math.random() * 15 + 10) + 's;animation-delay:' + (Math.random() * 10) + 's;';
              layer.appendChild(p);
            }
          })();
        </script>
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
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Marcellus&display=swap" rel="stylesheet">
          <style>
            :root {
              --bg-deep: #0d0f12;
              --bg-board: #1a1510;
              --parchment: #f5e6c8;
              --parchment-dark: #d4c4a0;
              --sand-light: #ffd08a;
              --sand-mid: #c68b4a;
              --spice-glow: #e8a84c;
              --sienna: #6b3a2a;
              --text-light: #f3efe7;
              --muted: #ad9f89;
              --border: #302b25;
              --border-strong: #4d4032;
              --font-heading: 'Marcellus', serif;
              --font-body: 'Inter', sans-serif;
              --font-code: ui-monospace, 'SF Mono', 'Consolas', monospace;
            }
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: var(--font-body);
              background: var(--bg-deep);
              color: var(--text-light);
              line-height: 1.6;
              min-height: 100vh;
            }
            .sand-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
            .sand-particle {
              position: absolute;
              border-radius: 50%;
              background: rgba(255, 208, 138, 0.35);
              animation: sandDrift linear infinite;
            }
            @keyframes sandDrift {
              0%   { transform: translateX(-5vw) translateY(0); opacity: 0; }
              10%  { opacity: 0.7; }
              90%  { opacity: 0.7; }
              100% { transform: translateX(105vw) translateY(15vh); opacity: 0; }
            }
            .hero-glow {
              position: fixed;
              width: 500px; height: 500px;
              top: 50%; left: 50%;
              transform: translate(-50%, -50%);
              background: radial-gradient(circle, rgba(232, 168, 76, 0.06) 0%, transparent 70%);
              animation: glowPulse 6s ease-in-out infinite alternate;
              pointer-events: none;
              z-index: 0;
            }
            @keyframes glowPulse {
              0% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
              100% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
            }
            .page-wrapper {
              position: relative;
              z-index: 1;
              max-width: 640px;
              margin: 0 auto;
              padding: 40px 20px 60px;
            }
            .page-header {
              text-align: center;
              margin-bottom: 32px;
            }
            h1 {
              font-family: var(--font-heading);
              font-size: clamp(24px, 4vw, 36px);
              color: var(--sand-light);
              margin-bottom: 4px;
              letter-spacing: 0.02em;
            }
            .welcome {
              color: var(--parchment-dark);
              font-size: 16px;
            }
            .panel {
              background: var(--bg-board);
              border: 1px solid var(--border-strong);
              border-radius: 12px;
              padding: 24px;
              margin-bottom: 20px;
            }
            .panel h2 {
              font-family: var(--font-heading);
              font-size: 18px;
              color: var(--sand-light);
              margin-bottom: 16px;
            }
            label {
              display: block;
              margin-bottom: 4px;
              font-weight: 600;
              font-size: 14px;
              color: var(--parchment-dark);
            }
            input, select {
              width: 100%;
              padding: 10px 12px;
              border-radius: 8px;
              border: 1px solid var(--border-strong);
              background: rgba(13, 15, 18, 0.6);
              color: var(--text-light);
              font-family: var(--font-body);
              font-size: 14px;
              margin-bottom: 4px;
              transition: border-color 0.2s;
            }
            input:focus, select:focus {
              outline: none;
              border-color: var(--spice-glow);
              box-shadow: 0 0 0 2px rgba(232, 168, 76, 0.2);
            }
            .hint {
              font-size: 13px;
              color: var(--muted);
              margin-bottom: 14px;
            }
            code {
              font-family: var(--font-code);
              font-size: 0.9em;
              padding: 2px 6px;
              border-radius: 4px;
              background: rgba(232, 168, 76, 0.12);
              color: var(--sand-light);
            }
            .btn {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              background: linear-gradient(135deg, var(--spice-glow), var(--sand-mid));
              color: var(--bg-deep);
              border: none;
              padding: 14px 28px;
              border-radius: 10px;
              font-weight: 700;
              font-size: 16px;
              cursor: pointer;
              text-decoration: none;
              transition: transform 0.2s, box-shadow 0.2s;
              box-shadow: 0 4px 24px rgba(232, 168, 76, 0.3);
              margin-top: 8px;
            }
            .btn:hover {
              transform: translateY(-2px);
              box-shadow: 0 4px 36px rgba(232, 168, 76, 0.5);
              text-decoration: none;
            }
            .btn-sm {
              padding: 10px 16px;
              font-size: 14px;
              margin-top: 0;
              white-space: nowrap;
            }
            .token-row {
              display: flex;
              gap: 8px;
            }
            .token-row input {
              flex: 1;
            }
            .success-page {
              text-align: center;
              padding: 80px 20px;
            }
            .success-page h1 {
              color: var(--sand-light);
            }
            .success-page p {
              color: var(--muted);
              margin-bottom: 8px;
            }
            .success-icon {
              width: 64px; height: 64px;
              margin: 0 auto 20px;
              border-radius: 50%;
              background: radial-gradient(circle at 30% 30%, var(--spice-glow), var(--sand-mid));
              box-shadow: 0 0 30px rgba(232, 168, 76, 0.4);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 32px;
            }
          </style>
        </head>
        <body>
          <div class="sand-layer" id="sandLayer" aria-hidden="true"></div>
          <div class="hero-glow" aria-hidden="true"></div>
          <div class="page-wrapper">
            <div class="page-header">
              <h1>Configure Your Server</h1>
              <p class="welcome">Welcome, ${userName}!</p>
            </div>

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

                <label for="ownerRoleId">Owner Role ID <em>(optional)</em></label>
                <input type="text" name="ownerRoleId" id="ownerRoleId" placeholder="Discord role ID">
                <div class="hint">Members with this role can use owner-tier actions (backups, restarts, updates) when writes are enabled</div>

                <label for="adminRoleId">Admin Role ID</label>
                <input type="text" name="adminRoleId" id="adminRoleId" placeholder="Discord role ID">
                <div class="hint">Members with this role can use admin commands</div>

                <label for="moderatorRoleId">Moderator Role ID <em>(optional)</em></label>
                <input type="text" name="moderatorRoleId" id="moderatorRoleId" placeholder="Discord role ID">
                <div class="hint">Members with this role can use read-only commands and future moderation tools</div>

                <label for="observerRoleId">Player Role ID</label>
                <input type="text" name="observerRoleId" id="observerRoleId" placeholder="Discord role ID">
                <div class="hint">Members with this role can use read-only commands</div>
              </section>

              <button type="submit" class="btn">Connect Server</button>
            </form>
          </div>

          <script>
            (function() {
              var layer = document.getElementById('sandLayer');
              if (!layer) return;
              for (var i = 0; i < 20; i++) {
                var p = document.createElement('div');
                p.className = 'sand-particle';
                var size = Math.random() * 4 + 2;
                p.style.cssText = 'width:' + size + 'px;height:' + size + 'px;top:' + (Math.random() * 100) + '%;left:' + (Math.random() * -10) + '%;animation-duration:' + (Math.random() * 15 + 10) + 's;animation-delay:' + (Math.random() * 10) + 's;';
                layer.appendChild(p);
              }
            })();
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
                document.body.innerHTML = '<div class="sand-layer" id="sandLayer"></div><div class="hero-glow"></div><div class="success-page"><div class="success-icon">&#x2714;</div><h1>Connected!</h1><p>Your server "' + escHtml(data.guildName) + '" is now connected to ACP.</p><p>Use <code>/dune core help</code> in Discord to see available commands.</p></div>';
                (function() {
                  var layer = document.getElementById('sandLayer');
                  if (!layer) return;
                  for (var i = 0; i < 20; i++) {
                    var p = document.createElement('div');
                    p.className = 'sand-particle';
                    var size = Math.random() * 4 + 2;
                    p.style.cssText = 'width:' + size + 'px;height:' + size + 'px;top:' + (Math.random() * 100) + '%;left:' + (Math.random() * -10) + '%;animation-duration:' + (Math.random() * 15 + 10) + 's;animation-delay:' + (Math.random() * 10) + 's;';
                    layer.appendChild(p);
                  }
                })();
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

      // All four unified tiers are enrolled here. owner/moderator are
      // optional -- their absence simply means the guild has no users at
      // that tier, which the tier resolver fails closed on.
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

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "acp-setup" });
  });

  return app;
}
