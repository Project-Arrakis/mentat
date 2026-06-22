# Change Note: PII and Game Identity Redaction

## Summary

PR #12 expands shared Discord output redaction for PII and game identity fields
before the project adds more data-rich read-only commands.

## Security Impact

- Redacts email, Steam ID, Funcom ID, credential-like, and explicit real-name
  keys before formatting adapter output for Discord.
- Redacts email addresses, SteamID64, Steam2, Steam3, labeled Steam IDs, labeled
  Funcom IDs, and labeled credentials inside free-text strings.
- Documents that PCI/payment-card data is not expected and should be treated as
  a security finding if observed.
- Preserves the read-only adapter boundary and does not add commands, write
  routes, network exposure, or RBAC changes.

## Tests

- Added unit tests for key-based PII redaction.
- Added unit tests for free-text email, Steam ID, Funcom ID, and credential
  redaction.
- Kept bounded Discord output and error formatting tests.

## Evidence

- Issue: #9
- Primary files: `src/format.js`, `test/format.test.js`,
  `docs/security-model.md`, `docs/soc2-alignment.md`
- Upstream reference clone:
  `Red-Blink/dune-awakening-selfhost-docker@b1a0c26433dc89f6c031bdd151096e78bbbbbbcb`

## Known Limitations

Automated redaction cannot reliably detect arbitrary real names or unlabeled
third-party account identifiers in free text. Future data-rich command work
should avoid requesting or returning those values unless there is a specific
security review and documented operator need.
