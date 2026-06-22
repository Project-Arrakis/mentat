# PR Transparency Template

Use these notes for each pull request. The GitHub PR template asks for the same
information.

## Summary

What changed, and why.

## User Impact

What users or operators will notice.

## Security Impact

Cover:

- whether the command surface changed
- whether RBAC changed
- whether secrets handling changed
- whether any new data crosses Discord, the bot, or the WebUI adapter
- whether network exposure changed

## Least Privilege

List the minimum Discord permissions, gateway intents, WebUI adapter access, and
container privileges needed after the change.

## Tests

List local and CI checks:

- `npm test`
- `npm audit --audit-level=moderate`
- Semgrep
- Gitleaks
- Trivy filesystem
- Docker build
- Trivy image

## Known Limitations

Say what remains incomplete or out of scope.

## Sources

Link official docs or upstream source material used to make the change.
