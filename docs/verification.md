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

Discord should show one `/dune` command with `about`, `ping`, `health`,
`status`, `status-summary`, `readiness`, and `services` subcommands.

## Runtime Smoke Test

1. Enable the console's Discord adapter API.
2. Configure `.env`.
3. Run `npm start`.
4. Execute `/dune health` in Discord.

The bot should return adapter health JSON without leaking token, authorization,
password, secret, or API key fields.

## Adapter Contract Fixtures

```bash
npm test -- test/adapterContract.test.js
```

The contract tests check the default upstream adapter routes, configured route
overrides, supported methods, and fixture parsing without requiring a live
console.

## Local Adapter Mock

Run the mock adapter in a separate terminal for local smoke tests without a live
console:

```bash
npm run mock:adapter
```

By default it listens on `127.0.0.1:8095` and accepts the local-only token
`local-adapter-token`. To point the bot at it, use:

```bash
DUNE_CONSOLE_API_URL=http://127.0.0.1:8095
DUNE_DISCORD_ADAPTER_TOKEN=local-adapter-token
```

Set `MOCK_ADAPTER_PORT` to change the port. If `MOCK_ADAPTER_HOST` is set to a
non-loopback address, `DUNE_DISCORD_ADAPTER_TOKEN` must also be set explicitly.

## Regression Checklist

- `npm test`
- startup with `DISCORD_RBAC_MODE=restricted` and no allow-list should fail closed
- `npm run register` against a test guild
- `npm run mock:adapter`
- `/dune about`
- `/dune ping`
- `/dune health`
- `/dune status`
- `/dune status-summary`
- `/dune readiness`
- `/dune services`
- Docker start with `docker compose -f docker-compose.example.yml up --build`
- Docker healthcheck with `docker inspect --format '{{json .State.Health}}' <container>`
