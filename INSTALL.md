# Install

This is a Discord companion bot for Dune Awakening Self-Host Docker,
branded **Mentat** (the bot speaks as **Sahir Venn**; previously Sentinel,
before that Arrakis Control Panel / ACP). **There is a real, maintainer-
operated shared hosted instance** most operators should use instead of
self-hosting — see [README.md](README.md) and
[docs/admin-guide.md](docs/admin-guide.md) for the hosted-bot setup flow.
This file (`INSTALL.md`) documents the **self-hosted/DIY path**: creating
your own Discord application, keeping your own tokens, and connecting only
to your own WebUI Discord adapter — for operators who explicitly want
their own instance rather than the hosted one.

The bot is read-only by default. Write commands exist but are disabled by
default. In multi-tenant mode, a single self-hosted instance can serve
multiple Discord servers (this is exactly the mode the project's own
hosted instance runs in).

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
   `DISCORD_ADMIN_ROLE_IDS`. For write commands, also set
   `DISCORD_WRITE_ADMIN_ROLE_IDS`.
6. Set `DISCORD_GUILD_ID` for a test guild while validating command
   registration.
7. Run `npm run register`.
8. Run `npm start`.

Leave `DISCORD_RBAC_MODE=restricted` for normal installs. `open` mode is for
local testing only.

## Multi-Tenant Install (Hosted)

For a centralized service serving multiple Discord servers:

1. Set `ACP_MULTI_TENANT=true`
2. Set `DISCORD_CLIENT_SECRET` (from Discord Developer Portal → OAuth2)
3. Set `ACP_BASE_URL` to your public server URL
4. Run `npm start` — the setup portal starts on port 3100
5. Visit `http://your-server:3100/setup` to configure guilds via OAuth2

Guilds can also be onboarded automatically via DM when the bot joins a new server.
Configuration is stored in `data/acp.db` (SQLite).

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

Tagged GitHub Releases publish the optional addon package, its SHA-256 checksum,
the CycloneDX SBOM, and the SBOM checksum. Verify checksum files before
installing or redistributing artifacts.

Release artifacts can also be generated locally:

```bash
npm run release:check
npm run package:addon
npm run sbom
```

The addon package command refuses non-zero addon permissions. The SBOM command
writes a CycloneDX JSON SBOM from `package-lock.json`. Both commands write
SHA-256 checksum files under `dist/`.

See `docs/release-process.md` and `CHANGELOG.md` for release practice and
version history.

## Operator Validation

After setup, follow `docs/operator-validation.md` to record local adapter smoke,
test-guild command registration, runtime command smoke, and Docker healthcheck
evidence before promoting a release candidate or wider deployment.

## R740 Self-Hosted Deployment (superseded — historical, do not follow for this project's own instance)

For operators using the Dell PowerEdge R740 hypervisor
([r740-dune-deployment-kit](https://github.com/yacketrj/r740-dune-deployment-kit)):

**Status note (corrected 2026-09-06):** this section previously described
co-locating the bot on the R740's `dune-prod` game-server VM as a "planned
target, not yet executed." That plan was explicitly **rejected** — this
project's own live bot instance instead moved to a dedicated,
Services-VLAN VM (`192.168.22.10`, isolated from the game-server VMs) on
2026-08-17, per `compliance/runbooks/backup-recovery.md`'s own correction.
The steps below are left as historical record of the plan that was
considered and dropped; they do not describe this project's real,
current deployment (see `compliance/runbooks/backup-recovery.md` and
`systemd/acp-bot.service` for that). They may still be a starting point
for another operator who genuinely wants to co-locate their own instance
on an R740's game-server VM, but note the security/isolation tradeoff
that led this project to choose a separate VM instead.

The bot runs alongside the game server stack on the **dune-prod VM**
(VMID 101, IP 192.168.20.10). It calls the console API over localhost
and serves the setup portal through the Cloudflare Tunnel configured in
that deployment.

### Setup on the dune-prod VM

```bash
# 1. Clone the repo
git clone https://github.com/yacketrj/arrakis-control-panel.git ~/arrakis-control-panel
cd ~/arrakis-control-panel

# 2. Configure environment (copy from secure backup or set manually)
cp .env.example .env
# Fill in: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DUNE_CONSOLE_API_URL=http://localhost:8088,
#          DUNE_DISCORD_ADAPTER_TOKEN, DISCORD_HOME_GUILD_ID (if using RBAC)

# 3. Install and register
npm ci --omit=dev
npm run register

# 4. Install the systemd service
sudo cp systemd/acp-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now acp-bot.service

# 5. Verify
sudo systemctl status acp-bot.service
journalctl -u acp-bot -n 20
```

### Cloudflare Tunnel

The Cloudflare Tunnel (`cloudflared`) must have ingress rules for the
setup portal endpoints. Add to `/etc/cloudflared/config.yml`:

```yaml
ingress:
  - hostname: mentat-link.darkdante.org
    service: http://localhost:3100
  - hostname: CONSOLE_TUNNEL_HOSTNAME    # your own tunnel hostname
    service: http://localhost:8088
  - service: http_status:404
```

Restart the tunnel: `sudo systemctl restart cloudflared`

### Deploy Remote

For continuous deployment from a dev machine, configure a bare git repo
on the dune-prod VM and add the `deploy` remote:

```bash
# On the dune-prod VM:
mkdir -p ~/acp-deploy.git && cd ~/acp-deploy.git && git init --bare
cp ~/arrakis-control-panel/scripts/deploy-post-receive.sh hooks/post-receive
chmod +x hooks/post-receive

# On the dev machine:
git remote add deploy ssh://bot@192.168.22.10/home/bot/acp-deploy.git
git push deploy main:deploy
```

The post-receive hook runs the full test suite as a guardrail and only
restarts `acp-bot.service` if tests pass.

## More Setup Detail

- `docs/discord-setup.md`
- `docs/configuration.md`
- `docs/networking.md`
- `docs/operator-validation.md`
- `docs/verification.md`
- `docs/security-model.md`
- `compliance/runbooks/backup-recovery.md`
- `systemd/acp-bot.service`
