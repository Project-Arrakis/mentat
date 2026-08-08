# OpenBao Transit as Optional Backend for ACP_SECRETS_KEY -- Evaluation

**Status**: Design note, no code changes landed (issue #85 deliverable).
**Date**: 2026-08-07
**Scope**: `src/secretsCrypto.js`'s encryption key source in
`arrakis-control-panel`. Independent of Core's parallel evaluation
(`dune-awakening-selfhost-docker#128`).

## Recommendation

**Proceed, as a strictly opt-in backend, behind review of the config
shape below.** The win is real (audit trail, rotation, revocation) but
the bot currently has exactly one realistic consumer (multi-tenant
production on R740), zero actual exposure (verified: all at-rest rows are
already `enc:v1:` with a working key, reencrypt run 2026-08-07 confirmed
0 plaintext rows), and a new bootstrap credential requirement. That
makes this defense-in-depth, not remediation -- right size for an
evaluation + config-shape doc now, not for a code change this quarter.

## Current state (verified, not assumed)

`src/secretsCrypto.js`:

- `loadKey()` reads `ACP_SECRETS_KEY` (64 hex chars) or
  `ACP_SECRETS_KEY_FILE` (path), caches in-process, validates hex length.
- Encrypt: AES-256-GCM, 12-byte IV, pinned 16-byte tag, payload stored as
  `enc:v1:<base64(iv+tag+ciphertext)>` (see
  `src/secretsCrypto.js:135-139`).
- No key configured = deliberate no-op passthrough (`plain:` prefix) for
  single-tenant backward compat -- **this behavior must be preserved**.
- Rotation today = manual: new key env, run `scripts/reencrypt-secrets.js`
  (added 2026-08-06, issue #90) which re-encrypts all rows. No
  rewrap-without-decrypt, no audit trail, no revocation.

## Why Transit fits (and the honest tradeoff)

| Property | Today (env key) | OpenBao Transit |
|---|---|---|
| Key material exposure | Raw 32-byte hex in env/file | Never leaves OpenBao; caller gets ciphertext only |
| Rotation | Manual reencrypt (no key escrow) | `transit/keys/<name>/rotate` + `rewrap` without decrypt |
| Audit trail | None | `audit` backend (file/syslog) per `/encrypt`/`/decrypt` |
| Revocation/disable | None | Disable key, block future ops |
| Bootstrap credential | None needed | AppRole/token/mTLS to talk to OpenBao |
| Operational burden | Zero (env var) | Run + secure a second service (HA, TLS, storage) |
| Default attack surface | None | New outbound connection + credential (must be opt-in) |

Transit's `vault:v1:<ciphertext>` convention is the same idea as our
`enc:v1:` prefix; the `/encrypt`+`/decrypt` API maps near 1:1 onto
`encryptSecret()`/`decryptSecret()`. Transit never returns the key --
exactly the property missing today.

Constraint 2 from the issue is the honest core: OpenBao means the bot
now needs *a* credential to OpenBao. That moves the exposure surface
(from "protect one key" to "protect one AppRole secret + the OpenBao
instance"), it does not remove it. The win is rotation/audit/revocation,
not "no secrets to protect."

## Proposed config shape (opt-in, default unchanged)

```
ACP_SECRETS_BACKEND=env|openbao        # default: env (current behavior)
ACP_SECRETS_KEY / ACP_SECRETS_KEY_FILE # still fully supported when backend=env
ACP_OPENBAO_ADDR=http://127.0.0.1:8200 # must not bind a new public port
ACP_OPENBAO_ROLE_ID=                   # AppRole
ACP_OPENBAO_SECRET_ID_FILE=            # file path, not inline value
ACP_OPENBAO_KEY_NAME=acp-secrets       # transit key name in OpenBao
```

- Storage format stays `enc:v1:`; Transit-backed values would get a
  distinct prefix (`bao:v1:`) so a database can hold a mix (env-encrypted
  rows remain decryptable after a backend switch and vice versa).
- `isEncryptionConfigured()` must return true only when the backend is
  configured and reachable; the no-op passthrough for unconfigured
  single-tenant stays exactly as-is.
- Backend selected at process start and cached (no per-call HTTP when
  `backend=env`; a `backend=openbao` boot without connectivity must fail
  startup loudly, not silently degrade to passthrough).
- OpenBao must run on 127.0.0.1 only on the R740 dune-prod VM (no new public
  port; constraint 3). AppRole secret via `_FILE` convention to match
  the repo's existing VALUE/VALUE_FILE pattern.

## What would need to change in code (for later, not now)

- `src/secretsCrypto.js`: backend switch, `bao:` prefix, cached Transit
  client (`openbao` npm package or raw HTTP to `/v1/transit/encrypt`).
- `scripts/reencrypt-secrets.js`: backend-aware reencrypt (rewrap).
- `docs/security-secrets-at-rest.md`: operator docs for opt-in backend.
- Tests: injectable backend stub so unit tests don't need a live OpenBao.

## Verification

- Constraint 4 (single-tenant installs untouched) holds by design:
  default backend remains `env`; nothing changes without
  `ACP_SECRETS_BACKEND=openbao`.
- Existing at-rest rows: verified 2026-08-07 on the live R740 DB that all
  rows are already `enc:v1:` with zero plaintext (issue #90 evidence).
  A backend switch is therefore not urgent for data safety today.

## Decision record

- **Go** on a design note + config shape (this doc).
- **Hold** code changes until: (a) this doc is reviewed under the eight
  hats, and (b) a real need (per-guild history, rotation cadence, or a
  documented exposure) makes the extra service worth running. The
  revisit trigger is the same as issue #94's: do not add a second stateful
  service to a single-maintainer project ahead of real demand.
