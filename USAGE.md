# Usage

Register one `/dune` slash command with 6 command groups (plus a conditional 7th).
Commands pass through the WebUI Discord adapter and are RBAC-gated.

## Commands

Type `/dune` in Discord and select a group:

| Group | Purpose | Commands |
| --- | --- | --- |
| `core` | Bot information and help | `about`, `ping`, `help`, `setup` |
| `server` | Game server health | `health`, `status`, `summary`, `readiness`, `readiness-detail`, `services`, `services-detail` |
| `data` | Game world data and player features | `population`, `backups`, `maps`, `maintenance`, `link`, `unlink`, `faction`, `whoami`, `inventory`, `storage`, `find` |
| `ops` | Operational stats | `activity`, `combat`, `resources`, `economy`, `inventory`, `location`, `soc`, `prometheus`, `dashboard` |
| `admin` | Administration | `doctor`, `cooldowns`, `latency`, `events`, `broadcast` |
| `infra` | Infrastructure | `version`, `servers`, `ports`, `db` |
| `write` | Write operations (disabled by default) | `maintenance-note`, `maintenance-window`, `alert-channel`, `alert-threshold`, `digest-schedule`, `post-schedule`, `add-channel`, `remove-channel`, `backup`, `restart`, `update`, `cache` |

### Key Commands

| Command | Purpose | Adapter call |
| --- | --- | --- |
| `/dune core about` | Shows safe bot and adapter metadata | none |
| `/dune core ping` | Measures Discord defer timing and adapter health latency | `GET /api/integrations/discord/health` |
| `/dune server health` | Shows adapter health | `GET /api/integrations/discord/health` |
| `/dune server status` | Shows high-level server status | `POST /api/integrations/discord/status` |
| `/dune server summary` | Shows compact aggregate server status | `POST /api/integrations/discord/status` |
| `/dune server readiness` | Shows readiness and preflight state | `POST /api/integrations/discord/readiness` |
| `/dune server services` | Shows service state | `POST /api/integrations/discord/services` |
| `/dune data population` | Shows player count | `POST /api/integrations/discord/population` |
| `/dune data link <character>` | Link Discord to in-game character | `POST /api/integrations/discord/players/link` |
| `/dune data inventory` | View character inventory | `POST /api/integrations/discord/players/inventory` |
| `/dune infra version` | Shows Dune stack version | `GET /api/integrations/discord/version` |

> Add `diagnostic:true` to `/dune server status` or `/dune server readiness` for full CLI output (admins only).

### OPS Commands

OPS commands return planned/placeholder data until the upstream OPS addon is merged.
They are available for testing but will not show real operational data until the
console-side implementation is complete.

### Write Commands

Write commands are disabled by default. Set `DUNE_DISCORD_WRITES_ENABLED=true` to enable.
All write operations require confirmation and generate idempotency keys for safety.

Command output is ephemeral by default. Set `DISCORD_DEFAULT_EPHEMERAL=false`
only when the target channel and RBAC model are appropriate for shared server
status messages.

## RBAC

The default mode is restricted. At least one role or user allow-list must be
configured before startup succeeds.

- `DISCORD_ADMIN_ROLE_IDS` and `DISCORD_OBSERVER_ROLE_IDS` inherit every current
  read-only command.
- Command-specific role variables grant one command at a time.
- `DISCORD_ALLOWED_USER_IDS` is a user allow-list for operational break-glass
  cases.
- `DISCORD_RBAC_MODE=open` is for local testing only.

### Multi-Tenant RBAC

When `ACP_MULTI_TENANT=true`, RBAC is configured per-guild, either through the
in-console "Connect to hosted bot" flow (primary) or the web setup portal
(fallback) — there is no DM onboarding any more. Role IDs are stored in the
bot's SQLite database rather than environment variables. See
[Configuration Reference](docs/configuration.md) for details.

## Data Handling

The bot sends minimal actor context to `POST` adapter routes: Discord user ID,
guild ID, channel ID, and role IDs. It does not send message content, Discord
tokens, adapter tokens, or broader Discord profile data.

Before output reaches Discord or logs, the bot redacts credential-like fields,
emails, Steam identifiers, Funcom identifiers, and explicit real-name fields.
The project is not expected to process PCI/payment-card data.

### Data Storage

In multi-tenant mode, the bot stores per-guild configuration in a local SQLite
database (`data/acp.db`). This includes:
- Guild console URLs and adapter tokens (encrypted at rest)
- Per-guild role IDs for RBAC
- Per-guild settings (cooldowns, schedule, announcements)
- Player-to-character links (scoped per guild)
- OAuth2 session state for the setup portal

The bot does **not** connect to the game database or access game files directly.

## Multi-Tenant Mode

When `ACP_MULTI_TENANT=true`, the bot runs as a centralized service serving
multiple Discord servers. Each guild connects to its own Dune console.

Setup options:
1. **In-Console (primary)** — the operator's Dune Docker Console (Settings →
   Discord Bot → "Connect to hosted bot") performs the Discord OAuth
   round-trip itself and calls `POST /api/consoles/register` directly, after
   independently re-verifying guild ownership against Discord's API
2. **Web Portal (fallback)** — Visit `http://your-server:3100/setup` to
   configure via OAuth2 by hand

There is no DM-based onboarding any more — joining a guild is a no-op until
one of the two options above registers it; a command run in an unregistered
guild gets an in-guild reply instead of a DM.

See [Multi-Tenant Design](docs/multi-tenant-design.md) for architecture details.

## Troubleshooting

For local adapter smoke testing without a live console:

```bash
npm run mock:adapter
```

Then point the bot at the mock:

```env
DUNE_CONSOLE_API_URL=http://127.0.0.1:8095
DUNE_DISCORD_ADAPTER_TOKEN=local-adapter-token
```

Useful checks:

```bash
npm run check
npm audit --audit-level=moderate
npm run smoke:adapter
```

Do not paste tokens, `.env` files, private server addresses, SteamIDs,
FuncomIDs, emails, real names, or screenshots with secrets into issues or pull
requests.

## Related Docs

- `INSTALL.md`
- `SECURITY.md`
- `SUPPORT.md`
- `docs/adapter-contract.md`
- `docs/configuration.md`
- `docs/admin-guide.md`
- `docs/user-guide.md`
- `docs/multi-tenant-design.md`
- `docs/verification.md`
