# Admin Guide — Setting Up the Bot on Your Server

This guide walks you through getting the Dune Discord Bot running on your own
server. You'll need access to your Dune Awakening game server and about 20
minutes.

## What You Need

- A Discord server where you have the **Manage Server** permission
- Access to the [Discord Developer Portal](https://discord.com/developers/applications)
- Your Dune Awakening game server running (with the Discord adapter enabled)
- About 20 minutes of setup time

No coding or Docker experience is required if someone else handles the hosting.
If you're doing everything yourself, see the [Installation Guide](installation-guide.md).

---

## Step 1: Create Your Discord Application

Every bot needs its own Discord application. Think of this as registering your
bot with Discord so it can connect to your server.

1. Go to **[discord.com/developers/applications](https://discord.com/developers/applications)**
2. Click the **New Application** button (top right)
3. Name your bot (e.g., "Arrakis Control Panel" or "Dune Server Status")
4. Click **Create**

---

## Step 2: Create the Bot User

1. In the left sidebar, click **Bot**
2. Click **Add Bot** → **Yes, do it!**
3. Under **TOKEN**, click **Reset Token** → **Copy**

> ⚠️ **IMPORTANT:** Save this token somewhere safe. This is like a password for
> your bot. Anyone with this token can control your bot. You will only see it
> once — if you lose it, you'll need to reset it.

Under **Privileged Gateway Intents**, turn all three OFF:
- Server Members Intent — **OFF**
- Presence Intent — **OFF**
- Message Content Intent — **OFF**

Your bot uses slash commands only — it doesn't need to read messages.

---

## Step 3: Get Your Application ID

1. Click **General Information** in the left sidebar
2. Copy the **APPLICATION ID** — this is your bot's unique identifier

You'll need this for the invite link and bot configuration.

---

## Step 4: Invite the Bot to Your Server

Replace `YOUR_APP_ID` with your Application ID from Step 3, then open this in
your browser:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands
```

| Setting | Value |
|----------|-------|
| Client ID | Your Application ID from Step 3 |
| Scopes | `bot` + `applications.commands` |
| Permissions | `0` (slash commands don't need extra permissions) |

Select your server from the dropdown and click **Authorize**.

The bot will appear in your server's member list as **offline** — this is
normal. It shows as offline until the bot process is actually running.

---

## Step 5: Set Up Roles in Discord

The bot uses Discord roles to control who can use which commands. Think of
roles like badges — if someone has the right badge, they can use certain
commands.

1. In your Discord server, go to **Server Settings → Roles**
2. Create these roles (or use existing ones):

| Role | Purpose | Who Gets It |
|------|---------|-------------|
| **Dune Observer** | Can use all read-only commands (status, population, player inventory, etc.) | Trusted members |
| **Dune Admin** | Can use admin commands + diagnostics | Server admins |
| **Dune Moderator** *(optional)* | Can use read-only commands + broadcast | Trusted moderators |

3. Assign roles to yourself and your trusted members.

### How to Find a Role ID

1. Enable **Developer Mode** in Discord:
   - User Settings → Advanced → **Developer Mode** (turn ON)
2. Go to Server Settings → Roles
3. Right-click the role → **Copy Role ID**

Save these IDs — you'll need them for the bot configuration.

---

## Step 6: Get Your Guild (Server) ID

1. With Developer Mode enabled (see Step 5)
2. Right-click your server icon in the server list
3. Click **Copy Server ID**

---

## Step 7: Enable the Discord Adapter on the Console

The bot needs to talk to your game server's console. The console has a built-in
"Discord adapter" that the bot connects to.

1. On your game server, find the console's configuration file (usually `.env`
   or `docker-compose.web.yml`)
2. Add or update these settings:

```bash
DUNE_DISCORD_ADAPTER_ENABLED=true
DUNE_DISCORD_ADAPTER_TOKEN=your-random-secret-token
```

3. Create a token file for the adapter:

```bash
echo -n "your-random-secret-token" > /path/to/secrets/bot-api-token.txt
chmod 600 /path/to/secrets/bot-api-token.txt
```

4. Restart the console:

```bash
docker compose -f docker-compose.web.yml up -d redblink-dune-docker-console
```

> **Important:** The token you set here (`DUNE_DISCORD_ADAPTER_TOKEN`) must
> match the token in the bot's configuration (Step 10). They must be identical.

---

## Step 8: Enable Scheduled Status Updates (Optional)

The bot can automatically post server status to a channel every 30 minutes.

1. Create or identify a channel for updates (e.g., `#server-status`)
2. Right-click the channel → **Copy Channel ID**
3. Add these to your `.env` file (Step 10):

```bash
DUNE_POST_SCHEDULE_TYPE=status-summary
DUNE_POST_ALLOWED_CHANNELS=YOUR_CHANNEL_ID
DUNE_SCHEDULER_INTERVAL_MS=1800000    # 30 minutes
```

**Schedule types you can use:**

| Type | What It Posts |
|------|--------------|
| `none` | Disabled (default) |
| `status` | Full status data |
| `status-summary` | Compact summary (recommended) |
| `readiness` | Readiness checks |
| `services` | Service state |

---

## Step 9: Enable In-Game Announcements (Optional)

The bot can forward in-game announcements to a Discord channel:

```bash
DUNE_ANNOUNCEMENTS_ENABLED=true
DUNE_ANNOUNCEMENTS_CHANNEL=YOUR_CHANNEL_ID
```

---

## Step 10: Create the Configuration File

Create a `.env` file with your settings. Here's a complete template:

```bash
# === Required ===
DISCORD_BOT_TOKEN=PASTE_YOUR_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=PASTE_YOUR_APP_ID_HERE
DUNE_CONSOLE_API_URL=http://your-console-host:8088
DUNE_DISCORD_ADAPTER_TOKEN=PASTE_YOUR_ADAPTER_TOKEN_HERE

# === Roles (use your actual role IDs from Step 5) ===
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=PASTE_OBSERVER_ROLE_ID
DISCORD_ADMIN_ROLE_IDS=PASTE_ADMIN_ROLE_ID

# === Guild (for instant command registration) ===
DISCORD_GUILD_ID=PASTE_YOUR_GUILD_ID

# === Scheduler (status posts every 30 minutes) ===
DUNE_POST_SCHEDULE_TYPE=status-summary
DUNE_POST_ALLOWED_CHANNELS=PASTE_CHANNEL_ID
DUNE_SCHEDULER_INTERVAL_MS=1800000
```

> **Security tip:** Instead of putting tokens directly in the `.env` file, use
> file-based secrets:
> ```bash
> DISCORD_BOT_TOKEN_FILE=/app/secrets/discord-bot-token.txt
> DUNE_DISCORD_ADAPTER_TOKEN_FILE=/app/secrets/adapter-token.txt
> ```
> Create these files with 600 permissions and mount them as a read-only Docker
> volume.

---

## Step 11: Register Slash Commands

Once the bot is running, register the commands with Discord:

```bash
npm run register
```

Commands appear **instantly** if you set `DISCORD_GUILD_ID` (Step 6).
Without a guild ID, they register globally and can take up to an hour to appear.

---

## Step 12: Verify Everything Works

Test these commands in your Discord server:

| Command | What It Should Show |
|---------|-------------------|
| `/dune core ping` | Adapter latency (a few ms) |
| `/dune server status` | Status card with server info |
| `/dune server health` | Adapter health (🟢 Healthy) |
| `/dune core about` | Bot version and security info |

## After Setup

- Status updates automatically post every 30 minutes
- You'll see development notifications in the configured channel
- Security checks run automatically before every commit
- The bot restarts automatically if it crashes (Docker `--restart unless-stopped`)

## Player Linking

Players can link their Discord account to their in-game character to check
their inventory and storage. No additional setup is needed — this works
automatically once the bot is connected to the console.

Players use these commands:
- `/dune data link <character-name>` — Link their account
- `/dune data unlink` — Remove their character link
- `/dune data whoami` — Check their linked character
- `/dune data faction <name>` — Set their faction for themed embeds
- `/dune data inventory` — View their inventory
- `/dune data inventory <search>` — Search their inventory
- `/dune data storage` — View their storage
- `/dune data find <item>` — Search for items

## Multi-Tenant Mode (Optional)

For centralized hosting serving multiple Discord servers, enable multi-tenant mode:

```bash
ACP_MULTI_TENANT=true
ACP_DB_PATH=data/acp.db
ACP_BASE_URL=http://your-server:3100
DISCORD_CLIENT_SECRET=your-oauth2-secret
```

The setup portal runs at `http://your-server:3100/setup` and handles:
- Discord OAuth2 authentication
- Guild registration with console URL and adapter token
- Per-guild role configuration
- Automatic DM onboarding when the bot joins a new server

See [Multi-Tenant Design](multi-tenant-design.md) for architecture details.

## Next Steps

- [User Guide](user-guide.md) — how to use all commands
- [FAQ](faq.md) — answers to common questions
- [Troubleshooting](troubleshooting.md) — what to do when things go wrong
- [Configuration Reference](configuration.md) — all available settings

## Sources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord OAuth2 Documentation](https://discord.com/developers/docs/topics/oauth2)
- [Discord Slash Commands](https://support.discord.com/hc/en-us/articles/1500000368501-Slash-Commands-FAQ)
