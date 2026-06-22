# Change Note: About Command

## Summary

This change adds `/dune about`, a low-sensitivity read-only command that shows
safe bot and adapter metadata without contacting the console adapter.

## User Impact

Authorized users can check bot version, read-only status, adapter origin, RBAC
mode, and boundary flags from Discord.

## Security Impact

- Command surface: adds one read-only local metadata command.
- RBAC or authorization: adds `DISCORD_ABOUT_ROLE_IDS`; admin and observer roles
  inherit the command.
- Secret handling: the command exposes adapter origin only and strips any URL
  username/password details.
- Data crossing Discord, bot, or WebUI boundaries: no adapter call is made.
- Network exposure: unchanged.

## Least Privilege

No runtime privileges changed. The command reads already-loaded local
configuration and package metadata only.

## Tests

Local verification on June 22, 2026:

| Check | Result |
| --- | --- |
| `npm test` | Passed, 28 tests |
| `npm audit --audit-level=moderate` | Passed, 0 vulnerabilities |
| Semgrep default and secrets rules | Passed, 0 findings |
| Gitleaks | Passed, no leaks found |
| Trivy filesystem scan | Passed, 0 high/critical findings |
| Docker image build | Passed |
| Trivy image scan | Passed, 0 high/critical findings |

## Known Limitations

`/dune about` intentionally does not check live adapter health or latency. Use
`/dune health` or future `/dune ping` behavior for live checks.

Broader PII redaction for richer read-only outputs is tracked separately in
issue #9 and should land before adding data-rich player or server-detail
commands.

## Sources

- Security-first roadmap Phase 3.
- Existing package metadata in `package.json`.
