# Change Note: Ping Command

## Summary

PR #13 adds `/dune ping`, a read-only command that reports Discord defer timing
and adapter health latency.

## Security Impact

- Reuses the existing `GET /api/integrations/discord/health` adapter route.
- Adds command-specific RBAC through `DISCORD_PING_ROLE_IDS`.
- Summarizes adapter health flags instead of forwarding the raw health payload.
- Does not add write actions, new adapter routes, network exposure, persistence,
  or additional Discord permissions.

## Tests

- Added unit coverage for slash command registration.
- Added unit coverage for ping RBAC configuration.
- Added unit coverage for ping payload shaping and health-route execution.

## Evidence

- Roadmap item: Phase 3 low-complexity `/dune ping`.
- Adapter contract: `/dune ping` reuses the upstream health route.
- Upstream reference clone:
  `Red-Blink/dune-awakening-selfhost-docker@b1a0c26433dc89f6c031bdd151096e78bbbbbbcb`

## Known Limitations

Ping latency is measured from the bot process perspective. It is useful for
operator diagnostics but is not a full Discord gateway, network, or console
performance benchmark.
