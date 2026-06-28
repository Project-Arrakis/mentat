# Security Model

## v1 Scope

The first release is read-only. Commands are limited to about, ping, health,
status, status summary, readiness, and services.

## Trust Boundary

The console remains the trusted boundary. The bot only asks the console adapter
for already-approved read-only data. The bot does not receive broader console
credentials.

## Out of Scope

- Restarting services.
- Mutating configuration.
- Reading or writing the database.
- Running shell commands.
- Reading Docker directly.
- Accessing game files.

## Output Handling

Before sending adapter responses to Discord, the bot applies shared output
redaction. The redactor covers:

- credential-like keys such as `token`, `secret`, `password`, `authorization`,
  `cookie`, `apiKey`, and `credential`
- email address keys and email addresses in free-text strings
- Steam ID keys, SteamID64 values, Steam2 values, Steam3 values, and labeled
  Steam ID values in free-text strings
- Funcom ID keys and labeled Funcom ID values in free-text strings
- explicit real-name keys such as first name, last name, full name, real name,
  legal name, given name, family name, surname, and birth name

The project is not expected to process PCI/payment-card data. If payment-card
data appears in adapter output, treat it as a security finding and stop the data
flow before adding or widening commands.

Automated redaction cannot reliably identify arbitrary real names or unlabeled
third-party account identifiers inside free text. New adapter routes and command
formatters should avoid returning those values in the first place.

## Logging

Runtime and command-registration logs are structured JSON. Log fields use the
same shared redaction path as Discord output. Unexpected errors are logged with
bounded error metadata: name, message, status, and route. Raw error bodies,
Discord tokens, adapter tokens, and stack traces are not logged by default.

## RBAC

RBAC defaults to restricted mode. The bot fails closed at startup unless at
least one Discord role or user allow-list is configured.

Current permissions are command scoped:

- `/dune about`: safe bot and adapter metadata.
- `/dune ping`: Discord defer timing and adapter health latency.
- `/dune health`: adapter health.
- `/dune status`: high-level server status.
- `/dune status-summary`: compact aggregate server status.
- `/dune readiness`: readiness and preflight state.
- `/dune services`: service state.

`DISCORD_ADMIN_ROLE_IDS` and `DISCORD_OBSERVER_ROLE_IDS` inherit all current
read-only commands. Command-specific role variables grant only one command.

## Deployment Hardening

The Docker Compose example uses:

- `read_only: true`
- `/tmp` tmpfs for local healthcheck state
- `no-new-privileges:true`
- `cap_drop: [ALL]`
- container healthcheck that reads bot readiness state without Docker socket
  access
- no Docker socket mount
- no database mount

## Supply Chain Controls

Dependency and release checks include:

- Dependabot for npm and GitHub Actions updates.
- npm audit blocking moderate and higher advisories.
- GitHub dependency review blocking newly introduced moderate and higher
  vulnerable dependencies.
- CycloneDX SBOM generation from `package-lock.json`.
- Trivy filesystem and runtime image scanning.
- Gitleaks secret scanning.

## Future Write Actions

Write actions are outside the current security boundary. Future non-read-only
work must follow `docs/non-readonly-roadmap.md` and remain blocked until an
upstream write-capable adapter contract, write-specific RBAC, confirmation,
audit logging, idempotency, rate limits, rollback guidance, STRIDE review, and
tests are in place.
