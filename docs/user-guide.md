# User Guide — Using the Dune Discord Bot

This guide is for anyone who has the bot in their Discord server and wants to
use it. You don't need to know anything about servers, Docker, or code.

## What This Bot Does

The Arrakis Control Panel bot watches your Dune Awakening game server and
reports its health, status, and activity through Discord slash commands. Think
of it like a dashboard that lives inside Discord — you type a command, and the
bot tells you what's happening with the game server.

**What you can do:**
- Check if the game server is running and healthy
- See how many players are online
- Look up your own inventory and storage containers
- Search for specific items in your inventory or storage
- View combat statistics, resource data, and economy info
- Get automatic status updates posted to a Discord channel

## How to Use Slash Commands

In any channel where the bot can see messages, type `/` and start typing `dune`.
Discord will show a list of available commands:

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

### 📊 `data` — Game World Data & Player Features

| Command | What It Does |
|---------|-------------|
| `/dune data population` | Shows how many players are online |
| `/dune data backups` | Lists recent game backups |
| `/dune data maps` | Shows which game maps are running |
| `/dune data inventory` | View everything in your character's inventory |
| `/dune data inventory <search>` | Search for an item in your inventory |
| `/dune data storage` | View items in your storage containers (owned or guild) |
| `/dune data storage <scope>` | View storage with scope (owned, guild, or all) |
| `/dune data find <item-name>` | Search for an item across all your storage containers |

### 🔗 `player` — Character Linking & Identity

| Command | What It Does |
|---------|-------------|
| `/dune player link <character-name>` | Start linking your Discord to your in-game character (whisper code) |
| `/dune player link` (no character name) | Link via your Discord's connected Steam account instead — no whisper needed, works even if your character is offline |
| `/dune player verify <code>` | Complete linking by entering the verification code shown in-game |
| `/dune player characters` | List all your linked characters |
| `/dune player enable <character>` | Enable a linked character in this guild |
| `/dune player disable <character>` | Disable a linked character in this guild |
| `/dune player default <character>` | Set your default character for this guild |
| `/dune player unlink <character>` | Unlink a character from your Discord |
| `/dune player faction <name>` | Set your faction for themed embeds (atreides, harkonnen, fremen) |
| `/dune player whoami` | Show your linked character info |

**Character Linking Flow (whisper-based, default):**
1. Run `/dune player link <character-name>` — the bot sends a 6-character verification code to your character in-game via whisper
2. Read the code in-game (it appears as a whisper message)
3. Run `/dune player verify <code>` to complete the link
4. Codes expire after 5 minutes

**Character Linking Flow (via Steam, alternative — works even if your character is offline):**
1. Run `/dune player link` with no character name — the bot replies with a "Sign in with Discord" button
2. Click it, approve the requested `identify`/`connections` permissions on Discord's own consent screen
3. If your Discord account has a Steam connection linked (Discord Settings → Connections), the bot shows you a list of matching in-game character(s) — pick the one(s) you want to link
4. This works even if your character is currently offline, since it doesn't rely on an in-game whisper

You can link more than one character to your Discord account — see `/dune player characters` to view all of them.

### 📋 `logs` — Container Logs

| Command | What It Does |
|---------|-------------|
| `/dune logs dune-cache` | View dune-cache container logs |
| `/dune logs dune-generated` | View dune-generated container logs |
| `/dune logs dune-server` | View dune-server container logs |
| `/dune logs dune-steam` | View dune-steam container logs |
| `/dune logs dune-work` | View dune-work container logs |
| `/dune logs orchestrator` | View orchestrator container logs |
| `/dune logs redblink-dune-docker-console` | View console adapter logs |

### 📈 `ops` — Operational Stats (returns planned data until upstream merges)

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

## Linking Your Character

Before you can use the player commands (`/dune data inventory`, `/dune data storage`, etc.),
you need to link your Discord account to your in-game character.

### Step 1: Link Your Character

Run this command in Discord:

```
/dune player link <your-character-name>
```

Replace `<your-character-name>` with the exact name of your character in the game.
For example: `/dune player link PaulAtreides`

The bot will search for your character and generate a verification code. This code is sent to your character in-game as a whisper message.

### Step 2: Verify Your Code

Check your in-game whispers for a message like:

> *"Your ACP verification code is: ACP-7X9K2. Use /dune player verify ACP-7X9K2 to link your character."*

Then run:

```
/dune player verify ACP-7X9K2
```

Replace `ACP-7X9K2` with the actual code you received. Codes expire after 5 minutes.

**Alternative — link via Steam (no whisper needed):**

If your character is offline, or you'd rather skip the whisper step
entirely, run `/dune player link` with no character name instead of the
two steps above. The bot will show a "Sign in with Discord" button — click it, approve the
`identify`/`connections` permissions on Discord's own consent screen, and
the bot will show any in-game character(s) matching a Steam account linked
in your Discord Settings → Connections. This requires your Discord account
to already have a Steam connection added there (a one-time, native Discord
setting — the bot has no part in creating that link, only reading it with
your permission).

### Step 3: Check Your Link

Run this command to see your linked character:

```
/dune player whoami
```

This shows your character name, whether you're currently online, and other details.

### Step 4: Set Your Faction (Optional)

You can set your faction to get themed embed colors and quotes:

```
/dune player faction atreides
/dune player faction harkonnen
/dune player faction fremen
```

### Step 5: Use Player Commands

Once linked, you can use all the player commands:

- `/dune data inventory` — See everything your character is carrying
- `/dune data inventory <search>` — Search for an item in your inventory
- `/dune data storage` — See items in your storage containers
- `/dune data storage guild` — See items in guild storage
- `/dune data find <item>` — Search for an item across all your storage

### Step 6: Unlink (Optional)

If you want to remove the link between your Discord and character:

```
/dune player unlink
```

This does not affect your character in the game — it just disconnects it from Discord.

### Common Linking Issues

| Problem | What It Means | How to Fix |
|---------|--------------|------------|
| "No player found" | The character name doesn't exist | Check the spelling — it must match exactly |
| "Multiple players found" | More than one character has that name | Use a more specific name |
| "Invalid or expired code" | The code is wrong or expired | Run `/dune player link <character>` again for a new code |
| "Code belongs to different user" | Someone else generated this code | Use your own Discord account to link |
| "Not linked" | You haven't linked a character yet | Run `/dune player link <name>` first, or `/dune player link` with no name for the Steam-based flow |
| "No Steam connection found" | Your Discord account has no linked Steam account | Add one in Discord Settings → Connections, or use `/dune player link <name>` instead |
| "No characters found for your Steam account" | Your linked Steam account has no matching in-game character | Make sure you're logged into the game with the same Steam account, or use `/dune player link <name>` instead |
| "Not authorized" | You don't have the Observer role | Ask a server admin to give you the role |

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
│  ACP · The spice must flow.         │
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
(called `#acp-updates` or whatever your admin configured). These appear every
30 minutes and show:

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
- [Dune Awakening Self-Host Discord Bot Repository](https://github.com/yacketrj/Arrakis-Control-Panel)
