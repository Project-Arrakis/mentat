# PR-0037: Add R1.x to R2.x Release Roadmap

## Summary

Adds a detailed roadmap for the `R1.x` read-only maturity line and the first
`R2.x` write-safety line, including release cadence, train scopes, entry
criteria, release gates, and go/no-go rules.

## User Impact

Operators and maintainers get a clearer short-to-medium-term release path after
`R1.0.0`, including what can ship in read-only minor releases and what must wait
for upstream write adapter support.

## Security Impact

- Command surface: unchanged.
- RBAC: unchanged.
- Secrets handling: unchanged.
- Data crossing Discord, the bot, and the WebUI adapter: unchanged.
- Network exposure: unchanged.
- Security findings: no medium, high, or critical finding was introduced by
  this documentation and test update.

## Least Privilege

The bot remains read-only. The roadmap preserves the adapter boundary and
requires write-specific RBAC, confirmation, idempotency, audit evidence, and
disabled-by-default behavior before any `R2.x` write work can ship.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub PR #37 CI test jobs
- GitHub PR #37 Security Gates:
  dependency audit, dependency review, secret scan, Semgrep, Trivy filesystem,
  and Trivy image

## Known Limitations

This PR is planning and release governance only. It does not publish a release,
change runtime behavior, implement write support, or open an upstream PR.

## Sources

- `docs/full-release-roadmap.md`
- `docs/production-release-plan.md`
- `docs/non-readonly-roadmap.md`
- `docs/upstream-write-adapter-rfc.md`
- `docs/release-process.md`
- `docs/security-gates.md`
