# Verification

## Unit Tests

```bash
npm run check
```

All tests should pass, release metadata should validate, the addon package
should build, and the SBOM should be generated.

## Release Metadata

```bash
npm run release:check
```

The command verifies that `package.json`, `addon/addon.json`, `CHANGELOG.md`,
and `docs/releases/v<version>.md` agree on the release version.

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

## Addon Release Package

```bash
npm run package:addon
```

The command should create `dist/discord-readonly-bot-v<version>.tar.gz` and a
matching `.sha256` file. It must fail if the optional addon manifest gains
permissions or unsafe entry paths.

## SBOM

```bash
npm run sbom
```

The command should create `dist/dune-awakening-selfhost-discordbot.cdx.json`
and a matching `.sha256` file from `package-lock.json`.

## Release Artifact Checksums

After `npm run check`, verify local release artifact checksums with:

```bash
cd dist
sha256sum -c discord-readonly-bot-v0.1.0.tar.gz.sha256
sha256sum -c dune-awakening-selfhost-discordbot.cdx.json.sha256
```

## Regression Checklist

- `npm test`
- `npm run release:check`
- `npm run package:addon`
- `npm run sbom`
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
