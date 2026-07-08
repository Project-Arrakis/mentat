# User Guide — Using the Dune Discord Bot

This guide is for anyone who has the bot in their Discord server and wants to
use it. You don't need to know anything about servers, Docker, or code.

## What This Bot Does

The Arrakis Control Plane bot watches your Dune Awakening game server and
reports its health, status, and activity through Discord slash commands. Think
of it like a dashboard that lives inside Discord — you type a command, and the
bot tells you what's happening with the game server.

## How to Use Slash Commands

In any channel where the bot can see messages, type `/` and start typing `dune`.
Discord will show a list of available commands:

![Typing /dune in Discord](https://cdn.discordapp.com/attachments/1207782128457228348/1524202981606690916/content.png?ex=6a4ee425&is=6a4d92a5&hm=3f9f844d477990536c3ae4f19abfd45a55a351ed965ea67128355c6ae301686e&width=400)

Commands are organized into groups. After typing `/dune`, you'll see the groups.
Select one, then choose a command from within that group.

## Command Groups

### 🔧 `core` — Bot Information

| Command | What It Does |
|---------|-------------|
| `/dune core about` | Shows bot version, security info, and connection details |
| `/dune core ping` | Tests how fast the bot can reach your game server |
| `/dune core help` | Lists all commands you have permission to use |

### 🌍 `server` — Game Server Health

| Command | What It Does |
|---------|-------------|
| `/dune server health` | Checks if the Discord adapter is running |
| `/dune server status` | Shows a dashboard card with server status, players, maps |
| `/dune server summary` | Quick text summary of server status |
| `/dune server readiness` | Checks if the game server is ready for players |
| `/dune server services` | Lists all game services and their status |

> **Admin Tip:** Add `diagnostic:true` to `/dune server status` or
> `/dune server readiness` for detailed technical output (admin only).

### 📊 `data` — Game Data

| Command | What It Does |
|---------|-------------|
| `/dune data population` | Shows how many players are online |
| `/dune data backups` | Lists recent game backups |
| `/dune data maps` | Shows which game maps are running |

### 📈 `ops` — Operational Stats (requires OPS addon)

| Command | What It Does |
|---------|-------------|
| `/dune ops activity` | Player activity over time |
| `/dune ops combat` | Combat and death statistics |
| `/dune ops resources` | Resource field data (spice, water, etc.) |
| `/dune ops economy` | Currency, trading, and tax data |
| `/dune ops inventory` | Item and crafting statistics |
| `/dune ops location` | Map markers and player density |
| `/dune ops soc` | OPS bridge health and request stats |
| `/dune ops prometheus` | Container CPU, memory, and uptime |
| `/dune ops dashboard` | All of the above in one summary |

### 🛡️ `admin` — Administration (restricted access)

| Command | Who Can Use | What It Does |
|---------|------------|-------------|
| `/dune admin doctor` | Admins | Full system diagnostic across all services |
| `/dune admin cooldowns` | Admins | Shows who is rate-limited |
| `/dune admin latency` | Admins | Adapter request timing history |
| `/dune admin events` | Admins | Recent server incidents and alerts |
| `/dune admin broadcast` | Mods+ | Send a message to all in-game players |

### 🖥️ `infra` — Infrastructure

| Command | What It Does |
|---------|-------------|
| `/dune infra version` | Shows the Dune stack version |
| `/dune infra servers` | Lists all game server partitions |
| `/dune infra ports` | Shows which network ports are open |
| `/dune infra db` | Checks database health |

## Understanding the Status Card

When you run `/dune server status`, the bot generates a custom image card that
looks like this:

```
┌─────────────────────────────────────────┐
│  Tabr-Tau                    [ READY ]  │
│                                         │
│  PLAYERS    REGION    MODE    SERVICES  │
│    0/60       NA     public      10     │
│  ─────────────────────────────────────  │
│  ACTIVE MAPS                            │
│  🟢 Survival_1 — READY (Up 18h)         │
│  🟢 Overmap — READY (Up 18h)            │
│  ─────────────────────────────────────  │
│  Thumper · The spice must flow.         │
└─────────────────────────────────────────┘
```

- **Top line** — Server name and overall status
- **Stats row** — Quick numbers: players, region, game mode
- **Maps section** — Each game map with status (🟢=ready, 🔴=down)
- **Footer** — Random Dune quote

## "Not Authorized" Errors

If you see **"You are not authorized to use this command"**, it means your
Discord role doesn't have permission for that command. The server owner controls
who can use which commands.

Most read-only commands require the **Observer** role. Admin commands require
the **Admin** role. If you think you should have access, ask your server
administrator.

## Where to See Status Updates

The bot automatically posts server status updates to a dedicated channel
(called `#acp-updates`). These appear every 30 minutes and show:

```
**Scheduled Status Summary**
Overall: READY | Title: Tabr-Tau | Region: North America
Mode: public | Population: 0/60
```

You don't need to do anything — these updates happen automatically.

## Getting Help

- Type `/dune core help` to see which commands you can use
- See the [FAQ](faq.md) for common questions
- See [Troubleshooting](troubleshooting.md) if something isn't working

## Sources

- [Discord Slash Commands Guide](https://support.discord.com/hc/en-us/articles/1500000368501-Slash-Commands-FAQ)
- [Dune Awakening Self-Host Discord Bot Repository](https://github.com/yacketrj/dune-awakening-selfhost-discordbot)
