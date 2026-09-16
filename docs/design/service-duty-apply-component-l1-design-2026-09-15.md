# Service Duty/Apply Component — L1 Design

**Status:** In Design
**Issue:** mentat#372
**Date:** 2026-09-15
**Author:** Claude Code (session), reviewed by operator

## Summary

Chronicles of Kanly's Discord plan (`~/projects/meta/Project-Arrakis/docs/community/chronicles-of-kanly-discord-plan.md`
§4/§8/§9) calls for 14 service channels (Water-Seller, Smuggler, Sietch
Guard, etc.), each with a pinned status embed carrying **On Duty / Off
Duty / Apply** buttons. Building this once per channel is not
sustainable — this issue is the generalized component all future
service channels plug into.

This PR builds: (1) a DB-backed service registry, (2) the generic
button/modal component, (3) an application review flow posting to a new
`#applications` staff channel, and (4) a `/dune admin service-setup`
command that provisions a channel end-to-end. It wires **two real pilot
channels** (Water-Seller, Smuggler) as proof the generic path works.
Everything else (the other 12 channels, Sietch Guard's vouch-ring
guard, #365's auto-clear poller) is explicitly out of scope for this
PR.

## Scope

**In scope:**
- `service_channels`, `service_duty_status`, `service_applications`
  DB tables (schema v9, additive).
- `src/serviceChannels.js` — accessors for all three tables.
- `src/serviceComponent.js` — button/modal handlers (On Duty, Off Duty,
  Apply, Approve, Deny).
- `/dune admin service-setup <service-key> <channel> <role>` command —
  creates the role if missing, posts the pinned status embed with
  buttons, writes the registry row.
- Wiring Water-Seller and Smuggler as real, working pilot services.
- A new `#applications` channel under the Staff category (created by
  the same setup flow the first time it's needed, or manually by an
  operator — see Components below) as the sole review destination.

**Explicitly out of scope (deferred, tracked separately):**
- The remaining 12 service channels — adding them later is a config-only
  operation (one `service-setup` invocation per channel), no new code.
- Sietch Guard's vouch-ring requirement (needs its own review logic,
  not just Approve/Deny).
- mentat#365's on-duty auto-clear poller (reads `service_duty_status`,
  built as its own issue once this table exists).
- Reusing `#petition-review` — that channel is already archived on the
  live guild (renamed `#archived-petition-review` this session);
  applications get their own destination instead.

## Architecture

Three new additive SQLite tables (following the `live_messages`
precedent from #370 — schema v9) plus two new modules, reusing the
existing button-dispatch fallthrough chain (`src/index.js`, currently
handled by `handleWriteButtonInteraction` → `handleOwnerConfirmationButtonInteraction`)
and the existing `isAdminActor()` gate (`src/commands.js:971`) for
setup and Approve/Deny.

```
Service channel (e.g. #water-seller)
  pinned embed: [On Duty] [Off Duty] [Apply]
        |
        v
serviceComponent.js (button/modal handlers)
        |
        +-- On/Off Duty --> service_duty_status table --> postOrEditLiveMessage()
        |                                                  refreshes the pinned embed
        |
        +-- Apply --> ModalBuilder (character name, proof link)
                        |
                        v
                service_applications table (status: pending)
                        |
                        v
                #applications channel: embed + [Approve] [Deny]
                        |
                        +-- Approve --> grant role, update row (approved),
                        |                edit review message, DM applicant
                        +-- Deny --> update row (denied), edit review message,
                                      DM applicant
```

## Components

### 1. `service_channels` (DB registry)

```sql
CREATE TABLE IF NOT EXISTS service_channels (
  guild_id TEXT NOT NULL,
  service_key TEXT NOT NULL,       -- e.g. "water-seller", "smuggler"
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  review_channel_id TEXT NOT NULL, -- #applications
  status_message_id TEXT,          -- set after first postOrEditLiveMessage()
  requires_review INTEGER NOT NULL DEFAULT 1, -- 0 = auto-approve on apply (not used by any pilot channel yet, but Sietch Guard's future vouch-ring gate needs a per-service switch here rather than a second table)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, service_key)
);
```

### 2. `service_duty_status`

```sql
CREATE TABLE IF NOT EXISTS service_duty_status (
  guild_id TEXT NOT NULL,
  service_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, service_key, user_id)
);
```

A row's existence means that user is on duty for that service. Going
off duty deletes the row. #365's future poller reads this table; it is
not written by anything this PR builds beyond the On/Off Duty buttons.

### 3. `service_applications`

```sql
CREATE TABLE IF NOT EXISTS service_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  service_key TEXT NOT NULL,
  applicant_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  proof_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  review_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_applications_pending
  ON service_applications (guild_id, service_key, applicant_id)
  WHERE status = 'pending';
```

The partial index enforces the "one pending application per
service/applicant" check efficiently (queried before allowing a new
Apply submission — see Error Handling).

### 4. `src/serviceChannels.js`

Plain accessor module, same shape as `database.js`'s existing
`getLiveMessage`/`setLiveMessage` pair:
`getServiceChannel(db, guildId, serviceKey)`,
`setServiceChannel(db, guildId, serviceKey, {...})`,
`listServiceChannels(db, guildId)`,
`setDutyStatus(db, guildId, serviceKey, userId)` /
`clearDutyStatus(...)` / `listOnDuty(db, guildId, serviceKey)`,
`createApplication(...)`, `getPendingApplication(...)`,
`resolveApplication(db, applicationId, {status, reviewedBy})`.

### 5. `src/serviceComponent.js`

- `buildServiceStatusEmbed(db, guildId, serviceKey)` — renders the
  pinned embed (service name, current on-duty roster from
  `listOnDuty()`) with the 3-button row (customIds:
  `service:onduty:<serviceKey>`, `service:offduty:<serviceKey>`,
  `service:apply:<serviceKey>`).
- `handleServiceButtonInteraction(interaction, db)` — routed from
  `index.js`'s existing fallthrough chain exactly like
  `handleOwnerConfirmationButtonInteraction` is today. Splits
  `customId` on `:`, dispatches on the `service` prefix. Returns
  `false` for anything it doesn't own, per the established convention.
  - `onduty`/`offduty`: requires the interacting user already holds
    `role_id` for that service (checked via
    `interaction.member.roles.cache.has(...)`) — else an ephemeral
    rejection. Writes/deletes the `service_duty_status` row, then
    calls `postOrEditLiveMessage()` to refresh the pinned embed.
  - `apply`: checks `getPendingApplication()` first — if one exists,
    ephemeral rejection ("You already have a pending application").
    Otherwise shows a `ModalBuilder` (`service:applymodal:<serviceKey>`)
    with two `TextInputComponent`s: character name (required, short),
    proof link (optional, paragraph).
- `handleServiceModalSubmit(interaction, db)` — new interaction type
  for this bot (`interaction.isModalSubmit?.()`), added as its own
  branch in `index.js` alongside the existing button/chat-input
  branches (this bot has never had a modal-submit branch before).
  Writes the `service_applications` row, then posts the review embed +
  Approve/Deny buttons (customIds `service:approve:<applicationId>`,
  `service:deny:<applicationId>`) to `review_channel_id`, storing the
  resulting message ID back onto the application row.
- Approve/Deny handling (same `handleServiceButtonInteraction`
  dispatcher, `approve`/`deny` actions): gated by `isAdminActor()`
  (reusing the existing admin/owner check, not a new permission
  concept — the plan doc's "Fedaykin+" language maps to this bot's
  existing admin tier, there is no separate Fedaykin role concept in
  mentat's own role model). On approve: grants `role_id` to the
  applicant (`GuildMember.roles.add`), updates the row, edits the
  review message (buttons removed, embed shows "Approved by X"), then
  best-effort DMs the applicant. On deny: same but no role grant,
  "Denied by X".

### 6. `/dune admin service-setup` command

New subcommand under the existing `admin` group in `commands.js`,
gated by `isAdminActor()` like every other admin subcommand already
is. Args: `service-key`, `channel` (Discord channel option), `role`
(Discord role option, optional — created automatically, named after
`service-key`, if omitted). Steps:
1. If `role` omitted, create it (`guild.roles.create`).
2. Write the `service_channels` row (`review_channel_id` resolved from
   a `DUNE_SERVICE_APPLICATIONS_CHANNEL_ID` config value — see
   Configuration below).
3. Post the pinned status embed via `postOrEditLiveMessage()` (reusing
   #370's shared infra — this is its first real, non-test consumer)
   and pin the resulting message.

### Configuration

One new config value, following the existing `DEFAULT_PATHS`/env-var
override convention in `config.js`: `DUNE_SERVICE_APPLICATIONS_CHANNEL_ID`
(no adapter route involved — this is a pure Discord-side ID, not
Core-backed, so it doesn't touch `adapterClient.js`/`LIVE_ROUTES` at
all). Set once per guild at setup time; `service-setup` reads it when
writing `review_channel_id`. The `#applications` channel itself is
created manually by an operator once (staff-only permissions require
human judgment on the category/role overwrites — not something this
command should improvise), then its ID is set via this env var.

## Error Handling

- **Stale review message on Approve/Deny** (message deleted, channel
  gone): update the DB row regardless, log the Discord-side edit
  failure, don't throw — same fallback philosophy as `liveMessage.js`.
- **Duplicate Apply while pending**: ephemeral rejection before a modal
  is even shown, checked via the partial unique index.
- **On/Off Duty without the role**: ephemeral rejection, no DB write.
- **DM failures** (applicant has DMs closed): caught and swallowed —
  never blocks the Approve/Deny transaction itself.
- **Role grant failure on Approve** (bot lacks permission, role
  deleted since setup): caught, application still marked `approved` in
  the DB (the human decision is recorded), but the review message is
  edited to say "Approved — role grant FAILED, add `@role` manually"
  so the failure is visible to staff rather than silently swallowed.

## Testing Strategy

- `test/serviceChannels.test.js` — accessor unit tests (registry
  CRUD, duty status set/clear/list, application create/resolve,
  partial-index pending-application constraint).
- `test/serviceComponent.test.js` — button/modal handler unit tests
  with a mocked Discord.js interaction (matching the existing
  `writeConfirmation.test.js`/`ownerConfirmation.test.js` mocking
  style): role-gate rejection paths, duplicate-apply rejection, the
  full apply → modal submit → review-post → approve/deny → role-grant
  chain, stale-message fallback, DM-failure swallow.
- `test/database.test.js` — schema v9 migration additions (three new
  tables survive a v8→v9 upgrade, matching the existing
  `live_messages` v7→v8 precedent).
- End-to-end manual QA in a test guild (per the issue's own mandate —
  never the live guild) covering both pilot channels: apply as a test
  account, approve/deny as an admin account, verify role grant and
  pinned-embed roster refresh.

## Open Questions For The Layer 1 Audit

None outstanding from the brainstorming session — the design above
reflects every clarifying-question answer already given (scope,
on-duty storage, provisioning-in-scope, review destination, pilot
channels). Flagging this section explicitly per the spec self-review
checklist so the audit hats know there's no known unresolved decision
being carried forward silently.
