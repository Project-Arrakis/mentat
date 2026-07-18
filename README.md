# Arrakis Control Panel

Self-hosted Discord control panel for Dune: Awakening servers, with secure status dashboards, alerts, observability, RBAC, and adapter-based administration.

> **Compatibility:** Existing `/dune` commands, `DUNE_*` environment variables, addon IDs, runtime API paths, and historical release identifiers remain unchanged.

> *"A beginning is a very delicate time."*

Your Dune Awakening server is a living world — players, maps, resources,
economies — all pulsing to the rhythm of the deep desert. But you cannot stand
at the console every hour. You need eyes that never close. You need a watcher
that speaks the old tongue and warns your tribe when the sand shifts.

**ACP** is that watcher.

This bot watches over the data streams of your server and brings them to Discord — status
cards, population counts, map readiness, backup lists, combat stats, and more.
It posts scheduled updates. It forwards in-game announcements. It lets your
moderators speak to the game, and your admins diagnose from anywhere.

And like any Fremen tool, it is built for survival: read-only by default,
bearer-token protected, secrets never exposed, no Docker socket, no database
access, no shell commands. The spice must flow — safely.

---

## Quick Start

```bash
git clone https://github.com/yacketrj/Arrakis-Control-Panel.git
cd Arrakis-Control-Panel
cp .env.example .env   # fill in DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, etc.
npm ci --omit=dev
npm run register
npm start
```

**New to all this?** Start here:
- [Admin Guide](docs/admin-guide.md) — 12-step setup for first-time server owners
- [User Guide](docs/user-guide.md) — plain-English explanation of every command
- [FAQ](docs/faq.md) — 25 common questions answered
- [Troubleshooting](docs/troubleshooting.md) — error → fix table

**Already running?** See the [Configuration Reference](docs/configuration.md).

---

## Features

- **25 slash commands** across 6 groups — core, server, data, ops, admin, infra
- **Canvas status cards** — 1200×640 rendered PNG with Dune Rise typeface
- **Rich Discord embeds** — emoji indicators, faction colors, structured fields
- **Scheduled updates** — server status posted to your channel every 30 minutes
- **Diagnostic mode** — admins get full CLI-style output on status/readiness
- **Game → Discord bridge** — in-game announcements forwarded to your server
- **Discord → Game bridge** — moderators can broadcast to all players
- **OPS observability** — 9 operational data domains from the OPS addon
- **Role-based access** — observer roles for members, admin for operators
- **File-based secrets** — tokens never in shell history, never in Docker env
- **Zero-permission addon** — WebUI panel with no backend access
- **Dune quotes** — random lore-inspired wisdom in every embed footer

## Commands

Type `/dune` and select a group:

| Group | Description | Commands |
|-------|-------------|----------|
| `core` | Bot information | `about` `ping` `help` |
| `server` | Game server health | `health` `status` `summary` `readiness` `services` |
| `data` | Game data | `population` `backups` `maps` |
| `ops` | Observability (addon) | `activity` `combat` `resources` `economy` `inventory` `location` `soc` `prometheus` `dashboard` |
| `admin` | Administration | `doctor` `cooldowns` `latency` `events` `broadcast` |
| `infra` | Infrastructure | `version` `servers` `ports` `db` |

> Add `diagnostic:true` to `/dune server status` or `/dune server readiness` for full CLI output (admins only).

## Documentation

### For Everyone
- [User Guide](docs/user-guide.md) — how to use every command
- [FAQ](docs/faq.md) — common questions answered
- [Troubleshooting](docs/troubleshooting.md) — error messages and fixes

### For Server Owners
- [Admin Guide](docs/admin-guide.md) — set up the bot on your server
- [Configuration Reference](docs/configuration.md) — all environment variables and settings
- [Discord Setup](docs/discord-setup.md) — Discord app creation and OAuth2
- [Installation Guide](docs/installation-guide.md) — advanced Docker/Node deployment

### For Developers
- [Architecture](docs/architecture.md) — system design and integration points
- [Security Model](docs/security-model.md) — RBAC, secrets, threat model
- [API Security Testing](docs/api-security-testing.md) — DAST scans and gate enforcement
- [Cutting PRs](docs/cutting-prs.md) — upstream PR process and staging
- [Release Process](docs/release-process.md) — versioning, changelog, release gates
- [Full Release Roadmap](docs/full-release-roadmap.md) — multi-train release plan

## Security

| Gate | Tool | Frequency |
|------|------|-----------|
| SAST | Semgrep | pre-commit |
| Secrets | Gitleaks | pre-commit |
| Misconfig | Trivy | pre-commit |
| Dependencies | npm audit | pre-commit |
| Cloud secrets | ggshield | pre-commit |
| Unit tests | node:test | pre-push |
| API DAST | security:api | pre-push |
| Image scan | Trivy image | release gates |
| Doc validation | validate:docs | release gates |

`npm run check` runs unit tests, release metadata validation, addon packaging, and SBOM generation. `npm run release:gates` runs the full 9-step suite.

See [Security Gates](docs/security-gates.md) for details.

## Roadmap

- **R1.0.0–R1.5.0** (current) — Read-only maturity. 25 commands, subcommand groups, canvas cards. ✅ Complete.
- **R2.0.0** — Write-safety foundation. Disabled by default. Framework staged.
- **R2.x** — Low-risk admin writes (maintenance, notifications, schedule).
- **R3.0.0** — Operational writes (backup, restart, update, cache).
- **R4.0.0+** — Highest-risk operations (player moderation, restore).

See [Full Release Roadmap](docs/full-release-roadmap.md) for gates and entry criteria.
The detailed R1.x to R2.x cadence and entry criteria live in [docs/r1-r2-release-roadmap.md](docs/r1-r2-release-roadmap.md).
Release candidates are gated by the [v1.0.0 Promotion Checklist](docs/v1.0.0-promotion-checklist.md).
The latest readiness security review is recorded at [docs/security-review-2026-07-03.md](docs/security-review-2026-07-03.md).

See the [Release Process](docs/release-process.md) for versioning, changelog, and release gate procedures.

## Sources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Dune Awakening Self-Host Docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker)
