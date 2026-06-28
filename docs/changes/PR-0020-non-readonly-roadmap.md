# Change Note: Add Non-Read-Only Roadmap

## Summary

PR #20 adds a security-first roadmap for future non-read-only capabilities.

## User Impact

No runtime behavior changes. Operators and maintainers get a planning document
that explains why write actions remain blocked and what controls are required
before implementation.

## Security Impact

- The Discord command surface does not change.
- RBAC does not change.
- Secrets handling does not change.
- No new data crosses Discord, the bot, or the WebUI adapter.
- Network exposure does not change.
- The roadmap requires upstream write contracts, write-specific RBAC,
  confirmation, audit logging, idempotency, rate limits, tests, and STRIDE
  review before any write command ships.

## Least Privilege

Current least-privilege requirements are unchanged. Future write work must use
separate write-admin authorization and must not inherit observer roles.

## Tests and Evidence

Docs-only change. Existing local and CI gates are still required before merge.

## Known Limitations

This PR does not implement write actions. It intentionally keeps all
non-read-only behavior deferred until upstream and local controls are ready.

## Sources

- `docs/security-review-2026-06-28.md`
- `docs/security-model.md`
- `docs/pr-transparency-template.md`
