# Service Duty/Apply Component — L1 Design

**Status:** In Design (Layer 1 audit complete, findings resolved below)
**Issue:** mentat#372
**Date:** 2026-09-15 (revised same day, post-audit)
**Author:** Claude Code (session), reviewed by operator

## Summary

Chronicles of Kanly's Discord plan (`~/projects/meta/Project-Arrakis/docs/community/chronicles-of-kanly-discord-plan.md`
§4/§8/§9) calls for 14 service channels (Water-Seller, Smuggler,
Sietch Guard, etc.), each with a pinned status embed carrying **On Duty
/ Off Duty / Apply** buttons. Building this once per channel is not
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
- `/dune admin service-setup <service-key> <channel> <role>
  [applications-channel]` command — creates the role if missing, posts
  the pinned status embed with buttons, writes the registry row.
- Wiring Water-Seller and Smuggler as real, working pilot services.
- A new `#applications` channel under the Staff category (created
  manually by an operator once, its ID then passed to `service-setup`
  — see Components §6) as the sole review destination.
- Toggling the guild's single generic 🟢 On Duty role (per plan §8) in
  addition to the per-service duty-status row (see Components §5;
  corrected below — the original 2026-09-15 draft omitted this).

**Explicitly out of scope (deferred, tracked separately, with
justification — see "Deferred Items" below):**
- The remaining 12 service channels.
- Sietch Guard's vouch-ring requirement.
- mentat#365's on-duty auto-clear poller.
- Sietch Standing / Renown integration on Approve (#371 not yet built
  — see Deferred Items).
- Denial-reason capture UI (schema column added now, populated `NULL`
  until a follow-up issue builds the capture modal — see Deferred
  Items).
- An in-guild "check my application status" fallback for DM-closed
  applicants (see Deferred Items).

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
        +-- On/Off Duty --> service_duty_status table
        |                   + generic "On Duty" role add/remove
        |                   --> postOrEditLiveMessage() refreshes the
        |                       pinned embed (key: service:duty:<serviceKey>)
        |
        +-- Apply --> already has role? reject ephemerally.
                       already has a pending application? reject ephemerally.
                       otherwise: ModalBuilder (character name, proof link)
                        |
                        v
                service_applications table (status: pending, UNIQUE
                partial index guarantees only one pending row per
                guild+service+applicant even under a race)
                        |
                        v
                #applications channel: embed + [Approve] [Deny]
                (proof_link rendered as plain text, never as a
                clickable markdown label — see Security fix below)
                        |
                        +-- Approve --> re-check isAdminActor() +
                        |                application.guild_id === interaction.guildId,
                        |                grant role, update row, edit
                        |                review message, DM applicant
                        +-- Deny --> same checks, no role grant,
                                      update row, edit review message,
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
  review_channel_id TEXT NOT NULL, -- #applications, set explicitly per guild at setup (see Configuration)
  status_message_id TEXT,          -- set after first postOrEditLiveMessage()
  requires_review INTEGER NOT NULL DEFAULT 1, -- 0 = auto-approve on apply (not used by any pilot channel yet, but Sietch Guard's future vouch-ring gate needs a per-service switch here rather than a second table)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, service_key)
);
-- Rollback (Requirement 26, matching the live_messages/#370 precedent
-- at database.js:126-132): a plain `DROP TABLE IF EXISTS
-- service_channels`. No FK, consistent with live_messages' own
-- FK-less precedent (rows orphan silently if a guild row is ever
-- deleted from `guilds` -- a pre-existing, accepted pattern in this
-- codebase, not a new gap). Losing this table's rows means every
-- service channel loses its registry entry and must be re-provisioned
-- via /dune admin service-setup -- acceptable data loss, no in-game
-- state depends on it.
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
-- Rollback: plain `DROP TABLE IF EXISTS service_duty_status`. No FK.
-- Losing this table's rows means every on-duty member appears
-- off-duty until they re-toggle -- acceptable, no persistent
-- consequence beyond a stale roster display.
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
  reason TEXT, -- staff-entered denial/approval note; column added now
               -- for forward compatibility, always NULL in this PR --
               -- see "Deferred Items" (no capture UI ships yet)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- CORRECTED (Layer 1 DBA + Architect + QA hats, all three independently
-- caught this): the original 2026-09-15 draft omitted UNIQUE here,
-- making this a plain lookup-speed index that enforced nothing --
-- prose in Error Handling below claimed it prevented duplicate
-- applications, which was false as originally written. SQLite has
-- supported partial UNIQUE indexes since 3.8.0; this is the real,
-- authoritative guard. createApplication() MUST catch the resulting
-- SQLITE_CONSTRAINT and translate it into the same friendly ephemeral
-- rejection as the pre-check below -- the pre-check via
-- getPendingApplication() stays as a fast, friendly first line (avoids
-- even opening the modal in the common case), but the UNIQUE index is
-- what actually closes the race between two near-simultaneous clicks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_applications_pending
  ON service_applications (guild_id, service_key, applicant_id)
  WHERE status = 'pending';
-- Rollback: plain `DROP TABLE IF EXISTS service_applications`. No FK.
-- Losing this table's rows means in-flight applications disappear and
-- applicants would need to re-apply -- acceptable, no in-game state
-- depends on it, and the plan doc's own review process is entirely
-- Discord-side already (no external system reflects application
-- status).
```

### 4. `src/serviceChannels.js`

Plain accessor module, same shape as `database.js`'s existing
`getLiveMessage`/`setLiveMessage` pair — every query is parameterized
(`db.prepare(...).get/run` with `?` placeholders), matching that exact
precedent (`database.js:532-545`), never string-interpolated:
`getServiceChannel(db, guildId, serviceKey)`,
`setServiceChannel(db, guildId, serviceKey, {...})`,
`listServiceChannels(db, guildId)`,
`setDutyStatus(db, guildId, serviceKey, userId)` /
`clearDutyStatus(...)` / `listOnDuty(db, guildId, serviceKey)`,
`createApplication(...)` (catches the UNIQUE constraint violation per
above and returns a typed "already pending" result rather than
throwing), `getPendingApplication(...)`,
`resolveApplication(db, guildId, applicationId, {status, reviewedBy,
reason})` — **`guildId` is now a required parameter and part of the
`WHERE` clause** (see Security fix #4 below — the original draft keyed
this only on `applicationId`, with no guild scoping).

### 5. `src/serviceComponent.js`

- `buildServiceStatusEmbed(db, guildId, serviceKey)` — renders the
  pinned embed (service name, current on-duty roster from
  `listOnDuty()`, using the plan's exact "No one currently on duty"
  empty-state string when the roster is empty) with the 3-button row
  (customIds: `service:onduty:<serviceKey>`,
  `service:offduty:<serviceKey>`, `service:apply:<serviceKey>`).
- `handleServiceButtonInteraction(interaction, db)` — routed from
  `index.js`'s existing fallthrough chain exactly like
  `handleOwnerConfirmationButtonInteraction` is today. Splits
  `customId` on `:`, dispatches on the `service` prefix. Returns
  `false` for anything it doesn't own, per the established convention.
  - `onduty`/`offduty`: requires the interacting user already holds
    `role_id` for that service — else an ephemeral rejection that
    names the fix explicitly: *"You need the `@<service-role-name>`
    role first — click Apply below."* (was previously unspecified;
    UI/UX hat flagged this). On success: writes/deletes the
    `service_duty_status` row, **also grants/removes the guild's
    single generic 🟢 On Duty role** (read from `guild_settings`,
    following the same per-guild-column precedent as
    `announcements_channel` — per plan §8's "one generic role, not one
    per service" requirement, which the original draft silently
    dropped), then calls `postOrEditLiveMessage()` with
    `messageKey = "service:duty:<serviceKey>"` (explicit key scheme —
    see Security fix #1) to refresh the pinned embed.
  - `apply`: checks (a) does the user already hold `role_id` — if so,
    ephemeral rejection ("You're already a Water-Seller"); (b)
    `getPendingApplication()` — if one exists, ephemeral rejection
    ("You already have a pending application"). Otherwise shows a
    `ModalBuilder` (`service:applymodal:<serviceKey>`) with two
    `TextInputComponent`s: character name (required, short), proof
    link (optional, paragraph). Also sends an ephemeral acknowledgment
    on modal submit: *"Your application has been submitted. You'll be
    notified by DM once it's reviewed."* (sets expectations up front —
    UI/UX hat's DM-failure finding, mitigation below).
- `handleServiceModalSubmit(interaction, db)` — new interaction type
  for this bot (`interaction.isModalSubmit?.()`), added as its own
  branch in `index.js` alongside the existing button/chat-input
  branches (this bot has never had a modal-submit branch before —
  confirmed via grep, zero `isModalSubmit` references exist today).
  Writes the `service_applications` row (via `createApplication()`,
  which now handles the UNIQUE-constraint race per above), then posts
  the review embed + Approve/Deny buttons (customIds
  `service:approve:<applicationId>`, `service:deny:<applicationId>`)
  to `review_channel_id`, storing the resulting message ID back onto
  the application row. **`proof_link` is rendered as a plain-text/code
  block field (`` `<url>` ``), never interpolated into Discord's
  `[label](url)` masked-link markdown** — an applicant-controlled
  label over an applicant-controlled URL would let a malicious
  applicant present a phishing link to staff reviewers under an
  attacker-chosen display label (Security hat finding, STRIDE:
  Spoofing).
- Approve/Deny handling (same `handleServiceButtonInteraction`
  dispatcher, `approve`/`deny` actions): gated by `isAdminActor()`,
  re-checked live at click time (not just assumed from who can see the
  message) — the same fail-closed-at-click-time property
  `writeConfirmation.js` establishes for its own confirm/cancel flow.
  **A non-admin clicking Approve/Deny gets an explicit ephemeral
  rejection** ("You are not authorized to review applications") —
  the original draft's Error Handling section omitted this case even
  though the gate itself was already correctly specified (Security hat
  finding). **The handler also verifies
  `application.guild_id === interaction.guildId` before any mutation**
  — closes the cross-tenant gap the Security hat flagged (mentat is
  confirmed multi-tenant per `docs/multi-tenant-design.md` and
  `commands.js`'s `config.multiTenant` branches; `resolveApplication`'s
  new required `guildId` parameter, above, is what enforces this). On
  approve: grants `role_id` to the applicant
  (`GuildMember.roles.add`), updates the row (`reason` stays `NULL` in
  this PR — see Deferred Items), edits the review message (buttons
  removed, embed shows "Approved by X"), then best-effort DMs the
  applicant. On deny: same but no role grant, "Denied by X". The
  approval embed/DM copy **does not mention Renown** (the plan §4
  template's "+25 Renown" line is Sietch Standing/#371 integration,
  not yet built — see Deferred Items; shipping that copy now would be
  a false on-screen promise, per the UI/UX hat's finding).

### 6. `/dune admin service-setup` command

New subcommand under the existing `admin` group in `commands.js`,
gated by `isAdminActor()` like every other admin subcommand already
is. Args: `service-key`, `channel` (Discord channel option), `role`
(Discord role option, optional — created automatically, named after
`service-key`, if omitted), `applications-channel` (Discord channel
option, **optional** — if omitted, reuses the `review_channel_id`
already on record for any existing `service_channels` row in this
guild; required on a guild's first-ever invocation of this command,
since there's nothing to default to yet). Steps:
1. If `role` omitted, create it (`guild.roles.create`).
2. Resolve `review_channel_id`: the passed `applications-channel`, or
   the existing guild's prior value, or fail with a clear error asking
   the operator to pass it explicitly the first time.
3. Write the `service_channels` row (per-guild, per this command's
   args — **not a global env var**; see Configuration below for why
   the original draft's env-var approach was wrong).
4. Post the pinned status embed via `postOrEditLiveMessage()` (reusing
   #370's shared infra — this is its first real, non-test consumer;
   `messageKey = "service:duty:<serviceKey>"`, namespaced per Security
   fix #1 below) and pin the resulting message.

### Configuration

**Corrected from the original draft (Architect hat HIGH finding):**
there is **no `DUNE_SERVICE_APPLICATIONS_CHANNEL_ID` env var**. Mentat
is confirmed multi-tenant (`docs/multi-tenant-design.md`,
`commands.js`'s `config.multiTenant` branches) and a process-global env
var for a per-guild value would silently route guild B's staff
applications into guild A's `#applications` channel on any shared
hosted instance. The review channel is instead an explicit,
per-guild-scoped value passed to `/dune admin service-setup` and stored
directly in `service_channels.review_channel_id` — no config-file or
env-var layer at all, following the same per-guild-column precedent
`guild_settings.announcements_channel` already establishes in this
codebase. The `#applications` channel itself is still created manually
by an operator once (staff-only permissions require human judgment on
category/role overwrites — not something this command should
improvise), then its ID is passed as `service-setup`'s
`applications-channel` argument.

### `messageKey` scheme (Security + Architect hats)

`liveMessage.js`'s own Security-hat comment (added for #370) requires
`messageKey` stay a fixed, code-defined enum, never derived from
per-instance input, specifically to prevent two features' message
pointers from colliding on the same DB row. This design's pinned
status embed necessarily needs a distinct key **per service** (14
channels), which is admin-supplied at setup time (the `service-key`
argument) — a real tension with that invariant that the original draft
didn't acknowledge. Resolution: the key is always constructed as
`` `service:duty:${serviceKey}` `` — namespaced under a fixed
`service:duty:` prefix that no other feature uses or ever will (grep
confirms `coriolis`/`landsraad` are the only two keys in use today, and
neither will ever collide with this prefix). Combined with
`live_messages`'s existing `(guild_id, message_key)` primary key, this
means two different guilds' identically-named services (e.g. two
guilds both running a "smuggler" channel) still can't collide with each
other, and no future fixed-string feature key can collide with this
prefix. This satisfies the spirit of the original invariant (no two
unrelated features share a row) even though the leaf segment is
admin-supplied, and should be read as the concrete answer to that
comment's open question for any future caller with the same shape.

## Error Handling

- **Duplicate Apply while pending**: ephemeral rejection, backed by the
  real `UNIQUE` partial index (not just a pre-check) — see Components
  §3/§4 above for the corrected mechanism.
- **Stale review message on Approve/Deny** (message deleted, channel
  gone): update the DB row regardless, log the Discord-side edit
  failure, don't throw — same fallback philosophy as `liveMessage.js`.
- **Non-admin clicks Approve/Deny**: explicit ephemeral rejection
  ("You are not authorized to review applications") — was missing from
  the original draft despite the gate itself being correctly specified
  (Security hat finding).
- **Wrong-guild application ID** (should not be reachable via a real
  Discord click on a real message, but checked as defense-in-depth):
  the guild-scoping check in `resolveApplication` rejects silently as
  "application not found" rather than leaking existence of another
  guild's row.
- **On/Off Duty without the role**: ephemeral rejection naming the fix
  ("click Apply below") — see Components §5.
- **Already holds the role, clicks Apply**: ephemeral rejection before
  a modal is even shown (was unhandled in the original draft — UI/UX
  hat finding).
- **DM failures** (applicant has DMs closed): caught and swallowed —
  never blocks the Approve/Deny transaction itself. Mitigated by the
  ephemeral "you'll be DM'd" notice sent at apply time (Components
  §5), so a DM-closed applicant at least knows a decision is pending;
  a full in-guild fallback ("check my application status") for
  DM-closed users who are later denied is deferred — see Deferred
  Items.
- **Role grant failure on Approve** (bot lacks permission, role
  deleted since setup): caught, application still marked `approved` in
  the DB (the human decision is recorded), but the review message is
  edited to say "Approved — role grant FAILED, add `@role` manually"
  so the failure is visible to staff rather than silently swallowed.

## Deferred Items (explicit, per Requirement 20's MEDIUM-needs-justification rule)

- **Denial-reason capture UI.** The `reason` column exists in schema
  now (cheap, additive) but nothing populates it in this PR — adding a
  reason-capture modal to the Deny button is real added scope (a
  second modal type) that doesn't block proving the generalized
  component works for the two pilots. Filed as a follow-up issue
  (deny-reason capture) rather than expanding this PR.
- **In-guild application-status fallback for DM-closed users.** A
  `/dune service application-status` self-service command would close
  the remaining UI/UX gap for a denied, DM-closed applicant. Deferred
  as its own follow-up issue — the ephemeral "you'll be DM'd" notice at
  apply time is judged sufficient mitigation for this PR's two pilot
  channels; revisit if it proves to be a real recurring complaint once
  live.
- **Sietch Standing / Renown integration on Approve.** #371 doesn't
  exist yet; the plan's "+25 Renown" copy is explicitly not shown
  anywhere in this PR's embeds until #371 ships and a follow-up PR
  wires the grant.
- **Phase 3's "apply before the channel exists" sequencing for the
  remaining 12 channels.** See "Relationship to Plan §9 Phase 3" below
  — this PR's pilot-channel provisioning model is intentionally
  different from Phase 3's live-rollout model, and that distinction
  needs to be carried forward into whatever issue eventually rolls out
  channels 3-14.

## Relationship to Plan §9 Phase 3 (GRC hat finding — resolved)

The original draft's self-review section claimed "no open questions,"
which was false: the plan doc's §9 Phase 3 (lines 322-329) explicitly
requires a service channel be created **only after** an application is
approved, "never speculatively," with the application itself routed to
`#petition-review` (now archived and superseded by
`#archived-petition-review`/YAGPDB tickets, per this session's earlier
finding).

This PR's `/dune admin service-setup` does the opposite for its two
pilots: it provisions the channel, role, and pinned embed **up front**,
before any application exists. This is a deliberate, acknowledged
divergence, not a silent contradiction — the goal of this PR is
proving the generalized component end-to-end for two channels chosen
as pilots specifically because they're low-risk to have "on" ahead of
demand (per the brainstorming session's own scoping conversation).
Phase 3's apply-before-channel-exists sequencing remains the intended
**live rollout model** for the eventual other 12 channels — this PR
does not build that sequencing (a "generic apply, channel created only
on approval" flow would need its own design, since it implies the
apply button/modal exists somewhere with no channel yet, e.g. in a
central hub channel) and is explicitly out of scope. Whoever picks up
channels 3-14 should read this section before assuming `service-setup`
alone is the rollout mechanism Phase 3 describes — it isn't, by design,
for anything the operator wants to gate behind actual applications
first.

## Testing Strategy

- `test/serviceChannels.test.js` — accessor unit tests (registry
  CRUD, duty status set/clear/list, application create/resolve
  including the guild-scoping parameter, the `UNIQUE` partial-index
  constraint actually rejecting a second concurrent insert — not just
  the pre-check — and the resulting error being translated to the
  friendly typed result rather than propagating a raw
  `SQLITE_CONSTRAINT`).
- `test/serviceComponent.test.js` — button/modal handler unit tests
  with a mocked Discord.js interaction (matching the existing
  `writeConfirmation.test.js`/`ownerConfirmation.test.js` mocking
  style, extended for the modal-submit shape): the mock's
  `ModalSubmitInteraction`/`showModal()` shape (`interaction.fields.getTextInputValue()`,
  `interaction.showModal()`) will be checked against real discord.js
  type definitions before being written, not modeled by assumption
  from the button fixtures (QA hat finding — no existing fixture in
  this codebase covers modals). Every gate test asserts **both**
  sides: the success path succeeds, AND the rejected path performs no
  DB write and no Discord-side side effect (QA hat's tautology-risk
  finding) — role-gate rejection paths (on-duty/off-duty without the
  role), duplicate-apply rejection (both pre-check and the real race
  via a forced double-insert), already-has-role rejection, non-admin
  Approve/Deny rejection, cross-guild application-ID rejection, the
  full apply → modal submit → review-post → approve/deny →
  role-grant → generic-role-toggle chain, stale-message fallback,
  DM-failure swallow.
- `test/index.test.js` (or wherever the existing button-dispatch
  fallthrough is tested) — **a new routing-shape test asserting
  `index.js`'s new `isModalSubmit?.()` branch actually dispatches to
  `handleServiceModalSubmit`**, mirroring the existing
  "`handleOwnerConfirmationButtonInteraction` returns false for a
  customId it doesn't own" test pattern — a unit test of
  `handleServiceModalSubmit` in isolation cannot catch a wiring bug
  (wrong branch order, an earlier `isButton?.()`/`isChatInputCommand?.()`
  check swallowing the interaction first) (QA hat finding — this is the
  bot's first-ever modal-submit interaction type, confirmed via grep
  that zero `isModalSubmit` references exist today).
- `test/database.test.js` — schema v9 migration additions (three new
  tables survive a v8→v9 upgrade, matching the existing
  `live_messages` v7→v8 precedent).
- End-to-end manual QA in a test guild (per the issue's own mandate —
  never the live guild) covering both pilot channels: apply as a test
  account, approve/deny as an admin account, verify role grant, generic
  On Duty role toggle, and pinned-embed roster refresh; **explicitly
  including** the "no role, click On Duty" rejection path and a
  DM-closed test account's Approve flow (both named failure modes
  elsewhere in this doc that the original manual-QA checklist omitted
  — QA hat finding).

## Layer 1 Audit Summary

Seven hats dispatched (Architect, Security, GRC, DBA, QA, UI/UX,
combined Network+Cloud Security) against the original 2026-09-15 draft
of this document. No CRITICAL findings. Findings and resolutions are
folded inline above; see the mentat#372 issue comment for the full
findings register and STRIDE table (Requirement 20). Network and Cloud
Security hats found nothing applicable (no new network exposure, no
credential/cloud-provider touch) — stated explicitly per this
project's "absent vs. none" distinction.
