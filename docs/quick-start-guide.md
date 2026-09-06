# Quick Start Guide — Mentat Discord Bot

**Status:** Current | **Last Updated:** September 2026

Get connected to the hosted Mentat Discord bot in minutes.

## What is Mentat?

**Mentat** (the bot speaks as **Sahir Venn**) is a Discord bot that connects
your Dune: Awakening game server to Discord, bringing:

- **Server Status** — Check if your server is running and how many players are online
- **Player Tools** — Link your Discord account to your in-game character
- **Inventory Lookup** — Check what your character is carrying
- **Admin Diagnostics** — Health checks and system information
- **Scheduled Updates** — Automatic server status posts
- **Read-Only by Default** — The bot cannot change anything on your server

This project was previously branded Sentinel, and before that Arrakis
Control Panel (ACP) — you may still see those names in older links or
issue history.

## Quick Setup (about 10 minutes)

### Step 1: Invite the Bot

Use this link to invite the hosted bot to your Discord server:

```
https://discord.com/oauth2/authorize?client_id=1516816812006969494&scope=bot%20applications.commands&permissions=128
```

The bot is invite-link only — it is not listed in Discord's "Browse
Available Bots" directory, so searching for it there will not find it.

### Step 2: Open the Setup Portal

Visit the setup portal and sign in with Discord:

```
https://mentat-link.darkdante.org/setup
```

You'll connect your Dune Docker Console's URL and adapter token, and
optionally map Discord roles to the bot's Admin / Moderator / Player
tiers. See the [Setup Portal Guide](setup-portal-guide.md) for the full,
step-by-step walkthrough.

### Step 3: Verify It Works

In Discord, run:

```
/dune core ping
```

You should see a response showing Discord and adapter latency. Then try:

```
/dune server status
```

If you see an error, check the [Troubleshooting](#troubleshooting) section below.

## Available Commands

All commands are invoked as `/dune <group> <subcommand>` — there is no
bare `/status`, `/ping`, etc. Run `/dune core help` in Discord for the
full, current list for your role; a representative sample:

### For All Players

```
/dune core about              Bot information
/dune core ping               Bot latency test
/dune server status           Check if the server is running
/dune data population         See how many players are online
```

### Link Your Character

```
/dune player link             Link your Discord account to your character
/dune player verify <code>    Confirm the link with a verification code
```

Once linked, you can:

```
/dune player whoami            See your linked character info
/dune player inventory         See what your character is carrying
/dune player storage           Check your storage containers
/dune player find <item>       Search for an item across your containers
```

### For Admins

```
/dune admin doctor             Comprehensive system diagnostic
/dune admin broadcast          Send a message to all players in-game
```

## Common Workflows

### Check Player Count While AFK

In Discord:
```
/dune data population
```

See how many friends are online without launching the game.

### Link Your Account to Discord

1. Run `/dune player link`
2. Follow the linking flow it presents
3. Run `/dune player verify <code>` with the code you're given
4. You're linked! Now run `/dune player whoami` or `/dune player inventory` anytime

### Get Alerted When Server Goes Down

The bot automatically posts:
- **Status updates** on a configurable schedule
- **Critical alerts** when server crashes or disk is full
- **Player join/leave notifications** (if enabled)

### Admin: Broadcast to In-Game Players

```
/dune admin broadcast The server will restart in 10 minutes. Safe your progress!
```

All players in-game see the message immediately.

## Troubleshooting

### Bot Not Responding

**Problem:** Commands like `/dune server status` don't work

**Solution:**
1. Verify the bot has permissions in the channel
2. Right-click the channel → Edit → Roles → the bot's role → Enable "Use Application Commands"
3. Check bot is online (green dot in member list)
4. Try `/dune core about` to verify bot is working
5. Re-run setup: visit [mentat-link.darkdante.org/setup](https://mentat-link.darkdante.org/setup)

### Can't Connect to Game Server

**Problem:** `/dune server status` says the server is unreachable

**Solution:**
1. Verify your server is running: `dune status`
2. Check the Console URL you entered in setup (must be publicly reachable — see the [Setup Portal Guide](setup-portal-guide.md))
3. Verify your adapter token matches on both sides
4. Check firewall allows connections from the bot's host
5. Update your Console URL/token via the setup portal if anything changed

### Inventory Not Found

**Problem:** `/dune player inventory` says your character isn't linked

**Solution:**
1. Run `/dune player link` first
2. Complete the linking flow
3. Run `/dune player verify <code>` with the code you're given
4. Try `/dune player inventory` again

### Setup Link Won't Load

**Problem:** mentat-link.darkdante.org times out or 404s

**Solution:**
1. Wait a minute and refresh
2. Check your Discord auth (you should see "Signed in as...")
3. Try a different browser
4. Report the issue on [GitHub](https://github.com/Project-Arrakis/mentat/issues)

## Next Steps

- **[Full User Guide](user-guide.md)** — Detailed command reference
- **[Admin Setup Guide](admin-guide.md)** — For server administrators
- **[FAQ](faq.md)** — Answers to common questions
- **[Architecture](architecture.md)** — How the bot works internally

## Need Help?

- **[FAQ](faq.md)** — Answers to common questions
- **[Troubleshooting](troubleshooting.md)** — Step-by-step problem solving
- **[GitHub Issues](https://github.com/Project-Arrakis/mentat/issues)** — Report bugs or request features

---

**That's it!** You're ready to use Mentat. Happy gaming! 🎮
