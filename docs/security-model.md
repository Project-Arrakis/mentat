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

Before sending adapter responses to Discord, the bot redacts keys matching
credential-like names such as `token`, `secret`, `password`, `authorization`,
`cookie`, `apiKey`, and `credential`.

## Deployment Hardening

The Docker Compose example uses:

- `read_only: true`
- `no-new-privileges:true`
- `cap_drop: [ALL]`
- no Docker socket mount
- no database mount
