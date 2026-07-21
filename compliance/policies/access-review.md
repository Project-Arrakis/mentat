# Access Review Policy

**Version**: 1.0
**Date**: 2026-07-19
**Review Cycle**: Quarterly

---

## Scope

All systems and services within the ACP environment:
- GitHub repositories (`acp-landing`, `Arrakis-Control-Panel`, `acp-ops-monitor`)
- Cloudflare account (Pages, KV, Tunnel, DNS)
- Discord bot and developer application
- Server infrastructure (if applicable)

## Review Process

### 1. GitHub Access
- [ ] Review all repository collaborators
- [ ] Verify team memberships
- [ ] Check for inactive accounts (>90 days)
- [ ] Validate service account permissions
- [ ] Review branch protection rules

### 2. Cloudflare Access
- [ ] Review account members and roles
- [ ] Verify API tokens and scopes
- [ ] Check for unused tokens
- [ ] Validate KV namespace permissions

### 3. Discord Access
- [ ] Review bot permissions
- [ ] Verify OAuth scopes
- [ ] Check webhook access
- [ ] Validate role assignments

### 4. Infrastructure Access
- [ ] Review SSH keys
- [ ] Check service accounts
- [ ] Verify firewall rules
- [ ] Validate network access

## Evidence Collection

Document findings in `compliance/evidence/access-reviews/YYYY-Q#.md`:
- Date of review
- Reviewer
- Systems reviewed
- Findings and remediation
- Sign-off

## Remediation

- Remove access for inactive accounts
- Revoke unused tokens
- Update permissions to least privilege
- Document exceptions with justification

## Schedule

| Quarter | Review Date | Reviewer | Status |
|---|---|---|---|
| Q1 2026 | 2026-03-31 | yacketrj | ✅ Complete |
| Q2 2026 | 2026-06-30 | yacketrj | ✅ Complete |
| Q3 2026 | 2026-09-30 | yacketrj | ⏳ Pending |
| Q4 2026 | 2026-12-31 | yacketrj | ⏳ Pending |
