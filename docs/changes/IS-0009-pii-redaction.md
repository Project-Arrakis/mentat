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

Resolved by PR #12 before adding data-rich player or server-detail commands.

## Resolution

PR #12 expanded shared output redaction for email addresses, Steam IDs, Funcom
IDs, credential-like labels, and explicit real-name fields. It also documented
the no-PCI expectation and the limits of automated free-text real-name
detection.

## Evidence

- Issue: #9
- Resolving PR: #12
- Code area: `src/format.js`
- Tests: `test/format.test.js`
- Docs: `docs/security-model.md`
