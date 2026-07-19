# Installation Guide — Dune Discord Bot

Add the Dune Discord Bot to your server and deploy it alongside the Dune
Awakening Selfhost Docker Console.

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/yacketrj/Arrakis-Control-Panel.git
cd dune-awakening-selfhost-discordbot

# 2. Copy and edit the environment file
cp .env.example .env
# Fill in DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DUNE_CONSOLE_API_URL, DUNE_DISCORD_ADAPTER_TOKEN

# 3. Install and test
npm ci --omit=dev
npm run check

# 4. Register slash commands
npm run register

# 5. Run the bot
npm start
```

## Prerequisites

- Node.js >= 20.18.0
- Docker (optional, for containerized deployment)
- A Discord server where you have the **Manage Server** permission
- Access to the [Discord Developer Portal](https://discord.com/developers/applications)
- A running Dune Awakening Selfhost Docker Console with the Discord adapter enabled

---

## Step 1: Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it (e.g., "Dune Server Status")
4. Go to the **Bot** tab in the left sidebar
5. Click **Add Bot** → **Yes, do it!**
6. Under the **Token** section, click **Reset Token** → **Copy**

**Save this token.** You will never see it again without resetting it.
Paste it into your `.env` file as `DISCORD_BOT_TOKEN`.

### Disable Unused Privileged Intents

On the Bot page, under **Privileged Gateway Intents**, ensure all three are **OFF**:
- Server Members Intent — OFF
- Presence Intent — OFF
- Message Content Intent — OFF

This bot uses only the **Guilds** intent (no privileged intents required).

---

## Step 2: Get Your Application ID and Invite Link

1. Go to the **General Information** tab
2. Copy the **Application ID** — this is your `DISCORD_CLIENT_ID`

### Generate the Invite URL

Replace `YOUR_CLIENT_ID` in the URL below and open it in a browser:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands
```

Or build manually:

| Field | Value |
|-------|-------|
| **Client ID** | Your Application ID |
| **Scopes** | `bot`, `applications.commands` |
| **Permissions** | `0` (slash commands only, no extra permissions) |

This URL adds the bot to your Discord server. Select the target server from the
dropdown and authorize.

The bot will appear **offline** until you start it — this is normal.

---

## Step 3: Enable the Discord Adapter on the Console

On the Dune Console host, enable the adapter:

```bash
# In your console .env or runtime configuration:
DUNE_DISCORD_ADAPTER_ENABLED=true
DUNE_BOT_API_TOKEN_FILE=/path/to/secrets/bot-api-token.txt
```

Create the bot API token file:
```bash
echo -n "your-secure-random-token" > /path/to/secrets/bot-api-token.txt
chmod 600 /path/to/secrets/bot-api-token.txt
```

This token is what the Discord bot uses to authenticate against the console
adapter. It must match `DUNE_DISCORD_ADAPTER_TOKEN` on the bot side.

---

## Step 4: Configure the Bot Environment

Create a `.env` file in the bot's working directory. Copy `.env.example` and
fill in your values:

```bash
# === Required ===
DISCORD_BOT_TOKEN=                # From Developer Portal > Bot > Token
DISCORD_CLIENT_ID=                # From Developer Portal > General Information
DUNE_CONSOLE_API_URL=http://console-host:3000   # Your console WebUI address
DUNE_DISCORD_ADAPTER_TOKEN=       # Must match the console's bot-api-token

# === Optional: Role-based access ===
DISCORD_RBAC_MODE=restricted      # restricted (default) or open
DISCORD_OBSERVER_ROLE_IDS=        # Comma-separated Discord role IDs
DISCORD_ADMIN_ROLE_IDS=           # Comma-separated Discord role IDs
DISCORD_ALLOWED_USER_IDS=         # Comma-separated Discord user IDs

# === Optional: Guild-specific registration (dev) ===
DISCORD_GUILD_ID=                 # Test guild ID for immediate command registration

# === Optional: Ephemeral responses ===
DISCORD_DEFAULT_EPHEMERAL=true    # Bot replies visible only to command user

# === Optional: Scheduler (status posts) ===
DUNE_POST_SCHEDULE_TYPE=none      # none, status, status-summary, readiness, services
DUNE_POST_ALLOWED_CHANNELS=       # Comma-separated channel IDs
DUNE_SCHEDULER_INTERVAL_MS=300000 # 5 minutes default

# === Optional: Announcements ===
DUNE_ANNOUNCEMENTS_ENABLED=false  # Set true to forward game announcements to Discord
DUNE_ANNOUNCEMENTS_CHANNEL=       # Discord channel ID for announcements

# === Optional: Writes (disabled by default) ===
DUNE_DISCORD_WRITES_ENABLED=false # Set true to enable write commands
DISCORD_WRITE_ADMIN_ROLE_IDS=     # Roles allowed to execute write commands

# === Optional: Cooldowns ===
DUNE_COOLDOWN_MS=5000             # Per-user per-command cooldown (ms)
DUNE_ADMIN_COOLDOWN_MS=1000       # Cooldown for admin roles (ms)
```

**Production tip:** Use file-based secrets where possible:
```bash
DISCORD_BOT_TOKEN_FILE=/run/secrets/discord-bot-token
DUNE_DISCORD_ADAPTER_TOKEN_FILE=/run/secrets/adapter-token
```

---

## Step 5: Register Slash Commands

```bash
npm run register
```

- With `DISCORD_GUILD_ID` set: commands appear instantly in that guild (dev).
- Without `DISCORD_GUILD_ID`: commands register globally (can take up to 1 hour to propagate).

---

## Step 6: Run the Bot

### Option A: Direct (Node.js)

```bash
npm ci --omit=dev
npm start
```

### Option B: Docker

```bash
# Build the image
docker build -t dune-discord-bot .

# Run with .env
docker run -d --name dune-discord-bot \
  --env-file .env \
  --restart unless-stopped \
  dune-discord-bot
```

### Option C: Docker Compose (alongside the console)

```yaml
# docker-compose.override.yml
services:
  discord-bot:
    image: dune-discord-bot
    build: ./dune-awakening-selfhost-discordbot
    restart: unless-stopped
    env_file: ./dune-awakening-selfhost-discordbot/.env
    networks:
      - dune-net
```

---

## Step 7: Verify the Installation

1. **Check the bot is online** in Discord (green dot in member list).
2. Type `/dune ping` in a channel — should show Discord and adapter latency.
3. Type `/dune about` — should show bot version, read-only status, and boundary.
4. Run the operator validation:
   ```bash
   npm run validate:operator
   ```
5. Verify the bot container is healthy:
   ```bash
   docker ps --filter name=dune-discord-bot
   ```

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Bot offline | Wrong token or no network | Check `DISCORD_BOT_TOKEN`, verify network connectivity |
| "Not authorized" | Role not in allowed list | Set `DISCORD_OBSERVER_ROLE_IDS` to include your role |
| "Adapter request failed" | Console unreachable | Verify `DUNE_CONSOLE_API_URL`, check console adapter enabled |
| "Missing adapter credential" | Token mismatch | Ensure bot token matches console `bot-api-token` file |
| Commands not appearing | Registration needed | Run `npm run register` |
| "Write commands are disabled" | Expected | Set `DUNE_DISCORD_WRITES_ENABLED=true` if needed |

---

## Updating

```bash
git pull
npm ci --omit=dev
npm run register  # Re-register if commands changed
npm start
```

For Docker:
```bash
docker build -t dune-discord-bot .
docker stop dune-discord-bot && docker rm dune-discord-bot
docker run -d --name dune-discord-bot --env-file .env --restart unless-stopped dune-discord-bot
```

## Sources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord OAuth2 Documentation](https://docs.discord.com/developers/platform/oauth2-and-permissions)
- `docs/discord-setup.md` — Discord-specific setup details
- `docs/configuration.md` — Full configuration reference
- `docs/security-model.md` — Security model and RBAC
