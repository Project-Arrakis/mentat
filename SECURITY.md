# Security Policy

## Supported Versions

The project is at v1.5.0. Security fixes land on `main` first and are released by
tagging the next patch or minor version after the normal PR and security-gate
process completes. Operators should run the latest GitHub Release or the current
`main` branch only when they intentionally want unreleased changes.

## Reporting a Vulnerability

Do not open public issues for suspected vulnerabilities, leaked tokens, or
private deployment details.

Until GitHub private vulnerability reporting is enabled here, send a private
report to the repository owner through GitHub contact channels. Please include:

- affected commit or release
- vulnerable component
- reproduction steps
- expected impact
- whether any token, server address, Discord guild ID, or user data appears in
  logs or screenshots

Please redact secrets before sharing evidence.

## Secret Exposure Response

If a Discord bot token or Dune adapter token is exposed:

1. Rotate the exposed Discord bot token in the Discord Developer Portal.
2. Rotate the Dune WebUI Discord adapter bearer token.
3. Restart the bot and WebUI services with the new values.
4. Remove the leaked value from configuration files, logs, screenshots, and
   shell history where possible.
5. Treat the old token as compromised even if no abuse is visible.

## Security Scope

In v1, the bot is read-only by default. Write commands exist but are disabled
by default (`DUNE_DISCORD_WRITES_ENABLED=false`). The bot must not:

- mount the Docker socket
- connect directly to the **game** database (the bot maintains its own SQLite DB for multi-tenant config)
- read game files
- execute arbitrary shell commands
- restart services (unless write commands are explicitly enabled)
- mutate WebUI state (unless write commands are explicitly enabled)
- expose Discord or WebUI tokens in logs or responses

### Write-Safety Boundary

Write commands are scaffolded and gated behind `DUNE_DISCORD_WRITES_ENABLED`.
When enabled, all write operations:
- Require confirmation before execution
- Generate idempotency keys for safety
- Are audited with actor context
- Are restricted to `DISCORD_WRITE_ADMIN_ROLE_IDS` or `DISCORD_WRITE_OWNER_ROLE_IDS`

### Multi-Tenant Data Isolation

In multi-tenant mode (`ACP_MULTI_TENANT=true`), the bot maintains its own SQLite
database (`data/acp.db`) with per-guild data isolation:
- Each guild's console URL and adapter token are scoped to that guild
- Player-to-character links are scoped per guild
- RBAC roles are configured per guild
- OAuth2 sessions are isolated per guild

The bot does **not** connect to the game database or access game files directly.

Current redaction covers credential-like fields, emails, Steam identifiers,
Funcom identifiers, and explicit real-name fields before output reaches Discord
or logs. The project is not expected to process PCI/payment-card data.

## Security Gates

Every substantive pull request should pass unit tests, npm audit, Semgrep,
Gitleaks, Trivy filesystem scanning, GitHub dependency review, SBOM generation,
Docker image build, and Trivy image scanning before merge.

Do not ignore medium, high, or critical findings. Fix them in the same pull
request, open a GitHub issue with evidence and owner, or document a
false-positive decision with scanner output and rationale.

## Public Repository Notice

Publishing the source code is useful for review, but it does not make a
deployment safe by itself. Users still need to run their own Discord
application, generate their own tokens, and connect only to their own WebUI
adapter endpoint.

## Related Security Docs

- `docs/security-model.md`
- `docs/security-gates.md`
- `docs/dependency-management.md`
- `docs/security-review-2026-07-03.md`
- `docs/soc2-alignment.md`
