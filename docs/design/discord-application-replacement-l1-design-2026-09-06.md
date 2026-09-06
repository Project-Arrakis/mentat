# Discord Application Replacement (Sahir Venn) — L1 Design

**Date:** 2026-09-06
**Status:** L1 design, revision 1. Requirement 20 Layer 1 Eight-Hats audit not yet dispatched — this document is the input to that dispatch, not a record of its results.
**Scope:** replacing the bot's Discord Application identity (`DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`) on the live bot VM (`192.168.22.10`, `acp-bot.service`) from the old application (`1516816812006969494`) to a new one (`1546203607807041697`), created as part of introducing the bot's persona name, Sahir Venn.
**Explicitly out of scope:** the OAuth redirect-URI registration needed for the domain-consolidation work (Stage E of the broader Mentat Link rename plan) — that's a separate config change against whichever application is live at the time, not a credential-storage question this document needs to answer.

---

## 1. Why a new Application, not a rename

Discord Applications cannot be renamed at the application-identity level in the way this rebrand needs (confirmed by the operator directly attempting it) — a new Application was created instead, with a new `client_id`. This is a genuine identity replacement, not a config tweak: a new client ID means a new bot user in Discord's system, which means the bot must be **re-invited to the guild** before its gateway connection or slash commands work there again, and any existing OAuth redirect-URI registration against the old application does not carry over.

## 2. Storage mechanism — no new pattern needed

**Finding, verified directly against both the code and the live deployment**: this credential class already has a correct, established storage pattern in this codebase, and it is *not* the age/KEK hierarchy used elsewhere in this project.

- `src/config.js:183-184` reads `DISCORD_BOT_TOKEN` via `readSecret(env, "DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN_FILE")` — a VALUE-or-VALUE_FILE convention: a direct env var, or a path to a file containing the value, with the file form preferred (Requirement 24: avoid `/proc/<pid>/environ` exposure of raw secrets).
- `clientId` is read via a plain `requiredEnv(env, "DISCORD_CLIENT_ID")` — **not treated as secret**, correctly, since a Discord client ID is a public identifier embedded in OAuth authorize URLs by design.
- **The live VM already uses the file-based form**, confirmed via direct inspection:
  ```
  DISCORD_CLIENT_ID=1516816812006969494
  DISCORD_BOT_TOKEN_FILE=/home/bot/arrakis-control-panel/secrets/discord-bot-token.txt
  DISCORD_CLIENT_SECRET_FILE=/home/bot/arrakis-control-panel/secrets/discord-client-secret.txt
  ```
  Both secret files are `0600`, owned `bot:bot`, in a `0775` directory (individual file permissions are what actually gate access — this is fine as-is).

**This is a different secret realm from `ACP_AGE_IDENTITY_FILE`/`ACP_KEK_FILE`** (the KEK/DEK hierarchy documented in `docs/security-secrets-at-rest.md` and the org-wide `unified-age-secrets-management-l1-design-2026-08-13.md`). That system exists to encrypt **many different operators' per-guild adapter tokens and OAuth session tokens at rest in a single shared SQLite database** — a many-tenants-one-datastore threat model. The bot's own Discord Application credentials are the opposite shape: **one credential, read once at process startup**, never written to the database, never shared across tenants. Wrapping a single startup-time credential in a KEK/DEK envelope would add real complexity (key provisioning, rotation-of-the-wrapper-key) to solve a problem this credential doesn't have. **Decision: keep using the existing `_FILE` convention. Do not introduce the age/KEK hierarchy for this credential.**

## 3. Rotation procedure (this *is* the rotation procedure, exercised for real right now)

The credential this document was originally scoped around was pasted into a chat session during planning and must be treated as already compromised — the operator has confirmed they will reset it before any of the steps below happen with the *old*, exposed value. That reset is, concretely, this document's own rotation procedure:

1. Discord Developer Portal → Application `1546203607807041697` → Reset Token (and rotate the client secret the same way if it was ever exposed the same way).
2. `ssh acp-bot` → overwrite `/home/bot/arrakis-control-panel/secrets/discord-bot-token.txt` and `discord-client-secret.txt` with the new values (`0600`, `bot:bot` — matching existing permissions, no change needed there).
3. Update `/home/bot/arrakis-control-panel/.env`'s `DISCORD_CLIENT_ID` to `1546203607807041697`.
4. `sudo systemctl restart acp-bot.service`.
5. Confirm clean startup (`journalctl -u acp-bot.service`, no `readSecret` throw, gateway connects).
6. **Re-invite the bot to the Discord guild** under the new client ID — required before slash commands or gateway presence work there again. This cannot be done from the VM; it's an operator action in Discord's own invite flow.
7. Live test: run a real slash command in the actual guild and confirm a response, not just "the service is active."

If this credential ever needs rotating again in the future for an unrelated reason (suspected compromise, routine hygiene), the exact same 7 steps apply — this document doubles as that runbook, not just a one-time migration record.

## 4. Loss and recovery

**What happens if the token file is lost, corrupted, or the wrong value is written?** `readSecret()` throws at startup (`Missing required environment variable` or, for a present-but-empty file, `... points to an empty secret file.`) — the bot fails closed, does not start with a missing/blank credential. Recovery is identical to routine rotation (§3, steps 1-7): Discord tokens are always re-mintable from the Developer Portal on demand. **This is a materially lower-stakes loss scenario than the age identity key** documented elsewhere in this project (losing that permanently locks out already-encrypted data with no recovery path) — there is no "already-encrypted data" tied to this credential; resetting it in Discord and rewriting the file fully recovers the system with zero data loss.

## 5. What happens to the running bot during the swap (Requirement 7)

This is a full identity replacement — gateway connection and OAuth both move to the new application, not just OAuth. The bot will disconnect from Discord's gateway during the `systemctl restart` in §3 step 4 and reconnect under the new identity; this is a real, if brief, outage for actual Discord users in the guild (slash commands unavailable for the restart duration, on the order of seconds based on this service's existing restart behavior). **Explicit operator go-ahead is required before step 4** — this is exactly the kind of live/user-facing action this project's Requirement 7 exists to gate, not something to execute unattended.

Roles/permissions for the new application inside the actual guild cannot be fully known until it is re-invited and exercised live (§3 step 6-7) — this is stated plainly here rather than guessed at, per the plan this document was written to satisfy.

## 6. Deferred items (none blocking, named for the record)

- **Wrapping this credential in the age/KEK hierarchy for defense-in-depth** — explicitly deferred, not needed now (see §2's reasoning). Owner: revisit only if this credential's threat model changes (e.g., if the bot ever needs to hold multiple Discord Application identities simultaneously, which is not a currently planned feature).
- **A monitoring/alert for unexpected gateway disconnect/reconnect cycles** around this credential specifically — not currently instrumented, would be a `mentat-observatory` addition, not this repo's. Not blocking this swap.

## 7. Eight-Hats Layer 1 dispatch — what to check

Per this project's own precedent (the age-secrets document's audit found its real issues via the Security Architect and Cloud Security hats specifically), the dispatch against this document should focus those two hats on:
- Whether the `_FILE`-based convention genuinely closes the `/proc/<pid>/environ` exposure this document claims it does, on this specific VM's actual process/container setup (not just in the abstract).
- Whether the guild re-invite step (§3.6) has any privilege-escalation or scope-creep risk if the new Application requests different OAuth scopes than the old one — verify the actual scopes requested match what the old application had, not more.
- STRIDE mapping for this change: Spoofing (a leaked token lets an attacker impersonate the bot in the guild — mitigated by rotation being immediate and re-mintable per §4), Elevation of Privilege (re-invite flow should request the same scopes as before, verify per above), Repudiation (§3's restart/reconnect should be logged — confirm `journalctl` captures it, which it already does per standard systemd behavior).
