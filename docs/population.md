# Population Command

`/dune population` — Show aggregate player count and server population.
Read-only. Aggregate data only — no individual player details are exposed.

## Usage

```
/dune population
```

## Response

```json
{
  "ok": true,
  "online": 8,
  "total": 128,
  "aggregate": true,
  "detailsSuppressed": true
}
```

## RBAC

| Role | Access |
|------|--------|
| Observer | Allowed |
| Admin | Allowed |
| Public (no role) | Denied in restricted mode |

Configured via `DISCORD_POPULATION_ROLE_IDS` env var.

## Adapter Route

| Method | Path |
|--------|------|
| POST | `/api/integrations/discord/population` |

Configurable via `DUNE_ADAPTER_POPULATION_PATH` and `DUNE_ADAPTER_POPULATION_METHOD`.

## Security

- Read-only: cannot modify player state
- Aggregate-only: no individual player Steam IDs, Funcom IDs, or character names
- Details suppressed by default — moderator roles can see faction/guild breakdowns if the adapter supports it
- All output redacted (credentials, IPs, PII)

## Implementation

Source: `src/commands.js` (`populationPayload`), `src/adapterClient.js` (`population()`),
`src/config.js`. Added in v1.2.0.
