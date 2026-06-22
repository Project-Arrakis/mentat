## Summary

What changed and why.

## User Impact

What users or operators will notice.

## Security Impact

- Command surface:
- RBAC or authorization:
- Secret handling:
- Data crossing Discord/bot/WebUI boundaries:
- Network exposure:

## Least Privilege

Minimum required Discord scopes, bot permissions, gateway intents, WebUI adapter
access, and container privileges after this change.

## Tests

- [ ] `npm test`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image

## Known Limitations

What remains incomplete, deferred, or intentionally out of scope.

## Sources

Official docs, upstream source material, or evidence used to make the change.
