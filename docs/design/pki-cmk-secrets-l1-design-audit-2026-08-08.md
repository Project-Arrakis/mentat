# PKI / CMK / Secrets Management — L1 Design Audit

**Date:** 2026-08-08 | **Repos:** arrakis-control-panel, dune-awakening-selfhost-docker  
**Requirement 20, Layer 1:** Design audit before implementation

## Architecture Decision

**Two-tier key hierarchy with age-encrypted files as root of trust.**

```
Layer 0: age identity key on disk (~/.config/acp/age-identity.txt, mode 0400)
    ↓ decrypts
Layer 1: KEK (AES-256) stored age-encrypted on disk, loaded at startup
    ↓ unwraps
Layer 2: Per-row DEKs in SQLite, wrapped by KEK  
    ↓ encrypts
Layer 3: adapter_token, access_token rows encrypted with per-row DEK
```

**Why age?** Single binary, operator-controlled, no cloud dependency, offline recovery.

## Credential Storage

| Secret | Current | Proposed |
|---|---|---|
| ACP_SECRETS_KEY | Env var (/proc visible) | Removed. Replaced by age-encrypted KEK at `~/.config/acp/kek.age` |
| Bot tokens | Env var or file | `_FILE` variant becomes canonical. Startup warn on non-0600 |
| Guild adapter tokens | SQLite, single-key AES | SQLite, per-row DEK wrapped by KEK |
| OAuth tokens | SQLite, same key | SQLite, per-row DEK |

## Key Rotation

- **KEK rotation**: Non-breaking. Only DEKs (32 bytes each) re-wrapped. Old KEK retained for reading rows during transition.
- **DEK rotation**: Optional, heavy (full re-encryption). Needed only if cipher changes.
- **Migration v3→v4**: Auto-migrate `enc:v1:` rows on startup if `ACP_KEK_FILE` configured. Backward compat retained.

## Break-Glass Recovery

- **M-of-N Shamir sharding**: 3 shares, any 2 reconstruct the age key.
- **QR code backup**: Single-file backup for single operators.
- **Recovery script**: `node scripts/recover-keys.js` with guided flow.

## PKI Decision: Deferred

- **Phase 1**: Mandatory actor signing (builds on existing `actorSignature.js`)
- **Phase 2**: Body hash binding for replay protection
- **Phase 3 (deferred)**: mTLS — requires Core native HTTPS, complex for self-hosted operators

## Phase Plan

| Phase | What | Deps | Est |
|---|---|---|---|
| Phase 1 | Age KEK, schema v4, setup/rotate/recover scripts, deprecation, file-perm check | None | 1-2 weeks |
| Phase 2 | Mandatory actor signing, body hash, OAuth cleanup, /proc mitigation | Phase 1 | 1 week |
| Phase 3 | Core-side mandatory signing, mTLS evaluation, bearer scoping | Core work resumes | Deferred |
| Phase 4 | Cloudflare/OCI Vault integration (optional) | — | Deferred |

## Findings

| ID | Severity | Description |
|---|---|---|
| SEC-1 | CRITICAL | ACP_SECRETS_KEY visible in /proc |
| GRC-1 | CRITICAL | No break-glass recovery path |
| SEC-2 | HIGH | Single master key for all rows |
| NET-1 | MEDIUM | Actor signature replay within skew window |
| GRC-2 | MEDIUM | No key access audit trail |
| SEC-3 | MEDIUM | OAuth sessions never purged |
| SEC-4 | MEDIUM | No startup file permission check |
| SEC-5 | LOW | Actor signature opt-in by default |
