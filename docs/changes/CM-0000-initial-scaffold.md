# Change Note: Initial Read-Only Scaffold

## Summary

The initial scaffold created a separate self-hosted Discord bot repository for
Dune Awakening Self-Host Docker.

## Security Impact

- Kept the bot outside the console repository.
- Limited the command surface to read-only adapter calls.
- Avoided Docker socket, database, game-file, and shell-command access.
- Added Docker runtime hardening in the example deployment.

## Evidence

- Commit: `077aa41`
- Core files: `src/adapterClient.js`, `src/commands.js`, `src/config.js`,
  `src/format.js`, `Dockerfile`, `docker-compose.example.yml`

## Notes

This change landed before the durable change-note convention existed.
