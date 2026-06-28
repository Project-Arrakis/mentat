# Security Policy

## Supported Versions

The project is pre-1.0. Security fixes land on `main` first and are released by
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

In v1, the bot is read-only and must not:

- mount the Docker socket
- connect directly to a database
- read game files
- execute shell commands
- restart services
- mutate WebUI state
- expose Discord or WebUI tokens in logs or responses

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
- `docs/soc2-alignment.md`
