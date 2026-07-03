# PR-0036: Refresh Upstream v1.3.41 Compatibility Evidence

## Summary

Refreshed the living upstream compatibility evidence to
`Red-Blink/dune-awakening-selfhost-docker@5163bd8`, latest stable tag
`v1.3.41`.

## User Impact

Operators get current documentation for the upstream version this bot has been
checked against. No bot command behavior changes.

## Security Impact

- Command surface: unchanged.
- RBAC: unchanged.
- Secrets handling: unchanged.
- Data crossing Discord, the bot, and the WebUI adapter: unchanged.
- Network exposure: unchanged.
- Security findings: no medium, high, or critical finding was introduced by
  this documentation and test update.

## Least Privilege

The bot remains read-only and still needs only the existing Discord bot token,
configured Discord role or user allow-lists, WebUI Discord adapter bearer-token
access, and the existing non-root container runtime permissions.

## Tests and Evidence

- Upstream reference clone refreshed to `5163bd8`.
- Latest upstream stable tag observed: `v1.3.41`.
- Dedicated upstream Discord adapter service file was unchanged from the
  earlier fixture baseline.
- Upstream API route registration was reviewed for Discord adapter impact.
- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub PR #36 CI test jobs
- GitHub PR #36 Security Gates:
  dependency audit, dependency review, secret scan, Semgrep, Trivy filesystem,
  and Trivy image

## Known Limitations

This PR only updates current evidence. It does not add read-only commands, does
not enable write-capable behavior, and does not open an upstream PR.

## Sources

- `Red-Blink/dune-awakening-selfhost-docker@5163bd8`
- Upstream file:
  `console/api/src/services/discordAdapter.js`
- Local upstream reference clone:
  `../dune-awakening-selfhost-docker-upstream-main`
