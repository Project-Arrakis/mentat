# Discord Setup — Creating Your Bot Application

> **Self-hosted/DIY path only (corrected 2026-09-06).** Most server owners
> should use the **hosted** Mentat bot instead — see
> [README.md](../README.md) and the [Admin Guide](admin-guide.md), which
> require no Discord application of your own. This guide is only for
> operators running their **own** self-hosted instance (see
> [Installation Guide](installation-guide.md)) who need to create their own
> Discord bot application from scratch, matching the same
> hosted-vs-self-hosted distinction the Admin Guide already draws for its
> audience.

This guide walks you through creating a Discord bot application and inviting it
to your server. No coding experience is required.

## Overview

Each self-hosted Dune server instance should have its own Discord bot. This
keeps your tokens and server data private — no shared public bots. The
setup takes about 15 minutes.

**What you'll need:**
- A Discord server where you have "Manage Server" permission
- Access to the [Discord Developer Portal](https://discord.com/developers/applications)

---

## Step 1: Create a Discord Application

A Discord application is like a registration for your bot. It tells Discord
"this bot exists and belongs to me."

1. Go to **[discord.com/developers/applications](https://discord.com/developers/applications)**
2. Click the **New Application** button (top right corner)
3. Name your bot something recognizable, like:
   - "Arrakis Control Panel"
   - "Dune Server Status"
   - "Tabr-Tau Server Bot"
4. Click **Create**

You'll now see your application's dashboard.

---

## Step 2: Create the Bot User

The application is registered, but it doesn't have a bot yet. Let's create one.

1. In the left sidebar, click **Bot**
2. Click **Add Bot** → **Yes, do it!**
3. Under **TOKEN**, click **Reset Token** → **Copy**

> ⚠️ **IMPORTANT:** Save this token somewhere safe right now. This is like a
> password for your bot. Anyone with this token can control your bot. You will
> only see it once — if you lose it, you'll need to reset it (which creates a
> new token and invalidates the old one).

### Turn Off Privileged Intents

On the Bot page, scroll down to **Privileged Gateway Intents**. Turn all three
**OFF**:

- Server Members Intent — **OFF**
- Presence Intent — **OFF**
- Message Content Intent — **OFF**

Your bot uses slash commands only — it doesn't need to read messages or see
who's online. Turning these off is more secure and doesn't affect functionality.

---

## Step 3: Get Your Application ID

This is a number that uniquely identifies your bot application.

1. Click **General Information** in the left sidebar
2. Find **APPLICATION ID** and click **Copy**

You'll need this for the invite link and bot configuration.

---

## Step 4: Invite the Bot to Your Server

Now let's add the bot to your Discord server.

1. Replace `YOUR_APP_ID` in this URL with your Application ID from Step 3:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=128
   ```
2. Open the URL in your browser
3. Select your server from the dropdown
4. Click **Authorize**

| Setting | Value |
|----------|-------|
| Client ID | Your Application ID from Step 3 |
| Scopes | `bot` + `applications.commands` (already in the URL) |
| Permissions | `128` (View Audit Log -- see below; slash commands themselves don't need any extra permissions) |

**Why `128` and not `0`:** the bot uses `View Audit Log` (2026-07-27) to
identify who actually invited it to your server, so it can send the
setup DM to the real inviter rather than always defaulting to the
server owner (who may not be the person who did the inviting -- Discord
only requires "Manage Server" to complete this OAuth flow, not
ownership). This is optional: if you've already invited the bot with
`permissions=0` (the old default), it still works exactly as before --
it just falls back to DMing the server owner directly, since it can't
look up who really invited it without this permission. Re-invite with
the URL above (Discord will prompt to update permissions on an
already-added bot) if you'd like the owner-vs-inviter distinction.

The bot will appear in your server's member list as **offline**. This is
normal — it shows as offline until the bot process is actually running on
your game server.

---

## Step 5: Set Up Roles in Discord

The bot uses Discord roles to control who can use which commands. Think of
roles like badges — if someone has the right badge, they can use certain
commands.

### Create the Roles

1. In your Discord server, go to **Server Settings → Roles**
2. Create these roles (or use existing ones):

| Role | Purpose | Who Gets It |
|------|---------|-------------|
| **Dune Observer** | Can use all read-only commands | Trusted members |
| **Dune Admin** | Can use admin commands + diagnostics | Server admins |
| **Dune Moderator** *(optional)* | Read-only + broadcast | Trusted moderators |

3. Assign these roles to yourself and your trusted members.

### How to Find a Role ID

1. Enable **Developer Mode** in Discord:
   - User Settings → Advanced → **Developer Mode** (turn ON)
2. Go to Server Settings → Roles
3. Right-click the role → **Copy Role ID**

Save these IDs — you'll need them for the bot configuration.

---

## Step 6: Enable the Discord Adapter on the Console

The bot needs to talk to your Dune game server's console. The console has a
built-in "Discord adapter" that the bot connects to.

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
> match the token in the bot's configuration. They must be identical.

---

## Step 7: Configure the Bot

Create a `.env` file for the bot with your settings:

```bash
# === Required ===
DISCORD_BOT_TOKEN=PASTE_YOUR_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=PASTE_YOUR_APP_ID_HERE
DUNE_CONSOLE_API_URL=http://your-console-host:8088
DUNE_DISCORD_ADAPTER_TOKEN=PASTE_YOUR_ADAPTER_TOKEN_HERE

# === Roles ===
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=PASTE_OBSERVER_ROLE_ID
DISCORD_ADMIN_ROLE_IDS=PASTE_ADMIN_ROLE_ID

# === Guild (for instant command registration) ===
DISCORD_GUILD_ID=PASTE_YOUR_SERVER_ID
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

## Step 8: Register Slash Commands

Once the bot is running, register the commands with Discord:

```bash
npm run register
```

Commands appear **instantly** if you set `DISCORD_GUILD_ID`. Without it, they
register globally and can take up to an hour to appear.

---

## Step 9: Verify Everything Works

Test these commands in your Discord server:

| Command | What It Should Show |
|---------|-------------------|
| `/dune core ping` | Adapter latency (a few ms) |
| `/dune server status` | Status card with server info |
| `/dune server health` | Adapter health (🟢 Healthy) |
| `/dune core about` | Bot version and security info |

---

## Security Notes

### What the Bot Can and Cannot Do

**Can do:**
- Read server status, population, and service health
- Check player inventory and storage (for linked players)
- Post scheduled status updates to Discord
- Forward in-game announcements to Discord

**Cannot do:**
- Change anything on your game server (read-only by default)
- Access your Docker containers or database
- Read Discord messages (only responds to slash commands)
- See who's online or what they're doing in Discord

### Protecting Your Tokens

- Never share your bot token or adapter token
- Use file-based secrets instead of putting tokens in `.env`
- If a token leaks, reset it immediately in the Discord Developer Portal
- The old token becomes invalid instantly when you reset it

---

## Next Steps

- [Admin Guide](admin-guide.md) — full server setup instructions
- [User Guide](user-guide.md) — how to use all commands
- [FAQ](faq.md) — answers to common questions
- [Troubleshooting](troubleshooting.md) — what to do when things go wrong

## Sources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord OAuth2 Documentation](https://docs.discord.com/developers/platform/oauth2-and-permissions)
- [Discord Slash Commands](https://support.discord.com/hc/en-us/articles/1500000368501-Slash-Commands-FAQ)
