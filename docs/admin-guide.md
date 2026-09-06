# Admin Guide — Connecting Your Server to the Hosted Bot

This guide walks you through connecting your Dune Awakening server to the
**hosted** Arrakis Control Panel bot, run and maintained by the ACP team.
The bot side is fully hosted — you do **not** create a Discord
application, run a Node process, or register slash commands.

> **Corrected 2026-08-07 (issue #93):** this guide previously described a
> self-hosted, per-operator model (create your own Discord app, copy a bot
> token, run `npm run register`). That was the root cause of a real
> production documentation incident on `acp-landing`. ACP is a single,
> maintainer-operated, hosted bot. Port 3100/3101 OAuth setup portal and
> the real invite link below are the actual flow.
>
> Maintainers who genuinely want to run their own instance should use the
> [Installation Guide](installation-guide.md) and the
> [Backup & Recovery Runbook](../compliance/runbooks/backup-recovery.md)
> instead — this guide is for connecting your **server** to the **hosted**
> bot.

## What You Need

- A Discord server where you have the **Manage Server** permission
- A running **Dune Awakening Selfhost Docker Console** (the bot reads its
  Discord adapter API)
- Or about 10 minutes of setup time (no coding, no Docker, no `.env`)

---

## Step 1: Invite the Hosted Bot

Open this link in your browser:

```
https://discord.com/oauth2/authorize?client_id=1516816812006969494&scope=bot%20applications.commands&permissions=128
```

Select your server from the dropdown and click **Authorize**.

| Setting | Value |
|----------|-------|
| Client ID | `1516816812006969494` (the hosted bot's application) |
| Scopes | `bot` + `applications.commands` |
| Permissions | `128` (View Audit Log — lets the bot identify who invited it, so setup DMs reach the right person; slash commands themselves don't need any extra permissions) |

See `discord-setup.md` for the full explanation of why this permission is
requested.

The bot will appear in your server's member list as **offline** — that's
normal until a console is connected.

---

## Step 2: Complete the Setup Portal

The rest of the connection happens in the web setup portal — **not** in
this repo:

1. Open **<https://mentat-link.darkdante.org/setup>** in your browser
2. **Sign in with Discord** (identify + guilds scope only — no messages, roles, or private data)
3. **Select your server** from the dropdown
4. **Enter your Console URL** — must be publicly reachable from the internet (a public IP/domain, or a Cloudflare Tunnel URL for a home PC)
5. **Enter your Adapter Token** — paste the existing token file (`/repo/runtime/secrets/discord-adapter-token.txt` on the console host) or generate a fresh one from the portal and write it to the console's secrets file with `DUNE_DISCORD_ADAPTER_ENABLED=true`
6. Click **Connect Server**

Follow `setup-portal-guide.md` for the full walkthrough of each field,
including the role IDs (optional) and the generate-token option.

---

## Step 3: Set Up Roles and Configure Access

The portal accepts two optional role IDs. Skip them and use defaults now,
or fill them in later:

| Role | Can Use |
|------|---------|
| **Admin Role ID** | Admin commands and diagnostics (`/dune admin doctor`, etc.) |
| **Observer Role ID** | Read-only commands (`/dune health`, `/dune status`, inventory, storage, etc.) |

**How to find a Role ID:**
1. Enable **Developer Mode** in Discord (User Settings → Advanced)
2. Go to Server Settings → Roles, right-click the role → **Copy Role ID**
3. Paste it into the portal

If you only configure one role, members with that role can use any
command the bot considers allowed; configure both for proper separation.

---

## Verify It Works

1. In your Discord server, type `/dune` in any text channel
2. Try `/dune ping` — you should see a response with Discord latency and adapter latency
3. Try `/dune server status` — you should get a status card

If you get an error:

| Error | Cause | Fix |
|-------|-------|-----|
| "Not authorized" | No roles configured | Back to the setup portal, enter an Admin or Observer Role ID |
| "Adapter request failed" | Console unreachable | Verify the Console URL is publicly accessible and the adapter is enabled |
| "Missing adapter credential" | Token mismatch | The token in the portal must match the console's token file (`cat /repo/runtime/secrets/discord-adapter-token.txt`) |
| Commands don't appear | Slash commands not registered | The bot host handles this automatically; contact support if still missing after an hour |

---

## Player Linking

Players can link their Discord account to their in-game character — no
additional setup is needed once the bot is connected to the console.

Players use these commands:
- `/dune player link <character-name>` — Link their account
- `/dune player unlink` — Remove their character link
- `/dune player whoami` — Check their linked character
- `/dune player inventory` / `storage` / `find` — View their items

See the [User Guide](user-guide.md) for the full command reference.

---

## Optional: Scheduled Updates and Announcements

The hosted bot supports scheduled status posts and announcement
forwarding. These are managed through the bot's own commands
(`/dune admin events`, `/dune admin broadcast`, and the console's own
announcement settings) rather than a local `.env` — see the
[User Guide](user-guide.md) or `docs/configuration.md` for the hosted
configuration surface.

---

## Next Steps

- [User Guide](user-guide.md) — how to use all commands
- [FAQ](faq.md) — answers to common questions
- [Troubleshooting](troubleshooting.md) — what to do when things go wrong
- [Setup Portal Guide](setup-portal-guide.md) — full portal walkthrough (primary setup path)

## Sources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord OAuth2 Documentation](https://discord.com/developers/docs/topics/oauth2)
- [Discord Slash Commands](https://support.discord.com/hc/en-us/articles/1500000368501-Slash-Commands-FAQ)