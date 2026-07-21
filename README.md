# Arrakis Control Panel — Dune Discord Bot

> *"A beginning is a very delicate time."*

Your Dune Awakening server is a living world — players, maps, resources,
economies — all pulsing to the rhythm of the deep desert. But you cannot stand
at the console every hour. You need eyes that never close. You need a watcher
that speaks the old tongue and warns your tribe when the sand shifts.

**ACP** is that watcher.

Named for the Fremen device that calls the great worms with a steady beat, this
bot hammers the data streams of your server and brings them to Discord — status
cards, population counts, map readiness, backup lists, combat stats, and more.
It posts scheduled updates. It forwards in-game announcements. It lets your
moderators speak to the game and your admins diagnose from anywhere.

And like any Fremen tool, it is built for survival: read-only by default,
bearer-token protected, secrets never exposed, no Docker socket, no database
access, no shell commands. The spice must flow — safely.

---

## What This Bot Does

The bot connects your Dune Awakening game server to your Discord server. Once
set up, anyone in your Discord can check the game server's health, see how many
players are online, look up their own inventory and storage, and more — all
without leaving Discord.

**Key features:**

- **Server monitoring** — Check if your game server is running, how many players are online, and whether all services are healthy
- **Player tools** — Link your Discord account to your in-game character, then check your inventory, storage, and search for items
- **Scheduled updates** — The bot can automatically post server status to a Discord channel every 30 minutes
- **Admin diagnostics** — Server admins can run detailed health checks and view system information
- **Role-based access** — Control who can use which commands through Discord roles
- **Read-only by default** — The bot cannot change anything on your game server. All commands only read data.

---

## Quick Start

### For Server Owners (Full Setup)

If you run the Dune Awakening server and want to add this bot:

1. [Create a Discord application](docs/admin-guide.md#step-1-create-your-discord-application) — register your bot with Discord
2. [Invite the bot to your server](docs/admin-guide.md#step-4-invite-the-bot-to-your-server) — add it to your Discord
3. [Set up roles](docs/admin-guide.md#step-5-set-up-roles-in-discord) — control who can use commands
4. [Configure and start](docs/admin-guide.md) — connect the bot to your game server

**Estimated time:** 20 minutes for first-time setup.

### For Players (Just Want to Use Commands)

If the bot is already in your Discord server:

1. Ask a server admin to give you the **Dune Observer** role
2. Type `/dune` in any channel and pick a command
3. See the [User Guide](docs/user-guide.md) for a full list of commands

### For Server Admins (Technical Setup)

```bash
git clone https://github.com/yacketrj/Arrakis-Control-Panel.git
cd Arrakis-Control-Panel
cp .env.example .env   # fill in your settings
npm ci --omit=dev
npm run register       # register slash commands with Discord
npm start              # start the bot
```

---

## Commands

Type `/dune` in Discord and select a group:

| Group | What It Does | Commands |
|-------|-------------|----------|
| `core` | Bot information and help | `about` `ping` `help` `setup` |
| `server` | Game server health checks | `health` `status` `summary` `readiness` `readiness-detail` `services` `services-detail` |
| `data` | Game world data and player features | `population` `backups` `maps` `maintenance` `link` `unlink` `faction` `whoami` `inventory` `storage` `find` |
| `ops` | Detailed operational stats | `activity` `combat` `resources` `economy` `inventory` `location` `soc` `prometheus` `dashboard` |
| `admin` | Administration tools | `doctor` `cooldowns` `latency` `events` `broadcast` |
| `infra` | Server infrastructure | `version` `servers` `ports` `db` |
| `write` | Write operations (disabled by default) | `maintenance-note` `maintenance-window` `alert-channel` `alert-threshold` `digest-schedule` `post-schedule` `add-channel` `remove-channel` `backup` `restart` `update` `cache` |

> **Tip:** Add `diagnostic:true` to `/dune server status` or `/dune server readiness` for detailed technical output (admins only).

---

## Documentation

### For Everyone
- [User Guide](docs/user-guide.md) — how to use every command, explained in plain English
- [FAQ](docs/faq.md) — 25+ common questions answered
- [Troubleshooting](docs/troubleshooting.md) — error messages and how to fix them

### For Server Owners
- [Admin Guide](docs/admin-guide.md) — step-by-step setup for first-time server owners
- [Installation Guide](docs/installation-guide.md) — Docker and Node.js deployment
- [Configuration Reference](docs/configuration.md) — every setting explained
- [Discord Setup](docs/discord-setup.md) — creating your Discord bot application

### For Developers
- [Architecture](docs/architecture.md) — system design and how it all fits together
- [Security Model](docs/security-model.md) — how the bot stays safe
- [Release Roadmap](docs/full-release-roadmap.md) — what's coming next

---

## Security

The bot is designed to be safe by default:

| Protection | What It Means |
|-----------|--------------|
| Read-only by default | The bot cannot change anything on your game server unless writes are explicitly enabled |
| Token authentication | Every request to the game server requires a secret token |
| Role-based access | Only people with the right Discord roles can use commands |
| File-based secrets | Tokens stored in files, not in command history |
| No Docker access | The bot cannot see or control your Docker containers |
| No game database access | The bot cannot directly query your game database (it maintains its own SQLite DB for multi-tenant config) |
| Security scanning | Every code change is scanned for vulnerabilities |
| Write-safety | Write commands are disabled by default, require confirmation, and generate idempotency keys |

Run `npm run check` to verify everything is working. `npm run release:gates` runs the full security test suite.

See [Security Gates](docs/security-gates.md) for details.
The latest readiness security review is recorded at [docs/security-review-2026-07-03.md](docs/security-review-2026-07-03.md).

---

## Roadmap

| Release | What's Included | Status |
|---------|----------------|--------|
| **R1.0.0–R1.5.0** | Read-only commands, status cards, player features, OPS/infra commands | ✅ Complete |
| **R2.0.0** | Write-safety foundation (disabled by default) | Scaffolded |
| **R2.x** | Low-risk admin writes (maintenance, notifications) | Planned |
| **R3.0.0** | Operational writes (backup, restart, update) | Planned |
| **R4.0.0+** | High-risk operations (player moderation, restore) | Planned |
| **Multi-Tenant** | Centralized OCI hosting, per-guild console routing, OAuth2 portal | In Progress |

See [Full Release Roadmap](docs/full-release-roadmap.md) for details.
The detailed R1.x to R2.x cadence and entry criteria live in [docs/r1-r2-release-roadmap.md](docs/r1-r2-release-roadmap.md).
Release candidates are gated by the [v1.0.0 Promotion Checklist](docs/v1.0.0-promotion-checklist.md).

---

## Sources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Dune Awakening Self-Host Docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker)
