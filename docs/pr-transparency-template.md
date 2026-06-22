# PR Transparency Template

Use this template for each pull request. The repository also includes
`.github/PULL_REQUEST_TEMPLATE.md` so these prompts appear automatically when a
PR is opened on GitHub.

## Summary

What changed and why.

## User Impact

What users or operators will notice.

## Security Impact

Describe:

- whether the command surface changed
- whether RBAC changed
- whether secrets handling changed
- whether any new data crosses Discord, the bot, or the WebUI adapter
- whether network exposure changed

## Least Privilege

List the minimum Discord permissions, gateway intents, WebUI adapter access, and
container privileges needed after this change.

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

Be direct about what remains incomplete or intentionally out of scope.

## Sources

Link official docs or upstream source material used to make the change.
