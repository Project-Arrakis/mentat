# Change Note: Status Summary Command

## Summary

PR #14 adds `/dune status-summary`, a compact read-only status command backed by
the existing adapter status route.

## Security Impact

- Reuses the existing `POST /api/integrations/discord/status` adapter route.
- Adds command-specific RBAC through `DISCORD_STATUS_SUMMARY_ROLE_IDS`.
- Emits coarse aggregate fields only: overall state, region, mode, population,
  and automation status.
- Intentionally omits server title and battlegroup from the compact output.
- Does not add write actions, new adapter routes, network exposure, persistence,
  or additional Discord permissions.

## Tests

- Added unit coverage for slash command registration.
- Added unit coverage for status-summary RBAC configuration.
- Added unit coverage for aggregate payload shaping and status-route execution.
- Added regression coverage that title and battlegroup are not included in the
  compact output.

## Evidence

- Roadmap item: Phase 3 low-complexity compact status command.
- Adapter contract: `/dune status-summary` reuses the upstream status route.
- Upstream fixture: `test/fixtures/adapter/status.json`.
- Upstream reference clone:
  `Red-Blink/dune-awakening-selfhost-docker@b1a0c26433dc89f6c031bdd151096e78bbbbbbcb`

## Notes

The roadmap originally used the phrase `/dune status summary`. This PR ships
the command as `/dune status-summary` so existing `/dune status` installations
do not have to move from a subcommand to a subcommand group.
