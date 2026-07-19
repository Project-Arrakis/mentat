# Threat Model — Arrakis Control Panel

**Version**: 1.0
**Date**: 2026-07-19
**Review Cycle**: Quarterly

---

## System Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Discord   │────▶│  ACP Bot     │────▶│ Dune Console API │
│   Users     │     │  (Node.js)   │     │ (Bearer Token)   │
└─────────────┘     └──────┬───────┘     └──────────────────┘
                           │
                    ┌──────▼───────┐     ┌──────────────────┐
                    │ Cloudflare   │◀────│ Landing Page     │
                    │ KV (Stats)   │     │ (Static)         │
                    └──────────────┘     └──────────────────┘
```

## Trust Boundaries

| Boundary | From | To | Controls |
|---|---|---|---|
| TB-01 | Discord Users | ACP Bot | RBAC, rate limiting, input validation |
| TB-02 | ACP Bot | Dune Console API | Bearer token auth, HTTPS, timeout limits |
| TB-03 | ACP Bot | Cloudflare KV | API token with namespace-scoped permissions |
| TB-04 | Public | Landing Page | Static hosting, no server-side processing |
| TB-05 | Landing Page | Cloudflare KV | Pages Function with KV binding (read-only) |

## Threats & Mitigations

| ID | Threat | Impact | Likelihood | Mitigation | Control |
|---|---|---|---|---|---|
| T-01 | Discord token theft | High | Medium | Token in secrets/, never logged, rotated on exposure | DP-01, RA-03 |
| T-02 | Bearer token theft | High | Medium | Token in secrets/, scoped to adapter only, HTTPS only | DP-01, DP-02 |
| T-03 | KV namespace abuse | Medium | Low | Scoped API token, rate limiting, monitoring | AC-03, MD-02 |
| T-04 | Supply chain attack | High | Medium | Dependabot, npm audit, lockfile, pre-commit hooks | RA-01, RA-02 |
| T-05 | Unauthorized command execution | High | Low | RBAC enforcement, role validation per command | AC-01 |
| T-06 | Data leakage via logs | Medium | Low | Structured logging, no secrets in logs, log rotation | MD-01, DP-03 |
| T-07 | DDoS on landing page | Low | Low | Cloudflare CDN, rate limiting, static hosting | DP-02 |
| T-08 | Credential stuffing | Medium | Medium | Discord OAuth (no passwords), MFA enforced | AC-02 |
| T-09 | Privilege escalation | High | Low | RBAC, least privilege, regular access reviews | AC-01, AC-04 |
| T-10 | Data tampering in KV | Medium | Low | Write-only from bot, read-only from landing, integrity checks | DP-04, AC-03 |

## Attack Vectors

### 1. Discord Bot Compromise
**Scenario**: Attacker obtains bot token and impersonates ACP.
**Impact**: Unauthorized command execution, data exfiltration, social engineering.
**Detection**: Discord audit logs, anomalous command patterns, token usage alerts.
**Response**: Rotate token immediately, revoke old token, audit all commands executed.

### 2. Console API Token Theft
**Scenario**: Attacker obtains bearer token and accesses Dune console API.
**Impact**: Server manipulation, data exfiltration, write operations.
**Detection**: Unusual API patterns, IP anomalies, token usage monitoring.
**Response**: Rotate token, audit console logs, verify server integrity.

### 3. Supply Chain Compromise
**Scenario**: Malicious npm package injected into dependencies.
**Impact**: Code execution, data theft, bot compromise.
**Detection**: Dependabot alerts, npm audit, pre-commit scanning.
**Response**: Remove compromised package, audit codebase, rotate all secrets.

### 4. KV Namespace Abuse
**Scenario**: Attacker writes malicious data to KV namespace.
**Impact**: Landing page displays false stats, potential XSS if not sanitized.
**Detection**: Anomalous write patterns, data validation failures.
**Response**: Rotate API token, validate/clean KV data, audit access logs.

## Data Flow Classification

| Data Type | Classification | Storage | Retention |
|---|---|---|---|
| Discord token | Secret | File system, env var | Until rotation |
| Bearer token | Secret | File system, env var | Until rotation |
| KV API token | Secret | File system, env var | Until rotation |
| Player data | Confidential | Dune console API | Per game server policy |
| Stats aggregates | Public | Cloudflare KV | 30 days |
| Bot logs | Internal | File system | 90 days |
| Discord user IDs | PII | Bot database | Until unlink |
