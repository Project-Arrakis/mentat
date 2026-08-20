# Quick Start Guide — ACP Discord Bot

**Status:** Current | **Last Updated:** August 2026

Get your ACP Discord bot connected and running in minutes.

## What is ACP?

**Arrakis Control Panel (ACP)** is a Discord bot that connects your Dune: Awakening game server to Discord, bringing:

- **Server Status** — Check if your server is running and how many players are online
- **Player Tools** — Link your Discord account to your in-game character
- **Inventory Lookup** — Check what your character is carrying
- **Admin Diagnostics** — Health checks and system information
- **Scheduled Updates** — Automatic server status posts
- **Read-Only by Default** — The bot cannot change anything on your server

## Quick Setup (3 minutes)

### Step 1: Invite the Bot

Use this link to invite the hosted bot to your Discord server:

```
https://discord.com/oauth2/authorize?client_id=1516816812006969494&scope=bot%20applications.commands&permissions=128
```

Or from Discord:
1. Go to **Server Settings → Integrations**
2. Click **Browse Available Bots**
3. Search for "Arrakis Control Panel"
4. Click **Install** and select your server

### Step 2: Open the Setup Portal

The bot will post a setup link. Click it or visit:

```
https://acp-setup.darkdante.org
```

You'll see:
- **Server Connection** — Enter your game server's IP and port
- **Bot Configuration** — Set which Discord channels the bot uses
- **Permissions** — Define who can run which commands

### Step 3: Complete Setup

1. **Authenticate** — Log in with your Discord account
2. **Enter Server Details:**
   - Server IP (e.g., `192.168.1.100` or your public IP)
   - Game port (usually `7777`)
   - Console port (usually `8088`)
3. **Configure Channels:**
   - **Status Channel** — Where the bot posts server status
   - **Alerts Channel** — Where warnings appear
   - **Admin Channel** — Restricted to administrators
4. **Save & Test**

### Step 4: Verify It Works

In Discord, run:

```
/status
```

You should see:
```
✅ Server Status
━━━━━━━━━━━━━━
Status: Running
Players: 5 / 20
CPU: 45%
Memory: 60%
```

If you see an error, check the [Troubleshooting](#troubleshooting) section below.

## Available Commands

### For All Players

```
/status                 Check if the server is running
/ping                   Bot latency test
/about                  Bot information and commands
```

### Link Your Character

```
/link-steam             Link your Steam account to Discord
```

Once linked, you can:

```
/inventory              See what your character is carrying
/storage                Check your base storage
/search-item [item]     Find an item on the market
```

### For Admins

```
/health                 Detailed server diagnostics
/broadcast [message]    Send a message to all players in-game
```

## Common Workflows

### Check Player Count While AFK

In Discord:
```
/status
```

See how many friends are online without launching the game.

### Link Your Account to Discord

1. Run `/link-steam`
2. Click the Steam login link
3. Confirm on Steam
4. You're linked! Now run `/inventory` anytime

### Get Alerted When Server Goes Down

The bot automatically posts:
- **Status updates** every 30 minutes
- **Critical alerts** when server crashes or disk is full
- **Player join/leave notifications** (if enabled)

### Admin: Broadcast to In-Game Players

```
/broadcast The server will restart in 10 minutes. Safe your progress!
```

All players in-game see the message immediately.

## Troubleshooting

### Bot Not Responding

**Problem:** Commands like `/status` don't work

**Solution:**
1. Verify the bot has permissions in the channel
2. Right-click the channel → Edit → Roles → ACP bot → Enable "Use Application Commands"
3. Check bot is online (green dot in member list)
4. Try `/about` to verify bot is working
5. Re-run setup: Visit [acp-setup.darkdante.org](https://acp-setup.darkdante.org)

### Can't Connect to Game Server

**Problem:** `/status` says "Cannot reach server"

**Solution:**
1. Verify your server is running: `dune status`
2. Check the IP you entered in setup (use public IP if external)
3. Verify the port is correct (game: 7777, console: 8088)
4. Check firewall allows connections from Discord
5. Update setup with correct IP/port

### Inventory Not Found

**Problem:** `/inventory` says "Character not linked"

**Solution:**
1. Run `/link-steam` first
2. Complete the Steam login flow
3. Confirm the link worked (it will tell you your character name)
4. Try `/inventory` again

### Setup Link Won't Load

**Problem:** acp-setup.darkdante.org times out or 404s

**Solution:**
1. Wait a minute and refresh
2. Check your Discord auth (you should see "Signed in as...")
3. Try a different browser
4. Report the issue on [GitHub](https://github.com/yacketrj/arrakis-control-panel/issues)

## Next Steps

- **[Full User Guide](user-guide.md)** — Detailed command reference
- **[Admin Setup Guide](admin-guide.md)** — For server administrators
- **[FAQ](faq.md)** — Answers to common questions
- **[Architecture](architecture.md)** — How the bot works internally

## Need Help?

- **[FAQ](faq.md)** — Answers to common questions
- **[Troubleshooting](troubleshooting.md)** — Step-by-step problem solving
- **[GitHub Issues](https://github.com/yacketrj/arrakis-control-panel/issues)** — Report bugs or request features

---

**That's it!** You're ready to use ACP. Happy gaming! 🎮
