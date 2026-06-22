# Change Note: RBAC Roadmap and Least Privilege

## Executive Summary

This change finishes the first least-privilege pass for the Discord bot. The bot
now defaults to restricted RBAC, refuses to start without an allow-list in that
mode, and checks command access before calling the read-only adapter API.

The roadmap was also brought up to date so future work stays small, reviewable,
and tied to the upstream console adapter instead of drifting into console,
Docker, database, or shell access.

## Technical Summary

RBAC is loaded from environment configuration and normalized into a command map.
The current read-only commands can be granted through admin roles, observer
roles, command-specific roles, or explicit user IDs. Unsupported commands fail
closed.

The command handler checks RBAC before it calls the adapter client. A denied
interaction receives a private authorization failure and no adapter request is
made.

## Overall Theme

Least privilege for the existing read-only command set, with a roadmap that
keeps future work aligned to the console adapter boundary.

## Findings Mitigated

- Overbroad Discord access: mitigated by restricted mode as the default.
- Missing command-level authorization: mitigated by per-command role maps.
- Unsafe startup configuration: mitigated by failing closed when restricted mode
  has no role or user allow-list.
- Review drift: mitigated by documenting which work is complete, which work is
  next, and which write actions remain blocked.

## Architecture Notes

- `src/config.js` parses RBAC settings and validates that restricted mode has at
  least one allowed role or user.
- `src/commands.js` checks `isCommandAllowed` before invoking adapter calls.
- `DISCORD_ADMIN_ROLE_IDS` and `DISCORD_OBSERVER_ROLE_IDS` inherit all current
  read-only commands.
- Command-specific variables grant only their matching command.
- `DISCORD_ALLOWED_USER_IDS` provides an explicit user allow-list for controlled
  operational access.
- `DISCORD_RBAC_MODE=open` remains available for local testing, but it is not the
  documented production default.

## Evidence and Source Material

- Upstream console source of truth:
  [Red-Blink/dune-awakening-selfhost-docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker).
- Local upstream reference checked on June 22, 2026:
  `65a9011` / `v1.3.17`.
- Implementation files: `src/config.js`, `src/commands.js`.
- Documentation files: `README.md`, `docs/configuration.md`,
  `docs/security-model.md`, `docs/roadmap.md`, `docs/verification.md`.
- Test files: `test/config.test.js`, `test/commands.test.js`.

## Unit Testing and Verification

Local verification on June 22, 2026:

| Check | Result |
| --- | --- |
| `npm test` | Passed, 20 tests |
| `npm audit --audit-level=moderate` | Passed, 0 vulnerabilities |
| Semgrep default and secrets rules | Passed, 0 findings |
| Gitleaks | Passed, no leaks found |
| Trivy filesystem scan | Passed, 0 high/critical findings |
| Docker image build | Passed |
| Trivy image scan | Passed, 0 high/critical findings |
| Repository text scan for unwanted tool/vendor references | Passed, 0 matches |
