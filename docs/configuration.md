# Configuration Reference

Every environment variable, role mapping, and feature flag for the Dune Discord Bot.

> **Scope (2026-08-07, issue #93):** server owners do **not** need this
> page — the hosted bot has no `.env` on the operator's side (see
> [Setup Portal Guide](setup-portal-guide.md)). This reference is for
> **maintainers/self-hosted operators** running their own instance, and
> for understanding multi-tenant hosting options (Section: Multi-Tenant
> Configuration).

## Quick Start (Minimal Configuration)

For first-time setup, you only need these 4 values:

```bash
DISCORD_BOT_TOKEN=           # From Discord Developer Portal → Bot → Token
DISCORD_CLIENT_ID=            # From Discord Developer Portal → General Information
DUNE_CONSOLE_API_URL=http://localhost:8088  # Your console WebUI address
DUNE_DISCORD_ADAPTER_TOKEN=   # Must match console's bot-api-token.txt
```

**Security tip:** Use file-based secrets instead of raw tokens:
```bash
DISCORD_BOT_TOKEN_FILE=/app/secrets/discord-bot-token.txt
DUNE_DISCORD_ADAPTER_TOKEN_FILE=/app/secrets/adapter-token.txt
```

For Docker users, mount the secrets directory as a read-only volume:
```bash
docker run ... -v /host/secrets:/app/secrets:ro ...
```

See the [Admin Guide](admin-guide.md) for a step-by-step setup walkthrough.

---

## Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Discord bot token from Developer Portal | `mfa.xxxx...` |
| `DISCORD_CLIENT_ID` | Discord application ID | `123456789012345678` |
| `DUNE_CONSOLE_API_URL` | Console WebUI base URL | `http://192.168.1.100:3000` |
| `DUNE_DISCORD_ADAPTER_TOKEN` | Token shared with console adapter | `random-secure-token` |

### File-Based Secrets (Preferred)

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN_FILE` | Path to file containing the Discord bot token |
| `DUNE_DISCORD_ADAPTER_TOKEN_FILE` | Path to file containing the adapter token |

When both a direct env var and a `_FILE` variant are set, the direct env var takes precedence.

---

## Discord Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_GUILD_ID` | *(empty)* | Dev guild ID for instant command registration. Leave empty for global commands |
| `DISCORD_DEFAULT_EPHEMERAL` | `true` | Bot replies visible only to the user who ran the command |

---

## Role-Based Access Control (RBAC)

The bot defaults to **restricted** mode. Every command requires an allowed role
or user ID unless `DISCORD_RBAC_MODE=open`.

### RBAC Mode

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `DISCORD_RBAC_MODE` | `restricted`, `open` | `restricted` | Set to `open` to allow all server members |

In `restricted` mode, at least one principal (role or user) must be configured
or the bot will fail to start.

### Role IDs

| Variable | Description |
|----------|-------------|
| `DISCORD_OBSERVER_ROLE_IDS` | Comma-separated Discord role IDs for read-only commands |
| `DISCORD_ADMIN_ROLE_IDS` | Comma-separated Discord role IDs for admin commands |
| `DISCORD_WRITE_ADMIN_ROLE_IDS` | Roles allowed to execute write commands (R2+) |
| `DISCORD_WRITE_OWNER_ROLE_IDS` | Roles allowed to execute high-risk write commands (R3+) |

### User Allow-List

| Variable | Description |
|----------|-------------|
| `DISCORD_ALLOWED_USER_IDS` | Comma-separated Discord user IDs with access to all commands |

### Per-Command Role Overrides

Each command can have its own role list. If not set, falls back to observer/admin.

| Variable | Command |
|----------|---------|
| `DISCORD_HEALTH_ROLE_IDS` | `/dune server health` |
| `DISCORD_ABOUT_ROLE_IDS` | `/dune core about` |
| `DISCORD_PING_ROLE_IDS` | `/dune core ping` |
| `DISCORD_STATUS_ROLE_IDS` | `/dune server status` |
| `DISCORD_STATUS_SUMMARY_ROLE_IDS` | `/dune server summary` |
| `DISCORD_READINESS_ROLE_IDS` | `/dune server readiness` |
| `DISCORD_SERVICES_ROLE_IDS` | `/dune server services` |
| `DISCORD_POPULATION_ROLE_IDS` | `/dune data population` |
| `DISCORD_BACKUPS_ROLE_IDS` | `/dune data backups` |

**Example:**
```bash
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=1100000000000000001
DISCORD_ADMIN_ROLE_IDS=1100000000000000002
DISCORD_ALLOWED_USER_IDS=2200000000000000001
```

---

## Adapter Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REQUEST_TIMEOUT_MS` | `8000` | Adapter request timeout in milliseconds |

### Route Overrides

You can override individual adapter route paths and methods:

| Variable | Default |
|----------|---------|
| `DUNE_ADAPTER_HEALTH_PATH` | `/api/integrations/discord/health` |
| `DUNE_ADAPTER_STATUS_PATH` | `/api/integrations/discord/status` |
| `DUNE_ADAPTER_READINESS_PATH` | `/api/integrations/discord/readiness` |
| `DUNE_ADAPTER_SERVICES_PATH` | `/api/integrations/discord/services` |
| `DUNE_ADAPTER_POPULATION_PATH` | `/api/integrations/discord/population` |
| `DUNE_ADAPTER_LOGS_PATH` | `/api/integrations/discord/logs` |
| `DUNE_ADAPTER_MAP_STATE_PATH` | `/api/integrations/discord/map-state` |
| `DUNE_ADAPTER_MAINTENANCE_PATH` | `/api/integrations/discord/maintenance` |
| `DUNE_ADAPTER_BACKUPS_PATH` | `/api/integrations/discord/backups/list` |
| `DUNE_ADAPTER_ANNOUNCEMENTS_PATH` | `/api/integrations/discord/announcements` |
| `DUNE_ADAPTER_BROADCAST_PATH` | `/api/integrations/discord/broadcast` |
| `DUNE_ADAPTER_VERSION_PATH` | `/api/integrations/discord/version` |
| `DUNE_ADAPTER_SERVERS_PATH` | `/api/integrations/discord/servers` |
| `DUNE_ADAPTER_PORTS_PATH` | `/api/integrations/discord/ports` |
| `DUNE_ADAPTER_DB_PATH` | `/api/integrations/discord/db` |
| `DUNE_ADAPTER_WRITE_EXECUTE_PATH` | `/api/integrations/discord/write/execute` |
| `DUNE_ADAPTER_WRITE_PREVIEW_PATH` | `/api/integrations/discord/write/preview` |
| `DUNE_ADAPTER_PLAYERS_LINK_PATH` | `/api/integrations/discord/players/link` |
| `DUNE_ADAPTER_PLAYERS_LINK_VERIFY_PATH` | `/api/integrations/discord/players/link/verify` |
| `DUNE_ADAPTER_PLAYERS_UNLINK_PATH` | `/api/integrations/discord/players/unlink` |
| `DUNE_ADAPTER_PLAYERS_ME_PATH` | `/api/integrations/discord/players/me` |
| `DUNE_ADAPTER_PLAYERS_ACCOUNTS_LIST_PATH` | `/api/integrations/discord/players/accounts/list` |
| `DUNE_ADAPTER_PLAYERS_ACCOUNTS_UNLINK_PATH` | `/api/integrations/discord/players/accounts/unlink` |
| `DUNE_ADAPTER_PLAYERS_ACCOUNTS_LINK_STEAM_PATH` | `/api/integrations/discord/players/accounts/link-steam` |
| `DUNE_ADAPTER_PLAYERS_FACTION_PATH` | `/api/integrations/discord/players/faction` |
| `DUNE_ADAPTER_PLAYERS_INVENTORY_PATH` | `/api/integrations/discord/players/inventory` |
| `DUNE_ADAPTER_PLAYERS_INVENTORY_SEARCH_PATH` | `/api/integrations/discord/players/inventory-search` |
| `DUNE_ADAPTER_PLAYERS_STORAGE_PATH` | `/api/integrations/discord/players/storage` |
| `DUNE_ADAPTER_PLAYERS_FIND_PATH` | `/api/integrations/discord/players/find` |
| `DUNE_ADAPTER_GUILD_STORAGE_PATH` | `/api/integrations/discord/guilds/storage` |
| `DUNE_ADAPTER_GUILD_FIND_PATH` | `/api/integrations/discord/guilds/find` |
| `DUNE_ADAPTER_OPS_ACTIVITY_PATH` | `/api/integrations/discord/ops/activity` |
| `DUNE_ADAPTER_OPS_COMBAT_PATH` | `/api/integrations/discord/ops/combat` |
| `DUNE_ADAPTER_OPS_RESOURCES_PATH` | `/api/integrations/discord/ops/resources` |
| `DUNE_ADAPTER_OPS_ECONOMY_PATH` | `/api/integrations/discord/ops/economy` |
| `DUNE_ADAPTER_OPS_INVENTORY_PATH` | `/api/integrations/discord/ops/inventory` |
| `DUNE_ADAPTER_OPS_LOCATION_PATH` | `/api/integrations/discord/ops/location` |
| `DUNE_ADAPTER_OPS_SOC_PATH` | `/api/integrations/discord/ops/soc` |
| `DUNE_ADAPTER_OPS_PROMETHEUS_PATH` | `/api/integrations/discord/ops/prometheus` |
| `DUNE_ADAPTER_OPS_DASHBOARD_PATH` | `/api/integrations/discord/ops/dashboard` |

Method overrides: `_PATH` → `_METHOD` (e.g., `DUNE_ADAPTER_HEALTH_METHOD=GET`).

---

## Scheduler Configuration

Controls scheduled status posts to Discord channels.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_POST_SCHEDULE_TYPE` | `none` | `none`, `status`, `status-summary`, `readiness`, `services` |
| `DUNE_POST_ALLOWED_CHANNELS` | *(empty)* | Comma-separated Discord channel IDs for scheduled posts |
| `DUNE_SCHEDULER_INTERVAL_MS` | `1800000` | Interval between posts in milliseconds (30 min default) |
| `DUNE_POST_RATE_LIMIT_MS` | `600000` | Minimum time between posts per channel (10 min default) |

**Example:**
```bash
DUNE_POST_SCHEDULE_TYPE=status-summary
DUNE_POST_ALLOWED_CHANNELS=3300000000000000001,3300000000000000002
DUNE_SCHEDULER_INTERVAL_MS=600000
```

---

## Monitoring Posts from Mentat (status and alert relays)

A monitoring stack (Prometheus and Alertmanager) can have its Discord posts come from Mentat itself, in Sahir Venn's voice, with the persona footer and a random signed quote, instead of from a webhook with a generic name. Data is **pushed** to the bot; the bot never reads from the monitoring host. Everything below is off unless configured, so an existing deployment is unaffected.

| Variable | Purpose |
| --- | --- |
| `DUNE_STATUS_CHANNEL_ID` | Channel for the live status message. |
| `DUNE_STATUS_RELAY_TOKEN` / `DUNE_STATUS_RELAY_TOKEN_FILE` | Bearer token the monitoring job must send. A separate secret from the alert relay's. Generate with `openssl rand -hex 32`; never paste it into chat. |
| `DUNE_ALERT_RELAY_CHANNEL_ID` | Post `/api/alerts/relay` alerts as the bot in this channel. Unset = the `DUNE_ALERT_WEBHOOK_URL` path, unchanged. |

**`POST /api/status/relay`** keeps ONE message up to date (posted once, then edited in place; the bot's own message, so only the bot can edit it). Send `Authorization: Bearer <token>` and JSON `{"state": "ok" | "degraded" | "down" | "unknown", "headline": "Online", "fields": [{"name": "Players", "value": "3 / 120", "inline": true}], "note": "optional"}`. The bot writes the title, a Mentat-voiced description, the quote and a "last updated" time. Behaviour:

- Answers **503** until both the token and the channel are configured, **401** for a missing or wrong bearer (checked before the body, with a constant-time compare, and logged at most once a minute), **413** over 32 KB, **400** for a bad payload (state must be one of the four, at most 20 fields, text is clipped), **429** for an unchanged state sent within 10 seconds of the last update (a different state always goes through), **502** if Discord fails.
- Updates are applied one at a time, in order. Mentions are disabled on every post.
- Changing `DUNE_STATUS_CHANNEL_ID` posts a fresh message in the new channel and removes the old one (best effort).
- A temporary Discord error while editing (a 5xx, a rate limit) answers **502** and keeps the same message so the sender can retry; only a message that is definitely gone (deleted, or its channel removed) is replaced with a fresh post.
- The text of all fields together is capped at 4000 characters so the finished embed always fits Discord's 6000-character limit (**400** otherwise). The 32 KB limit is measured on the parsed body, so it holds without a `Content-Length` header.
- Status goes stale if the sender stops pushing: the message keeps its last state with an ageing "last updated" time. Watch the sender (the monitoring job) separately.
- The route is exempt from the proxy-secret check, like `/api/alerts/relay`, so it is protected by the bearer token alone: serve it over HTTPS.

**`POST /api/alerts/relay` as the bot.** With `DUNE_ALERT_RELAY_CHANNEL_ID` set, firing and resolved alerts post as the bot (this **requires `DUNE_ALERT_RELAY_TOKEN[_FILE]`**: posts carry Mentat's identity, so an open relay would let anyone spoof them, and the route answers 503 until the token is set), one embed per alert, split into messages that stay under Discord's 6000-character limit. If the bot cannot post (missing Send Messages or Embed Links, channel gone) and `DUNE_ALERT_WEBHOOK_URL` is set, the remaining alerts go through the webhook instead of being lost. A webhook that answers 4xx/5xx is now reported as a failure (502) so Alertmanager retries, instead of being counted as relayed. If some alerts posted and none of the rest could, it answers 200 so Alertmanager does not resend and duplicate them; if nothing posted and there is no webhook it answers 502 so Alertmanager retries.

Alertmanager side (`webhook_configs`, placeholders shown):

```yaml
receivers:
  - name: mentat
    webhook_configs:
      - url: https://<bot host>/api/alerts/relay
        send_resolved: true
        max_alerts: 10
        http_config:
          authorization:
            type: Bearer
            credentials_file: /run/secrets/alert-relay-token
```

---

## #the-atlas Channel

A single message that the bot keeps current with each sietch's PvP/PvE setting
and the Coriolis cycle. Needs multi-tenant mode (the bot records which message
to edit in its local database). `/dune server atlas` uses the same source.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_ATLAS_CHANNEL_ID` | *(empty)* | Channel for the self-refreshing message. Unset disables it |
| `DUNE_ATLAS_INTERVAL_MS` | `600000` | Refresh interval in milliseconds |
| `DUNE_ATLAS_PASSWORD_ROLE_IDS` | *(empty)* | Adapter source only: role IDs the scheduled refresh presents to the console. The channel message shows the passwords the console returns only while `@everyone` cannot see the channel |

By default the data comes from the console's Discord adapter atlas route. A
console without that route answers `Invalid API key` and the message stops
updating.

### Atlas from a Console API key

For a console without the adapter atlas route, the bot can build the same
message from the console's own API. Set all three values, or none:

| Variable | Description |
|----------|-------------|
| `DUNE_ATLAS_API_KEY_FILE` | File holding a Console API key (one line starting `dak_`). There is no variable for the key itself |
| `DUNE_ATLAS_CONSOLE_URL` | The console's public `https://` address. The key is sent nowhere else |
| `DUNE_ATLAS_GUILD_ID` | The one Discord server that sees this console's atlas. Other servers keep using their own console's adapter route |

Differences from the adapter source:

- Live sandstorm status is not available, and the message says so.
- This source carries no sietch passwords. To show them, use the passwords file
  below.

The bot reads `GET /api/maps/combat-state` and `GET /api/map/spice`. A redirect
is treated as an error, so use the final address. A wrong or incomplete setting
stops the bot at startup with a message saying what is wrong.

Setup:

1. In the console, create an API key with **Maps: read** and no other
   permission.
2. On the bot host, as the bot's user, save it without echoing it into your
   shell history:

   ```bash
   install -d -m 700 ~/.config/mentat
   (umask 077; F=~/.config/mentat/console-api-key; read -rs -p 'Console API key: ' K && [[ $K =~ ^dak_[0-9a-f]{8}_[A-Za-z0-9_-]+$ ]] && printf '%s\n' "$K" > "$F.new" && chmod 600 "$F.new" && mv "$F.new" "$F" && printf '\nsaved\n' || printf '\nnot saved (expected one key starting dak_), any earlier file is unchanged\n')
   ```

3. Check the file exists, then add the three variables to the bot's `.env` and
   restart the service. Use the full path (`~` is not expanded there), for
   example `DUNE_ATLAS_API_KEY_FILE=/home/bot/.config/mentat/console-api-key`.
   A wrong value stops the whole bot, for every Discord server, until it is
   corrected.
4. Check the log for `atlas.refresh.started` with your server's ID in
   `consoleApiGuildId`, and no `atlas.refresh.failed` after it.

Rotation: create a new key, repeat step 2, restart the service, check step 4,
then revoke the old key in the console. To switch the feature off, remove the
three variables, restart, and revoke the key.

### Sietch passwords in the channel message

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_ATLAS_PASSWORDS_FILE` | *(empty)* | JSON file of sietch passwords to show in the `DUNE_ATLAS_CHANNEL_ID` message. Works with either source |

The file is one object. Each name is a sietch's name exactly as the message
shows it, or its partition number. For a sietch shown as `Partition 8`, use
`8`; the `(Instance 1)` after a Deep Desert entry is not part of its name:

```json
{
  "Sietch Example": "the-password",
  "8": "another-password"
}
```

When the sietches share one password, use the name `*` instead:

```json
{
  "*": "the-shared-password"
}
```

`*` covers every Hagga Basin sietch that has no entry of its own. It never
applies to the Deep Desert, which shows a password only when an entry names it.

To write a file holding only the `*` entry, without the password reaching your
shell history, run this as the bot's user:

```bash
install -d -m 700 ~/.config/mentat
(umask 077; F=~/.config/mentat/atlas-passwords.json; IFS= read -rs -p 'Sietch password: ' P && [ -n "$P" ] && J="$(P="$P" node -e 'const p = process.env.P; if (p.length > 64 || /[\x60\r\n]/.test(p)) process.exit(1); process.stdout.write(JSON.stringify({ "*": p }))')" && printf '%s\n' "$J" > "$F.new" && chmod 600 "$F.new" && mv "$F.new" "$F" && printf '\nsaved\n' || printf '\nnot saved (1 to 64 characters, no backtick), any earlier file is unchanged\n')
```

It replaces the whole file, so add any other entries again afterwards.

Keep the file outside the project folder, owned by the bot's user and open to
that user only (`chmod 600`). Except on Windows, a file that group or other
users can access is not used: no password from it is shown and the reason is
logged. The bot reads it at each refresh, so a changed password appears without
a restart. Change the file when you change a password in the console.

Rules:

- Passwords from this file appear only in the channel message, never in
  `/dune server atlas` replies.
- With the adapter source, `/dune server atlas` replies show any password the
  console returns for the caller's roles. The channel rule below does not apply
  to replies. Only the caller sees a reply, unless
  `DISCORD_DEFAULT_EPHEMERAL=false`, which posts it in the channel where the
  command was run.
- The channel message shows passwords, from this file or from the adapter source,
  only while `@everyone` cannot see the channel. Otherwise they are left out and
  `atlas.refresh.failed` is logged. Every role that can see the channel can read
  them, so review those roles.
- The bot checks at each refresh, not at the moment permissions change. If the
  channel is opened by mistake, the passwords stay up until the next refresh
  (10 minutes by default): delete the message and change the passwords.
- Changing `DUNE_ATLAS_CHANNEL_ID` removes the earlier message when the bot can,
  and logs it when it cannot. A move to a channel in another Discord server
  leaves the earlier message: delete it by hand.
- In that channel the bot needs View Channel, Send Messages, Embed Links and
  Read Message History. Without the last, each refresh posts a new copy.
- The number of file entries that match no sietch is logged.
- A file that cannot be read, or holds a password over 64 characters or with a
  backtick or line break, leaves all passwords out and logs the reason.

---

## Announcement Bridge Configuration

Forwards in-game announcements to a Discord channel.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_ANNOUNCEMENTS_ENABLED` | `false` | Enable game→Discord announcement forwarding |
| `DUNE_ANNOUNCEMENTS_CHANNEL` | *(empty)* | Discord channel ID to post announcements |
| `DUNE_ANNOUNCEMENTS_POLL_MS` | `30000` | Poll interval in milliseconds |

---

## Player Features Configuration

Controls player inventory, storage, and character linking features.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_DISCORD_ADAPTER_ENABLED` | *(inherited from console)* | Must be `true` on the console side for player features to work |
| `ACP_STEAM_LINK_PORT` | `3101` | Port the Steam-link OAuth callback server binds on the current deploy host. Canonical name `MENTAT_STEAM_LINK_PORT`; `SENTINEL_STEAM_LINK_PORT`/`ACP_STEAM_LINK_PORT` are deprecated but still accepted — see [env-var-compatibility.md](env-var-compatibility.md). |
| `ACP_STEAM_LINK_BASE_URL` | `ACP_BASE_URL` or `http://localhost:3101` | Public base URL used in OAuth `redirect_uri`; must match Discord's registered redirect and be reachable by players' browsers. Canonical name `MENTAT_STEAM_LINK_BASE_URL`; `SENTINEL_STEAM_LINK_BASE_URL`/`ACP_STEAM_LINK_BASE_URL` are deprecated but still accepted. |

**Note:** The Steam-link callback server is always started (it is cheap to
run idle and its `/health` route is useful), but the "Link via Steam"
button is only offered when a Discord OAuth client secret is configured
(`DISCORD_CLIENT_SECRET` in multi-tenant mode). Self-hosted operators
reaching the Steam-link flow over the internet must expose
`MENTAT_STEAM_LINK_PORT` (or the deprecated `ACP_STEAM_LINK_PORT`)
and set `MENTAT_STEAM_LINK_BASE_URL` (or the deprecated
`ACP_STEAM_LINK_BASE_URL`) to a public URL Discord will redirect to.

**Note:** Player features require no additional bot configuration. They work
automatically once the bot is connected to a console with the Discord adapter
enabled. Players run `/dune player link <character-name>` to link their
Discord account to their in-game character (the character name is
required); what happens next is decided automatically by the bot:

1. If the named character has no Steam account on file, a verification
   code is sent in-game via whisper (RabbitMQ `chat.whispers`) — use
   `/dune player verify <code>` to complete the link.
2. If the named character already has a Steam account on file, the bot
   instead shows a "Link via Steam" button — completing Discord's OAuth
   consent screen links the character instantly if the connected Steam
   account matches, or automatically falls back to sending the whisper
   code if it doesn't.

**Correction (2026-07-24):** this section previously also documented a
"Discord has a verified Steam connection, linking completes instantly" step
as already-working; that capability did not exist in the code at the time
this was originally written (verified against the commit history — see the
CHANGELOG.md correction for the same claim). It has since actually been
designed and implemented, per the corrected mechanics above — see
`docs/steam-link-design.md` for the full design (including a mid-development
revision correcting an initial draft where the character argument was
optional). Command paths below are also updated from the pre-restructure
`/dune data *` group to the current `/dune player *` group (see
`docs/steam-link-design.md`'s "Scope Addition" section for that rename's
rationale).

Once linked, players can use:

- `/dune player link <character>` — Link Discord to in-game character (bot picks whisper or Steam automatically)
- `/dune player verify <code>` — Complete linking with verification code (whisper path only)
- `/dune player unlink` — Remove character link
- `/dune player whoami` — Show linked character info
- `/dune player faction` — Show your real, in-game faction (read-only, auto-detected — `dune-awakening-selfhost-docker#696`)
- `/dune player inventory` — View character inventory
- `/dune player inventory <search>` — Search items in inventory
- `/dune player storage` — View storage containers (owned scope)
- `/dune player storage <scope>` — View storage (owned, guild, or all)
- `/dune player find <item>` — Search items in storage

### Player Feature Capabilities

Player links are stored on the console (Core) side, not in this bot's own
database. **Correction (2026-07-24):** the exact table name in the "origin/main"
side of this conflict (`dune.discord_player_links`) was already stale even
before this conflict was resolved — the current schema (see
`docs/steam-link-design.md`'s "Why No New Core Schema Is Needed" section) is
`console.discord_account_links` (FINDING-LINK-6), which supports multiple
characters per Discord user; the single-link `console.discord_player_links`
table this doc originally referenced is the older, superseded schema. Note
this bot's own `src/database.js` does define a `player_links` SQLite table
with `upsertPlayerLink()`/`getPlayerLink()`/`deletePlayerLink()` functions,
but as of this correction none of those functions are called anywhere in
`src/commands.js` or `src/index.js` — all `player:*` commands route through
`adapterClient` (HTTP calls to Core) instead. That bot-side table appears to
be unused/dead schema, not a second source of truth.

**Resolved (mentat#251):** the SAME dead-code pattern used to exist for a
second, unrelated feature — `src/database.js`'s `guild_settings.faction`
column and its `setGuildFaction()`/`getGuildFaction()` functions (a
per-guild cosmetic theme used by `statusCard.js` for themed status cards,
entirely distinct from a player's own personal in-game faction).
`getGuildFaction()` was always called and did render themed cards;
`setGuildFaction()` was defined but never called anywhere, so every
guild's theme was permanently stuck at the empty-string default.
`/dune player faction`'s old description ("Set your faction for themed
embeds") appears to have described this feature's INTENT, but its actual
handler never called `setGuildFaction()` — it called
`adapterClient.playerFaction()` (a real, different, per-player Core
route) the whole time.

**Regressed again (mentat#276, schema v7 hardening — see the "Six tables
are gone from `data/acp.db`" migration in `src/database.js`):** the
auto-sync wiring described in the paragraph above was itself removed
when `guild_member_activity` (its only data source) was deleted as part
of the v6→v7 SQLite hardening pass. `guildFactionSync.js` and
`syncGuildFactionTheme()` no longer exist in this codebase; `/dune
player faction` no longer calls either. `setGuildFaction()` is once
again defined but never called by anything — the exact dead-code state
mentat#251 originally fixed — so every guild's themed-embed faction is
back to being permanently stuck at the empty-string default. This is a
known, currently-undecided limitation, not an oversight left
undocumented: see mentat#311 for whether to reintroduce a
manual-setter command/setup-portal field (the hardening commit's own
comment says the column is "still directly, manually settable," but no
such manual path is actually implemented yet) or remove the dead
`setGuildFaction()`/`guild_settings.faction` column outright.

| Capability | Required Role | Commands |
|-----------|---------------|----------|
| `inventory:read` | Observer or Admin | `/dune player link`, `/dune player unlink`, `/dune player whoami`, `/dune player faction`, `/dune player inventory`, `/dune player find` |
| `storage:read` | Observer or Admin | `/dune player storage` (owned scope) |
| `guild:read` | Observer or Admin | `/dune player storage` (guild scope), `/dune player find` (guild scope) |

---

## Write Command Configuration (R2+)

All write commands are disabled by default. Requires upstream write-contract
approval before enabling in production.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_DISCORD_WRITES_ENABLED` | `false` | Master switch for all write-capable commands |
| `DISCORD_WRITE_ADMIN_ROLE_IDS` | *(empty)* | Roles allowed to execute write operations |
| `DISCORD_WRITE_OWNER_ROLE_IDS` | *(empty)* | Roles allowed to execute high-risk writes |

**Broadcast cooldown:** 60 seconds per user (not configurable in v1).

---

## Cooldown Configuration

Prevents command spam.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_COOLDOWN_MS` | `5000` | Per-user per-command cooldown in milliseconds |
| `DUNE_ADMIN_COOLDOWN_MS` | `1000` | Cooldown for admin roles (shorter) |

---

## Health State

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_BOT_HEALTH_STATE_FILE` | `/tmp/dune-discord-bot/health.json` | Health state output path |
| `DUNE_BOT_HEALTH_MAX_AGE_MS` | `120000` | Maximum staleness before healthcheck fails |

---

## Multi-Tenant Configuration (v1.6+)

When `ACP_MULTI_TENANT=true` (or its canonical name `MENTAT_MULTI_TENANT=true`), the bot runs as a centralized service serving multiple Discord servers. Each guild connects to its own Dune console, with configuration stored in a local SQLite database.

Four of the five settings below accept the canonical/legacy prefix scheme
(`MENTAT_*` canonical, `SENTINEL_*`/`ACP_*` deprecated but still accepted —
see [env-var-compatibility.md](env-var-compatibility.md)); `ACP_DB_PATH`
is the one exception, deliberately not yet resolved through that scheme.

| Variable | Default | Description |
|----------|---------|-------------|
| `ACP_MULTI_TENANT` | `false` | Enable multi-tenant mode. Canonical: `MENTAT_MULTI_TENANT`. |
| `ACP_DB_PATH` | `data/acp.db` | Path to SQLite database file. **No canonical `MENTAT_*` alias exists for this one** — only `ACP_DB_PATH` is recognized. |
| `ACP_BASE_URL` | `http://localhost:3100` | Base URL for the setup web portal. Canonical: `MENTAT_BASE_URL`. |
| `ACP_SETUP_PORT` | `3100` | Port for the setup web portal. Canonical: `MENTAT_SETUP_PORT`. |
| `ACP_OAUTH_REDIRECT_URI` | *(auto)* | Discord OAuth2 callback URL. Canonical: `MENTAT_OAUTH_REDIRECT_URI`. |
| `DISCORD_CLIENT_SECRET` | *(required)* | Discord OAuth2 client secret (from Developer Portal → OAuth2) |

In multi-tenant mode:
- `DUNE_CONSOLE_API_URL` and `DUNE_DISCORD_ADAPTER_TOKEN` are optional placeholders
- RBAC is configured per-guild, either via the in-console "Connect to hosted bot" flow (primary) or the web setup portal (fallback) — the old DM onboarding flow no longer exists
- Guild configuration is stored in SQLite (`data/acp.db`)
- The setup portal runs at `http://localhost:3100/setup`

### Setup Portal Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /setup` | OAuth2 login page |
| `GET /oauth/callback` | Discord OAuth2 callback |
| `POST /setup/register` | Guild registration API (manual/portal path) |
| `POST /api/consoles/register` | In-console registration API — called directly by the Dune Docker Console's "Connect to hosted bot" button, never through the portal; independently re-verifies Discord guild ownership before registering |
| `GET /health` | Setup server health check |

### Database Schema

**Corrected (schema v7 hardening pass):** this section previously listed
`oauth_sessions` and `player_links` as tables the bot stores. Neither is
true anymore, and `player_links` never actually held real data even
before this correction — see database.js's own "Schema hardening (v7)"
comment for the full rationale (`player_links` was dead code with zero
callers; player-linking has always actually lived in each operator's
own Core Postgres, reached via `adapterClient.js`). `oauth_sessions`,
along with the command counter and the live-stats display caches, moved
to in-memory-only JS state in the same pass -- none of it needs to
survive a process restart to be correct.

The bot's SQLite database (`data/acp.db`) now holds only:
- `guilds` — Per-guild console URL, encrypted adapter token, status, and
  (opt-in) live-stats-sharing secret/consent record
- `guild_roles` — Per-guild observer/admin/moderator role IDs
- `guild_settings` — Per-guild RBAC mode, cooldowns, schedule
- `key_versions` / `secret_keys` / `secret_access_log` — KEK/DEK
  bookkeeping for the encrypted columns on `guilds` above

---

## Feature Flag Summary

| Feature | Env Var | Default |
|---------|---------|---------|
| Read-only commands | (always on) | N/A |
| Player inventory/storage | (always on when adapter enabled) | N/A |
| Player faction | (always on when adapter enabled) | N/A |
| OPS commands | (always on, returns planned data) | N/A |
| Infra commands | (always on) | N/A |
| Scheduled status posts | `DUNE_POST_SCHEDULE_TYPE` | `none` |
| Announcement bridge | `DUNE_ANNOUNCEMENTS_ENABLED` | `false` |
| Write commands | `DUNE_DISCORD_WRITES_ENABLED` | `false` |
| Broadcast command | `DUNE_DISCORD_WRITES_ENABLED` | `false` |
| Multi-tenant mode | `ACP_MULTI_TENANT` | `false` |

---

## Discord Role Setup

After inviting the bot, create these roles in your Discord server:

1. **Dune Observer** — Can use all read-only commands including player features
2. **Dune Admin** — Read-only + all admin commands
3. **Dune Write Admin** — Can execute write commands (when enabled)
4. **Dune Write Owner** — Full access including high-risk operations (future)

Configure the role IDs in your `.env`:
```bash
DISCORD_OBSERVER_ROLE_IDS=ROLE_ID_1
DISCORD_ADMIN_ROLE_IDS=ROLE_ID_2
DISCORD_WRITE_ADMIN_ROLE_IDS=ROLE_ID_2
DISCORD_WRITE_OWNER_ROLE_IDS=ROLE_ID_3
```

### How to Find a Role ID

1. Enable **Developer Mode** in Discord (User Settings > Advanced > Developer Mode)
2. Right-click a role in Server Settings > Roles
3. Click **Copy Role ID**

### How to Find a Channel ID

1. Enable Developer Mode
2. Right-click a channel name
3. Click **Copy Channel ID**

---

## .env.example Template

```bash
# === Required ===
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DUNE_CONSOLE_API_URL=http://localhost:3000
DUNE_DISCORD_ADAPTER_TOKEN=

# === Role Access ===
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=
DISCORD_ADMIN_ROLE_IDS=
DISCORD_ALLOWED_USER_IDS=

# === Dev Registration ===
# DISCORD_GUILD_ID=

# === Scheduler ===
DUNE_POST_SCHEDULE_TYPE=none
# DUNE_POST_ALLOWED_CHANNELS=

# === Announcements ===
# DUNE_ANNOUNCEMENTS_ENABLED=true
# DUNE_ANNOUNCEMENTS_CHANNEL=

# === Writes (disabled by default) ===
# DUNE_DISCORD_WRITES_ENABLED=true
# DISCORD_WRITE_ADMIN_ROLE_IDS=

# === Multi-Tenant (optional) ===
# ACP_MULTI_TENANT=false
# ACP_DB_PATH=data/acp.db
# ACP_BASE_URL=http://localhost:3100
# DISCORD_CLIENT_SECRET=
```
