# PR Transparency Template

Use these notes for each pull request. The GitHub PR template at
`.github/PULL_REQUEST_TEMPLATE.md` asks for the same information.

For substantive changes, also add a permanent
`docs/changes/PR-####-short-name.md` change note using these sections. Use
`IS-####-short-name.md` for issue evidence notes. The PR body is for review; the
change note is the durable evidence record after merge.

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

## Tests and Evidence

List local and CI checks:

- `npm run check`
- `npm audit --audit-level=moderate`
- Semgrep
- Gitleaks
- Trivy filesystem
- Dependency review
- SBOM generation
- Docker build
- Trivy image

## Known Limitations

Say what remains incomplete or out of scope.

## Sources

Link official docs or upstream source material used to make the change.
