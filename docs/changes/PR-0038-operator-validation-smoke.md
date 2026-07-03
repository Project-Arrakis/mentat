# PR-0038: Add R1.1 Operator Validation Smoke Path

## Summary

Adds an R1.1 operator validation checklist and a `npm run smoke:adapter` command
that exercises the four current read-only adapter routes without printing
adapter response bodies.

## User Impact

Operators get a repeatable local or live-adapter smoke path for release
candidate validation. No Discord command behavior changes.

## Security Impact

- Command surface: unchanged.
- RBAC: unchanged.
- Secrets handling: improved validation; smoke fails when adapter responses
  contain content that would need redaction before Discord output.
- Data crossing Discord, the bot, and the WebUI adapter: unchanged for runtime;
  the smoke command calls existing read-only adapter routes.
- Network exposure: unchanged.
- Security findings: no medium, high, or critical finding was introduced by
  this validation tooling and documentation update.

## Least Privilege

The bot remains read-only. The smoke command uses only the existing adapter
base URL and bearer token, calls only the current read-only routes, does not
mount Docker, does not access the database, does not read game files, and does
not execute shell commands against the console.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- `npm run smoke:adapter` against the local mock adapter on loopback
- PR #38 hosted gates passed: dependency audit, dependency review, secret scan,
  Semgrep SAST, test, Trivy filesystem scan, and Trivy image scan.

## Known Limitations

This PR does not perform a live Discord guild test or live WebUI adapter test.
Those remain operator-owned validation steps because they require deployment
credentials and environment-specific infrastructure.

## Sources

- `docs/r1-r2-release-roadmap.md`
- `docs/verification.md`
- `docs/security-gates.md`
- `docs/adapter-contract.md`
