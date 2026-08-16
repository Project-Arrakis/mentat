# Secrets at Rest (Multi-Tenant Mode)

## What this covers

In `ACP_MULTI_TENANT=true` mode, one bot process and one shared SQLite
database (`ACP_DB_PATH`, default `data/acp.db`) serve every connected
Discord guild. Two columns in that database hold live credentials, not
player data:

- `guilds.adapter_token` -- the bearer token this bot uses to call that
  guild's own Core (`dune-awakening-selfhost-docker`) adapter API. This
  is not the guild's player data; it is the *key* that authenticates the
  bot to that operator's Core install.
- `oauth_sessions.access_token` -- a live Discord OAuth2 access token,
  captured during the setup wizard's OAuth callback. Short-lived
  (`expires_at` is checked by callers), but a real bearer credential for
  that Discord user's account while it lasts.

Without `ACP_SECRETS_KEY`/`ACP_SECRETS_KEY_FILE` configured, both columns
are stored in plaintext. A single compromise of the shared database file
(a misconfigured backup, an unrelated bug in a write path, a stolen disk
snapshot) would expose every connected operator's adapter credential at
once -- not just this bot's own configuration.

This does **not** cover player-linking data (character names, controller
IDs, Discord-to-character mappings). That data is never stored in this
bot's database at all, in either single-tenant or multi-tenant mode --
see `docs/multi-tenant-design.md`'s "Player Links stays in each
operator's own console database" note for why, and
`src/adapterClient.js`'s `playerLink*`/`playerUnlink*` methods for how
linking is actually implemented (a per-guild HTTP call to that operator's
own Core adapter, backed by `console.discord_player_links` in that
operator's own Postgres).

## Setting it up

**Recommended: use the KEK/DEK hierarchy below instead of a plain
`ACP_SECRETS_KEY`.** The rest of this section describes the older,
simpler single-key mode, which still works and remains fully supported
(existing deployments are not broken), but has three real limitations
(a `/proc`-visible env var if set directly, no break-glass recovery, one
key for every row) that the KEK/DEK hierarchy exists specifically to
close -- see that section below before choosing this path for a new
deployment.

Generate a key:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This prints 64 hex characters (32 random bytes). Set it as either:

```
ACP_SECRETS_KEY=<the 64 hex characters>
```

or, to keep the key out of your process environment/`.env` file entirely:

```
ACP_SECRETS_KEY_FILE=/app/secrets/acp-secrets-key.txt
```

(a file containing just that hex string). `ACP_SECRETS_KEY` takes
precedence if both are set.

If neither is set, the bot still starts and runs normally -- this is a
deliberate backward-compatibility choice, not an oversight, so that
single-tenant operators who never touch `ACP_MULTI_TENANT` are never
forced to provision a key they don't need. In multi-tenant mode
specifically, an unconfigured key logs a
`security.secrets_at_rest_unencrypted` warning once at startup (see
`src/index.js`). Treat that warning as an operational finding to fix, not
background noise.

## What happens to data written before a key was configured

Nothing breaks. Rows written while no key was configured are stored as
plaintext with an internal tag distinguishing them from ciphertext.
`getGuild()`/`getOauthSession()` read both forms transparently -- you do
not need to run a migration script before or after adding
`ACP_SECRETS_KEY`. The next `upsertGuild()`/`updateOauthSession()` call
for a given row (for example, the next time that guild's setup form is
resubmitted, or its adapter token is rotated) will re-encrypt it under
the now-configured key. There is currently no bulk "re-encrypt everything
now" command; if you need every existing row encrypted immediately rather
than opportunistically, the fastest path today is to have each connected
operator re-run their guild's setup flow once.

## Key rotation (ACP_SECRETS_KEY, v1 single-key mode)

If you are still on plain `ACP_SECRETS_KEY`/`ACP_SECRETS_KEY_FILE` (no
KEK/DEK hierarchy configured), rotating it has the same limitation
described in earlier versions of this document: rows encrypted under the
*old* key cannot be decrypted once you switch to a new key, and the only
rotation path is having each connected operator re-run their guild's
setup flow under the new key. **This is exactly the limitation the
KEK/DEK hierarchy below exists to remove** -- if key rotation needs to be
a routine, low-friction operation rather than an operator-by-operator
re-setup, migrate to the KEK/DEK hierarchy first.

## KEK/DEK hierarchy (Phase 1 of the ecosystem-wide secrets management
## epic -- issues #107/#108/#109)

`ACP_SECRETS_KEY` alone has three real limitations this hierarchy
addresses:

- **SEC-1**: a direct environment variable is visible to any process
  that can read `/proc/<pid>/environ` for this bot's PID.
- **GRC-1**: no break-glass recovery path if the key is lost.
- **SEC-2**: a single key encrypts every row in the database -- a
  compromise of that one key (or its holder) exposes every connected
  operator's adapter token and every live OAuth session at once.

The hierarchy: an **age identity key** (the operator-controlled root of
trust, on disk, never sent anywhere) decrypts a **KEK** (Key Encryption
Key, itself age-encrypted on disk), which unwraps a **per-row DEK** (Data
Encryption Key) for each individual `adapter_token`/`access_token`
value. Compromising one row's wrapped DEK exposes only that one row, not
every secret in the database.

### Setup

```bash
node scripts/setup-keys.js
```

Generates an age identity, a KEK encrypted to it, and (by default) 3
Shamir recovery shares (any 2 reconstruct the identity) under
`~/.config/acp/`. See `node scripts/setup-keys.js --help` for QR-code
recovery instead, or `--recovery none` to skip recovery material
entirely (not recommended -- see "What if the key is lost" below).

Activate by setting the environment variables the script prints
(`ACP_AGE_IDENTITY_FILE`, `ACP_KEK_FILE`, `ACP_KEK_VERSION=1`) and
restarting the bot. Existing `ACP_SECRETS_KEY`-encrypted rows keep
working unchanged (see "What happens to data written before a key was
configured" above -- the same opportunistic-upgrade-on-next-write model
applies to the v1-to-v2 transition, not just the plaintext-to-v1 one).

### Rotation

```bash
node scripts/rotate-keys.js --db data/acp.db --dir ~/.config/acp
```

Non-breaking: only the (32-byte) wrapped DEKs are re-wrapped under a new
KEK -- no data row is re-encrypted, and every row remains readable
throughout. Use `--dry-run` first to see what would change. The old KEK
file is never deleted automatically; keep it until you've confirmed the
bot starts and reads secrets correctly with the new one.

### What if the key is lost

This is the real answer this document previously didn't have (GRC-1):

- **If you generated Shamir shares** (the default): run
  `node scripts/recover-keys.js --from-shares <share1> <share2> --output <path>`
  with any `--shamir-threshold` (default 2) of the shares
  `setup-keys.js` generated, then point `ACP_AGE_IDENTITY_FILE` at the
  recovered file and restart. The script verifies the reconstruction
  with a real encrypt/decrypt round-trip before writing anything, so a
  wrong or insufficient set of shares fails loudly rather than silently
  producing an unusable identity.
- **If you generated a QR code backup**: scan it with any QR reader,
  save the decoded text to a file, and run
  `node scripts/recover-keys.js --from-qr <file> --output <path>`.
- **If you chose `--recovery none`, or you've lost enough shares that
  fewer than the threshold remain**: there is no recovery path. Every
  secret encrypted under that KEK (every connected operator's adapter
  token, every live OAuth session) is permanently unreadable. The bot
  itself does not crash -- affected guilds' adapter calls fail until
  each operator re-runs their setup flow to re-provision a fresh,
  readable token, exactly like the v1 rotation-without-migration path
  above.

### Audit trail (GRC-2, issue #111)

Every encrypt, decrypt, decrypt failure, and rotation event is recorded
in the `secret_access_log` table (schema v4) -- which table/row/column
was touched, when, and under which key version. The log never contains
the secret value itself, the DEK, or the KEK.

## Threat model notes

- This protects against **data-at-rest exposure of the SQLite file
  itself** (backups, disk snapshots, misconfigured file permissions, a
  bug that logs or serializes a full row). It does **not** protect
  against a compromise of the running bot process itself -- a process
  with access to `ACP_SECRETS_KEY` can always decrypt everything it can
  read, by design (the bot needs the plaintext token to make live
  adapter calls). This is standard for application-level encryption at
  rest and is not a gap specific to this implementation.
- `ACP_SECRETS_KEY`/`ACP_SECRETS_KEY_FILE` is itself a secret. Do not
  commit it, and store it with the same care as any other credential in
  this project (see the existing `*_FILE` secret-file convention used
  throughout `.env.example`).
