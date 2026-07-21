# Data Classification Policy

**Version**: 1.0
**Date**: 2026-07-19
**Review Cycle**: Annually

---

## Classification Levels

| Level | Definition | Examples | Handling Requirements |
|---|---|---|---|
| Public | Safe for external distribution | Landing page content, command docs, stats aggregates | No restrictions |
| Internal | For authorized personnel only | Bot logs, CI/CD logs, internal docs | Access control, no public sharing |
| Confidential | Sensitive business data | Player data, server configs, API responses | Encryption, access logging, need-to-know |
| Secret | Credentials and keys | Bot tokens, bearer tokens, API keys | Encrypted storage, rotation, audit trail |

## Data Handling Rules

### Public Data
- No access restrictions
- Can be shared externally
- No encryption required

### Internal Data
- Access limited to team members
- No sharing without approval
- Access logged

### Confidential Data
- Access limited to authorized roles
- Encryption in transit required
- Access logged and reviewed
- Retention period defined

### Secret Data
- Stored in encrypted files or secret managers
- Never committed to version control
- Rotated on schedule or exposure
- Access logged and audited

## Data Retention

| Data Type | Retention Period | Deletion Method |
|---|---|---|
| Bot logs | 90 days | Secure delete |
| CI/CD logs | 90 days | GitHub auto-delete |
| KV stats | 30 days | KV expiration |
| Character links | Until unlink | `/dune player unlink` or DB delete |
| Player links | Until unlink | Database delete |
| Audit records | 1 year | Secure delete |
