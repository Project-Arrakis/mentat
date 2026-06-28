# Change Note: Docker Healthcheck

## Summary

PR #16 adds a Docker healthcheck based on local bot readiness state.

## Security Impact

- Writes bot readiness state to `/tmp/dune-discord-bot/health.json`.
- Keeps the root filesystem read-only by using the existing `/tmp` tmpfs in the
  Compose example.
- Healthcheck reads local process state only; it does not call Docker, the
  database, game files, shell commands, or the adapter API.
- Does not add commands, adapter routes, write actions, persistence, network
  exposure, or additional Discord permissions.

## Tests

- Added unit coverage for health-state file writes.
- Added unit coverage for ready, not-ready, stale, and invalid healthcheck
  states.

## Evidence

- Roadmap item: Phase 4 Docker healthcheck.
- Primary files: `src/healthState.js`, `src/healthcheck.js`,
  `scripts/healthcheck.js`, `Dockerfile`, `docker-compose.example.yml`
- Config knobs: `DUNE_BOT_HEALTH_STATE_FILE`,
  `DUNE_BOT_HEALTH_MAX_AGE_MS`

## Known Limitations

The healthcheck verifies that the bot process has reached Discord ready state
and continues refreshing local state. It does not prove the Discord gateway, the
adapter API, or the game server are healthy; those remain command-level adapter
checks.
