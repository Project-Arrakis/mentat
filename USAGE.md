# Usage

Register one `/dune` slash command. All current subcommands are read-only and
pass through the WebUI Discord adapter.

## Commands

| Command | Purpose | Adapter call |
| --- | --- | --- |
| `/dune about` | Shows safe bot and adapter metadata. | none |
| `/dune ping` | Measures Discord defer timing and adapter health latency. | `GET /api/integrations/discord/health` |
| `/dune health` | Shows adapter health. | `GET /api/integrations/discord/health` |
| `/dune status` | Shows high-level server status. | `POST /api/integrations/discord/status` |
| `/dune status-summary` | Shows compact aggregate server status. | `POST /api/integrations/discord/status` |
| `/dune readiness` | Shows readiness and preflight state. | `POST /api/integrations/discord/readiness` |
| `/dune services` | Shows service state. | `POST /api/integrations/discord/services` |

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

## Data Handling

The bot sends minimal actor context to `POST` adapter routes: Discord user ID,
guild ID, channel ID, and role IDs. It does not send message content, Discord
tokens, adapter tokens, or broader Discord profile data.

Before output reaches Discord or logs, the bot redacts credential-like fields,
emails, Steam identifiers, Funcom identifiers, and explicit real-name fields.
The project is not expected to process PCI/payment-card data.

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
- `docs/verification.md`
