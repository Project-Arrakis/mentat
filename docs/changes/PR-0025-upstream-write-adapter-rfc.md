# PR-0025: Add Upstream Write Adapter RFC

## Summary

Adds a maintainer-facing RFC packet for a future upstream Discord write adapter.
The packet includes proposed disabled-by-default write routes, JSON schema
files, example fixtures, STRIDE notes, abuse cases, action risk tiers, and
questions for the upstream maintainer.

No runtime write behavior is implemented. The bot remains read-only.

## User Impact

Operators should see no behavior change. The new RFC gives maintainers and
contributors a concrete proposal to discuss before any write-capable work
starts.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged in runtime code.
- Secret handling: unchanged in runtime code; the RFC requires redaction for
  secrets, emails, SteamIDs, FuncomIDs, real names, and private deployment
  details.
- Data crossing Discord/bot/WebUI boundaries: unchanged.
- Network exposure: unchanged.

## Least Privilege

Runtime least privilege is unchanged. The RFC explicitly preserves the current
read-only adapter boundary and proposes separate write routes that remain
disabled by default.

## Tests and Evidence

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

This is a proposal artifact only. It does not create an upstream issue or pull
request and does not implement bot write commands. Exact upstream route names,
storage, audit retention, and permission mapping still need maintainer review.

## Sources

- Current adapter contract: `docs/adapter-contract.md`
- Non-read-only roadmap: `docs/non-readonly-roadmap.md`
- OWASP API Security Top 10 2023:
  https://owasp.org/API-Security/editions/2023/en/0x00-header/
- OWASP Authorization Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Logging Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- NIST SP 800-53 Rev. 5:
  https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final
- HTTP Semantics, RFC 9110:
  https://www.rfc-editor.org/rfc/rfc9110
