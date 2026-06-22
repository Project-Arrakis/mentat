# Issue Note: PII Redaction

## Summary

Issue #9 tracks a security requirement to expand output redaction for PII and
game identity fields before adding richer read-only commands.

## Scope

The project should redact or avoid exposing:

- email addresses
- Steam IDs
- Funcom IDs
- keys, passwords, tokens, credentials, authorization values, cookies, API keys
- real-name fields such as first name, last name, full name, or real name

The project is not expected to process PCI/payment-card data.

## Status

Open. This should be handled before data-rich player or server-detail commands.

## Evidence

- Issue: #9
- Planned code area: `src/format.js`
- Planned docs area: `docs/security-model.md`
