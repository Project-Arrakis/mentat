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

**New:** on command invocation (after `canWrite()` passes), call `adapterClient.writePreview(actor, { action, params })` immediately. Core validates capability/tier/params server-side and returns `{ nonce, expiresAt, preview: { action, confirmPhrase } }` or a real rejection. Build the Discord confirm button from *that real response* — the actual action and a live "expires in Ns" countdown from `expiresAt`, not a generic risk/tier sentence. On button click, call `adapterClient.writeExecute(actor, { nonce, action })`.

**`server.stop`'s dual-confirmation is a distinct third state**, not success/failure: a 202 `second_confirmation_required` response means the *first* admin's click succeeded but a *second, different* admin must independently run the same confirm step (same nonce). The bot must show this as its own state ("waiting on a second admin") and let a second admin's click on the same message complete it — clicking the button a second time as the *same* admin must be rejected client-side too (mirroring Core's own `second_confirmation_same_actor` check) rather than relying solely on Core's 403.

**Error mapping** (every code `write/preview`/`write/execute` can return, mapped to a specific Discord message, not a generic failure):

| Core code | HTTP | mentat message |
|---|---|---|
| `writes_disabled` | 403 | "Write commands are disabled on this console." |
| `not_authorized` | 403 | "You don't have permission for this action." (tier-specific wording, matching today's `canWrite()` messages) |
| `unknown_write_action` / `invalid_parameters` | 400 | "This command isn't available yet." / show the specific parameter problem |
| `nonce_not_found` | 410 | "This confirmation expired. Please run the command again." |
| `nonce_actor_mismatch` | 403 | "This confirmation wasn't issued to you." |
| `nonce_action_mismatch` | 409 | (should not occur from the bot's own flow — treat as an internal-error fallback) |
| `second_confirmation_required` | 202 | the dual-confirmation waiting state above |
| `second_confirmation_same_actor` | 403 | "A different administrator must provide the second confirmation." |
| `stale_actor_signature` / `invalid_actor_signature` | 403 | "Your role info expired. Please run the command again." |
| `write_backend_unavailable` | 503 | "The write backend is temporarily unavailable. Try again shortly." |

## 4. The 22 commands

Grouped by Core's existing namespacing. Path params (`playerId`/`baseId`/`guildId`) are exact, already-verified Discord command options; body params are specified at the level already verified against each real target route handler, with implementation-time verification flagged where noted.

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

**Why reuse the deploy pipeline instead of a new implementation:** `deploy-post-receive.sh` already has reviewed, production-proven safety guardrails — refuses on a dirty working tree, runs the real test suite and aborts on any failure, verifies required files exist, conditionally re-registers Discord slash commands, restarts `acp-bot.service`, then runs a post-restart security smoke test. A new, separate "self-update" implementation would either duplicate all of this (drift risk — two copies of the same safety logic going out of sync, the exact bug class this project has already been bitten by) or, worse, skip it entirely (shipping a broken deploy straight to the live bot with no test gate).

**Design:** extract the reusable steps of `deploy-post-receive.sh` (fetch/reset, test-gate, required-files check, npm install, conditional command re-registration, restart, health check) into a shared script, `scripts/lib/deploy-core.sh`, parameterized by `WORK_DIR`/`SERVICE_NAME` (already variables in the script today). `deploy-post-receive.sh` is refactored to source and call it — no behavior change to the existing git-push deploy path, verified by keeping `test/deploy-hook.bats` green throughout. A new `scripts/self-update.sh` sources the same library and calls the same function, run against the deploy branch's current tip (i.e., "replay the deploy pipeline now" rather than "wait for the next push") — this only does something when a push already landed on `deploy` without a subsequent restart (e.g., a prior deploy that failed the test gate has since been fixed and re-pushed, or a push happened but nobody triggered redeploy) — it can't invent code to deploy that isn't already sitting on the `deploy` ref.

**How the bot invokes it, safely:**
- Owner tier only (matches the existing `operations:trigger-update` tier judgment).
- Goes through the same generic confirm-button UI as every other write command for UX consistency, but its "execute" step calls a new local function, `runSelfUpdate()`, never `adapterClient.writeExecute()` — there is no Core action name for this.
- `runSelfUpdate()` spawns `scripts/self-update.sh` via `child_process.spawn` with an **argument array**, never a template-interpolated shell string (no user-controlled input reaches this call at all — the command takes no parameters — but the discipline is followed regardless, since a future parameter must not create an injection path by accident).
- Spawned **detached** (`{ detached: true, stdio: ["ignore", logFd, logFd] }`, then `.unref()`): the restart this script triggers kills the current bot process, so the script must survive its own parent's death to finish the job and report back. Output goes to a log file (`runtime/self-update-<timestamp>.log`, git-ignored), not the parent's stdout, since the parent won't be alive to see it.
- **Reporting back**: the interaction is replied to immediately ("Self-update started — this will restart the bot; I'll confirm success or failure here.") *before* spawning, since the process may not survive long enough to reply after. `scripts/self-update.sh` itself posts the final result (test-gate pass/fail, restart success/failure) directly to Discord via a webhook call (`curl`, using the interaction's stored webhook token/channel — Discord allows a followup message on an interaction token for up to 15 minutes), from the shell script, independent of whether the Node process that spawned it is still alive.
- If the test gate fails, the script must NOT restart the service — the bot keeps running on its current, known-good code, and the failure (including the actual test output) is what gets posted back.

## 5. Explicitly deferred (not touched by this design)

- `maintenance:set-note`, `maintenance:set-window`, `notifications:set-alert-channel`, `notifications:set-threshold`, `notifications:set-digest-schedule`, `schedule:set-post-schedule`, `schedule:add-channel`, `schedule:remove-channel` — no real backing feature anywhere; left returning today's stub.
- `operations:clear-cache` — no matching Core route.

`docs/upstream-write-adapter-rfc.md`'s Status section gets updated in the same PR to record that its "do not implement" gate was explicitly overridden by the operator for the scope above, while the deferred items remain genuinely blocked pending their own future design work (not the upstream-contract question this RFC was originally about).

## 6. Testing

- Real, live tests per command group (matching Core's own "real, not mocked" standard established in #1026): a real Discord.js interaction mock, a real `adapterClient` pointed at a real HTTP server standing in for Core's write/preview+write/execute (not a hand-wavy mock — asserting the actual request shape sent).
- One dedicated test proving the `server.stop` dual-confirmation UX state machine end-to-end (first click → waiting state → second, different admin's click → success; same admin's second click → rejected client-side).
- One dedicated test per error-mapping table row (§3), proving each Core error code produces its specific mentat message, not a fallback.
- The 3 new Core-side actions get their own scoped Layer 2 review before merging (§2).
- `scripts/lib/deploy-core.sh`'s extraction is verified by keeping the existing `test/deploy-hook.bats` suite green throughout (proves the refactor changed nothing about the real git-push deploy path's behavior), plus new bats coverage for `scripts/self-update.sh` specifically (test-gate failure must not restart the service; test-gate success must). The Node-side `runSelfUpdate()` spawn/reply logic gets its own test with a fake `child_process.spawn` proving detached+unref invocation and the argument-array (never string-interpolated) call shape.

## 7. Rollout

No schema changes. `DUNE_DISCORD_WRITES_ENABLED` remains the single kill switch on both sides (already true today). This ships as a normal PR on `mentat` (depending on Core's PR #1026 merging first for the write-bridge routes to exist, and a small follow-up Core PR for the 3 new `WRITE_ACTION_ROUTES` entries) plus the RFC status update.
