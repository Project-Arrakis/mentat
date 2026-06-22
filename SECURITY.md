# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes are applied to the `main` branch until
formal releases begin.

## Reporting a Vulnerability

Do not open public issues for suspected vulnerabilities, leaked tokens, or
private deployment details.

Until GitHub private vulnerability reporting is enabled for this repository,
send a private report to the repository owner through GitHub contact channels.
Include:

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

## Public Repository Notice

This repository is intended to be safe to publish, but publishing source code
does not make user deployments safe by itself. Users must run their own Discord
application, generate their own tokens, and connect only to their own WebUI
adapter endpoint.
