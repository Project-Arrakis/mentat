# Write Command Reconciliation — Wiring mentat to Core's Real Write Bridge

**Date:** 2026-09-22
**Status:** Layer 1 Design — approved for planning (2026-09-22); implementation plan next

## 1. Background

`dune-awakening-selfhost-docker`#215 (Core's Discord write bridge) is now implemented: `write/preview` and `write/execute` on Core, backed by a real Unix-socket Hop B loopback to Core's own 25 real player/base/server/map/carepackage/guild mutation routes (`WRITE_ACTION_ROUTES`). See PR #1026 on that repo.

`mentat` (this bot) has never called these routes. Its own `WRITE_COMMANDS` scaffold (`src/writeHandler.js`, 12 entries) was built independently, earlier, against a different, speculative action vocabulary (`maintenance:*`, `notifications:*`, `schedule:*`, `operations:*`) and has always returned a stub "scaffolded, awaiting upstream contract" response — `docs/upstream-write-adapter-rfc.md` explicitly blocks real implementation "until upstream publishes and approves a write-capable adapter contract."

**This design records the decision to proceed anyway** (explicit operator decision, 2026-09-22) and reconciles the two catalogs:

- **8 of 12** existing `WRITE_COMMANDS` entries (`maintenance:set-note`, `maintenance:set-window`, `notifications:set-alert-channel`, `notifications:set-threshold`, `notifications:set-digest-schedule`, `schedule:set-post-schedule`, `schedule:add-channel`, `schedule:remove-channel`) have **no real backing feature anywhere** — verified directly: Core's own `commandCatalog.js` already documents that its "maintenance" route doesn't store/read a note at all, and mentat's `alertChannelId` is still a bare env var, never a settable value. **Deferred** — left as-is (still returning the stub), not touched by this design.
- **1** (`operations:restart-service`) maps **exactly** to Core's real `server.restart-service` action.
- **2** (`operations:create-backup`, `operations:trigger-update` for `type: game`/`type: steamcmd`) map to real Core routes that exist but were never added to `WRITE_ACTION_ROUTES`. **In scope** — added to Core's table as part of this work.
- **1** (`operations:clear-cache`) has no matching Core route (`/api/server/storage/cleanup-build-cache` is Docker build-cache, an unrelated concept to the "steam/maps/derived" types this action describes). **Deferred**.
- `operations:trigger-update`'s `type: self` sub-case (bot self-update) originally had no existing mentat-local trigger mechanism — now **in scope** as its own separate command, `/write bot self-update` (§4a), reusing the existing git-push deploy pipeline's safety guardrails rather than reimplementing them.
- **21** of Core's 25 real, audited actions have **no** mentat command today. **In scope** — new slash commands for all of them.

**Net new scope: 22 real write actions** get real mentat commands (21 Core moderation actions + `restart-service`), plus **2 new Core-side actions** (`backup.create`, and a game/steamcmd update pair) get added to `WRITE_ACTION_ROUTES` to back `operations:create-backup`/`operations:trigger-update`.

## 2. Core-side addition (small, mechanical)

Three new `WRITE_ACTION_ROUTES` entries, following the table's existing pattern exactly (no new mechanism):

| Action | Method | Path | IAM action | Tier | Confirm phrase |
|---|---|---|---|---|---|
| `backup.create` | POST | `/api/backups/create` | `backups:create` | owner | none (matches `task()`'s existing no-confirmation precedent for `server.restart`/`stop`/`start`) |
| `updates.apply-game` | POST | `/api/updates/apply-game` | `updates:apply` | owner | none |
| `updates.fix-steamcmd` | POST | `/api/updates/fix-steamcmd` | `updates:fix` | owner | none |

`WRITE_ACTION_MIN_TIER` gets the same three entries at `owner` (matching mentat's own existing tier judgment for these actions, and Core's own convention for irreversible/high-blast-radius server operations). This is a small, mechanical addition to an already-audited table — still gets its own scoped Layer 2 review (not a full 8-hat round) before merging, per this project's "shift audits left" discipline, since any change to this table is security-relevant by construction.

## 3. mentat-side: replace the stub with real calls

`writeHandler.js`'s `handleWriteCommand` keeps its existing shape (`WRITE_COMMANDS` lookup, `canWrite()` tier check) — only the confirmation completion logic changes:

**Today:** `createPendingConfirmation()` builds a generic risk-message embed; confirming it just reports the "pending-upstream" stub, never calling Core.

**New:** on command invocation (after `canWrite()` passes), call `adapterClient.writePreview(actor, { action, params })` immediately. Core validates capability/tier/params server-side and returns `{ nonce, expiresAt, preview: { action, confirmPhrase } }` or a real rejection. Build the Discord confirm button from *that real response* — the actual action and a real, rendered expiry indicator (a Discord relative timestamp, `<t:<unix-seconds>:R>`, computed from `expiresAt` — **corrected after Layer 1 audit, UI/UX hat HIGH finding: the original design only stated this as an intent; the real, existing `buildConfirmationEmbed()` function doesn't accept or render `expiresAt` at all, so the promised countdown would have silently never appeared. `buildConfirmationEmbed` must be extended to accept `expiresAt` and add a field rendering that timestamp**), not a generic risk/tier sentence. On button click, call `adapterClient.writeExecute(actor, { nonce, action })`.

**`server.stop`'s dual-confirmation is a distinct third state**, not success/failure: a 202 `second_confirmation_required` response means the *first* admin's click succeeded but a *second, different* admin must independently run the same confirm step (same nonce). The bot must show this as its own state ("waiting on a second admin") and let a second admin's click on the same message complete it — clicking the button a second time as the *same* admin must be rejected client-side too (mirroring Core's own `second_confirmation_same_actor` check) rather than relying solely on Core's 403.

**Visibility, corrected after Layer 1 audit (UI/UX hat, CRITICAL finding): this bot defaults to ephemeral replies (`config.discord.defaultEphemeral` defaults to `true`) for every `/dune` command, including write confirmations.** An ephemeral message is visible only to the user who triggered it — under the default configuration, the *entire dual-confirmation mechanism was unusable*: the first admin's "waiting on a second administrator" message would never be visible to any other admin, so no second admin could ever see or click it. **Fix:** any action with `requiresDualConfirmation: true` (currently only `server.stop`) is replied to with `ephemeral: false` unconditionally, overriding the configured default — a genuinely public, high-visibility message is the entire point of a control that requires a second, different human. This is a deliberate, per-action override, not a global default change; every other write command keeps the operator's configured ephemeral default.

**Discoverability, corrected after Layer 1 audit (UI/UX hat, HIGH finding):** making the waiting-state message non-ephemeral means it's visible in the channel it was posted to, but a second admin who wasn't watching that channel still has no signal a stop is pending. The waiting-state embed's description explicitly names the required second confirmer's tier and instructs them to run `/dune server stop` themselves (not merely "click the button" — a second admin arriving later needs to be able to independently discover the pending action even if the original message has scrolled out of view or Discord's message history is deep); the confirm button on that message remains a shortcut for whoever is already looking at it.

**Confirmation-state lifecycle, corrected after Layer 1 audit (Architect hat, HIGH finding: real and self-update confirmations, unlike the original stub flow, were never given an expiry timer, so an unclicked one sits in memory forever):** every entry in the shared `pendingConfirmations` map — real Core-backed, self-update, and the untouched legacy stub entries alike — is given a discriminant `kind` field (`"legacy" | "real" | "self-update"`) and a scheduled cleanup at `expiresAt`, matching the legacy flow's own existing `setTimeout`-based pattern (the legacy flow already does this correctly; the real/self-update paths must not diverge from it).

**Confirm-button `customId` parsing, corrected after Layer 1 audit (Security Architect + QA hats, MEDIUM finding): the existing handler splits `customId` on every colon (`customId.split(":")`) and destructures positionally, silently truncating any key containing its own colon** (the self-update path already avoids this by using a colon-free `randomUUID()`, but Core's own real nonce format was never verified colon-free, and relying on that as a permanent, unstated assumption is fragile). **Fix:** parse with a fixed split limit (`customId.split(":", 3)` is insufficient in JS — `String.prototype.split`'s `limit` argument *discards* everything after the limit is reached rather than leaving the remainder joined, so the correct fix is `customId.indexOf(":")` twice to find the first two separators and take everything after the second one as the key, verbatim, regardless of any colons it contains). This makes the parsing correct by construction for any nonce format Core could ever produce, rather than depending on Core never choosing one that collides with this bot's own delimiter choice.

**Audit trail, corrected after Layer 1 audit (GRC hat, HIGH finding — Repudiation: neither the original design nor the plan called the codebase's own established `writeAuditEvent()` anywhere):** every write command's real outcome — the preview call's result, the execute call's result (success, a mapped error, or the dual-confirmation waiting state), and self-update's trigger/outcome (see §4a) — is recorded via `writeAuditEvent()` (`src/writes.js`, the same function `broadcast.js` and the legacy `writeHandler.js` stub already call). This is mentat's own, independent audit trail — complementary to, not a duplicate of, Core's own server-side audit log for the same mutation (the two systems have no shared storage; each needs its own record of what it did/observed). Every real Core action already gets Core-side attribution (issue #215's own `principalOf()`/`req.authSession` chain); mentat's own `writeAuditEvent()` calls are the only record of "which Discord interaction triggered this" from the bot's own side, independent of whether Core's own log is ever consulted.

**Self-update's interaction with other admins' pending confirmations, stated explicitly (Layer 1 audit, DBA hat, HIGH finding):** because self-update restarts the process holding this same in-memory map, any *other* admin's in-flight confirmation (of any kind — a real Core action or a dual-confirmation `server.stop` waiting on a second admin) is destroyed along with it. This is an accepted, fail-closed risk (the affected admin sees "confirmation expired," not a wrong or duplicated mutation, and must re-run their command) — but it must be surfaced, not silent: `runSelfUpdate()` checks `pendingConfirmationCount()` at trigger time and, if non-zero, includes an explicit warning in its confirmation prompt ("N other pending confirmation(s) will be lost") before the host operator confirms.

**Error mapping** (every code `write/preview`/`write/execute` can return, mapped to a specific Discord message, not a generic failure):

| Core code | HTTP | mentat message |
|---|---|---|
| `writes_disabled` | 403 | "Write commands are disabled on this console." |
| `not_authorized` | 403 | "You don't have permission for this action." (tier-specific wording, matching today's `canWrite()` messages) |
| `unknown_write_action` | 400 | "This command isn't available on the connected Core instance yet." |
| `invalid_parameters` | 400 | show the specific parameter problem — see the sanitization note below |
| `nonce_not_found` | 410 | "This confirmation expired. Please run the command again." |
| `nonce_actor_mismatch` | 403 | "This confirmation wasn't issued to you." |
| `nonce_action_mismatch` | 409 | (should not occur from the bot's own flow — treat as an internal-error fallback) |
| `second_confirmation_required` | 202 | the dual-confirmation waiting state above |
| `second_confirmation_same_actor` | 403 | "A different administrator must provide the second confirmation." |
| `stale_actor_signature` / `invalid_actor_signature` | 403 | "Your role info expired. Please run the command again." |
| `write_backend_unavailable` | 503 | "The write backend is temporarily unavailable. Try again shortly." |

**Sanitization, corrected after Layer 1 audit (Security Architect hat, HIGH finding):** the fallback branch (an error code this table doesn't recognize) forwards Core's raw error string verbatim. Since every write-confirmation reply (per the visibility rule above, excluding `server.stop`) is ephemeral by default — visible only to the invoking admin, who is by construction already tier-authorized for this specific action — this is judged an acceptable disclosure boundary as designed (an admin seeing raw diagnostic detail about their *own* rejected action is not a cross-user leak). This judgment is stated explicitly here rather than left implicit, and does not apply to `server.stop`'s forced-public replies — the error-mapping table's own named codes are used for every state `server.stop` can reach, so its public messages never hit the raw-fallback branch.

## 4. The 22 commands

**Revised after Layer 1 audit (2026-09-22, round 1 — CRITICAL, Architect hat): the original design proposed 8 brand-new top-level subcommand groups (`player`, `base`, `server`, `map`, `carepackage`, `guild`, `operations`, `bot`), but `commands.js` already has real, live top-level groups named `player` and `server`** (read commands, not write: `link`/`verify`/`characters`/`enable`/`disable`/`default`/`unlink`/`faction`/`whoami`/`inventory`/`storage`/`find` under `player`; `health`/`status`/`summary`/`readiness`/`services`/`maintenance`/`coriolis`/`atlas` under `server`). Discord's command registration is one atomic bulk overwrite — two same-named sibling groups in the same payload would either be rejected outright or silently corrupt the live command tree for the *entire* bot, not just the new commands. Separately, even without that collision, `executeDuneCommand`'s dispatch only special-cases `group === "write"` — none of these new group names would ever reach `handleWriteCommand` at all, leaving every new command "Unknown command."

**Fix, both parts:**
1. **`player` and `server`'s new write subcommands are merged into the existing groups**, not registered as colliding siblings — `/dune player kick`, `/dune server stop`, etc. sit alongside the existing read subcommands in the same two groups. Verified no subcommand-name collision: none of the new names (`kick`/`ban`/`unban`/`warn`/`give-item`/`clear-backpack`/`fill-water` for `player`; `restart`/`stop`/`start`/`restart-service` for `server`) match any existing subcommand in either group.
2. **`base`, `map`, `carepackage`, `guild`, `operations`, `bot` are genuinely new groups** (no existing group uses these names) — these register as new top-level siblings exactly as originally described.
3. **Dispatch is fixed by checking the shared `writeActions.js` table directly, not by hardcoding which group names are "write-capable"**: `executeDuneCommand` gains one new branch, checked before the final "Unknown command" fallback, that looks up `findWriteAction(group, subcommand)` regardless of whether that `group` is a brand-new group or an existing one being extended. This handles both cases (merged-into-existing and genuinely-new groups) uniformly, and means a future write action added to an existing group needs no new dispatch code at all.

Grouped below by Core's existing namespacing (which command group each lives under, per the fix above). Path params (`playerId`/`baseId`/`guildId`) are exact, already-verified Discord command options; body params are specified at the level already verified against each real target route handler, with implementation-time verification flagged where noted.

### Group: player (7)
| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write player kick` | `player.kick` | admin | — | `playerId`, `reason` (forwarded to the real route body) |
| `/write player ban` | `player.ban` | admin | BAN PLAYER | `playerId`, `reason` |
| `/write player unban` | `player.unban` | admin | — | `playerId` |
| `/write player warn` | `player.warn` | moderator | — | `message` (maps to real `mapChatRoute`'s `body`/`mapName`/`dimension` — this is a map-wide chat broadcast, not a DM to one player; command copy must say so) |
| `/write player give-item` | `player.give-item` | owner | — | `playerId`, `itemName` or `itemId`, `quantity` (exact shape verified during implementation against `giveSingleItemRoute`) |
| `/write player clear-backpack` | `player.clear-backpack` | owner | CLEAN INVENTORY | `playerId` |
| `/write player fill-water` | `player.fill-water` | admin | — | `playerId` |

### Group: base (2)
| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write base refill-generators` | `base.refill-generators` | admin | — | `baseId` |
| `/write base refill-water` | `base.refill-water` | admin | — | `baseId` |

### Group: server (4, includes the one exact existing match)
| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write server restart` | `server.restart` | owner | — | none |
| `/write server stop` | `server.stop` | owner | — | none — dual-confirmation, see §3 |
| `/write server start` | `server.start` | admin | — | none |
| `/write server restart-service` | `server.restart-service` | admin | — | `service` (gateway/survival-1/overmap — reuses mentat's own existing `operations:restart-service` param values, already correct) |

### Group: map (4)
| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write map spawn` | `map.spawn` | admin | SPAWN MAP | `mapName`, `preset` (exact shape verified during implementation against `buildDuneArgs("mapsSpawn", ...)`) |
| `/write map despawn` | `map.despawn` | admin | DESPAWN MAP | `mapName` |
| `/write map respawn` | `map.respawn` | admin | RESTART MAP | `mapName` |
| `/write map teleport` | `map.teleport` | admin | — | `playerId`, `x`, `y`, `z`, `yaw` (verified exactly against `liveMapTeleportPlayerRoute`) |

### Group: carepackage (6)
| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write carepackage grant` | `carepackage.grant` | admin | GRANT CARE PACKAGE | `playerId` |
| `/write carepackage grant-all` | `carepackage.grant-all` | owner | GRANT CARE PACKAGE TO ELIGIBLE PLAYERS | none |
| `/write carepackage enable` | `carepackage.enable` | admin | ENABLE CARE PACKAGE | none |
| `/write carepackage disable` | `carepackage.disable` | admin | DISABLE CARE PACKAGE | none |
| `/write carepackage scan` | `carepackage.scan` | admin | RUN CARE PACKAGE SCAN | none |
| `/write carepackage history-clear` | `carepackage.history-clear` | owner | CLEAR GRANT HISTORY | none |

### Group: guild (2)
| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write guild add` | `guild.add` | admin | — | `guildId`, `playerId`, `roleId` (verified against `guildAddMemberRoute`) |
| `/write guild remove` | `guild.remove` | admin | — | `guildId`, `playerId` |

### Group: operations (2 backed by new Core actions)

`operations:restart-service` is **removed** from `WRITE_COMMANDS`, not kept as a second command — `/write server restart-service` (§4 Group: server) already covers this exact action; shipping two command names for one action is a real, avoidable source of confusion, not a feature.

| Command | Core action | Tier | Confirm | Params |
|---|---|---|---|---|
| `/write operations create-backup` | `backup.create` (new) | owner | — | none. Core's real `/api/backups/create` route (`task(req, res, "backup", "backupCreate", {})`) hardcodes an empty payload today and ignores any body field — `label` is dropped from this command for v1 rather than silently discarded or requiring an unplanned Core route change beyond the 3 additions already scoped in §2. |
| `/write operations trigger-update` | `updates.apply-game` or `updates.fix-steamcmd` (new), selected by `type` | owner | — | `type` (game/steamcmd only — bot self-update is its own separate command, §4a) |

## 4a. Bot self-update — `/write bot self-update` (new, bot-local, no Core call)

**Decision (2026-09-22, operator override):** originally deferred (no mechanism existed), now in scope. This is architecturally distinct from every other command in this design — it never calls Core's write bridge at all. It triggers the bot's own existing git-push deploy pipeline (`scripts/deploy-post-receive.sh`) on demand, without requiring a new `git push`.

**Revised after Layer 1 audit (2026-09-22, round 1 — 4 CRITICAL findings, all in this section or caused by it): the original design authorized this purely by `canWrite()`'s generic per-guild "owner" tier, exactly like every other command.** That is wrong for this one action specifically, and the audit's Security Architect and Cloud Security hats both independently caught it: `mentat` is a real, shipped **multi-tenant** deployment (`config.multiTenant`, `src/writes.js`) — one bot *process* serves multiple, independent Discord guilds, each with its own "owner" (that guild's real Discord server owner). Every other command's "owner" tier check is correctly scoped, because every other command's blast radius is that one guild's own Core instance. `bot.self-update` is categorically different: it restarts the **one shared process** serving *every* tenant. Under the original design, any tenant's guild owner — including a small, low-trust guild the operator barely pays attention to — could force a host-wide restart affecting every other tenant's bot availability. This is a real Elevation-of-Privilege/Denial-of-Service finding, not a hypothetical.

**Fix: self-update is gated by a single, explicit, host-configured identity — never by any guild's ownership.** A new env var, `DUNE_BOT_OPERATOR_DISCORD_USER_ID` (`config.discord.botOperatorUserId`), holds the Discord user ID of whoever actually operates this bot's host (in practice, the same person who holds the git-push deploy SSH key today — see the trust-model note below). `handleWriteCommand` checks `interaction.user?.id === config.discord.botOperatorUserId` for this one action, **not** `canWrite()`/`def.tier` at all — the action's `tier` field in `writeActions.js` is set to a sentinel (`tier: "host-operator"`) that `canWrite()` never grants to anyone, so a bug that accidentally routed this action through the generic tier check fails closed (rejected for everyone) rather than failing open. If `DUNE_BOT_OPERATOR_DISCORD_USER_ID` is unset, self-update is unconditionally disabled — matching this project's own established "fail closed absent explicit config" pattern (e.g. `ATRIUM_ALLOWED_USER_ID` on Core).

**Trust-model consequence, stated explicitly (Cloud Security hat finding):** this narrows, rather than widens, who can trigger the underlying `sudo systemctl restart <service>` via Discord — from "any tenant's guild owner" down to exactly one operator-configured Discord user ID. It is still a **new** way to reach that same privileged restart, alongside the pre-existing SSH-key-gated `git push deploy deploy` path. Both paths now require the operator's own explicit action (setting the env var to their own Discord user ID, or holding the SSH key) — there is no longer an implicit, per-tenant-widened trust boundary. An operator who wants self-update disabled entirely simply never sets the env var.

**No typed confirmation phrase (simplified during plan self-review):** an earlier draft of this section proposed a typed `"RESTART BOT"` phrase on top of the identity check, matching this codebase's other high-risk-action precedents (`CLEAN INVENTORY`, `BAN PLAYER`). Dropped — those precedents are typed phrases because they're the *only* gate beyond a shared tier check available to potentially many people; here, the host-operator identity check already narrows execution to exactly one specific person, and the confirm-button click (§3) already requires a second, deliberate action from that same person. A typed phrase would need a Discord modal (a different interaction type than every other command's button flow) for marginal benefit over what the identity check already provides. Dual-*person* confirmation (matching `server.stop`) is also deliberately not required, for the same reason: since exactly one person can ever pass the identity check, requiring a second, different confirmer is structurally impossible, not merely undesirable.

**Why reuse the deploy pipeline instead of a new implementation:** `deploy-post-receive.sh` already has reviewed, production-proven safety guardrails — refuses on a dirty working tree, runs the real test suite and aborts on any failure, verifies required files exist, conditionally re-registers Discord slash commands, restarts `acp-bot.service`, then runs a post-restart security smoke test. A new, separate "self-update" implementation would either duplicate all of this (drift risk — two copies of the same safety logic going out of sync, the exact bug class this project has already been bitten by) or, worse, skip it entirely (shipping a broken deploy straight to the live bot with no test gate).

**Design:** extract the test-gate/required-files/npm-install/restart steps of `deploy-post-receive.sh` into a shared script, `scripts/lib/deploy-core.sh`, parameterized by `WORK_DIR`/`SERVICE_NAME` (already variables in the script today). `deploy-post-receive.sh` is refactored to source and call it — no behavior change to the existing git-push deploy path, verified by keeping `test/deploy-hook.bats` green throughout. **Corrected (Security Architect hat, design/implementation mismatch finding):** the new `scripts/self-update.sh` does **not** fetch or reset from the deploy remote — only `deploy-post-receive.sh`'s own git-push-triggered path does that. Self-update replays the test-gate/install/restart sequence against whatever is *already checked out* at `WORK_DIR`; it cannot invent code to deploy that isn't already sitting there. In practice this means self-update is useful specifically when a prior `git push deploy deploy` landed but didn't result in a running restart (e.g., that push's own test gate failed, was fixed with a *second* push, and the operator wants to retry the restart without waiting for infrastructure to notice) — the command's own Discord description states this precisely, so an operator doesn't mistake it for "check for and pull new code."

**Concurrency guard (DBA hat finding):** a lock file (`runtime/deploy.lock`, created with `set -o noclobber` / `mkdir` as an atomic lock primitive, removed on exit via a `trap`) is acquired by `deploy_core::sync_test_install_restart` itself, so a concurrent `git push deploy deploy` and `/write bot self-update` (or two self-update triggers in a row) cannot interleave against the same `WORK_DIR`. The second caller fails fast with "a deploy is already in progress" rather than racing `npm install`/`systemctl restart` against the first.

**Audit trail (GRC hat finding):** every self-update trigger, and its outcome (test-gate pass/fail, restart success/failure), is recorded via the existing `writeAuditEvent()` (`src/writes.js`) — called once when the command is invoked (before spawning) and does not depend on the spawned script surviving to report the outcome back to Discord (see below); the *trigger* record exists in the bot's own audit log regardless of what happens afterward. This closes the one action in this whole design that previously had zero structured audit trail.

**How the bot invokes it, safely:**
- Gated by the host-operator identity check + typed confirmation phrase above, never by `canWrite()`.
- Goes through the same generic confirm-button UI as every other write command for UX consistency, but its "execute" step calls a new local function, `runSelfUpdate()`, never `adapterClient.writeExecute()` — there is no Core action name for this.
- `runSelfUpdate()` spawns `scripts/self-update.sh` via `child_process.spawn` with an **argument array**, never a template-interpolated shell string. **Corrected (Security Architect / Cloud Security hats, Requirement 24 finding):** the Discord interaction's webhook token is passed via the child's **environment** (`env: { ...process.env, DISCORD_WEBHOOK_URL: ... }`), never as a `argv` element — an `argv`-passed secret is visible to any local process via `ps auxww`/`/proc/<pid>/cmdline` for the child's lifetime, while an env var is only visible via `/proc/<pid>/environ`, which requires owning the process or root (this codebase's own established `_FILE`/env-var convention for exactly this class of problem, e.g. `MENTAT_PROXY_SHARED_SECRET_FILE`).
- Spawned **detached** (`{ detached: true, stdio: ["ignore", logFd, logFd] }`, then `.unref()`).
- **Reporting back has two independent layers, not one (Network hat finding: a plain `detached: true` child is very likely still in `acp-bot.service`'s systemd cgroup, and `KillMode=control-group` — systemd's default — would kill the reporting script in the same signal that kills the process it's restarting, silently breaking the single-webhook-report design for the fast, successful case, not just the slow 15-minute-timeout case the original design worried about):**
  1. The interaction is replied to immediately ("Self-update started...") *before* spawning.
  2. `scripts/self-update.sh` is invoked via `systemd-run --uid=$(id -u) --scope` (verified against the real host's systemd version before implementation — falls back to plain `spawn` with a loud warning in the self-update log if `systemd-run` is unavailable, since a missing escape mechanism must not silently look like a working one) so it runs in its **own** transient scope unit, outside `acp-bot.service`'s cgroup — surviving the restart signal that kills the bot process.
  3. As a second, independent layer (not a replacement): the **new** bot process, on its own startup, checks for a marker file (`runtime/self-update-pending.json`, written by `self-update.sh` before it triggers the restart, containing the webhook URL and a timestamp) and — if found and less than 15 minutes old — posts the "self-update complete, now running commit `<sha>`" follow-up itself, then deletes the marker. This means the *new*, definitely-alive process is what actually confirms success in the common case, and the shell script's own webhook post (layer 2) is redundant-but-harmless backup for the fast local case where it does survive.
  - If the marker is present but >15 minutes old on the new process's startup (the webhook token has expired), the new process logs it and does not attempt the follow-up (Discord would reject it) — the operator would need to check the bot's own status/audit log, which the trigger-time `writeAuditEvent()` above already provides.
- If the test gate fails, the script must NOT restart the service — the bot keeps running on its current, known-good code, and the failure (including the actual test output) is what gets posted back (from the still-alive original process, since no restart happened).
- **No automatic rollback exists for a failure that only manifests after a successful restart** (a dependency install succeeds and passes the pre-restart test suite, but breaks something only exercised live) — this is a pre-existing limitation of `deploy-post-receive.sh` too, not new to self-update, but is now stated here explicitly as an accepted risk rather than left implicit: recovery in that case is a second, corrective `git push`/self-update, or manual intervention on the host.
- `runtime/self-update-<timestamp>.log` files are not automatically rotated or deleted — a known, accepted, low-severity operational gap (DBA hat finding) given this command's low expected invocation frequency; a future session may add retention if it becomes a real problem.

## 5. Explicitly deferred (not touched by this design)

- `maintenance:set-note`, `maintenance:set-window`, `notifications:set-alert-channel`, `notifications:set-threshold`, `notifications:set-digest-schedule`, `schedule:set-post-schedule`, `schedule:add-channel`, `schedule:remove-channel` — no real backing feature anywhere; left returning today's stub.
- `operations:clear-cache` — no matching Core route.

`docs/upstream-write-adapter-rfc.md`'s Status section gets updated in the same PR to record that its "do not implement" gate was explicitly overridden by the operator for the scope above, while the deferred items remain genuinely blocked pending their own future design work (not the upstream-contract question this RFC was originally about).

**Corrected after Layer 1 audit (GRC hat, HIGH finding): the RFC is not the only governing document blocking this work.** `docs/r1-r2-release-roadmap.md` is a second, more specific, **test-enforced** gate (`test/r1R2ReleaseRoadmap.test.js` asserts its text is unchanged) whose R2 Entry Criteria explicitly require "upstream publishes and approves a write-capable Discord adapter contract," "a GitHub issue exists for each write command family," and "a fresh STRIDE and abuse-case review is recorded" — none met — and whose "Blocked from early R2.x" list names **"service restart as the first write command"** and **"player moderation"** by name, i.e. exactly what this design ships first. Leaving this document unchanged (as the original design did) would let a permanent regression test keep passing green after this ships, giving false assurance that the gate is intact when it has, in fact, also been overridden. **Fix:** `docs/r1-r2-release-roadmap.md` gets the same kind of explicit, dated override note as the RFC, in the same PR, and `test/r1R2ReleaseRoadmap.test.js` is updated alongside it (not deleted — its job of catching *unintentional* drift in this doc remains valuable; it should keep asserting the *post-override* text stays consistent, not the pre-override text forever).

**Also corrected (GRC hat, HIGH finding): `src/writeConfirmation.js`'s own module-header comment makes a direct, in-file factual claim that becomes false the moment this design ships** ("confirming a write action here NEVER calls `adapterClient.writePreview()` or `adapterClient.writeExecute()`... Do not wire [them] into this module until the project's R2 entry criteria are met"). This exact file is the one being rewired. Its header must be corrected in the same change that rewires it, not left as a stale claim sitting beside the code that contradicts it.

**Also corrected (GRC hat, MEDIUM finding): the override decision itself needs a durable, findable record beyond this document's own prose.** A GitHub issue on `mentat` tracks this decision (title referencing the override, labeled `security`, linking this design doc and the eventual PR) — satisfying both Requirement 15's general "every scope decision gets a real issue" norm and the roadmap's own R2 Entry Criterion #7 ("a GitHub issue exists for each write command family").

## 6. Testing

- Real, live tests per command group (matching Core's own "real, not mocked" standard established in #1026): a real Discord.js interaction mock, a real `adapterClient` pointed at a real HTTP server standing in for Core's write/preview+write/execute (not a hand-wavy mock — asserting the actual request shape sent, not just that a return value threads through).
- One dedicated test proving the `server.stop` dual-confirmation UX state machine end-to-end (first click → waiting state, posted non-ephemeral → second, different admin's click → success; same admin's second click → rejected client-side) — including an explicit assertion that the waiting-state reply is NOT ephemeral (Layer 1 audit, UI/UX hat CRITICAL finding — this property must be asserted directly, not inferred from message content).
- One dedicated test per error-mapping table row (§3) — all 10 real codes, not a subset (Layer 1 audit, QA hat finding: the original plan only covered 8 of 10).
- At least one test proving a non-string param (`type: "integer"` or `"number"`) is read via the correct `interaction.options` accessor, not just the string-typed params every other proposed test happened to cover (Layer 1 audit, QA hat HIGH finding).
- The 3 new Core-side actions get their own scoped Layer 2 review before merging (§2).
- `scripts/lib/deploy-core.sh`'s extraction is verified by keeping the existing `test/deploy-hook.bats` suite green throughout (proves the refactor changed nothing about the real git-push deploy path's behavior), plus new bats coverage for `scripts/self-update.sh` that genuinely observes restart behavior (stubbed `sudo`/`systemctl` asserted called zero times on test-gate failure, at least once on success — **corrected after Layer 1 audit, QA hat CRITICAL finding: the original plan's proposed tests both passed `--skip-restart`, meaning neither test could ever observe whether the restart call happened at all, the exact tautology this project's own history keeps finding**). The Node-side `runSelfUpdate()` spawn/reply logic gets its own test with a fake `child_process.spawn` proving detached invocation, the argument-array (never string-interpolated) call shape, and that the webhook URL is passed via `env`, never `argv` (Layer 1 audit, Security/Cloud-Security hats).
- Before Task 3's `writeActions.js` table is considered validated, its own test suite must actually be run once and pass against the literal table it's meant to gate — the original plan's own two headline tests (entry count, action-name set) were both wrong against the very code block in the same task (an off-by-one count, and an assertion that doesn't account for `trigger-update`'s `action: null`/`resolveAction` shape) — evidence the plan was never dry-run (Layer 1 audit, QA hat CRITICAL finding). Whoever executes Task 3 must run the tests and see them pass against the real table before moving to Task 4, not assume the plan's own proposed test code is already correct.

## 7. Rollout

No schema changes. `DUNE_DISCORD_WRITES_ENABLED` remains the single kill switch on both sides (already true today). `DUNE_BOT_OPERATOR_DISCORD_USER_ID` (§4a) is a new, optional env var — self-update is disabled by default until an operator sets it. This ships as a normal PR on `mentat` (depending on Core's PR #1026 merging first for the write-bridge routes to exist, and a small follow-up Core PR for the 3 new `WRITE_ACTION_ROUTES` entries) plus the RFC and roadmap status updates and the tracked GitHub issue above.

**Corrected after Layer 1 audit (GRC + Architect hats, MEDIUM finding): a re-verification gate is added before this PR leaves draft, not left implicit.** Because 22 of `writeActions.js`'s 27 entries are frozen against Core's still-unmerged `issue/215-write-bridge` branch, and Core validates tier/params server-side regardless (so a drift here would produce a misleading Discord UI, not a security bypass) — the PR-ready checklist includes: re-diff `writeActions.js` against Core's then-current `WRITE_ACTION_ROUTES`/`WRITE_ACTION_MIN_TIER` on the branch that will actually be merged, and re-run this table's own consistency tests, immediately before removing draft status (Requirement 29's "verify branch freshness before and during work, not just at creation," applied to a plan that may span multiple sessions while Core's side is still moving).
