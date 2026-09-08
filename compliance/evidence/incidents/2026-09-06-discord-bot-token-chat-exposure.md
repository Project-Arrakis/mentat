# INC-01: Credential Exposure — new Discord Application bot token pasted into a chat session

**Severity**: Medium (see 2026-09-07 update below — the "not yet in production use" bound that originally scoped this severity no longer holds; not re-scored here since the exposure event itself and its actual-impact window predate the cutover)
**Detected**: 2026-09-06, during planning/design work for the Discord Application replacement (client_id `1546203607807041697`)
**Status**: PARTIALLY RESOLVED, as of 2026-09-07 (mentat#278) — the cutover to the new Application actually happened (bot token rotated, VM `.env` updated, service restarted under the new identity, `discord.ready` confirmed, slash commands re-registered), but this record's own Contain step 1 and Verify section were never updated to say so until now. **Still genuinely open**: independent confirmation via Discord's audit log that the specific exposed (old) token value is non-functional (Verify, below) has not been performed — only that a working new token exists and is in use, which is a different fact. Do not close this record until that audit-log check is done.

## Trigger

The bot token (and possibly client secret) for a newly-created Discord Application, intended to become the bot's identity as part of introducing its persona name "Sahir Venn," was pasted directly into a chat session with an AI assistant during planning work. A background research subagent (with no visibility into the main planning conversation) independently flagged the exposure and recommended immediate rotation, matching this runbook's own INC-01 trigger definition exactly ("Secret found in ... public channel" — a chat session with a third-party service is exactly this class of exposure).

## Contain

1. **Rotate the exposed credential immediately** — Discord Developer Portal → Application `1546203607807041697` → Reset Token (and reset the client secret too if it was pasted the same way; the operator's own message did not specify which credential(s) were exposed, so treat both as compromised until confirmed otherwise, per the Layer 1 audit's own recommendation to resolve this ambiguity rather than hedge on it).
   - **Update (2026-09-07):** the bot token was rotated and the new value is confirmed live — `DISCORD_CLIENT_ID=1546203607807041697` on the bot VM's `/home/bot/arrakis-control-panel/.env`, `acp-bot.service` active, independently re-verified directly against the VM during mentat#278's fix rather than taken on faith. **The client secret has NOT been confirmed rotated** — only the bot token's rotation was verified as part of the cutover; per mentat#278, treat the secret as a separate, still-outstanding rotation task (see docs/design/discord-application-replacement-l1-design-2026-09-06.md's runbook step tracking).

## Assess

- **Scope of exposure**: the token was visible in a chat transcript, in a session with an AI coding assistant (not shared publicly, not committed to any repository, not posted to a public issue/PR). No evidence found of it reaching any other channel.
- **Actual exploitability window**: at the time this record was originally written, the new Application (`1546203607807041697`) was not yet wired into any running process — `DISCORD_CLIENT_ID` on the live bot VM (`192.168.22.10`) still pointed at the old Application (`1516816812006969494`). This means the exposed token, even if used by an attacker during that window, could authenticate as a Discord Application that no bot process was actively running under — bounding real-world impact during the exposure window itself, though not eliminating it (an attacker with the token could still have brought up their own process using this identity, or used it to inspect the Application's configuration via Discord's API).
  - **Update (2026-09-07):** that bound no longer describes the current state — the cutover happened 2026-09-07 ~02:06 UTC and this Application is now the live bot's real identity (verified directly against the VM, not assumed). This doesn't retroactively change what was true during the original exposure window, but it does mean this incident can no longer be treated as "low-impact because nothing lives here" from this point forward — a still-valid copy of the originally-exposed (pre-rotation) token would now authenticate as the actual production bot, which is exactly why the Verify section's audit-log check matters and must not be skipped.
- **Who had access**: the chat session itself (this assistant and its infrastructure), plus a background research subagent that independently read the same exposed value while investigating an unrelated question and correctly flagged it rather than acting on it.

## Remediate

- Once the token is rotated (Contain, step 1), the new value must be written to `/home/bot/arrakis-control-panel/secrets/discord-bot-token.txt` (and `discord-client-secret.txt` if that was also rotated) on the bot VM, per the storage convention documented in `docs/design/discord-application-replacement-l1-design-2026-09-06.md` §2-3 — **not** re-pasted into any chat session to verify it.
- No other reference to this credential exists anywhere in this repository's tracked files (verified: `git grep` for the literal client_id `1546203607807041697` at the time of this record's creation returns no hits outside this incident record and the design document, and neither file contains the actual token/secret value — only the public client ID).

## Verify

- **Pending**: confirm via the Discord Developer Portal (or a direct API call attempting to use the old, exposed token) that the exposed value is actually revoked and non-functional, not just that a new one was generated. Per the Layer 1 audit's Cloud Security hat finding, "Reset Token instantly invalidates the old value" is a platform assumption, not independently verified here — check the new bot user's Discord audit-log activity for the exposure window (token creation → Reset Token) to rule out misuse before treating this incident as closed.
- Update this record with the verification outcome once performed.

## Document

This record. Cross-referenced from `docs/design/discord-application-replacement-l1-design-2026-09-06.md` (the design note this exposure was discovered while writing) and from the tracking issue, `mentat#248`.
