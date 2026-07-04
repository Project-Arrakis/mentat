# Backup List Command

`/dune backups` — List recent backup metadata from the server. Read-only.
No create, restore, or delete operations are exposed.

## Usage

```
/dune backups
```

## Response

Returns up to 10 recent backup entries with name, date, and size metadata:

```json
{
  "ok": true,
  "count": 3,
  "backups": [
    {"name": "2026-07-04-manual", "date": "2026-07-04T08:00:00Z", "size": "4.2 GB"},
    {"name": "2026-07-03-auto", "date": "2026-07-03T08:00:00Z", "size": "4.1 GB"}
  ]
}
```

## RBAC

| Role | Access |
|------|--------|
| Observer | Allowed |
| Admin | Allowed |
| Public (no role) | Denied in restricted mode |

Configured via `DISCORD_BACKUPS_ROLE_IDS` env var.

## Adapter Route

| Method | Path |
|--------|------|
| GET | `/api/integrations/discord/backups/list` |

Configurable via `DUNE_ADAPTER_BACKUPS_PATH` and `DUNE_ADAPTER_BACKUPS_METHOD`.

## Security

- Read-only: cannot create, restore, or delete backups
- No backup file paths exposed in Discord output
- All output redacted (credentials, IPs, PII)
- Response size bounded

## Implementation

Source: `src/commands.js` (`backupPayload`), `src/adapterClient.js` (`backups()`), `src/config.js`
