# Frequently Asked Questions

## General

**Q: What is this bot for?**

It monitors your Dune Awakening game server and shows its health, status,
players, and services through Discord slash commands. Instead of logging into
the WebUI console, you can check everything from Discord. Players can also
link their Discord account to their in-game character to check their inventory
and storage.

**Q: Can I add this bot to my server right now?**

Not as a shared public bot. Each Dune server operator runs their own instance
of the bot connected to their own console. This keeps your tokens and server
data private.

**Q: Do I need coding experience to set this up?**

The basic setup (creating a Discord app, inviting the bot, configuring roles)
requires no coding. If someone else handles the server hosting, you can set up
the Discord side in about 15 minutes.

**Q: Is this bot secure?**

Yes. It never accesses the Docker socket, game files, or database directly.
All commands go through a bearer-token protected API. Secrets use file-based
storage with restricted permissions (0600). Security scanning runs on every
commit (Semgrep, Gitleaks, Trivy, ggshield, npm audit).

**Q: Is the bot read-only?**

Yes. All commands only read data from your game server — they cannot change
anything. Write commands (like broadcast) are disabled by default and require
explicit configuration to enable.

---

## Commands

**Q: Why can't I see the `/dune` commands in my server?**

Two possible reasons:
1. Commands haven't been registered yet. Run `npm run register`.
2. Global registration can take up to an hour. Use `DISCORD_GUILD_ID` for
   instant guild-scoped commands.

**Q: Why do I see "/dune" twice?**

You have both global and guild-scoped commands registered. The fix is to
delete the global registration and use guild-only. Ask your bot admin to
clear the global commands.

**Q: What's the difference between `/dune server status` and `/dune server summary`?**

`status` generates a custom image card with maps, stats, and a Dune quote.
`summary` shows a compact text version — good for scheduled channel posts.

**Q: Why can't I use admin commands like `/dune admin doctor`?**

Admin commands require the Admin role as configured by your server owner.
Regular members with the Observer role can only use read-only commands.

**Q: What does "diagnostic mode" mean?**

Adding `diagnostic:true` to `/dune server status` or `/dune server readiness`
shows detailed technical output — similar to running `dune status` on the
command line. Only available to admins.

---

## Player Features

**Q: How do I check my inventory in Discord?**

First, link your Discord account to your character:
```
/dune player link <your-character-name>
```
You'll receive a verification code in-game via whisper. Then run:
```
/dune player verify <code>
```
Once linked, run:
```
/dune data inventory
```

**Q: What does "linking" mean?**

Linking connects your Discord account to your in-game character. This lets the
bot know which character's data to show you when you run player commands. The
link is stored securely on the game server — your Discord account and character
are associated, but no personal data is shared.

**Q: How does the verification code work?**

The bot sends a 6-character code (e.g., `ACP-7X9K2`) to your character in-game as a whisper
message. Only you can see this message. Enter the code with `/dune player verify <code>`
to complete linking. Codes expire after 5 minutes. Alternatively, run
`/dune player link` with no character name to link via your Discord's
connected Steam account instead — no whisper code needed. See
[User Guide § Linking Your Character](user-guide.md#linking-your-character)
for the full walkthrough.

**Q: Can I link multiple characters to one Discord account?**

Yes, as of the multi-character linking update — see `/dune player characters`
to list all linked characters, and `/dune player enable`/`disable`/`default`
to manage which are active in a given guild. To remove a link entirely, run
`/dune player unlink <character>`, then link the new
character.

**Q: Can multiple Discord accounts link to the same character?**

No. Each character can only be linked to one Discord account at a time.

**Q: What's the difference between `/dune data inventory` and `/dune data storage`?**

- **Inventory** shows items your character is currently carrying (on their person).
- **Storage** shows items in storage containers you own (chests, shelves, etc.).

**Correction (2026-07-24):** this section and the next previously referenced
`/dune player inventory`, `/dune player storage`, `/dune player find`, and a
nonexistent `/dune player inventory-search` command. These commands have
always lived in the `data` group, not `player` — `player` is (and has only
ever been) the identity/linking command group. There is no separate
"inventory-search" subcommand; use `/dune data inventory <search-term>`
(the `search` option is optional on the same `inventory` subcommand).

**Q: What's the difference between `/dune data find` and searching within `/dune data inventory`?**

- **find** searches across all your storage containers (chests, guild storage, etc.)
- **`/dune data inventory <search-term>`** searches only in your character's personal inventory

**Q: Can I search guild storage?**

Yes. Use `/dune data storage` with the scope set to `guild`, or use
`/dune data find` with scope `guild`. You must be a member of the guild
to see its storage.

**Q: Why do I get "Not linked" when I try to check my inventory?**

You need to link your Discord account to your character first. Run:
```
/dune player link <your-character-name>
```
Replace `<your-character-name>` with the exact name of your character in the game.

**Q: Why do I get "No player found" when linking?**

The character name you entered doesn't match any character on the server.
Check the spelling — it must match exactly, including capitalization.

**Q: Why do I get "Multiple players found" when linking?**

More than one character on the server has the name you entered. Try using a
more specific name, or ask a server admin for help.

---

## Setup

**Q: How do I get my bot token?**

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application → **Bot** tab
3. Click **Reset Token** → **Copy**

**Q: Where do I find my role/channel/server IDs?**

1. Enable Developer Mode in Discord: Settings → Advanced → Developer Mode
2. Right-click any role, channel, or server → **Copy ID**

**Q: Can I use this bot on multiple Discord servers?**

Yes. Set up the bot once with guild-scoped commands (`DISCORD_GUILD_ID`) and
repeat Steps 4-6 of the admin guide for each additional server. Each server
points to the same console by default, or you can configure per-guild console
urls in advanced setup.

**Q: Do I need to open ports on my firewall?**

No. The bot connects OUT to Discord (WebSocket) and OUT to your console API
(localhost). It never listens for incoming connections.

**Q: Can I run the bot on the same machine as the game server?**

Yes, and this is the recommended setup. The bot is lightweight (~100MB RAM)
and communicates with the console over localhost.

---

## Status Updates

**Q: How often does the bot post status updates?**

Every 30 minutes by default. You can change this with
`DUNE_SCHEDULER_INTERVAL_MS` (in milliseconds).

**Q: Can I change which channel the bot posts to?**

Yes — set `DUNE_POST_ALLOWED_CHANNELS` to a comma-separated list of channel
IDs. The bot will post to all listed channels.

**Q: What kinds of updates can I schedule?**

| Setting | Content |
|---------|---------|
| `status-summary` | Compact status with overall/region/mode/population |
| `status` | Full status details |
| `readiness` | Readiness checks |
| `services` | Service container list |
| `none` | Disabled |

---

## Security

**Q: Are my tokens safe?**

Yes. Use file-based secrets (`DISCORD_BOT_TOKEN_FILE` with a Docker volume
mount) instead of putting tokens in the `.env` file directly. The secrets
directory has 0600 permissions and is gitignored.

**Q: What if my token gets leaked?**

1. Reset the token immediately in the Discord Developer Portal
2. Update the token file
3. Restart the bot
4. The old token becomes invalid instantly

**Q: Can the bot do anything destructive?**

No. All commands are read-only by default. Write commands like broadcast are
behind `DUNE_DISCORD_WRITES_ENABLED=true` which is off by default. The bot
has no access to the Docker socket, database, or game files.

**Q: Does the bot see my Discord messages?**

No. The bot only uses the Guilds gateway intent — it never reads message
content. It only responds to slash commands.

**Q: Is player data private?**

Yes. Each player can only see their own inventory and storage. The bot checks
your Discord identity and only returns data for the character you've linked to.
Other players' data is never exposed.

---

## Troubleshooting

**Q: The bot shows as offline in my server.**

The bot process isn't running on the host machine. Check the Docker container
or Node.js process.

**Q: I see "application did not respond" when using commands.**

Same issue — the bot process needs to be running. This error means Discord
sent the command but nobody was home to answer it.

**Q: Commands aren't showing up in my server.**

Run `npm run register`. If using global registration, wait up to 1 hour.
Use `DISCORD_GUILD_ID` for instant registration.

**Q: I get "not authorized" on commands I should have access to.**

Check that your Discord role ID matches the IDs in the `.env` file under
`DISCORD_OBSERVER_ROLE_IDS` or `DISCORD_ADMIN_ROLE_IDS`.

**Q: I get "Adapter request failed" when running commands.**

The bot can't reach the game server console. Check that:
1. The console is running
2. `DUNE_CONSOLE_API_URL` is correct
3. `DUNE_DISCORD_ADAPTER_TOKEN` matches the console's token

For a full troubleshooting guide, see [Troubleshooting](troubleshooting.md).

## Sources

- [Admin Guide](admin-guide.md) — full server setup instructions
- [User Guide](user-guide.md) — how to use all commands
- [Troubleshooting](troubleshooting.md) — error messages and fixes
- [Configuration Reference](configuration.md) — all settings explained
