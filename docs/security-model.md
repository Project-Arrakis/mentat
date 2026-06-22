# Security Model

## v1 Scope

The first release is read-only. Commands are limited to health, status,
readiness, and services.

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

## RBAC

RBAC defaults to restricted mode. The bot fails closed at startup unless at
least one Discord role or user allow-list is configured.

Current permissions are command scoped:

- `/dune about`: safe bot and adapter metadata.
- `/dune health`: adapter health.
- `/dune status`: high-level server status.
- `/dune readiness`: readiness and preflight state.
- `/dune services`: service state.

`DISCORD_ADMIN_ROLE_IDS` and `DISCORD_OBSERVER_ROLE_IDS` inherit all current
read-only commands. Command-specific role variables grant only one command.

## Deployment Hardening

The Docker Compose example uses:

- `read_only: true`
- `no-new-privileges:true`
- `cap_drop: [ALL]`
- no Docker socket mount
- no database mount
