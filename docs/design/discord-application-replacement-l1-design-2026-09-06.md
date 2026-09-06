# Discord Application Replacement (Sahir Venn) — L1 Design

**Date:** 2026-09-06 (revised same day, post-audit)
**Status:** L1 design, revision 2. The Requirement 20 Layer 1 Eight-Hats audit against revision 1 is complete (4 dispatches, 8 hats). Findings register and STRIDE table: §8. Every CRITICAL and HIGH finding is resolved inline in this revision (marked `[R2]`); MEDIUM/LOW findings are resolved inline where cheap to do so, or explicitly deferred with a named trigger.
**Scope:** replacing the bot's Discord Application identity (`DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`) on the live bot VM (`192.168.22.10`, `acp-bot.service`) from the old application (`1516816812006969494`) to a new one (`1546203607807041697`), created as part of introducing the bot's persona name, Sahir Venn.
**Explicitly out of scope:** the OAuth redirect-URI registration needed for the domain-consolidation work (Stage E of the broader Mentat Link rename plan) — that's a separate config change against whichever application is live at the time, not a credential-storage question this document needs to answer.
**Related:** `compliance/evidence/incidents/2026-09-06-discord-bot-token-chat-exposure.md` (INC-01, opened as a direct result of this design work — see §3.1).

---

## 1. Why a new Application, not a rename

Discord Applications cannot be renamed at the application-identity level in the way this rebrand needs (confirmed by the operator directly attempting it) — a new Application was created instead, with a new `client_id`. This is a genuine identity replacement, not a config tweak: a new client ID means a new bot user in Discord's system, which means the bot must be **re-invited to the guild** before its gateway connection or slash commands work there again, and **Discord slash commands are registered per-Application** (`[R2]`, see §3.5) — neither carries over from the old application.

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
- **`[R2]`, confirmed by the audit's Cloud Security hat**: `acp-bot.service` runs as a plain systemd service (`User=bot`, `EnvironmentFile=...`), not a container. Since `.env` sets only the `_FILE` path variables (never the raw-value variables), `/proc/<pid>/environ` never contains the actual secret regardless of who can read the process's own environment block — the `_FILE` convention's stated benefit genuinely holds on this specific deployment, not just in the abstract.

**This is a different secret realm from `ACP_AGE_IDENTITY_FILE`/`ACP_KEK_FILE`** (the KEK/DEK hierarchy documented in `docs/security-secrets-at-rest.md` and the org-wide `unified-age-secrets-management-l1-design-2026-08-13.md`). That system exists to encrypt **many different operators' per-guild adapter tokens and OAuth session tokens at rest in a single shared SQLite database** — a many-tenants-one-datastore threat model. The bot's own Discord Application credentials are the opposite shape: **one credential, read once at process startup**, never written to the database (`[R2]`, confirmed by the audit's DBA hat via direct grep of `database.js` and every caller of `config.discord.*` — zero matches), never shared across tenants. Wrapping a single startup-time credential in a KEK/DEK envelope would add real complexity (key provisioning, rotation-of-the-wrapper-key) to solve a problem this credential doesn't have. **Decision: keep using the existing `_FILE` convention. Do not introduce the age/KEK hierarchy for this credential.**

## 3. Rotation procedure (this *is* the rotation procedure, exercised for real right now)

**`[R2]` — the credential this document was originally scoped around was pasted into a chat session during planning and must be treated as compromised.** This is now tracked as a real incident, `compliance/evidence/incidents/2026-09-06-discord-bot-token-chat-exposure.md` (INC-01, per `compliance/runbooks/incident-response.md`) — not just mentioned in passing here. **The exposure determination is not hedged**: treat *both* the bot token and the client secret as compromised (the operator's report did not specify which value(s) were visible, and the audit's Security Architect hat flagged "rotate if it was exposed" as too permissive an instruction — rotate both, unconditionally, rather than leave that judgment call to whoever executes this).

1. **Contain (incident step 1)**: Discord Developer Portal → Application `1546203607807041697` → Reset Token, and reset the client secret too (see above — both, unconditionally). Do not paste either new value into a chat session to verify it worked.
2. `ssh acp-bot` → overwrite `/home/bot/arrakis-control-panel/secrets/discord-bot-token.txt` and `discord-client-secret.txt` with the new values (`0600`, `bot:bot` — matching existing permissions, no change needed there).
3. Update `/home/bot/arrakis-control-panel/.env`'s `DISCORD_CLIENT_ID` to `1546203607807041697`.
4. `sudo systemctl restart acp-bot.service`.
5. Confirm clean startup (`journalctl -u acp-bot.service`, no `readSecret` throw, gateway connects).
6. **Re-invite the bot to the Discord guild** under the new client ID. **`[R2]` — use the bot's own generated invite link, not a manually-built one.** The audit's Cloud Security hat found a real scope-parity gap: `/dune core setup`'s embed (`src/commands.js`'s `setupPayload()`) generates `https://discord.com/oauth2/authorize?client_id=<id>&scope=bot%20applications.commands` with no `permissions` parameter — this is the exact scope the *old* application was invited with (RBAC is enforced entirely in-app via Discord role IDs, not Discord permission bits, so `permissions=0` is correct and sufficient). **Do not use Discord Developer Portal's own OAuth2 URL Generator to hand-build an invite** — that flow lets an operator freely tick arbitrary permission checkboxes, which could silently over-grant (Elevation of Privilege) or under-grant (breaks a working feature) relative to what the old application had. Fetch the generated link from the new application's own `/dune core setup` output once step 5 confirms it's online, or construct it manually using the exact template above with the new `client_id` substituted if the command isn't reachable yet.
7. **`[R2]` — new, previously-missing step: re-register slash commands.** Discord slash commands are registered per-`client_id` via `Routes.applicationCommands()`/`applicationGuildCommands()` (`scripts/register-commands.js`) — this is a **separate resource from the gateway connection** and does **not** happen automatically on restart (`src/index.js` only calls `client.login()`; nothing in the restart path touches command registration). Run `npm run register` against the new `DISCORD_CLIENT_ID`/token **after** step 3's `.env` update and **before** step 8's live test — without this step, the new application has zero registered commands and step 8 will fail regardless of whether steps 1-6 succeeded. Check whether `DISCORD_GUILD_ID` is set on the VM: guild-scoped commands propagate instantly; global commands can take up to ~1 hour to appear, which changes what "no response yet" means in step 8.
8. **`[R2]` — live test, now fully specified rather than "run a command, confirm a response".** Run two commands in the real guild, not one, since a single trivial command can produce a false positive:
   - `/dune core about` or `/dune core help` (local-only logic, no external round-trip) — confirms the gateway connection and command registration are both live.
   - A command that exercises a real adapter/console round-trip *and* an RBAC-gated path (e.g. `/dune server status` for an admin-tier user) — confirms role/permission state re-established correctly after the re-invite, not just that the bot process is up. A false pass here (the first command works, this one silently 500s or times out) is exactly the "looks like it worked" scenario this step exists to catch.
   - Confirm the *old* token is actually dead, not just assumed reset: attempt (or have Discord's own Developer Portal confirm) that the old value no longer authenticates. **`[R2]`, per the audit's Cloud Security hat**: "Reset Token instantly invalidates the old value" is a platform assumption about Discord's own behavior, not something this document can verify independently — check the new bot user's Discord audit-log activity for the exposure window (token creation → Reset Token) to rule out misuse before treating the incident record as closed.
9. **Decommission the old application's standing access** (`[R2]`, new step): remove the old bot user (`1516816812006969494`) from the guild once the new one is confirmed working, so a still-valid old credential (if the Reset Token assumption in step 8 turns out wrong) isn't left with real guild access as a standing Spoofing/Elevation-of-Privilege vector.

If this credential ever needs rotating again in the future for an unrelated reason (suspected compromise, routine hygiene), the same 9 steps apply — this document doubles as that runbook, not just a one-time migration record.

### 3.1 Public-facing invite links (`[R2]`, new — closes a real HIGH finding)

Four files hardcode the *old* application's invite link and are not touched by any step above: `README.md:50`, `docs/admin-guide.md:35,42`, `docs/quick-start-guide.md:25`, `docs/installation-guide.md:29` (a fifth reference, `docs/DOMAIN-MIGRATION-ANALYSIS.md:147`, is already-superseded historical narrative about an unrelated domain move and is left as-is, matching this project's own convention of not rewriting accurate history). Without fixing these, the one guild this procedure directly tests will work — but any *new* operator following the shipped documentation invites the old, now-token-reset application, which no live process is running under. **Resolution: update all four files' hardcoded `client_id=1516816812006969494` to `1546203607807041697` in the same PR that implements this swap**, not as a deferred follow-up — this is a five-minute sed-and-verify fix, not a reason to delay.

## 4. Loss and recovery

**What happens if the token file is lost, corrupted, or the wrong value is written?** `readSecret()` throws at startup (`Missing required environment variable` or, for a present-but-empty file, `... points to an empty secret file.`) — the bot fails closed, does not start with a missing/blank credential. Recovery is identical to routine rotation (§3, steps 1-9): Discord tokens are always re-mintable from the Developer Portal on demand. **This is a materially lower-stakes loss scenario than the age identity key** documented elsewhere in this project (losing that permanently locks out already-encrypted data with no recovery path) — there is no "already-encrypted data" tied to this credential; resetting it in Discord and rewriting the file fully recovers the system with zero data loss.

## 5. What happens to the running bot during the swap (Requirement 7)

**`[R2]` — this section previously understated the real outage window; corrected here per two independent audit findings (Security Architect and UI/UX hats).** This is a full identity replacement — gateway connection and OAuth both move to the new application, not just OAuth, and it touches more than the Discord gateway:

- **The restart itself (§3 step 4)** drops the bot's gateway connection *and* its two HTTP servers — the setup portal (port 3100) and the Steam-link OAuth callback server (port 3101), both reachable through the live Cloudflare Tunnel. Anyone mid-flow on Steam-link, or the landing page's live-stats widget (`GET /api/live-stats`), sees a connection failure during this window, not just "slash commands unavailable." This restart itself is brief (on the order of seconds — confirmed graceful SIGTERM handling via `client.destroy()` in `src/index.js`, no `TimeoutStopSec` override that would extend it).
- **The real outage window is bounded by step 6 (manual re-invite) and step 7 (command re-registration), not by the restart.** Between a completed step 4 and a completed step 7, the bot has zero guild presence and zero working commands — an outage bounded by how quickly the operator completes two manual, Discord-UI-driven actions, not "seconds." **Explicit operator go-ahead is required before starting step 4**, and **`[R2]`, new guidance**: treat steps 4 through 8 as one uninterrupted session — do not start the restart and then step away before re-invite and command registration are both confirmed complete. Nothing in §6 monitors for an abandoned mid-procedure state (see §6's deferred item on this), so an interrupted session would leave the guild bot-less indefinitely with no automated detection.
- **`[R2]`, new guidance**: post a heads-up in the guild before starting, if there's an active channel for it — Discord's own failure mode for a cached slash command hitting a bot-less application is a generic, context-free "This interaction failed," which gives guild members no signal that a planned rebrand is in progress rather than an outage.

Roles/permissions for the new application inside the actual guild are addressed by §3 step 6's use of the bot's own generated invite link (guaranteed scope parity with the old application) rather than a manually-built one — this was previously an open question this document declined to guess at; it's now resolved by using the existing code path instead of leaving it to operator judgment.

## 6. Deferred items (none blocking, named for the record)

- **Wrapping this credential in the age/KEK hierarchy for defense-in-depth** — explicitly deferred, not needed now (see §2's reasoning). Owner: revisit only if this credential's threat model changes (e.g., if the bot ever needs to hold multiple Discord Application identities simultaneously, which is not a currently planned feature).
- **A monitoring/alert for unexpected gateway disconnect/reconnect cycles**, or for an abandoned mid-procedure state (§5) — not currently instrumented, would be a `mentat-observatory` addition, not this repo's. Not blocking this swap; owner: whoever next touches `mentat-observatory`'s cron checks.
- **A CHANGELOG entry for the Discord Application ID change itself** (`[R2]`, new — distinct from the already-planned Sahir Venn persona-copy entry) — add to `CHANGELOG.md`'s `[Unreleased]` section as part of the implementation PR, not deferred; noted here only because revision 1 of this document omitted it.
- **A cross-reference from `unified-age-secrets-management-l1-design-2026-08-13.md` back to this document's §2 decision** (`[R2]`, LOW, GRC hat) — a future reader of that document has no way to discover this credential class was deliberately evaluated and excluded from its hierarchy. Owner: add a one-line pointer to that document the next time it's touched for an unrelated reason; not worth a standalone PR for one sentence.
- **Scrubbing the exposed value from wherever it was pasted** (chat transcript, any local scrollback) as defense-in-depth alongside the Discord-side reset (`[R2]`, LOW, Cloud Security hat) — reasonable but low priority since rotation alone neutralizes the actual credential; left to the operator's own judgment on their client/transcript.

## 7. Verification checklist (ties §3's steps to explicit pass/fail, for whoever executes this)

- [ ] Old token/secret confirmed reset in Discord Developer Portal (both, unconditionally — §3.1)
- [ ] New secret files written to the existing `_FILE` paths on the VM, `0600 bot:bot`
- [ ] `.env`'s `DISCORD_CLIENT_ID` updated
- [ ] `acp-bot.service` restarted, clean `journalctl` output, no `readSecret` throw
- [ ] Bot re-invited using its own generated invite link (not a manually-built one) — §3.6
- [ ] `npm run register` run against the new identity — §3.7
- [ ] Both live-test commands pass (local-only + adapter/RBAC round-trip) — §3.8
- [ ] Old token's actual invalidation checked (not just assumed) — §3.8
- [ ] Old application's guild membership removed — §3.9
- [ ] Four public-facing invite-link references updated (§3.1) in the same PR
- [ ] CHANGELOG entry added for the Application ID change (§6)
- [ ] Incident record (`compliance/evidence/incidents/2026-09-06-discord-bot-token-chat-exposure.md`) updated with actual rotation/verification timestamps and closed

## 8. Eight-Hats Layer 1 audit — findings register and STRIDE table

Four parallel dispatches (8 hats total) against revision 1 of this document. All CRITICAL/HIGH findings resolved inline above (marked `[R2]`); MEDIUM/LOW resolved inline where cheap, otherwise deferred in §6 with a named owner.

| # | Hat(s) | Severity | Finding | STRIDE | Resolution |
|---|---|---|---|---|---|
| 1 | QA, Security Architect (independently, same root cause) | CRITICAL / HIGH | §3 omitted slash-command re-registration (`npm run register`) — new application would have zero commands after restart | Denial of Service | Added as explicit §3 step 7 |
| 2 | GRC | HIGH | Credential exposure not routed through the project's own INC-01 incident-response process | N/A | Created `compliance/evidence/incidents/2026-09-06-discord-bot-token-chat-exposure.md` |
| 3 | GRC, QA (independently) | HIGH | Four public docs hardcode the old application's invite link, unaddressed by the original scope | N/A (borders Spoofing if old app stays live) | New §3.1, fixed in the same implementation PR, not deferred |
| 4 | QA | HIGH | Live-test step had no named command, no success criterion, no check that the old token is actually dead | Spoofing | §3 step 8 rewritten with two named commands and an explicit old-token-dead check |
| 5 | Security Architect | HIGH | §5 understated the real outage window as "seconds"; actual window is bounded by manual re-invite + command registration | Denial of Service | §5 rewritten |
| 6 | Cloud Security | HIGH | No instruction to use the bot's own scope-matched invite link for re-invite; manual Developer Portal invite risks over/under-scoping | Elevation of Privilege / Denial of Service | §3 step 6 now mandates the bot-generated link |
| 7 | Architect | MEDIUM | Missing concrete re-invite URL/scope baseline in the runbook itself | N/A | Subsumed by finding 6's resolution |
| 8 | GRC | MEDIUM | No CHANGELOG entry planned for the Application ID change itself | N/A | Added to §6, required in implementation PR |
| 9 | UI/UX | MEDIUM | No guild-facing symptom/communication plan for the outage window | N/A | §5 now recommends a guild heads-up |
| 10 | UI/UX | MEDIUM | No "steps 4-8 must be one uninterrupted session" safeguard | N/A (availability-shaped) | §5 now states this explicitly |
| 11 | Security Architect | MEDIUM | Client-secret exposure determination was hedged ("if it was exposed") rather than verified | Information Disclosure / Spoofing | §3 now treats both credentials as compromised, unconditionally |
| 12 | GRC | LOW | No back-reference from the KEK/DEK design doc to this document's decision | N/A | Deferred, §6, owner named |
| 13 | Security Architect | LOW | No decommissioning step for the old application's credentials/guild membership | Spoofing / Elevation of Privilege | Added as §3 step 9 |
| 14 | Cloud Security | MEDIUM | "Reset Token instantly invalidates" is an unverified platform assumption | N/A | §3 step 8 now requires an audit-log check, not just trust |
| 15 | Cloud Security | LOW | No mention of scrubbing the exposed value from wherever it was pasted | N/A | Deferred, §6 |
| 16 | Network | LOW | Outage blast radius understated (setup portal/Steam-link HTTP servers also drop, not just gateway) | N/A | §5 now mentions both |
| 17 | Network | LOW/informational | Outage duration estimate plausible but not certain | N/A | No change needed, noted as acceptable |
| 18 | DBA | N/A (confirmed sound) | Verified: no code path persists these credentials to the database | N/A | No finding — confirms §2's claim |
| 19 | Architect, Security Architect | N/A (confirmed sound) | Storage-mechanism reasoning (§2) and no `.env`/restart race both verified against real code, not just asserted | N/A | No finding — confirms document's own claims |
