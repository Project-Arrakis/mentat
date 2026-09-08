# Installation Guide — Mentat Discord Bot

**Status:** Current | **Last Updated:** September 2026

Complete installation and deployment guide for Mentat (this project was
previously branded Sentinel, and before that Arrakis Control Panel / ACP).

## Installation Options

Mentat is available as:

1. **Hosted Bot (Recommended)** — Use the official hosted instance
2. **Self-Hosted (Node.js)** — Run your own bot instance directly
3. **Self-Hosted (Docker)** — Build and run your own instance in a container

Choose based on your needs:

| Option | Setup Time | Maintenance | Cost | Best For |
|--------|-----------|-------------|------|----------|
| **Hosted Bot** | ~10 min | None | Free | Most server operators |
| **Self-Hosted (Node.js)** | 20 min | Medium | Low | Large communities, custom features |
| **Self-Hosted (Docker)** | 20 min | Medium | Hosting | Professional deployments |

**Note:** there is no publicly published container image for this project
(no `docker push`/`ghcr.io` step exists in CI) — the Docker option below
builds the image locally from this repo's own `Dockerfile`, it does not
pull a prebuilt one.

### Not sure which to pick?

**If you don't know what Docker or Node.js is, or you just want it working
in a few minutes — choose Hosted.** It's free, it's what most server
operators use, and nothing below this section applies to you; skip
straight to [Option 1](#option-1-hosted-bot-recommended). Self-hosting
(Options 2/3) is for operators who specifically want their own bot
identity, their own token, and full control over updates — pick it on
purpose, not by default.

## Option 1: Hosted Bot (Recommended)

### Setup

1. **Invite the bot** — click the link below, or scan the QR code with your
   phone's camera:

   [**→ Click here to invite Sahir Venn to your server**](https://discord.com/oauth2/authorize?client_id=1546203607807041697&scope=bot%20applications.commands&permissions=128)

   <img src="../assets/qr/invite-hosted.svg" alt="QR code for the Sahir Venn Discord invite link" width="200" height="200">

   (The QR code and the link above go to the exact same place — use
   whichever is easier. If you're reading this on the same phone you'd
   scan with, just tap the link instead.)

2. **Open setup portal:**
   ```
   https://mentat-link.darkdante.org/setup
   ```

3. **Complete the setup form** — see the [Setup Portal Guide](setup-portal-guide.md)
   for the full walkthrough (Console URL, adapter token, and optional role mapping).

4. **Verify — in Discord, type:**
   ```
   /dune core ping
   ```

### Pros & Cons

**Pros:**
- Zero maintenance
- Always up-to-date
- No infrastructure required
- No Docker knowledge needed

**Cons:**
- Depends on hosting stability
- Limited customization
- Data on external servers

## Option 2: Self-Hosted (Node.js)

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Discord Bot Token** and **Application (Client) ID** (from Discord Developer Portal)
- A running **Dune Docker Console** with the Discord adapter enabled (see [Discord Setup](discord-setup.md))
- **Internet connection** for Discord API

### Step 1: Create Your Discord Application, Invite the Bot, and Set Up Roles

Follow **[Discord Setup](discord-setup.md)**, Steps 1 through 5 — it walks
through creating the application, turning off privileged intents you don't
need, generating a correct, ready-made invite link (rather than manually
picking permissions in Discord's own UI, which is easy to get wrong and
would leave a feature silently degraded — see that guide's own explanation
of exactly what `permissions=128` does and why), and creating the Discord
roles that control who can use which commands. By the end of those 5 steps
you'll have:

- Your bot's **Token** (from Discord Setup Step 2)
- Your **Application ID** (from Discord Setup Step 3)
- The bot already invited to your server (from Discord Setup Step 4)
- **Role IDs** for whichever roles you want to grant access (from Discord
  Setup Step 5 — you'll need these for Step 3 below)

Come back here once you have those.

### Step 2: Clone Repository

```bash
git clone https://github.com/Project-Arrakis/mentat.git
cd mentat
npm ci --omit=dev
```

### Step 3: Configure Environment

Copy `.env.example` to `.env` and fill in your values. At minimum:

```bash
# Required
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
DUNE_CONSOLE_API_URL=http://your-console-host:8088
DUNE_DISCORD_ADAPTER_TOKEN=your_console_adapter_token_here

# Role-based access (see .env.example for the full set)
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=your_player_role_id
DISCORD_ADMIN_ROLE_IDS=your_admin_role_id
```

`DISCORD_RBAC_MODE=restricted` means only members holding the roles listed
below can use restricted commands — get the Role IDs to paste in from
[Discord Setup, Step 5](discord-setup.md#step-5-set-up-roles-in-discord).

See [Configuration Reference](configuration.md) for every setting, and
[Environment Variable Compatibility](env-var-compatibility.md) for the
`MENTAT_*`/`SENTINEL_*`/`ACP_*` canonical/legacy prefix scheme used by
several optional settings (base URL, Steam-link port, dashboard URLs).

### Step 4: Run the Bot

```bash
npm start
```

Or use a process manager (an alternative to the systemd approach later in
this guide — pick one, not both):

```bash
npm install -g pm2
pm2 start "npm start" --name mentat-bot
pm2 save
```

### Step 5: Register Slash Commands

**Don't skip this — without it, `/dune` commands won't exist in Discord at
all, even with the bot running and online.** With the bot's `.env` filled
in from Step 3, run once:

```bash
npm run register
```

Commands appear **instantly** if you set `DISCORD_GUILD_ID` in `.env`.
Without it, they register globally and can take up to an hour to appear —
see [Discord Setup, Step 8](discord-setup.md#step-8-register-slash-commands)
for more detail.

### Step 6: Verify

In Discord, type:
```
/dune core ping
```

## Option 3: Self-Hosted (Docker)

### Prerequisites

- Docker & Docker Compose — if you don't already have these installed,
  [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows,
  Mac, or Linux) installs both together with a normal graphical installer,
  no command-line experience needed for the install itself
- The same `.env` values as Option 2 (get these via [Discord Setup](discord-setup.md) first)
- A running Dune Docker Console with the Discord adapter enabled

### Step 1: Build and Run

This repo ships a real `Dockerfile` and `docker-compose.example.yml` — copy
the compose file and build locally rather than pulling a published image
(none is published):

```bash
git clone https://github.com/Project-Arrakis/mentat.git
cd mentat
cp .env.example .env   # fill in your values, per Option 2 Step 3
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
```

The example compose file already applies real container hardening
(`read_only`, `cap_drop: ALL`, `no-new-privileges`, a tmpfs-mounted `/tmp`,
and a real healthcheck script) — see `docker-compose.example.yml` in this
repo for the exact, current definition rather than a copy here that could
drift out of sync.

### Step 2: Register Slash Commands

**Don't skip this — without it, `/dune` commands won't exist in Discord at
all, even with the container running and healthy.** Run once, against the
running container:

```bash
docker compose exec dune-discord-bot node scripts/register-commands.js
```

(Not `npm run register` here — the final container image deliberately
removes `npm` itself to reduce attack surface, so only the plain `node`
form works inside it. `npm run register` is exactly right for Option 2
above, where the bot runs directly on your own host with `npm` installed.)

Commands appear **instantly** if you set `DISCORD_GUILD_ID` in `.env`.
Without it, they register globally and can take up to an hour to appear —
see [Discord Setup, Step 8](discord-setup.md#step-8-register-slash-commands)
for more detail.

### Step 3: Verify

```bash
docker compose logs -f
```

## Securing Your Deployment

**Using the Hosted Bot?** The "Discord Bot Token Security" section below
doesn't apply to you — you never create or hold a bot token; that belongs
to the Mentat/Sahir Venn application, not you. "Console Adapter
Credentials" below it does still apply, since you enter an adapter token
into the setup portal either way.

### Discord Bot Token Security

🔒 **NEVER commit your bot token to Git!**

- Store in `.env` (already covered by `.gitignore`)
- Use environment variables in production
- Rotate token if compromised:
  1. Discord Developer Portal → Bot → Regenerate Token
  2. Update `.env` or environment
  3. Restart bot

### Console Adapter Credentials

🔒 **The adapter token should be treated as a secret:**

- Prefer the `_FILE` variant (`DUNE_DISCORD_ADAPTER_TOKEN_FILE`) over the
  bare env var where possible, so the value doesn't appear in `/proc` or
  process listings
- Rotate it if you suspect it's been exposed, on both the bot and console sides together

### Network Security

- Keep the console's adapter port internal/firewalled where possible
- Use a reverse proxy with HTTPS for any web-facing setup portal
- Use firewall rules to restrict access to only what needs to reach it

## Systemd Service (Self-Hosted)

This repo ships a real, current systemd unit template at
[`systemd/acp-bot.service`](../systemd/acp-bot.service) — use that file
directly rather than hand-typing one, so you get its full hardening
(`ProtectSystem=strict`, `NoNewPrivileges`, syscall filtering, network
address restrictions, and more) rather than a stripped-down copy that
drifts from the real one over time.

**Note on the filename/paths:** the unit template's own path conventions
(`/home/bot/arrakis-control-panel`, description text) reflect this
project's own real production deployment's directory naming, which
predates the Mentat rebrand and was deliberately left unchanged on that
VM (a directory rename there was judged not worth the deploy-path churn).
Substitute your own install path and username throughout when adapting
it for your own host — the paths in the template are not a requirement,
just what this project's own hosted instance happens to use.

**Why the filename changes from `acp-bot.service` to `mentat-bot.service`
below:** that's intentional, not a typo. The source template in this repo
keeps its old `acp-bot.service` name (see above), but the `cp` command
below renames your copy to `mentat-bot.service` so the systemd service on
*your* host is named after the current product, not its old one. Once
copied, every command after that point (`systemctl enable/start/status`,
`journalctl -u`) refers to your renamed copy, `mentat-bot` — not the
source file.

```bash
sudo cp systemd/acp-bot.service /etc/systemd/system/mentat-bot.service
sudo nano /etc/systemd/system/mentat-bot.service   # adjust User/WorkingDirectory/paths for your host
sudo systemctl daemon-reload
sudo systemctl enable mentat-bot
sudo systemctl start mentat-bot
```

### Monitor

```bash
# Check status
sudo systemctl status mentat-bot

# View logs
sudo journalctl -u mentat-bot -f

# Restart
sudo systemctl restart mentat-bot
```

## Upgrading

### Hosted Bot

Updates are automatic. No action needed.

### Self-Hosted (Node.js)

```bash
git pull origin main
npm ci --omit=dev
sudo systemctl restart mentat-bot   # or: npm start, if not running as a service
```

### Self-Hosted (Docker)

```bash
git pull origin main
docker compose up -d --build
```

## Troubleshooting Installation

### Slash Commands Don't Show Up At All

You likely haven't registered them yet — this is a separate step from
starting the bot. See Step 5 (Node.js) / Step 2 (Docker) above:
`npm run register` or `docker compose exec dune-discord-bot node
scripts/register-commands.js`. Without `DISCORD_GUILD_ID` set, global
registration can also take up to an hour to appear — that's normal, not
a sign something's broken.

### Bot Doesn't Respond

(This means the bot itself is unreachable/offline — different from the
commands not existing at all, above.)

1. Check bot is online in Discord
2. Verify `DISCORD_BOT_TOKEN`/`DISCORD_CLIENT_ID` are correct in `.env`
3. Check logs: `docker compose logs -f` or `journalctl -u mentat-bot -f`
4. Ensure bot has permission to use slash commands in channels

### Can't Connect to Game Server Console

1. Verify `DUNE_CONSOLE_API_URL` and `DUNE_DISCORD_ADAPTER_TOKEN` in `.env`
2. Test connectivity: `curl -I $DUNE_CONSOLE_API_URL`
3. Check firewall allows the bot's host to reach the console's adapter port
4. Verify the adapter token matches on both the bot and console sides

### Port Already in Use

If you get "EADDRINUSE" error:

```bash
# Find process using the setup portal's port (default 3100)
lsof -i :3100

# Kill process
kill -9 <PID>
```

### Module Not Found

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm ci --omit=dev
```

## Next Steps

1. **[Quick Start](quick-start-guide.md)** — Basic usage
2. **[Discord Setup](discord-setup.md)** — Self-hosted Discord application/adapter setup (DIY path)
3. **[User Guide](user-guide.md)** — Command reference
4. **[Admin Guide](admin-guide.md)** — Admin features (hosted-bot path)
5. **[Configuration](configuration.md)** — Advanced settings

## Getting Help

- **[FAQ](faq.md)** — Common questions
- **[Troubleshooting](troubleshooting.md)** — Problem solving
- **[GitHub Issues](https://github.com/Project-Arrakis/mentat/issues)** — Bug reports
- **[Discussions](https://github.com/Project-Arrakis/mentat/discussions)** — Questions & ideas

---

**Ready?** Head to the [Quick Start Guide](quick-start-guide.md) to begin! 🎮
