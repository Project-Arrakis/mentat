# Incident Response Runbook — Arrakis Control Panel

**Version**: 1.0
**Date**: 2026-07-19
**Severity Levels**: P1 (Critical), P2 (High), P3 (Medium), P4 (Low)

---

## Severity Classification

| Severity | Criteria | Response Time | Escalation |
|---|---|---|---|
| P1 | Active breach, data exfiltration, service down | 15 min | Immediate |
| P2 | Credential exposure, vulnerability exploited | 1 hour | 4 hours |
| P3 | Security control failure, policy violation | 4 hours | 24 hours |
| P4 | Minor misconfiguration, informational | 24 hours | 1 week |

---

## Incident Types

### INC-01: Credential Exposure

**Trigger**: Secret found in logs, commit, or public channel.

**Steps**:
1. **Contain** — Rotate the exposed credential immediately
2. **Assess** — Determine scope of exposure (who had access, for how long)
3. **Remediate** — Update all references to the credential
4. **Verify** — Confirm old credential is revoked and non-functional
5. **Document** — Record in `compliance/evidence/incidents/`

**Credentials to rotate**:
- Discord bot token: Regenerate in Discord Developer Portal
- Adapter bearer token: Generate new token, update console `.env`
- Cloudflare API token: Regenerate in Cloudflare dashboard
- Webhook URL: Create new webhook in Discord channel settings

### INC-02: Unauthorized Access

**Trigger**: Anomalous command usage, unexpected API calls, role bypass.

**Steps**:
1. **Contain** — Disable affected account/role, revoke tokens if needed
2. **Assess** — Review audit logs, identify affected commands/data
3. **Remediate** — Patch vulnerability, update RBAC configuration
4. **Verify** — Test that unauthorized access is blocked
5. **Document** — Record timeline, impact, and remediation

### INC-03: Service Disruption

**Trigger**: Bot offline, landing page down, KV API errors.

**Steps**:
1. **Assess** — Check service status, identify root cause
2. **Contain** — Isolate affected component if needed
3. **Remediate** — Restart service, apply fix, or rollback
4. **Verify** — Confirm service is operational and healthy
5. **Document** — Record outage duration, cause, and resolution

### INC-04: Data Integrity Issue

**Trigger**: False stats displayed, corrupted KV data, mismatched records.

**Steps**:
1. **Assess** — Identify affected data, determine cause
2. **Contain** — Disable stats display if showing false data
3. **Remediate** — Clear corrupted data, restore from backup if available
4. **Verify** — Confirm data accuracy and integrity
5. **Document** — Record data affected, cause, and remediation

### INC-05: Supply Chain Compromise

**Trigger**: Malicious dependency, npm audit failure, Dependabot alert.

**Steps**:
1. **Assess** — Identify affected package, version, and vulnerability
2. **Contain** — Pin to safe version, remove if necessary
3. **Remediate** — Update to patched version, audit codebase
4. **Verify** — Run full test suite, security scans
5. **Document** — Record vulnerability, impact, and fix

---

## Communication Plan

| Audience | Channel | Timing |
|---|---|---|
| Internal | Discord #acp-updates | Immediate for P1/P2 |
| Users | Discord announcements | After containment |
| stakeholders | Direct message | As needed |

## Post-Incident Review

Within 48 hours of resolution:
1. Document timeline of events
2. Identify root cause
3. List corrective actions
4. Update runbooks if needed
5. Schedule follow-up review

Store reports in `compliance/evidence/incidents/YYYY-MM-DD-incident-type.md`.
