# PROMPT: Phase 1 — Bot KEK/DEK Secrets Management

**Epic:** #112 | **L1 Design:** `docs/design/pki-cmk-secrets-l1-design-audit-2026-08-08.md`  
**Repo:** arrakis-control-panel | **Core Changes Required:** None  
**Timeout estimate:** 1-2 weeks

## Architecture

```
age identity key (~/.config/acp/age-identity.txt, mode 0400)
    ↓ decrypts
KEK file (~/.config/acp/kek.age, age-encrypted)
    ↓ unwraps
Per-row DEKs in SQLite (secret_keys table)
    ↓ encrypts
adapter_token, access_token columns
```

## Deliverables

### 1. Key Hierarchy Implementation (`secretsCrypto.js`)

Extend the existing module to support per-row DEKs wrapped by a KEK.

```js
// New exports:
async function loadKEK(kekFilePath, ageIdentityPath) → returns KEK Buffer
function wrapDEK(dek, kek) → returns { wrapped: Buffer, keyVersion: int }
function unwrapDEK(wrappedDek, kek) → returns DEK Buffer
function encryptWithDEK(plaintext, dek) → returns ciphertext
function decryptWithDEK(ciphertext, dek) → returns plaintext

// Existing API preserved (backward compat):
function encryptSecret(plaintext) → now uses per-row DEK if KEK configured
function decryptSecret(ciphertext) → handles both enc:v1: and enc:v2: formats
```

**Key behaviors:**
- If `ACP_KEK_FILE` is not set, fall back to `ACP_SECRETS_KEY` (v1 mode)
- `enc:v2:<key_version>:<base64>` format for per-row encryption
- `enc:v1:` format still readable (backward compat)
- Log deprecation warning if `ACP_SECRETS_KEY` is used

### 2. Schema Migration v4 (`database.js`)

```sql
CREATE TABLE IF NOT EXISTS key_versions (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1,
  wrapped_dek_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secret_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  column_name TEXT NOT NULL,
  key_version INTEGER NOT NULL REFERENCES key_versions(version),
  wrapped_dek TEXT NOT NULL,
  UNIQUE(table_name, row_key, column_name)
);

CREATE TABLE IF NOT EXISTS secret_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL, -- 'decrypt', 'encrypt', 'rotate_kek', 'migration'
  table_name TEXT,
  row_key TEXT,
  key_version INTEGER,
  outcome TEXT NOT NULL,
  failure_reason TEXT
);
```

**Auto-migration on startup (v3 → v4):**
1. If `ACP_KEK_FILE` is not configured, skip migration (stay in v1 mode)
2. Load KEK from age-encrypted file
3. For each `enc:v1:` row in `guilds` and `oauth_sessions`:
   a. Decrypt with `ACP_SECRETS_KEY`
   b. Generate per-row DEK
   c. Encrypt with DEK, store as `enc:v2:<version>:<base64>`
   d. Store wrapped DEK in `secret_keys`
4. Update `schema_version` to 4
5. Write `.migration-v4-complete` marker so it doesn't re-run

**Safety:**
- Empty adapter_token rows skip migration (don't create DEK for empty string)
- Migration wraps errors and continues (one bad row doesn't block others)
- Failed migration: all rows still in `enc:v1:` format, nothing lost

### 3. Setup Script (`scripts/setup-keys.js`)

```
$ node scripts/setup-keys.js

This script generates encryption keys for the ACP bot.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generating age identity key... done.
  Written to: ~/.config/acp/age-identity.txt
  Permissions: 0400

⚠️  STORE THIS FILE SECURELY. It is the only way to decrypt your data.

Choose a recovery method:
  [1] Print QR code (store offline)
  [2] Generate 3 recovery shares — any 2 can reconstruct
  [3] Skip recovery (NOT RECOMMENDED — no backup means permanent loss if key is deleted)

> 1

QR code saved to: ~/.config/acp/age-identity-recovery.png
Print this and store it in a safe place (physical safe, sealed envelope).

Generating Key Encryption Key (KEK)... done.
Encrypting KEK with age identity... done.
  Written to: ~/.config/acp/kek.age
  Permissions: 0400

✅ Setup complete. Add to your .env:
  ACP_KEK_FILE=~/.config/acp/kek.age
  ACP_AGE_IDENTITY_FILE=~/.config/acp/age-identity.txt

The bot will auto-migrate existing encrypted data on next startup.
```

**Dependencies:** age binary (`age-keygen` must be on PATH). Detect and warn if missing.

### 4. Rotation Script (`scripts/rotate-keys.js`)

```
$ node scripts/rotate-keys.js

This rotates your Key Encryption Key. Existing data is NOT re-encrypted —
only the 32-byte per-row DEKs are re-wrapped with the new key. This is a
fast, non-breaking operation.

Prerequisites:
  ✓ Age identity found at ~/.config/acp/age-identity.txt
  ✓ Current KEK found at ~/.config/acp/kek.age
  ✓ Database accessible (acp.db)
  ✓ 3 rows will be re-wrapped

Continue? [y/N] y

Generating new KEK... done.
Re-wrapping DEKs: 3/3 rows (guilds: 2, oauth_sessions: 1)
Backing up old KEK: ~/.config/acp/kek.age.bak-2026-08-09T12:00:00Z
Writing new KEK: ~/.config/acp/kek.age
  New key version: 2

✅ Rotation complete. The bot will use the new key on next restart.
   Old key retained for reading rows encrypted during transition.
   Discard the backup only after confirming all guilds are accessible.
```

**Safety:**
- Old KEK version kept in `key_versions` (active=0) so rows written during transition are readable
- Backup of old `kek.age` saved with timestamp
- Rotation can be interrupted and restarted (idempotent — skips already-re-wrapped DEKs)

### 5. Recovery Script (`scripts/recover-keys.js`)

```
$ node scripts/recover-keys.js

No age identity found at ~/.config/acp/age-identity.txt.

Recovery options:
  [1] I have a QR code backup (age-identity-recovery.png)
  [2] I have recovery shares (share-*.txt)
  [3] I have a copy of the age identity file
  [4] I have no backups — ALL encrypted tokens must be re-provisioned

> 2

Enter share 1 path: ~/.config/acp/recovery-shares/share-1.txt
Enter share 2 path: /mnt/usb/recovery/share-2.txt

Reconstructing key from shares... done.
  Written to: ~/.config/acp/age-identity.txt
  Permissions: 0400

✅ Key recovered. Verify with: node scripts/verify-keys.js
```

**Shamir implementation:** Use `secrets.js` (npm: `secrets.js`) or implement GF(256) Shamir directly (the algorithm is ~50 lines). Prefer a well-tested library.

### 6. File Permission Check (`config.js`)

On startup, for every `*_FILE` env var:
```js
const stat = fs.statSync(filePath);
const mode = stat.mode & 0o777;
if (mode !== 0o600 && mode !== 0o400) {
  logWarning(`secret_file_permissions: ${filePath} has mode ${mode.toString(8)}. Recommend 0600.`);
}
```

**Do not refuse to start** — warn only. An operator might have a legitimate reason (e.g., shared group access).

### 7. Deprecation Warnings (`config.js`)

On startup:
- If `ACP_SECRETS_KEY` is set: `logWarning("ACP_SECRETS_KEY is deprecated. Use ACP_KEK_FILE instead. See docs/design/pki-cmk-secrets-l1-design-audit-2026-08-08.md")`
- If both `DISCORD_BOT_TOKEN` and `DISCORD_BOT_TOKEN_FILE` are set: `logWarning("Both DISCORD_BOT_TOKEN and DISCORD_BOT_TOKEN_FILE are set. DISCORD_BOT_TOKEN is visible in /proc. Prefer _FILE variant.")`

## Testing

### Unit Tests (`test/secretsCrypto.test.js`)
- [ ] Load KEK from age-encrypted file (valid age key)
- [ ] Fail to load KEK with wrong age key
- [ ] Fall back to `ACP_SECRETS_KEY` when `ACP_KEK_FILE` not set
- [ ] Wrap DEK with KEK, unwrap, verify round-trip
- [ ] Detect tampered wrapped DEK (auth failure)
- [ ] Encrypt with per-row DEK, decrypt, verify round-trip
- [ ] Different rows get different DEKs
- [ ] Rotate KEK: old DEKs still readable with old KEK
- [ ] Forward compat: `enc:v1:` rows still decrypt with `ACP_SECRETS_KEY`
- [ ] Empty plaintext returns empty (no DEK created)

### Integration Tests (`test/secrets-migration.test.js`)
- [ ] Start with v3 schema, `ACP_SECRETS_KEY`, insert guild with token
- [ ] Verify token is `enc:v1:` format
- [ ] Run migration to v4 with `ACP_KEK_FILE`
- [ ] Verify token is still decryptable (now `enc:v2:`)
- [ ] Rotate KEK
- [ ] Verify token still decryptable
- [ ] Remove `ACP_SECRETS_KEY`, verify token still decryptable
- [ ] `secret_access_log` has entries for all operations

### Manual Verification
- [ ] Run `setup-keys.js` on a clean environment
- [ ] Verify bot starts and auto-migrates data
- [ ] Run `rotate-keys.js` while bot is running
- [ ] Verify bot continues to read tokens after rotation
- [ ] Run `recover-keys.js` from shamir shares

## Files to Modify
- `src/secretsCrypto.js` — KEK/DEK hierarchy
- `src/database.js` — schema v4 migration
- `src/config.js` — `ACP_KEK_FILE`, `ACP_AGE_IDENTITY_FILE`, deprecation, file-perm check
- New: `scripts/setup-keys.js`
- New: `scripts/rotate-keys.js`
- New: `scripts/recover-keys.js`
- New: `scripts/verify-keys.js`
- `test/secretsCrypto.test.js` — extend (or new test file)

## Files NOT Modified
- `src/adapterClient.js` — unchanged
- `src/setupServer.js` — unchanged
- Core (`dune-awakening-selfhost-docker`) — no changes

## L2/L3 Audit Requirements

Per Requirement 20:
- **L2 (implementation audit):** Dispatch all 8 hats after implementation, before marking complete
- **L3 (integration audit):** Dispatch all 8 hats before cutting a release that includes this

## Related Issues
- #107 — SEC-1: /proc exposure
- #108 — GRC-1: No break-glass recovery
- #109 — SEC-2: Single master key
- #110 — NET-1: Replay protection
- #111 — GRC-2: No audit trail
- #112 — EPIC: ecosystem-wide secrets management
