# INC-01: Credential Exposure — new Discord Application bot token pasted into a chat session

**Severity**: Medium (credential not yet in production use — new Application, not yet wired into any live deployment; window of actual exploitability is bounded to "nothing lives at this identity yet")
**Detected**: 2026-09-06, during planning/design work for the Discord Application replacement (client_id `1546203607807041697`)
**Status**: OPEN — steps 1 and 4 pending operator action as of this writing; do not close this record until both are confirmed and this line is updated.

## Trigger

The bot token (and possibly client secret) for a newly-created Discord Application, intended to become the bot's identity as part of introducing its persona name "Sahir Venn," was pasted directly into a chat session with an AI assistant during planning work. A background research subagent (with no visibility into the main planning conversation) independently flagged the exposure and recommended immediate rotation, matching this runbook's own INC-01 trigger definition exactly ("Secret found in ... public channel" — a chat session with a third-party service is exactly this class of exposure).

## Contain

1. **Rotate the exposed credential immediately** — Discord Developer Portal → Application `1546203607807041697` → Reset Token (and reset the client secret too if it was pasted the same way; the operator's own message did not specify which credential(s) were exposed, so treat both as compromised until confirmed otherwise, per the Layer 1 audit's own recommendation to resolve this ambiguity rather than hedge on it).
   - **Operator confirmed via chat they would do this — not yet independently verified as of this record's creation. Update this line with the actual completion time/method once done.**

## Assess

- **Scope of exposure**: the token was visible in a chat transcript, in a session with an AI coding assistant (not shared publicly, not committed to any repository, not posted to a public issue/PR). No evidence found of it reaching any other channel.
- **Actual exploitability window**: as of this writing, the new Application (`1546203607807041697`) was not yet wired into any running process — `DISCORD_CLIENT_ID` on the live bot VM (`192.168.22.10`) still points at the old Application (`1516816812006969494`) as of the design-note-writing session. This means the exposed token, even if used by an attacker, could authenticate as a Discord Application that no bot process is actively running under — bounding real-world impact, though not eliminating it (an attacker with the token could still bring up their own process using this identity, or use it to inspect the Application's configuration via Discord's API).
- **Who had access**: the chat session itself (this assistant and its infrastructure), plus a background research subagent that independently read the same exposed value while investigating an unrelated question and correctly flagged it rather than acting on it.

## Remediate

- Once the token is rotated (Contain, step 1), the new value must be written to `/home/bot/arrakis-control-panel/secrets/discord-bot-token.txt` (and `discord-client-secret.txt` if that was also rotated) on the bot VM, per the storage convention documented in `docs/design/discord-application-replacement-l1-design-2026-09-06.md` §2-3 — **not** re-pasted into any chat session to verify it.
- No other reference to this credential exists anywhere in this repository's tracked files (verified: `git grep` for the literal client_id `1546203607807041697` at the time of this record's creation returns no hits outside this incident record and the design document, and neither file contains the actual token/secret value — only the public client ID).

## Verify

- **Pending**: confirm via the Discord Developer Portal (or a direct API call attempting to use the old, exposed token) that the exposed value is actually revoked and non-functional, not just that a new one was generated. Per the Layer 1 audit's Cloud Security hat finding, "Reset Token instantly invalidates the old value" is a platform assumption, not independently verified here — check the new bot user's Discord audit-log activity for the exposure window (token creation → Reset Token) to rule out misuse before treating this incident as closed.
- Update this record with the verification outcome once performed.

## Document

This record. Cross-referenced from `docs/design/discord-application-replacement-l1-design-2026-09-06.md` (the design note this exposure was discovered while writing) and from the tracking issue, `mentat#248`.
