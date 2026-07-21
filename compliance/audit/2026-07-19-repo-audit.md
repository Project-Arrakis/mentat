# SOC 2 Compliance Audit — Repository Findings

**Audit Date**: 2026-07-19
**Auditor**: yacketrj
**Scope**: 6 repositories in ACP ecosystem

---

## Repository Inventory

| Repository | Purpose | Visibility | Branch |
|---|---|---|---|
| `yacketrj/acp-landing` | Landing page | Private | master |
| `yacketrj/Arrakis-Control-Panel` | Discord bot | Private | main |
| `yacketrj/acp-ops-monitor` | Cron/monitoring | Public | main |
| `yacketrj/dune-ops-observability-addon` | Ops addon | Public | main |
| `yacketrj/dune-docker-addons` | Docker addons catalog | Public | main |
| `yacketrj/dune-awakening-selfhost-docker` | Core fork | Public | main |

---

## Findings by Control

### CC-01: Branch Protection Rules

| Repo | Protected | Status Checks | Reviews | Force Push | Deletions | Status |
|---|---|---|---|---|---|---|
| acp-landing | ✅ | ❌ | ❌ (0) | ❌ | ❌ | ⚠️ Partial |
| Arrakis-Control-Panel | ✅ | ❌ | ❌ (0) | ❌ | ❌ | ⚠️ Partial |
| acp-ops-monitor | ✅ | ❌ | ❌ (0) | ❌ | ❌ | ⚠️ Partial |
| dune-ops-observability-addon | ✅ | ❌ | ❌ (0) | ❌ | ❌ | ⚠️ Partial |
| dune-docker-addons | ✅ | ❌ | ❌ (0) | ❌ | ❌ | ⚠️ Partial |
| dune-awakening-selfhost-docker | ✅ | ❌ | ❌ (0) | ❌ | ❌ | ⚠️ Partial |

**Finding**: All repos have branch protection enabled but lack required status checks and code review requirements.
**Resolution**: Enable required status checks (CI Gate) and require 1+ approving review on all repos.

---

### CC-03: CI/CD Pipeline Security Gates

| Repo | CI Workflow | Security Gates | Status |
|---|---|---|---|
| acp-landing | ✅ CI (lint, links, a11y, security, perf, build) | ✅ gitleaks, semgrep, ggshield | ✅ Compliant |
| Arrakis-Control-Panel | ✅ CI + Security Gates | ✅ Trivy, Semgrep, gitleaks, ggshield | ✅ Compliant |
| acp-ops-monitor | ❌ None | ❌ None | ❌ Non-compliant |
| dune-ops-observability-addon | ✅ 6 workflows | ✅ SAST, Secret Scan, Trivy | ✅ Compliant |
| dune-docker-addons | ❌ None | ❌ None | ❌ Non-compliant |
| dune-awakening-selfhost-docker | ✅ 7 workflows | ✅ CodeQL, Semgrep, Trivy, Dependabot | ✅ Compliant |

**Finding**: `acp-ops-monitor` and `dune-docker-addons` lack CI/CD pipelines and security gates.
**Resolution**: Add CI workflow with lint, security scanning, and build validation to both repos.

---

### RA-01: Automated Vulnerability Scanning

| Repo | Trivy | Semgrep | CodeQL | npm audit | Status |
|---|---|---|---|---|---|
| acp-landing | ❌ | ✅ | ❌ | ✅ | ⚠️ Partial |
| Arrakis-Control-Panel | ✅ | ✅ | ❌ | ✅ | ⚠️ Partial |
| acp-ops-monitor | ❌ | ❌ | ❌ | ❌ | ❌ Non-compliant |
| dune-ops-observability-addon | ✅ | ✅ | ❌ | ❌ | ⚠️ Partial |
| dune-docker-addons | ❌ | ❌ | ❌ | ❌ | ❌ Non-compliant |
| dune-awakening-selfhost-docker | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |

**Finding**: No repo has complete scanning coverage. `acp-ops-monitor` and `dune-docker-addons` have no scanning.
**Resolution**: Add Trivy + Semgrep to all repos. CodeQL for repos with significant code.

---

### RA-02: Dependency Monitoring

| Repo | Dependabot | Dependabot Alerts | Auto-PRs | Status |
|---|---|---|---|---|
| acp-landing | ✅ | ✅ | ❌ | ⚠️ Partial |
| Arrakis-Control-Panel | ✅ | ✅ | ✅ | ✅ Compliant |
| acp-ops-monitor | ✅ | ✅ | ❌ | ⚠️ Partial |
| dune-ops-observability-addon | ✅ | ✅ | ❌ | ⚠️ Partial |
| dune-docker-addons | ✅ | ✅ | ❌ | ⚠️ Partial |
| dune-awakening-selfhost-docker | ✅ | ✅ | ✅ | ✅ Compliant |

**Finding**: All repos have Dependabot enabled but only 2 have auto-PR configuration.
**Resolution**: Add `.github/dependabot.yml` to repos missing auto-PR configuration.

---

### RA-03: Secret Scanning & Prevention

| Repo | Gitleaks | ggshield | Pre-commit | Secret Scanning (GH) | Push Protection | Status |
|---|---|---|---|---|---|---|
| acp-landing | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ Partial |
| Arrakis-Control-Panel | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ Partial |
| acp-ops-monitor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ Non-compliant |
| dune-ops-observability-addon | ✅ | ❌ | ✅ | ❌ | ❌ | ⚠️ Partial |
| dune-docker-addons | ❌ | ❌ | ✅ | ❌ | ❌ | ⚠️ Partial |
| dune-awakening-selfhost-docker | ✅ | ❌ | ✅ | ❌ | ❌ | ⚠️ Partial |

**Finding**: No repos have GitHub native secret scanning or push protection enabled.
**Resolution**: Enable GitHub secret scanning and push protection on all repos. Add gitleaks/ggshield to repos missing them.

---

### MD-01: Security Event Logging

| Repo | Structured Logging | Audit Trail | Log Retention | Status |
|---|---|---|---|---|
| acp-landing | ❌ (static site) | ✅ (CI logs) | ❌ | ⚠️ Partial |
| Arrakis-Control-Panel | ✅ (JSON logs) | ✅ (CI logs) | ❌ | ⚠️ Partial |
| acp-ops-monitor | ❌ | ❌ | ❌ | ❌ Non-compliant |
| dune-ops-observability-addon | ❌ | ✅ (CI logs) | ❌ | ⚠️ Partial |
| dune-docker-addons | ❌ | ❌ | ❌ | ❌ Non-compliant |
| dune-awakening-selfhost-docker | ❌ | ✅ (CI logs) | ❌ | ⚠️ Partial |

**Finding**: No repos have defined log retention policies. Bot has structured logging but no rotation.
**Resolution**: Implement log rotation (90 days) for bot. Add logging to monitoring scripts.

---

### DP-01: Secret Management

| Repo | Secrets in Repo | .env in .gitignore | Secret Files | Status |
|---|---|---|---|---|
| acp-landing | ✅ | ✅ | ❌ (no secrets) | ✅ Compliant |
| Arrakis-Control-Panel | ✅ | ✅ | ✅ (secrets/) | ✅ Compliant |
| acp-ops-monitor | ✅ | ❌ | ❌ | ⚠️ Partial |
| dune-ops-observability-addon | ✅ | ✅ | ❌ | ✅ Compliant |
| dune-docker-addons | ✅ | ✅ | ❌ | ✅ Compliant |
| dune-awakening-selfhost-docker | ✅ | ✅ | ❌ | ✅ Compliant |

**Finding**: `acp-ops-monitor` lacks `.gitignore` for sensitive files.
**Resolution**: Add `.gitignore` with webhook URL, token patterns.

---

### Documentation & Compliance

| Repo | CHANGELOG | CONTRIBUTING | SECURITY.md | Compliance Dir | Status |
|---|---|---|---|---|---|
| acp-landing | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |
| Arrakis-Control-Panel | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |
| acp-ops-monitor | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |
| dune-ops-observability-addon | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |
| dune-docker-addons | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |
| dune-awakening-selfhost-docker | ✅ | ✅ | ✅ | ❌ | ⚠️ Partial |

**Finding**: No repos have compliance documentation structure.
**Resolution**: Add `compliance/` directory with SOC 2 control matrix to primary repos.

---

## Priority Remediation Plan

### Critical (Fix Immediately)

1. **Enable GitHub secret scanning + push protection** on all 6 repos
2. **Add CI workflow** to `acp-ops-monitor` and `dune-docker-addons`
3. **Add required status checks** to branch protection on all repos
4. **Add required code review** (1+ approver) to branch protection on all repos

### High (Fix This Week)

5. **Add Trivy + Semgrep scanning** to `acp-ops-monitor` and `dune-docker-addons`
6. **Add gitleaks + ggshield** to repos missing them
7. **Add `.gitignore`** to `acp-ops-monitor`
8. **Add Dependabot auto-PR config** to repos missing it

### Medium (Fix This Month)

9. **Add compliance documentation** structure to primary repos
10. **Implement log rotation** for bot (90-day retention)
11. **Add logging** to monitoring scripts
12. **Create SECURITY.md** templates with vulnerability disclosure process

### Low (Fix This Quarter)

13. **Add CodeQL** to repos with significant code
14. **Create security metrics dashboard**
15. **Implement automated access review** reminders
16. **Add backup verification** automation

---

## Compliance Score

| Control | Score | Status |
|---|---|---|
| CC-01 Branch Protection | 40% | ⚠️ Partial |
| CC-03 CI/CD Gates | 50% | ⚠️ Partial |
| RA-01 Vulnerability Scanning | 33% | ⚠️ Partial |
| RA-02 Dependency Monitoring | 67% | ⚠️ Partial |
| RA-03 Secret Scanning | 33% | ⚠️ Partial |
| MD-01 Security Logging | 33% | ⚠️ Partial |
| DP-01 Secret Management | 83% | ✅ Mostly |
| Documentation | 50% | ⚠️ Partial |
| **Overall** | **49%** | ⚠️ Partial |
