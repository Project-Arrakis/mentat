# Change Note: Local Adapter Mock

## Summary

This change completes the remaining Phase 2 adapter-stabilization slice by
adding a local Discord adapter mock backed by the existing contract fixtures.

The mock is a development and smoke-test tool only. It does not add bot runtime
privileges and does not call Docker, the database, game files, shell commands,
or write-capable console routes.

## User Impact

Operators can run `npm run mock:adapter` to exercise the bot against local
fixture responses before connecting to a live console adapter.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged; the mock logs no tokens.
- Data crossing Discord, bot, or WebUI boundaries: unchanged for production.
- Network exposure: the mock binds to `127.0.0.1` by default and requires an
  explicit token before binding outside loopback.

## Least Privilege

No runtime privileges changed. The mock is a separate local script, serves static
fixtures, and requires the same bearer-token shape as the real adapter.

## Tests

Local verification on June 22, 2026:

| Check | Result |
| --- | --- |
| `npm test` | Passed, 26 tests |
| `npm audit --audit-level=moderate` | Passed, 0 vulnerabilities |
| Semgrep default and secrets rules | Passed, 0 findings |
| Gitleaks | Passed, no leaks found |
| Trivy filesystem scan | Passed, 0 high/critical findings |
| Docker image build | Passed |
| Trivy image scan | Passed, 0 high/critical findings |

## Known Limitations

The mock validates route, method, and bearer-token behavior but does not emulate
console command execution, adapter-side Discord role tiers, or live service
state.

## Sources

- Upstream adapter contract: `docs/adapter-contract.md`.
- Fixture files: `test/fixtures/adapter/`.
