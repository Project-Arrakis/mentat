# SOC 2 Control Framework — Arrakis Control Panel

**Scope**: Discord bot, landing page, Cloudflare infrastructure, GitHub repositories
**Classification**: SOC 2 Type I (ready for Type II after 6 months of operation)
**Last Updated**: 2026-07-19
**Owner**: yacketrj

---

## Control Matrix

| ID | Control | Category | Status | Evidence |
|---|---|---|---|---|
| AC-01 | Role-based access control (RBAC) | Access Control | ✅ Implemented | Bot RBAC, GitHub teams |
| AC-02 | Multi-factor authentication required | Access Control | ✅ Enforced | GitHub, Cloudflare, Discord |
| AC-03 | Least privilege principle | Access Control | ✅ Implemented | Bot tokens scoped, KV read-only for landing |
| AC-04 | Access review (quarterly) | Access Control | ⚠️ Manual | [Access Review Checklist](policies/access-review.md) |
| AC-05 | Service account management | Access Control | ✅ Implemented | Bot uses dedicated Discord app |
| CC-01 | Branch protection rules | Change Management | ⚠️ Partial | [Setup Required](#branch-protection) |
| CC-02 | Required code review (1+ approver) | Change Management | ⚠️ Partial | [Setup Required](#branch-protection) |
| CC-03 | CI/CD pipeline security gates | Change Management | ✅ Implemented | `.github/workflows/ci.yml` |
| CC-04 | Change approval process | Change Management | ✅ Implemented | PR required, CI gate |
| CC-05 | Rollback procedures | Change Management | ✅ Implemented | [Runbook: Rollback](runbooks/rollback.md) |
| CC-06 | Change log maintained | Change Management | ✅ Implemented | `CHANGELOG.md`, GitHub releases |
| RA-01 | Automated vulnerability scanning | Risk Assessment | ✅ Implemented | Trivy, Semgrep, npm audit |
| RA-02 | Dependency monitoring | Risk Assessment | ⚠️ Partial | [Dependabot Setup](#dependabot) |
| RA-03 | Secret scanning & prevention | Risk Assessment | ✅ Implemented | Gitleaks, ggshield, pre-commit |
| RA-04 | Threat model documented | Risk Assessment | ✅ Implemented | [Threat Model](policies/threat-model.md) |
| MD-01 | Security event logging | Monitoring | ✅ Implemented | Bot structured logging, CI logs |
| MD-02 | Anomaly detection & alerting | Monitoring | ✅ Implemented | Discord webhook alerts, cron monitoring |
| MD-03 | Log retention (90 days) | Monitoring | ⚠️ Partial | [Policy](policies/log-retention.md) |
| MD-04 | Incident response plan | Monitoring | ✅ Implemented | [Runbook](runbooks/incident-response.md) |
| DP-01 | Secret management | Data Protection | ✅ Implemented | File-based secrets, `.env` excluded |
| DP-02 | Encryption in transit | Data Protection | ✅ Implemented | HTTPS everywhere, TLS 1.2+ |
| DP-03 | Data classification | Data Protection | ✅ Implemented | [Policy](policies/data-classification.md) |
| DP-04 | KV data encryption at rest | Data Protection | ✅ Implemented | Cloudflare default encryption |
| DP-05 | Backup & recovery | Data Protection | ⚠️ Partial | [Runbook](runbooks/backup-recovery.md) |
| PR-01 | Privacy policy published | Privacy | ✅ Implemented | `/privacy` on landing page |
| PR-02 | Data retention policy | Privacy | ✅ Implemented | [Policy](policies/data-retention.md) |
| PR-03 | User data deletion capability | Privacy | ⚠️ Manual | [Runbook](runbooks/data-deletion.md) |
| BC-01 | Disaster recovery plan | Availability | ✅ Implemented | [Runbook](runbooks/disaster-recovery.md) |
| BC-02 | RTO/RPO defined | Availability | ✅ Implemented | RTO: 1hr, RPO: 15min |
| BC-03 | Backup testing (monthly) | Availability | ⚠️ Manual | [Schedule](policies/backup-schedule.md) |

---

## Critical Gaps to Close

### 1. Branch Protection (CC-01, CC-02)
```bash
# Run to enforce on all repos
gh api repos/yacketrj/acp-landing/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI Gate"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

### 2. Dependabot (RA-02)
Create `.github/dependabot.yml` in each repo.

### 3. Log Retention (MD-03)
Configure Cloudflare log retention + bot log rotation.

### 4. Access Review (AC-04)
Quarterly review of GitHub repo collaborators, Cloudflare account members, Discord bot permissions.

---

## Audit Evidence Collection

| Evidence Type | Location | Frequency |
|---|---|---|
| CI/CD logs | GitHub Actions | Per deployment |
| Security scan results | `.github/workflows/`, pre-commit logs | Per commit |
| Access logs | GitHub audit log, Cloudflare dashboard | Quarterly |
| Incident reports | `compliance/evidence/incidents/` | As needed |
| Change records | `CHANGELOG.md`, GitHub releases | Per release |
| Backup verification | `compliance/evidence/backups/` | Monthly |

---

## Compliance Automation

```bash
# Run full compliance check
bash compliance/scripts/compliance-check.sh

# Generate evidence bundle for audit
bash compliance/scripts/generate-evidence.sh

# Verify secret rotation status
bash compliance/scripts/check-secret-rotation.sh
```
