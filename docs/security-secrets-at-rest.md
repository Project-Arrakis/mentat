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

## Key rotation

There is currently no built-in key-rotation tooling. If you need to
rotate `ACP_SECRETS_KEY`:

1. Rows encrypted under the *old* key cannot be decrypted once you switch
   to a new key -- `decryptSecret()` will throw for them (this is
   intentional: silently returning garbage instead of failing loudly
   would be worse). Plan for this before rotating, not after.
2. The safest rotation path today is the same as the initial-adoption
   path above: have each connected operator re-run their guild's setup
   flow (which calls `upsertGuild()` again) under the *new* key, after it
   is deployed. Until an operator does this, their row is unreadable and
   `getGuildConfig()` will fail for that guild specifically (see
   `src/index.js`'s `getGuildConfig` callback) -- the bot does not crash,
   but that one guild's adapter calls will error until it re-links.
3. A proper "decrypt-with-old-key, re-encrypt-with-new-key" migration
   command, run once as a maintenance step with both keys available
   simultaneously, is a reasonable follow-up if key rotation needs to
   become a routine, low-friction operation rather than an
   operator-by-operator re-setup. Not implemented as of this writing.

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
