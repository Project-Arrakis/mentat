# PR-0046: v1.3.0 Read-Only Notifications

## Summary

R1.3 release train: scheduled status posts to allow-listed channels, readiness or service alert subscriptions, incident digest summaries.

## User Impact

Operators can configure scheduled Discord posts of server status and subscribe to readiness/service alerts.

## Security Impact

- Command surface: expanded (scheduler, alert subscriptions, digest generation)
- RBAC or authorization: channel allow-lists required; rate limits enforced
- Secret handling: unchanged

## Least Privilege

Read-only by contract and test. Scheduled output has channel allow-lists and rate limits.

## Tests and Evidence

- [ ] Scheduler unit tests
- [ ] Alert subscription authorization tests
- [ ] Digest generation tests with bounded output
- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image

## Known Limitations

- Notifications are pull-based via scheduler.

## Sources

- `docs/full-release-roadmap.md`
- `docs/architecture.md`
