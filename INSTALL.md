# Install

This bot is a user-owned, read-only Discord companion for Dune Awakening
Self-Host Docker. There is no shared hosted bot. Each operator creates their
own Discord application, keeps their own tokens, and connects only to their own
WebUI Discord adapter.

## Prerequisites

- Node.js 20.18 or newer, or Docker with Docker Compose.
- A Discord application and bot user.
- A Dune WebUI deployment with the disabled-by-default Discord adapter enabled.
- A private network path from the bot to the WebUI adapter.

Do not expose the adapter publicly unless you also add TLS, firewall
allow-lists, request limits, rate limits, and token rotation.

## Local Node Install

1. Clone this repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DUNE_CONSOLE_API_URL`, and
   `DUNE_DISCORD_ADAPTER_TOKEN`.
5. Set at least one RBAC principal, usually `DISCORD_OBSERVER_ROLE_IDS` or
   `DISCORD_ADMIN_ROLE_IDS`.
6. Set `DISCORD_GUILD_ID` for a test guild while validating command
   registration.
7. Run `npm run register`.
8. Run `npm start`.

Leave `DISCORD_RBAC_MODE=restricted` for normal installs. `open` mode is for
local testing only.

## Docker Install

Start from `docker-compose.example.yml`. The example keeps the root filesystem
read-only, uses `/tmp` for the local healthcheck state file, drops Linux
capabilities, and does not mount the Docker socket.

```bash
docker compose -f docker-compose.example.yml up --build
```

After the bot reaches Discord ready state, inspect the container healthcheck:

```bash
docker inspect --format '{{json .State.Health}}' <container>
```

## Release Artifacts

Optional release artifacts can be generated locally:

```bash
npm run package:addon
npm run sbom
```

The addon package command refuses non-zero addon permissions. The SBOM command
writes a CycloneDX JSON SBOM from `package-lock.json`. Both commands write
SHA-256 checksum files under `dist/`.

## More Setup Detail

- `docs/discord-setup.md`
- `docs/configuration.md`
- `docs/networking.md`
- `docs/verification.md`
- `docs/security-model.md`
