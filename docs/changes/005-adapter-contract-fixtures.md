# Change Note: Adapter Contract Fixtures

## Executive Summary

This change starts Phase 2 by pinning the bot's default adapter routes to the
current upstream Discord adapter contract and adding fixtures for the four
read-only responses the bot consumes.

The bot still only calls the bearer-token protected adapter API. No Docker,
database, game-file, shell, or write-capable console access was added.

## Technical Summary

The new fixture set covers:

| Route | Method | Fixture |
| --- | --- | --- |
| `/api/integrations/discord/health` | `GET` | `test/fixtures/adapter/health.json` |
| `/api/integrations/discord/status` | `POST` | `test/fixtures/adapter/status.json` |
| `/api/integrations/discord/readiness` | `POST` | `test/fixtures/adapter/readiness.json` |
| `/api/integrations/discord/services` | `POST` | `test/fixtures/adapter/services.json` |

The compatibility tests assert that default config matches those routes and
methods, POST calls include the minimal Discord actor context, GET calls do not
send a request body, configured route overrides still work, and adapter method
overrides remain limited to `GET` and `POST`.

The durable contract notes live in `docs/adapter-contract.md`.

## Evidence and Source Material

- Upstream console source of truth:
  [Red-Blink/dune-awakening-selfhost-docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker).
- Upstream `origin/main` checked on June 22, 2026: `6fe7f46`.
- Latest published upstream release checked on June 22, 2026: `v1.3.17`.
- The Discord adapter contract is present on upstream `main` after the latest
  published release, so this project treats it as upstream-main compatibility
  evidence until a release tag includes it.

## Unit Testing and Verification

Local verification on June 22, 2026:

| Check | Result |
| --- | --- |
| `npm test` | Passed, 24 tests |
| `npm audit --audit-level=moderate` | Passed, 0 vulnerabilities |
| Semgrep default and secrets rules | Passed, 0 findings |
| Gitleaks | Passed, no leaks found |
| Trivy filesystem scan | Passed, 0 high/critical findings |
| Docker image build | Passed |
| Trivy image scan | Passed, 0 high/critical findings |
