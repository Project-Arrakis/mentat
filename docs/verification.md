# Verification

## Unit Tests

```bash
npm test
```

All tests should pass.

## Command Registration Smoke Test

Use a test guild for fast command propagation:

```bash
DISCORD_GUILD_ID=your-guild-id npm run register
```

Discord should show one `/dune` command with `health`, `status`, `readiness`,
and `services` subcommands.

## Runtime Smoke Test

1. Enable the console's Discord adapter API.
2. Configure `.env`.
3. Run `npm start`.
4. Execute `/dune health` in Discord.

The bot should return adapter health JSON without leaking token, authorization,
password, secret, or API key fields.

## Regression Checklist

- `npm test`
- startup with `DISCORD_RBAC_MODE=restricted` and no allow-list should fail closed
- `npm run register` against a test guild
- `/dune health`
- `/dune status`
- `/dune readiness`
- `/dune services`
- Docker start with `docker compose -f docker-compose.example.yml up --build`
