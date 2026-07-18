# Arrakis Control Panel FAQ

## General

**Q: What is Arrakis Control Panel for?**

It monitors your Dune Awakening game server and shows its health, status,
players, and services through Discord slash commands. Instead of logging into
the WebUI console, you can check everything from Discord.

**Q: Can I add Arrakis Control Panel to my server right now?**

Not as a shared public bot. Each Dune server operator runs their own Arrakis
Control Panel instance connected to their own console. This keeps tokens and
server data private.

**Q: Do I need coding experience to set this up?**

The basic setup (creating a Discord app, inviting the bot, configuring roles)
requires no coding. If someone else handles the server hosting, you can set up
the Discord side in about 15 minutes.

**Q: Is Arrakis Control Panel secure?**

It never accesses the Docker socket, game files, or database directly. All
commands go through a bearer-token protected API. Secrets use file-based storage
with restricted permissions (0600). Security scanning runs on every commit
(Semgrep, Gitleaks, Trivy, ggshield, npm audit).

---

## Commands

**Q: Why can't I see the `/dune` commands in my server?**

Two possible reasons:
1. Commands haven't been registered yet. Run `npm run register`.
2. Global registration can take up to an hour. Use `DISCORD_GUILD_ID` for
   instant guild-scoped commands.

**Q: Why do I see "/dune" twice?**

You have both global and guild-scoped commands registered. The fix is to delete
the global registration and use guild-only. Ask your Arrakis Control Panel
administrator to clear the global commands.

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

## Setup

**Q: How do I get my bot token?**

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application → **Bot** tab
3. Click **Reset Token** → **Copy**

**Q: Where do I find my role/channel/server IDs?**

1. Enable Developer Mode in Discord: Settings → Advanced → Developer Mode
2. Right-click any role, channel, or server → **Copy ID**

**Q: Can I use Arrakis Control Panel on multiple Discord servers?**

Yes. Set up Arrakis Control Panel once with guild-scoped commands
(`DISCORD_GUILD_ID`) and repeat Steps 4-6 of the admin guide for each additional
server. Each server points to the same console by default, or you can configure
per-guild console URLs in advanced setup.

**Q: Do I need to open ports on my firewall?**

No. Arrakis Control Panel connects OUT to Discord (WebSocket) and OUT to your
console API. It never listens for incoming connections.

**Q: Can I run Arrakis Control Panel on the same machine as the game server?**

Yes, and this is the recommended setup. Arrakis Control Panel is lightweight
(about 100 MB RAM) and communicates with the console over localhost.

---

## Status Updates

**Q: How often does Arrakis Control Panel post status updates?**

Every 30 minutes by default. You can change this with
`DUNE_SCHEDULER_INTERVAL_MS` (in milliseconds).

**Q: Can I change which channel Arrakis Control Panel posts to?**

Yes — set `DUNE_POST_ALLOWED_CHANNELS` to a comma-separated list of channel
IDs. Arrakis Control Panel will post to all listed channels.

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

Use file-based secrets (`DISCORD_BOT_TOKEN_FILE` with a Docker volume mount)
instead of putting tokens in the `.env` file directly. The secrets directory
has 0600 permissions and is gitignored.

**Q: What if my token gets leaked?**

1. Reset the token immediately in the Discord Developer Portal
2. Update the token file
3. Restart Arrakis Control Panel
4. The old token becomes invalid instantly

**Q: Can Arrakis Control Panel do anything destructive?**

All commands are read-only by default. Write commands such as broadcast are
behind `DUNE_DISCORD_WRITES_ENABLED=true`, which is off by default. Arrakis
Control Panel has no access to the Docker socket, database, or game files.

**Q: Does Arrakis Control Panel see my Discord messages?**

No. It only uses the Guilds gateway intent — it never reads message content and
only responds to slash commands.

---

## Troubleshooting

**Q: Arrakis Control Panel shows as offline in my server.**

The process isn't running on the host machine. Check the Docker container or
Node.js process.

**Q: I see "application did not respond" when using commands.**

The Arrakis Control Panel process needs to be running. This error means Discord
sent the command but nobody was home to answer it.

**Q: Commands aren't showing up in my server.**

Run `npm run register`. If using global registration, wait up to 1 hour. Use
`DISCORD_GUILD_ID` for instant registration.

**Q: I get "not authorized" on commands I should have access to.**

Check that your Discord role ID matches the IDs in the `.env` file under
`DISCORD_OBSERVER_ROLE_IDS` or `DISCORD_ADMIN_ROLE_IDS`.

For a full troubleshooting guide, see [Troubleshooting](troubleshooting.md).

## Sources

- [Admin Guide](admin-guide.md) — full server setup instructions
- [User Guide](user-guide.md) — how to use all commands
- [Troubleshooting](troubleshooting.md) — error messages and fixes
- [Configuration Reference](configuration.md) — all settings explained
