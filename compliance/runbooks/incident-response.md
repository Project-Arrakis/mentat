# Incident Response Runbook — Dune: Awakening Docker (Mentat / Sahir Venn)

**Version**: 1.1
**Date**: 2026-09-10 (added INC-06; rebranded from "Arrakis Control Panel" — mentat#337)
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

### INC-06: Social Engineering / Confirmation-Gate Abuse

**Added 2026-09-10 (mentat#337, comprehensive security/GRC audit finding).** The hosted-bot auto-invite design's owner-confirmation gate (`dune-awakening-selfhost-docker#844`) is cryptographically unforgeable — a real Discord user must click Confirm or run `/confirm-connection` themselves — but that says nothing about whether the *human* decision behind a real click was socially engineered (e.g., a guild owner phished into approving a registration for a console URL they didn't recognize as suspicious). This incident type exists because the prior four types don't cover "the authentication was real, but the human was deceived."

**Trigger**: A denied/timed-out confirmation attempt logged against the same target guild repeatedly (a real, reviewable abuse signal the design already logs, per `dune-awakening-selfhost-docker#844`'s Path F); a guild owner reports they confirmed a connection they don't recognize; a `reclaimed=true` event (`dune-awakening-selfhost-docker` design §4.2 Path E) the affected operator disputes.

**Steps**:
1. **Assess** — Pull the logged audit trail for the target `guildId` (consoleUrl, timestamps, confirming/denying `ownerId`) from mentat's existing `upsertGuild()`/registration logging. Confirm whether the registration is genuinely fraudulent or a legitimate-but-confusing reclaim.
2. **Contain** — If fraudulent: disconnect the guild (remove the `guilds` row, matching the existing owner-initiated "Disable" path), and if the bot has permission, leave the guild.
3. **Remediate** — Notify the affected guild owner directly (a bot DM, mirroring the confirmation-gate's own delivery mechanism) that their server's connection was reset due to a suspected fraudulent registration, with a plain-language explanation and a way to re-register legitimately.
4. **Verify** — Confirm the guild's registration state now reflects reality (disconnected, or correctly re-registered by the real owner).
5. **Document** — Record in `compliance/evidence/incidents/`, same as every other incident type.

**Standing gap, not yet closed**: this runbook names the steps, but no automated alerting currently wires Deny/timeout/reclaim events to a human reviewer — `mentat-observatory`'s existing hourly cron monitoring is the natural consumer for this signal (it already monitors this workstream's other cross-repo signals) but is not yet configured to do so. Tracked as follow-up work, not fixed in this pass.

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
