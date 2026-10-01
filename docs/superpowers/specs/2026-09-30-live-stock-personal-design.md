# Live Stock Integration, Personal Scope — Design (Phase 2), v3

**Status:** design v3, revised after **two** Requirement 20 **Layer 1** (eight-hat design)
rounds. It is not implemented. It contains no code except illustrative query and data
shapes, which are clearly marked.

**Audit status:**
- **Round 1** ran on v1 (commit `a0e0d3b`). It found 0 Critical, 17 High, 43 Medium,
  27 Low and 1 Info. It did **not** cover Phase 2a (§3.5), which did not exist yet.
- **Round 2** ran on v2 (commit `2dd3158`) and was the first audit of Phase 2a. It found
  124 raw findings, which deduplicate to 75: 0 Critical, 12 High, 40 Medium, 23 Low.

Every finding from both rounds, its disposition and both STRIDE tables are in
`docs/superpowers/specs/2026-09-30-live-stock-personal-layer1-audit-register.md`.
Round 2 rows are `D01`–`D75`, and this document cites them as `(R2 Dnn)`. Every High from both
rounds is resolved in this document, or has a safe default pending an operator decision
(§18 OD 10–14). Round-2 issues: mentat#443–#450 and Core
Project-Arrakis/dune-awakening-selfhost-docker#1088.

**Operator decisions, 2026-09-29.** Open Decision 1 was decided as **per-guild encrypted
signing secret** (option A). Open Decision 5 was decided as **take the 20-char `sync` cost
now**. Two things follow:
- The per-guild secret is its own security-sensitive deliverable, **Phase 2a**, specified in
  §3.5. It ships as its own PRs **before** the sync command.
- §3.5 is new design material, so it needs its own Layer 1 pass before implementation. That
  pass has **not yet run**.

**Delivery order:**

| Phase | Content | Depends on |
|---|---|---|
| 2a (§3.5) | Per-guild actor signing secret. The **mentat PR ships first**, then Core#1088 (R2 D01). | mentat#438 resolved (the deploy branch reconciled with `main`, which includes #384's v9), U13, OD 7 (§3.5.2, §13) |
| 2b (rest of this document) | Stock route and `/dune goal sync` | 2a (both sides deployed and provisioned on dune-dev). PR #435 is **merged** (`db3db83`). |
| 2c (**new 2026-10-01, operator decision; own design, not in this document**) | Guild-base designation in Core (Option 2) and `/order sync` (key `order:sync`). Orders are a separate guild-only command (command-split design D14 v2.2, OD17). | 2a, 2b, and the Core issue for the designation (Requirement 18). The game data has no base-to-guild link today (a base has one player Owner, rank 1), so the designation must be explicit. |

**Evidence base:** Core claims are cited as `path:line` on the fork's `origin/main`
(`ace31877`, 2026-09-27, still Core `main` on 2026-09-29). Core was read only through
`git show`/`git grep` against git objects, never its working tree. mentat claims cite this
worktree (`docs/phase2-live-stock-design`, based on `f8709f0`) unless another branch is named.
mentat `origin/main` has since moved to `db3db83` (PR #435). Citations into `src/commands.js`
must be re-run at branch cut (Requirement 29, R2 D25). Anything that could not be verified
this way is listed under §16 (Unverified).

**Spec context:** Phase 2 of `docs/crafting-resource-planning-overview.md`. Phase 1
(`/dune data calculator`) and Phase 3 (`/dune goal`,
`docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md`, PR #430) are
shipped. Phase 2 lets a player **choose** to fill a **personal** goal's on-hand numbers
from the game database instead of typing them.

### What changed from v2 (round 2 summary)

| Area | v2 | v3 |
|---|---|---|
| Secret activation | Core generated the secret and enforced it at once. A failed push meant a total signed-route outage. | Core writes a **pending** secret that is never enforced. mentat drives the handshake: verify, then promote, then store, then revert if the store fails. No outage window on first connect or rotation. OD 8 is superseded (R2 D01, §3.5.3). |
| Rollout order | Core K1 before mentat | **mentat 2a first**, then Core. A pending secret that an old mentat ignores simply expires (R2 D01, §13). |
| Owner tier | Unsigned `guildOwnerId` stripped once signing is on, so hosted owners were demoted | **Signature v2** signs `guildOwnerId`. Core keeps it only when v2 verified (R2 D02, §3.5.5). |
| Binding | A secret stayed "verified" after a `console_url` or bearer change | Cleared in the same transaction unless re-verified; a runtime re-verify on mismatch (R2 D03) |
| Direct env var | Core refused to connect | Forwarded as an `existing` secret. Stored only if it is 64-hex, has enough entropy, and is not the process secret. Otherwise the guild stays on the legacy path (R2 D04). |
| Resolver | Two lookups (config, secret); process fallback | One atomic `resolveGuildRequestContext` with strict semantics for guild paths. A dedicated self-check call. A non-colliding signing API (R2 D11, D13). |
| Migration | try/catch-all, then bump the version | Fail closed: catch only duplicate-column errors, one transaction, `PRAGMA` assert (R2 D05) |
| Operator UX | A "status page" / "Test signing" that did not exist | Core settings is the status surface. A secret-only update path. One copy table (R2 D07–D09). |
| Tests | Per-repo sha pins; UAT not executable | Golden cross-repo vectors with a fail-not-skip gate; an executable UAT (R2 D10, D12) |

### What changed from v1 (summary)

| Area | v1 | v2 |
|---|---|---|
| Base population | Every inventory of every rank-1 placeable | Core's own `BASE_INVENTORY_TYPES` Storage/Refining/Crafting allowlist plus `max_item_count >= 0`. Generator, turbine, windtrap, recycler, repair-station and totem inventories are excluded (§4.3, DBA-1). |
| Id match | Case-sensitive `=` | `lower(template_id) = any($ids)`. The caller's own spelling is returned (DBA-2). |
| Query shape | OR of two IN-subqueries over `dune.items` | One statement driven by the small inventory set. Read-only transaction, `lock_timeout`, 2 s statement timeout (DBA-3/9/10). |
| Response | Object keyed by caller ids | An array of `{id,total,inBackpack,inBases,unavailable?}`. Reserved names are rejected (SEC-1). |
| Missing pawn | Silently 0 | Explicit `unavailable:["backpack"]`. `actor_id = 0` is never read, and no decrease is ever written from it (DBA-6/ARCH-2/SEC-6). |
| Preview/apply | `apply:true` option, second live read | Preview-only slash command. **Apply is a button** that writes exactly what was previewed, with a compare-and-set against newer manual edits. Decreases need a separate button (ARCH-3, UX-2/3). |
| Writes | Per-node statements | One IMMEDIATE `goalTransaction` (depends on mentat#428 / PR #435) (DBA-7). |
| Provenance | Not stored | Additive, nullable `source`, `source_guild_id`, `source_ref` on `goal_audit_log` (schema **v11**, Requirement 26) (GRC-1, DBA-12). |
| Load | 5 s timeout, mentat cooldown only | Core concurrency cap (503) + per-actor limiter (429) + 2 s timeout. mentat per-command 15 s cooldown (§6.7) (NET-3, DBA-4, SEC-4). |
| Tenancy | Global env kill switch, silent adapter fallback | Per-guild allowlist. Sync requires an active registered guild and never uses the fallback. Invariant: 1 guild = 1 Core (NET-1/2, ARCH-7). |
| Signing | Required, one global secret | Required, with a **per-guild encrypted secret** (Phase 2a, §3.5; decided). The stock route never uses the process-wide secret. `itemIds` is inside the signed payload (SEC-8). |
| Command budget | Unaccounted | Measured at 7473/7500. `sync` costs 20 chars and is taken now (decided). Anything after it goes through the `/dune` split (mentat#423) (UX-1). |

## 1. Goal and Non-Goals

**Goal.** A player has linked their Discord account to their in-game character. For one
of their own **active personal** goals, they can ask mentat to read their current stock
of that goal's syncable items from their Discord server's game server. mentat shows them
exactly what would change. If they confirm, it saves those numbers as the goal's on-hand
values. The manual `/dune goal on-hand` path is unchanged and always available.

**Non-goals (explicit).**
- **Guild scope is OUT of 2a/2b.** Guild goals and orders stay manual (Option 1) until phase 2c.
  The operator chose Option 2 on 2026-10-01 (a real guild-base designation in Core, a separate
  design); orders are now their own `/order` command and `order:sync` is a 2c deliverable. mentat refuses to sync a guild goal `[D1]`.
- **Per-member contribution attribution is OUT.** The engine gives no per-actor deposit signal.
- **No recipe or crafting math in Core.** Core answers one question: "how many of these item ids
  does this linked player have in these places". All domain logic stays in mentat.
- **No automatic, background or scheduled refresh, and no push notifications.**
- **No "sync all goals" in v1.** See §17 and UX-9.
- **Multi-instance guilds are unsupported in v1.** One Discord guild maps to exactly one Core
  (§3.1).
- **No direct Postgres access from mentat.** The only path is `adapterClient.js` → Core adapter →
  `duneDb.js` (`docs/architecture.md`, "Boundaries").

## 2. Verified Findings About Core (and mentat facts the design depends on)

Core citations are on `origin/main` `ace31877`.

### F1. The existing `owned`-scope container search cannot give totals
`searchItemsInContainers` (`console/api/src/duneDb.js:17117`, owned branch
`:17120`–`:17152`) has four problems for this use:
- It matches `i.template_id ilike '%<query>%'`, a substring match.
- It returns one row per stack.
- It stops at `limit 200`.
- It does not filter `is_hologram`, unlike `playerOwnedStorageQuery` (`:17053`–`:17077`).

The ownership join (`actor_fgl_entities` → `permission_actor_rank`, `par.player_id = $1 and
par.rank = 1`) includes every base the player owns, with no per-base limit. Rank 1 is Owner,
and there is exactly one per base (`docs/console/base-permissions.md:19`). The player-carried
family is separate: `searchItemsInPlayerInventory` (`:17194`) and `playerInventory` (`:2759`,
backpack `inventory_type = 0`, `PLAYER_BACKPACK_INVENTORY_TYPE` at `:2703`).

### F2. Item-id namespace: mentat catalog `id` = `dune.items.template_id` namespace
v1 evidence is unchanged. Core's `adminItemMetadata()` keys by `item.id` (`duneDb.js:7185`–`:7200`),
and `inventoryProvider.js:48`–`:49` looks up `metadata.get(String(templateId))` for live rows.
mentat's catalog is a deduplicated copy: Core has 2,558 rows with 7 duplicate ids, mentat has
2,551, and neither side has an id the other lacks. All 27 bridge ids are present in Core's file.

Re-verified for v2 with a script over both catalogs:
- every id matches `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, with a maximum length of 60;
- no two ids collide case-insensitively.

**Correction to v1 F2.4.** "No two catalog ids differ by case" is true, but it does *not* make
case-sensitive matching safe. Core's own L2-audit comment states that "the engine/DB treats
template ids case-insensitively (refillBaseGenerators matches fuels with lower())"
(`duneDb.js:10191`–`:10193`), and Core matches with `lower()` elsewhere (`:9300`, `:11224`,
`:11304`). v2 therefore matches case-insensitively (§4.3). Because the catalog has no case
collisions, mapping a matched row back to the requested id is 1:1.

Catalog categories matter for §5.3. Of the 27 bridge ids, 26 are `resources` and `Oil` is
`consumables`. Simple goals may target any of the 2,551 catalog items, including weapons,
clothing, vehicles and placeables.

### F3. The Discord-adapter route pattern (`PLAYERS_FIND`)
- Route constant: `adapter.js:70`. It is listed in `DISCORD_LIVE_ADAPTER_ROUTES` at `:165`.
- Handler: `integrations/discord/routes.js:605`–`:619`. It runs, in order,
  `readJsonWithActorSignature` → `validateDiscordActor` → `requireDiscordCapability(INVENTORY_READ)`
  → `requireLinkedPlayer` → provider. **The target player comes only from the actor.**
- `readJsonWithActorSignature` (`routes.js:200`–`:215`) behaves differently depending on
  configuration:
  - When a secret is configured, *every* route requires a valid signature.
  - When no secret is configured, only routes passing `requireActorSignature: true` reject.
  - The `fields` option can merge `body.params` into the signed payload. This is the
    mechanism the write bridge uses after Core issue #1070.
- `getLinkedPlayer` (`duneDb.js:16525`–`:16550`) returns one character: the single-link row,
  otherwise the multi-account default. It returns `player_pawn_id` as
  `coalesce(ps.player_pawn_id::text, '0')` (`:16530`, `:16542`). It deliberately ignores
  per-guild character state (`:16597`–`:16600`).
- `commandCatalog.buildCommandCatalog` throws if a live route and its `COMMAND_METADATA` entry
  do not match in both directions (`commandCatalog.js:737`–`:745`).
- PLAYERS_FIND has **no `audit()` call**. `audit(config, req, action, detail)` (`audit.js:69`)
  appends one JSON line with timestamp, method, path, remote address, principal and a redacted
  `detail` to `config.auditLog` at mode 0600.
- No limiter exists on inventory reads. The only limiters are the link/verify ones
  (`linkProvider.js:46`, via `createLoginRateLimiter` from `rateLimit.js`).

### F4. `INVENTORY_READ` is moderator-and-up
In `policy.js:107`–`:128`, the `observer` ("Player") set is STATUS, CORIOLIS, ATLAS, READINESS
and SERVICES. INVENTORY/STORAGE/GUILD_READ first appear in `moderator`. `admin` and `owner` are
computed as all non-self-scoped capabilities (`:146`–`:147`). mentat nevertheless registers
`player:find`/`player:inventory` as `role: "player"` (`src/commands.js:1864`–`:1866`). This
possible gap in the *existing* commands is tracked as **mentat#433** (open). The design needs
a new Player-tier capability either way.

### F5. Base inventories: Core already has the right classification
`BASE_INVENTORY_TYPES` (`duneDb.js:12559`–`:12640`) is an explicit `lower(building_type)`
allowlist with four groups:

| Group | Building types |
|---|---|
| Storage | 6 container types |
| Refining | 8 refineries |
| Crafting | 9 fabricators |
| Other | Recycler, Repair Station, Sub-Fief totems |

Its header comment (`:12514`–`:12558`) says grouping must not key on `inventory_type`, because
Recycler and Repair Station share type 3 with the oil generators. Anything unlisted is omitted
rather than bucketed. `baseInventory` (`:12713`–`:12745`) adds `inv.max_item_count >= 0`, which
drops the uncapped second inventory every refinery and fabricator carries. It also joins
`inventory_types it on it.building_type = lower(p.building_type)` and filters
`p.is_hologram = false`. `baseInventoryTypeParams()` (`:12650`) passes the allowlist through
`unnest()` so no building type is interpolated into SQL.

Generators are a separate family, `GENERATOR_TYPES` (`duneDb.js:9183`), with building types
such as `generator_placeable` and `spicegenerator_placeable`. Their refill templates are `Oil`,
`SpicedFuelCell` and `WindTurbineLubricant1/2`, which are exactly the bridge's fuel and
lubricant ids (DBA-1).

### F6. Query cost and safety facts
- The Core pool has `max: ADMIN_DB_POOL_SIZE || 5` and `connectionTimeoutMillis: 3000`
  (`db.js:53`–`:54`). It is shared by the whole console API, including the web console and every
  adapter route. `db.transaction` holds a dedicated client for the whole transaction and issues a
  bare `begin`, i.e. READ WRITE at READ COMMITTED (`db.js:73`–`:90`).
- `runOpsProvider` (`routes.js:136`–`:142`) sets a transaction-local `statement_timeout`.
- `dune.inventories.actor_id` is already indexed (`CHANGELOG.md`, issue #935 entry). Production
  already runs an inventory-driven `left join dune.items i on i.inventory_id = inv.id` per request
  (`baseInventory`, `playerOwnedStorageQuery`). Whether `dune.items(inventory_id)` is indexed is
  still unknown (U4). No replica exists.
- `dune.items.stack_size` is `bigint not null check (stack_size > 0)` (production-shape fixture,
  `test-support/baseContainerFixture.js:93`–`:103`). **Correction to v1 F6:** `sum(bigint)` returns
  **numeric**, not bigint. Both arrive in node-postgres as strings. NULLs come from `sum(...)
  filter (...)` when no row passes the filter, not from `stack_size`.
- `dune.inventories.actor_id` is nullable. An inventory can belong to an exchange, an item or a
  vehicle module instead of an actor (`baseContainerFixture.js:69`–`:81`).
- Integration tests use `withIsolatedDatabase` (`test-support/pgIntegrationDb.js:102`–`:112`). It
  **skips** when Postgres is unreachable locally and **throws** when `CI` is set. Core CI
  provisions `postgres:17-alpine` (`.github/workflows/ci.yml:42`–`:43`).

### F7. mentat multi-tenant facts
- Goals exist only in multi-tenant/DB mode (`src/commands.js:557`–`:566`).
- The `guilds` row holds one `console_url` and one `adapter_token` per guild
  (`src/database.js:16`–`:37`). The token is encrypted at rest through the KEK/DEK
  `encryptColumn`/`decryptColumn` path (`database.js:478`–`:535`). `stats_push_secret`
  (schema v6) is the precedent for a **nullable, encrypted, per-guild secret column** added by a
  guarded `ALTER TABLE` (`database.js:24`–`:32`, `:285`–`:297`).
- `getGuildConfig` returns `null` for a missing or non-`active` guild (`src/index.js:164`–`:177`),
  and `AdapterClient._resolveConfig` then **silently falls back** to the process-global config
  (`src/adapterClient.js:277`–`:283`).
- The actor-signing secret is **one process-wide value**: `actorSignatureSecret()` reads
  `DUNE_DISCORD_ACTOR_SECRET(_FILE)` from `process.env` (`src/actorSignature.js:79`–`:88`), and
  `signedHeaders()` returns `{}` (unsigned) when it is empty (`:163`–`:170`). There is no
  per-guild signing secret anywhere in mentat.
- mentat's `actor` does not currently carry `interactionId`, although it is in both sides'
  `SIGNED_ACTOR_FIELDS` (`src/actorSignature.js:38`; Core `actorSignature.js:49`). The signature
  skew window is 30 s (Core `actorSignature.js:29`).

### F8. mentat cooldown, visibility and command budget facts
- `src/cooldown.js` has one global duration: `DUNE_COOLDOWN_MS` (default 5000), or admin 1000.
  It keys on `${userId}:${commandName}`, is checked at `commands.js:473`, and is applied after
  every run, including errors (`:996`). There is no per-command duration. The `guild_settings.
  cooldown_ms` column exists but `cooldown.js` does not read it.
- `deferReply` fixes visibility once, before dispatch:
  `ephemeral: forcedPublic ? false : config.discord.defaultEphemeral` (`commands.js:500`–`:504`).
  `forcedPublic` comes from a write-action flag. It is not a reusable per-command override.
- The `/dune` command's Discord character budget, measured this session with the test's own
  `discordCommandCharBudget` over `commandDefinitions({ includeWriteGroup: true })`, is
  **7473**. The test target is 7500 (`test/commands.test.js:1976`) and Discord's hard limit is
  8000. Goal subcommands already use one-word option descriptions ("Id.", "Qty.").
- Precedent for owner-only, expiring button confirmations exists:
  `src/writeConfirmation.js:30`, `:116`–`:124` (a `pendingConfirmations` map with nonce,
  `userId`, `expiresAt`) and `:202` (button handler).
- `goalTransaction(db, fn) = db.transaction(fn).immediate()` is **on `main`**. PR **#435** (which
  fixes #428) merged 2026-09-30T00:18Z as `db3db83`, and the function is at `origin/main`
  `src/commands.js:1314`. (v2 said #435 was open. That was stale; corrected per R2 D25.)
- The goal audit table has columns `id, goal_id, action, actor_id, node, previous_quantity,
  new_quantity, created_at` and no provenance column (`database.js:189`–`:199`).
  `appendGoalAuditLog` inserts an explicit column list (`database.js:1367`–`:1372`). The bundled
  SQLite is 3.53.2, so `ALTER TABLE ... DROP COLUMN` is available.
- **Schema v9 is already taken.** `main` is at `SCHEMA_VERSION = 8`. Open PR **#384**
  (`issue/372-service-duty-apply-component`) claims **v9** (`guild_settings.on_duty_role_id`).
  The production deploy branch `deploy/deploy` already carries that v9 migration
  (`database.js:343`–`:349` there) and is not merged to `main`. Any database run by that build is
  therefore already at version 9.
  - A second, different "v9" migration would be silently skipped on that database, because its
    guard `version < 9` is false. The first read of the new column would then throw.
  - This design therefore uses **v10** (Phase 2a) and **v11** (goal provenance).
  - **The real gate is mentat#438, not just #384** (R2 D16). The local `deploy/deploy` ref
    (`be8f605`, 2026-09-17; not re-fetched from the bot VM, so it may be stale) carries 22 commits
    not on `origin/main` and lacks 20 `main` commits, including the write-bridge signing rewrite
    (#406/#414) and Phase 3 goals (#430/#435). Its `src/actorSignature.js` exports no
    `writeBridgeSignedHeaders`. #384 is still a **draft**.
  - No migration from this design lands until #438 is resolved: the deploy branch reconciled with
    `main`, deployed on its own, and verified (§3.5.2, §13 A0).

## 3. Tenant, Instance and Credential Model

### 3.1 `[D16]` One guild = one Core; strict resolution; no fallback
- **Invariant:** a Discord guild reads live stock from exactly one Core, the `console_url` of its
  own **active** `guilds` row. A guild that runs several battlegroups or instances (Instance 1/2/3
  in `multi-server-config.py`, or prod and dev both attached to one Discord) is **unsupported in
  v1**. It gets whichever single Core it registered, and the docs say so.
- **Strict, atomic resolution (NET-1; R2 D11, ruling R2-D):** every adapter call that carries a
  guild id goes through one resolver, `resolveGuildRequestContext(guildId, { purpose })`.
  - It returns `{ coreUrl, token, secret, signing }` from **one** read of the guild's `guilds` row.
    `signing` is `"per_guild"`, `"process"` or `"none"`.
  - In multi-tenant mode it **never** falls back to the process config (`this.config`) for a
    guild id. An unregistered, inactive or suspended guild throws `guild_unregistered`; for this
    feature that is `live_stock_guild_unregistered`.
  - Calls with **no** guild id keep the process config unchanged. Those are single-tenant mode and
    the system paths in `scheduler.js:49-122` and `notifications.js:105-112`.
  - `request()` asserts `actor.guildId === guildId` whenever both are present, and throws
    otherwise (C2-4).
  - `playerStock()` uses `purpose: "stock"`. Every other route uses `purpose: "legacy"`.
  - **Requirement 0 gate.** This changes behaviour for guild-scoped *background* paths
    (`atlasRefresh.js:47`, `statsPusher.js:73`). For an inactive guild they now refuse instead of
    reaching the operator's Core. Interactions are unaffected: `commands.js:399-422` already
    blocks non-active guilds. **U13 is therefore a hard A0 precondition:** the operator's own
    guilds must be active `guilds` rows before 2a deploys.
  - Tests: an inactive, unregistered or suspended guild makes **zero** adapter calls and shows the
    §6.5 message (M-T3, A-T17).
- **Source label (NET-5, UX-6; R2 D45):** every preview and apply embed shows
  `Read from: <guild_name>'s game server`. The value comes from mentat's own `guilds` row, never
  from Core, because Core returns counts only.
  - v2 also showed the host part of `console_url`. **That is removed.** The host (a LAN IP:port or
    a console hostname) helps no player decision, and mentat already treats it as sensitive: the
    `setupServer.js` comment for #207 says "do NOT log consoleUrl".
  - The character read is the character Core's `getLinkedPlayer` returns. Its name is not
    returned by the stock route (`[D7]`). Showing the name would need an extra `players/me` call,
    which needs `INVENTORY_READ` (moderator+), so that is out of scope.
  - **R2 D43:** whether `/dune player default` governs Core's `getLinkedPlayer` is **unverified**
    (U16; `duneDb.js:16597-16600` ignores per-guild character state). Layer 2 verifies it. The
    embed copy must then name the selection that actually governs the read, for example "your
    default linked character (set with …)". It must not ship without saying which character was
    read.
- **Persisted source:** the guild id and interaction id go into the audit rows (§7). A later
  dispute can then identify which server produced a number (NET-5, GRC-1).
- **Global goals versus per-guild stock:** personal goals are global across Discord servers
  (Phase 3). The preview always shows the saved value, who set it, when, and **whether it came
  from this server**. That is the node's latest `on_hand_update` audit row, compared with
  `interaction.guildId` (R2 D64):

  `SELECT source, source_guild_id FROM goal_audit_log WHERE goal_id = ? AND node = ? AND action = 'on_hand_update' ORDER BY id DESC LIMIT 1`

  The query is **per node**, never "the goal's last row", because `complete`/`create` rows and
  other nodes would give the wrong answer. `created_at` has one-second resolution, so the query
  orders by `id`. `idx_goal_audit_log_goal` serves it. A NULL `source` renders "set manually or
  before live sync existed".
  If it matches, the preview names this server from its own `guilds` row. If it does not, the
  preview says "last synced from another Discord server" and **never looks up the other guild's
  `guilds` row, name, Core URL or secret** (tenant isolation invariant below). A player who syncs one
  goal from two guilds therefore still sees the warning before overwriting it (FM10, UX-6).
  (Corrected in v2 after the operator's tenant isolation requirement: the earlier text, "last
  synced from Server A" shown in Server B, implied resolving another guild's row.)
- **Tenant isolation invariant (operator requirement, binding).** Each Discord guild is a distinct
  tenant bound to its own `guilds` row: its own encrypted `adapter_token`, its own `console_url`
  and (after Phase 2a) its own `actor_signing_secret` (`src/database.js:19-20, 519-549`). There is
  one shared `DISCORD_BOT_TOKEN` (`src/config.js:212`); isolation is the per-guild row. **There are
  no cross-guild commands.** For this feature:
  - `goal sync` and its Apply buttons take **no guild, tenant or server parameter**; the guild is
    only ever `interaction.guildId` (for buttons, the guild of the button interaction, which must
    equal the guild stored with the preview, else the button refuses).
  - A stock query for guild A uses **only** guild A's `console_url`, `adapter_token` and verified
    per-guild signing secret, all returned by **one** `resolveGuildRequestContext(A, { purpose:
    "stock" })` call. It can never use guild B's values, the process config or the process-wide
    secret.
  - **One signer per Core (R2 D14, ruling R2-E).** Core holds exactly one active secret
    (`actorSignature.js` `actorSignatureSecret`). mentat therefore refuses per-guild provisioning
    for a `console_url` that another active guild row uses, or that equals the process config's
    adapter base URL. It replies `actorSigning: "refused", reason: "shared_core"`, and the Core's
    pending secret simply expires. What to do about the operator's default-config Core is
    **OD 14**.
  - The only cross-server state is the user's **own** personal goal (global by Phase 3 design);
    nothing guild-scoped from another guild is read.
  - The pre-existing process-wide actor secret that `purpose: "legacy"` routes still use for
    unprovisioned guilds (§3.5.5) is shared by value but never selects a tenant: every request still
    goes to the invoking guild's own `console_url` with its own `adapter_token`. It is never used for
    stock, and retiring it is a follow-up (§17).
  - Tests: M-T24 (below).

### 3.2 `[D19]` Rollout control: per-guild allowlist, restart to change
- The kill switch is `MENTAT_LIVE_STOCK_GUILD_IDS`, a comma-separated list of Discord guild ids
  (snowflake-validated). **Empty or unset means off everywhere** (ARCH-7, CLOUD-4, QA-6). It
  replaces v1's process-wide `MENTAT_LIVE_STOCK_ENABLED`.
- Sync works in a guild only if **both** of these hold:
  - the guild is on this allowlist; and
  - the guild has a **verified per-guild signing secret** (Phase 2a, §3.5.6).

  The allowlist controls rollout. The secret requirement is a security precondition. Neither
  can substitute for the other.
- `config.js` parses it once at startup, like every other env setting (`loadConfig`,
  `config.js:145`). A malformed entry is a startup warning and that entry is ignored, rather than
  a crash.
- **Changing the list is an edit of the bot VM's `.env` plus a restart of `acp-bot.service`.**
  That is a Live Systems restart and needs explicit operator confirmation under Requirement 7.
  It is *not* an instant kill switch, and the rollback text below says so.
- The slash command is registered globally, so it is **visible in every guild**. In a guild not
  on the list it replies "Live stock isn't enabled for this server yet. You can still set on-hand
  numbers with `/dune goal on-hand`." and makes no adapter call.
- A Core-side off switch is not provided. Core's controls are: revert the route, disable the
  adapter (`discordAdapterEnabled`), or remove the Player-tier grant.

### 3.3 `[D18]` Actor signing in multi-tenant mode — **DECIDED: per-guild secret (Phase 2a)**
**Problem (ARCH-1, CLOUD-2, CLOUD-3, SEC-3, GRC-8).**
- `[D10]` requires a signed actor.
- mentat signs with one process-wide secret (F7), while goals, and so this feature, exist only in
  multi-tenant mode, where every guild has its own Core.
- A tenant Core can verify only if it holds **the same** secret. Every participating tenant
  operator would then hold a key that signs for every other participating Core. Exploiting that
  also needs the victim Core's per-guild bearer token, which bounds it. The key-hygiene, rotation
  and blast-radius problems are real regardless.
- If a tenant is not given the secret, the route rejects every call with `actor_signing_disabled`.

**What the privacy invariant actually rests on.** "A player can only read their own stock" is
enforced by two things:
- (1) mentat builds `actor.userId` from `interaction.user.id`. A Discord user cannot name
  anyone else.
- (2) Core derives the target from `actor.userId`. There is no target field.

Signing protects against a third party: someone who holds the bearer token, but is not mentat,
naming an arbitrary `userId`. On a tenant Core, the bearer holders are mentat and that tenant's
operator, who already has direct DB access. Signing therefore mainly protects against a
**leaked bearer token**.

Current posture is also worth recording:
- On an unsigned Core, a bearer holder can *already* claim moderator `roleIds` and read
  PLAYERS_FIND for anyone, which discloses far more than this route.
- On a signed Core, every route already requires the signature (F3).

**Options.**

| # | Option | Security | Cost | Who can use it |
|---|---|---|---|---|
| A | **Per-guild actor secret column**. `guilds.actor_signing_secret`: nullable, KEK/DEK-encrypted like `adapter_token`/`stats_push_secret`, entered by the tenant in the setup portal. An explicit-secret signing helper takes the per-guild secret. (v3: the helper is `signHeadersWithSecret`, §3.5.5; v2's `signedHeaders(actor, route, { secret })` collided with the existing `env` parameter, R2 D13.) NULL means that guild is unsigned. | Best. Per-tenant key, per-tenant rotation and revocation (Requirement 27). No shared key. It also fixes the **same pre-existing gap in the write bridge**. | Schema v10 + migration (Requirement 26), setup-portal UI, encryption, a rotation runbook, a signing-API change touching the write bridge. It is its own design. | Any tenant who configures a secret. |
| B | **HKDF-derived per-guild key** `K_g = HKDF(master, info="mentat-actor-sig:v1:"+guildId)`. The operator hands `K_g` to tenant g. | Master compromise exposes all tenants. Rotation is all-at-once unless a stored version is added. **Two guilds sharing one Core break**, because Core holds one secret. | No schema change, but a delivery channel for `K_g` is still needed. | Tenants who were handed their `K_g`. |
| C | **Restrict v1 to guilds whose Core already shares the bot's secret**, i.e. the operator's own Cores (dune-dev, dune-prod). This is enforced by the §3.2 allowlist. The global secret is never given to a third-party tenant. | No new key sharing. Same posture as today's write bridge. | None beyond §3.2. | Operator-run guilds only. |
| D | **Signature optional**, like every sibling read route: verified if the Core has a secret, accepted unsigned otherwise. | On an unsigned Core, a leaked bearer can read any linked user's stock counts. That is strictly less than PLAYERS_FIND already discloses there, but it is a new Player-data read. | None. | Every tenant. |

**DECIDED 2026-09-29 (operator): option A, a per-guild encrypted signing secret.** It is
specified as its own deliverable, Phase 2a, in §3.5, and ships before the stock route and the
sync command.

The other options are recorded as rejected:
- **C** (restrict to guilds sharing the bot's secret) leaves hosted tenants without the feature
  and keeps a shared key alive.
- **B** (HKDF-derived keys) breaks two guilds sharing one Core and concentrates risk in one
  master key.
- **D** (optional signature) removes the only defence against a leaked bearer on the route that
  turns a Discord link into a data-read credential (SEC-2).

`playerStock()` obtains its secret from `resolveGuildRequestContext(guildId, { purpose: "stock" })`
(§3.1, §3.5.5). For the stock route this returns only the guild's **verified per-guild** secret,
and never the process-wide one.

### 3.4 Secret lifecycle summary (CLOUD-1, CLOUD-2, CLOUD-8, GRC-8)
Phase 2a introduces **one new credential per guild**. Requirement 27 therefore applies in full.
§3.5.3 covers provisioning, §3.5.4 rotation and §3.5.7 failure diagnosis.

- **Fail-closed in mentat (CLOUD-1):** `playerStock()` refuses to send a request unless the guild
  has a verified per-guild secret. It never sends an unsigned stock request, and never falls back
  to the process-wide secret (§3.5.5).
- **Distinct secrets per environment (CLOUD-8; R2 D04):** dune-dev and dune-prod each get their
  own per-guild secret and their own bearer. For a Core-generated candidate this holds by
  construction. For an `existing` secret, mentat refuses to store a value equal to its
  process-wide secret, so shared values can never become per-guild rows (§3.5.3). Operator guilds
  are provisioned by **regenerating** on Core, never by pasting a value the Core already holds.
  The UAT prerequisites check it (§11.4).

### 3.5 Phase 2a — Per-guild actor signing secret (own PRs; ships BEFORE the sync command)

**Scope.** mentat stores, for each registered guild, the HMAC secret that guild's Core uses as
`DUNE_DISCORD_ACTOR_SECRET`. mentat signs every signed adapter request for that guild with it.

It needs a Core change (Core#1088):
- Core generates a **pending** secret that it never enforces, and forwards it at hosted
  registration.
- Core exposes a signature check route with `verify`, `promote` and `revert`.
- Core accepts signature v2, which signs `guildOwnerId`.
- Core displays the signing state and a fingerprint.

It ships as **two PRs**, **mentat first, then Core** (R2 D01). Each PR gets its own Layer 1 (this
section; round 2 done), Layer 2 and Layer 3 audits. Core follows the same Requirement 18 hand-off
as §4. Nothing in Phase 2a reads game data.

#### 3.5.1 What exists today (verified)

| Fact | Evidence |
|---|---|
| `guilds` holds one `console_url` + `adapter_token` per guild. `adapter_token` is written through `encryptColumn` and read through `decryptColumn` (`getGuild`). | mentat `src/database.js:16`–`:37`, `:478`–`:535`, `upsertGuild` `:537`–`:560` |
| `encryptColumn` uses a **per-row DEK** wrapped by the KEK when one is configured (`secret_keys` keyed by table/row/column), else the legacy v1 single-key path. Every encrypt/decrypt is logged to `secret_access_log`. If **no** key is configured at all, values are stored in **plaintext**, and startup only logs `security.secrets_at_rest_unencrypted`. | `database.js:66`–`:122`, `:436`–`:505`; `src/index.js:86`–`:100` |
| `stats_push_secret` (schema v6) is the precedent for a nullable, encrypted per-guild secret. It was added by a guarded `ALTER TABLE`. **The secret is generated on Core and pasted back** by the operator in the setup portal (`setGuildStatsSharingSecret`). | `database.js:24`–`:32`, `:285`–`:297`, `:1172`–`:1190`; `src/setupServer.js:440`–`:441`, `:587`–`:590` |
| The legacy setup form collects `adapterToken` and `statsPushSecret` as **`type="text"`** (visible) inputs. It has no "edit my existing guild" path, and **no issue tracks one**. (v2 cited mentat#312 here. #312 is stats-sharing revocation, which itself *depends on* such an entry point: corrected in R2 D08.) Re-submitting the whole form is the only update path. Phase 2a adds a secret-only update path (§3.5.11, mentat#447). | `setupServer.js:388`–`:389`, `:440`–`:441`, `:572`–`:585` |
| The hosted flow is **Core-initiated**. Core reads its own adapter bearer (`readDiscordBotApiToken`) and POSTs `{guildId, discordAccessToken, consoleUrl, adapterToken}` to mentat `POST /api/consoles/register`, or `{consoleUrl, adapterToken}` to `/api/consoles/auto-invite/start` via mentat-link's proxy (`requireProxySecretFailClosed`). | Core `server.js:2380`–`:2396`, `:2473`–`:2490`; mentat `setupServer.js:781`–`:802`, `:843`–`:866` |
| Core **generates** its adapter bearer server-side (`randomBytes`) into `runtime/secrets/discord-adapter-token.txt`. It writes only a hardcoded set of `.env` keys, and clears the direct env var when minting a file token, because a direct var silently wins. It also sets `process.env[...]` **in-process** (`:278`–`:280`), because compose interpolates `.env` only at container create. `MANAGED_ENV_KEYS` has player, moderator and admin role keys, but **no owner role key**. | Core `integrations/discord/adapterSettings.js:1`–`:40`, `:278`–`:280`; `docker-compose.web.yml:99`–`:100` |
| Once signing is on, Core **strips** the unsigned `actor.guildOwnerId` on every route. Owner tier (`discordActorTier`) checks `isRealGuildOwner` first, then `ownerRoleIds`. The #691 comment requires a coordinated signed-field rollout before the strip may go. | Core `routes.js:212`–`:214`; `policy.js` `discordActorTier`, `isRealGuildOwner`; mentat `src/rbac.js:187`–`:213` |
| Core's hosted register POST uses `fetchWithTimeoutAndRetry(..., { timeoutMs: 15000 })`, which **retries once** on a timeout or 5xx. Core's server proxies and acts on auto-invite `confirmation-status`. | Core `server.js:2383`–`:2397`, `:2592`ff; `services/httpWithRetry.js` |
| The auto-invite `/start` receives only `{consoleUrl, adapterToken}`, with **no guild id**. `upsertGuild` happens only at owner Confirm. | mentat `src/setupServer.js:843`–`:866`, `:880`–`:900` |
| Core's actor secret comes from `DUNE_DISCORD_ACTOR_SECRET`, else `_FILE`, read **per request**. There is **no** Core UI or generation path for it: it is `.env`/compose only. `config.discordActorSecret(File)` is read but never set anywhere. | Core `actorSignature.js:104`–`:117`; `.env.example:191`–`:192`; `docker-compose.web.yml:99`–`:100` |
| Core error codes: `actor_signing_disabled` (no secret, route requires one), `missing_actor_signature`, `invalid_actor_signature` (bad timestamp format or mismatch), `stale_actor_signature` (outside the skew window, default 30 s, env 5–300). All are 403. | Core `actorSignature.js:212`–`:240`, `:29`–`:43` |
| mentat signs in exactly **one** place: `AdapterClient.request()`. It uses `writeBridgeSignedHeaders` for write routes and `signedHeaders` otherwise. Both read the **process-wide** secret, `actorSignatureSecret(process.env)`, and return `{}` (unsigned) when it is empty. | mentat `src/adapterClient.js:455`–`:473`; `src/actorSignature.js:79`–`:88`, `:163`–`:170` |
| Core holds **one** secret for **all** routes. When it is set, every adapter route requires a valid signature. | Core `routes.js:200`–`:215` |

#### 3.5.2 Schema (Requirement 26)
Schema **v10**, following #384's v9 (F8):

```sql
ALTER TABLE guilds ADD COLUMN actor_signing_secret TEXT;              -- encrypted (encryptColumn); NULL = not configured
ALTER TABLE guilds ADD COLUMN actor_signing_secret_set_at TEXT;       -- when stored
ALTER TABLE guilds ADD COLUMN actor_signing_secret_verified_at TEXT;  -- last successful self-check (§3.5.3); NULL = never verified
```

- **Column properties:** nullable, no default. NULL means "not configured", which follows the
  `stats_push_secret` convention and keeps "not set" distinct from an empty string. The
  fresh-install `CREATE TABLE guilds` gains the same columns.
- **Migration code: fail closed (R2 D05, ruling R2-F).** Do **not** copy the v6 idiom verbatim.
  That idiom (`database.js:285`–`:297`) wraps each `ALTER` in a catch-all. The final block
  (`:322`–`:338`) then bumps `schema_version` whenever `version < SCHEMA_VERSION`, whether or not
  the `ALTER`s succeeded. Phase 2a reads the new column on every signed request, so a swallowed
  SQLITE_BUSY during a deploy restart would become a bot-wide outage that no retry can repair. v10
  therefore:
  - runs its three `ALTER`s **and** its own version bump inside one `db.transaction` (SQLite DDL
    is transactional);
  - catches only `/duplicate column name/i` and rethrows everything else, so a failure leaves the
    version at 9;
  - after all migrations, asserts that `PRAGMA table_info(guilds)` contains the three columns, and
    refuses to start (a loud startup error) otherwise;
  - does the same for v11 on `goal_audit_log` (§7);
  - sets `SCHEMA_VERSION` to 10.
- **Implementer trap (R2 D66).** `db.exec(SCHEMA)` runs **before** the `ALTER` blocks
  (`database.js:257` vs `:285`). A `CREATE INDEX` on a new column placed in the `SCHEMA` constant
  would throw `no such column` on every upgraded database. No index is added here. A test upgrades
  frozen v8, v9 and v10 fixture databases with the new code.
- **Goal provenance (§7) is v11.** It lives in a different PR (2b). The two cannot share one
  migration unless both PRs merge as one, which the delivery order rules out.
- **Precondition (R2 D16):** **mentat#438 is resolved.** That means the deploy branch is reconciled
  with `main` (either #384 lands, or its v9 migration is extracted), and that reconciled build is
  deployed and verified **on its own** before 2a. "#384 merged" alone is not enough.
  - The implementer must **never** reuse 9, because the deploy branch has already applied a v9.
  - The 2a PR adds a static test asserting that migration guards are strictly ascending and that
    `SCHEMA_VERSION` equals the highest guard. #384's v9 DDL on `main` must be byte-identical to
    `deploy/deploy`'s. A-T2's v9 fixture is taken from that DDL, frozen as a literal (QA2-20).
- **Backward compatibility:** every existing query names its columns or uses `SELECT *` plus a
  spread. Old code ignores the new columns.
  - `getGuild` is **not** changed to decrypt the new column (see §3.5.5), so a decrypt failure
    cannot widen the blast radius, which was the same concern as `getGuildStatus`'s mentat#316
    fix.
  - **`getGuild` omits the column (R2 D19).** Its `SELECT *` plus spread (`database.js:532`–`:535`)
    would otherwise carry `actor_signing_secret` into every guild object: ciphertext, or the live
    key if encryption were ever off. It deletes the key from the returned object. A-T10 asserts
    the key is absent and that a canary value never appears in `JSON.stringify(guild)`.
- **Rollback SQL:**
  ```sql
  ALTER TABLE guilds DROP COLUMN actor_signing_secret_verified_at;
  ALTER TABLE guilds DROP COLUMN actor_signing_secret_set_at;
  ALTER TABLE guilds DROP COLUMN actor_signing_secret;
  DELETE FROM secret_keys WHERE table_name = 'guilds' AND column_name = 'actor_signing_secret';
  UPDATE schema_version SET version = 9;
  ```
  SQLite 3.53.2 is bundled.
  - **Rollback is forward-only once any guild is provisioned (R2 D17, ruling R2-F).** "Leave the
    columns" is schema-compatible, but **not behaviour-compatible**. Any rollback below 2a, whether
    this SQL or only a code revert, makes every provisioned guild sign with the process secret
    again. Its Core holds a different, per-guild value, so every signed route for that guild
    fails. For a hosted tenant, only that tenant's operator can fix it (Requirement 7, on
    infrastructure the bot operator does not own). Therefore:
    - **Before** any guild is promoted: a revert and this SQL are safe.
    - **After** any guild is promoted: "rollback" means deploying a build that still reads the v10
      columns (keep the resolver). The rollback SQL and a code revert below 2a are **not** used.
    - The code-rollback pre-check is mandatory in both cases: run
      `SELECT guild_id FROM guilds WHERE actor_signing_secret IS NOT NULL`, and list the Cores that
      must be reverted with the Core check route's `revert` inside its window, or re-keyed by
      their operators.
    - Rollback order: v11 (§7) before v10.
- **Requirement 26 evidence:**
  - Copy the production mentat SQLite at the same size and structure. The copy is taken by the
    operator, not by this session, with `sqlite3 .backup` or `db.backup()` rather than a file copy
    of a WAL database.
  - Sanitise it (R2 D39): replace every secret column with dummy ciphertext, delete or replace
    `secret_keys.wrapped_dek` and `secret_access_log`, and replace the Discord user ids in every
    goal and audit table. Requirement 26 says "not real player data".
  - Run the v9→v10 migration on the copy. Record the timing and the before/after row count, and
    confirm that `getGuild` and `upsertGuild` still work.
  - Run the rollback SQL on the copy and confirm that v9 code starts on it.
  - Post the results in the Phase 2a tracking issue.

#### 3.5.3 Provisioning: the pending/promote handshake (R2 D01, D04, D06, D14, D15, D18, D20; ruling R2-A)

**Binding rule (ruling R2-A).** Core **never enforces a secret that mentat has not verified.**

v2 had Core write and enforce the secret *before* the push to mentat. Core reads the secret per
request (`actorSignature.js` `actorSignatureSecret`), and once any secret exists **every** adapter
route rejects missing or wrong signatures (`routes.js:200`–`:215`). A failed or partial connect,
a rotation whose push failed, or a Core released before mentat 2a therefore became a total
signed-route outage that the UI reported as success. The fork is public, so that would reach other
operators (Requirement 0). v3 replaces the v2 flow with the handshake below.

**Generation.** A candidate secret is always **256 random bits** from `crypto.randomBytes(32)`,
encoded as 64 lowercase hex characters. It is generated on **Core**, never in a browser. That
follows the `stats_push_secret` and adapter-token precedents; the browser-generated pattern was
tried and removed in mentat#194.

**Core states (Core#1088 K1/K2).**

| File (`runtime/secrets/`) | Read by `actorSignatureSecret()`? | Lifetime |
|---|---|---|
| `discord-actor-secret.pending.txt` | **Never.** Only the check route verifies against it. | The flow that created it: at most 15 min for hosted or auto-invite, at most 24 h for manual paste. Deleted on expiry. |
| `discord-actor-secret.txt` (active, managed) | Yes, per request | Until the next promote or revert |
| `discord-actor-secret.txt.prev` | **Never** | Written by promote; **deleted 15 min after promote** (R2 D22). Its only use is `revert` inside that window. |

- Every write is a temp file at mode 0600 followed by `rename()`, so a reader never sees a torn or
  empty file (R2 D29).
- On promote, K1 sets `DUNE_DISCORD_ACTOR_SECRET_FILE` both in `.env` (added to `MANAGED_ENV_KEYS`)
  **and** in `process.env` in-process, like the bearer at `adapterSettings.js:278`–`:280`. Compose
  interpolates `.env` only at container create (`docker-compose.web.yml:99`–`:100`), so writing
  `.env` alone would not reach the running process (R2 D18).
- **Fail closed on the managed file (R2 D29).** If the *managed* path is configured but unreadable
  or empty, Core treats signing as enabled with no valid secret: it rejects everything and logs one
  loud line. Today `actorSignatureSecret()` returns `""` on any read error, which silently turns
  signing off. An operator-set arbitrary `_FILE` keeps today's behaviour plus a startup warning, so
  existing deployments do not break on update (Requirement 0).

**The handshake. mentat drives it; Core only answers.**

Core starts the flow ("Connect to hosted bot", auto-invite start, "Enable signing" or
"Regenerate") by writing a pending candidate `C`. It then sends
`actorSigning: { mode: "candidate", secret: C }` in the body that already carries `adapterToken`.
mentat then:

1. **Guards (no Core call).** mentat rejects `C` and replies `actorSigning: "refused"` with a reason
   code, storing nothing, if:
   - `C` does not match `^[0-9a-f]{64}$` after trimming;
   - `C` has fewer than 8 distinct characters (C2-14);
   - `C` equals mentat's process-wide secret, compared in constant time (C2-3);
   - the one-signer-per-Core guard fails (§3.1, R2 D14).

   The pending secret then expires on Core. Nothing changes.
2. **verify.** A dedicated call (below) with `params.op = "verify"`, signed with `C`. Core verifies
   against pending, else active, and returns `{ ok, fingerprint, state, signatureVersions,
   features }`. mentat requires HTTP 200 JSON, `ok === true`, and
   `fingerprint === fp(C)` compared in **constant time** (R2 D20). That is proof that Core holds
   `C`.
3. **promote** (only when `state === "pending"`). The same call with `params.op = "promote"` and
   `params.fingerprint`. Core atomically moves active to `.prev` and pending to active, and audits
   it. It is idempotent: if `C` is already active it returns `state: "active"`.
4. **store.** One synchronous transaction, after the network awaits (R2 D36). It re-reads the guild
   row, requires `status = 'active'` and the same `console_url` and bearer, writes the ciphertext,
   `_set_at` and `_verified_at`, and asserts `changes === 1`.
5. **revert on store failure.** If step 4 throws after a successful promote, mentat calls
   `params.op = "revert"`, signed with `C`. Core restores `.prev`, or for a first generation
   restores "no secret". It is allowed only within 15 min of the promote and only once. mentat
   replies `actorSigning: "failed"` and logs `actor_secret.store_failed_reverted`.
6. mentat replies `actorSigning: "verified", fingerprint`.

**Existing secrets (R2 D04, ruling R2-E).** When Core already has an active secret, either the
direct `DUNE_DISCORD_ACTOR_SECRET` or an existing `_FILE`, Core sends
`actorSigning: { mode: "existing", secret }`. The rules for that path:
- **Core no longer refuses the connect.** v2's refusal blocked the reconnect flow that works today
  (`server.js:2380`–`:2396`). A refusal would be a Requirement 0 regression.
- mentat runs guards 1 and 2 only (`state` must be `active`), with no promote, then stores.
- Consequences:
  - A value equal to the process secret is **refused**. The guild stays on the legacy path, which
    is unchanged and keeps working because Core and bot share that value. This covers the
    operator's own Cores; whether dev and prod share today's value is unverified (U12).
  - A non-conforming format is refused and the guild stays legacy. Core documents no format for
    the actor secret (`.env.example:191`–`:192`), while every Core-generated value is 64-hex.
  - A conforming, distinct value is stored. That guild signed with the wrong key before, so
    storing it fixes it.
- **Regenerate is disabled while the direct var is set.** The direct var wins over the file, so a
  promote would have no effect. The documented migration is: remove the direct var, recreate the
  console container (a Requirement 7 restart), then "Enable signing".
- **v2's advice to "paste the value your Core already holds" is removed.** dev and prod must not
  share a secret. Operator guilds regenerate.

**Idempotency and time budget (R2 D06).**
- Core's hosted register POST has a 15 s timeout and **retries once** on a timeout or 5xx
  (`httpWithRetry.js`). The mentat side of the flow must therefore fit and be repeatable:
  - Each handshake call to Core has a **3 s** timeout.
  - The handshake starts only after Discord ownership verification.
  - If less than **7 s** of a **12 s** response deadline remains, mentat skips the handshake and
    replies `actorSigning: "deferred"`, with no promote. The pending secret expires; the operator
    retries with "Enable signing".
  - A repeated registration for the same guild with the same `fp(C)`, already stored and bound, is
    a no-op success. So is a promote of an already-active `C`.
- **Residual.** If mentat stored `C` after a promote but **both** Core attempts lost the response,
  Core shows a failure but its own state is correct: pending was promoted by mentat. Core's
  settings page reads its file state (§3.5.11), so it displays "active", not the failed request.

**Auto-invite (R2 D15, ruling R2-F).**
- `/api/consoles/auto-invite/start` has no guild id (`setupServer.js:843`–`:866`). mentat therefore
  runs guard 1 (format, entropy, process-secret equality) at `/start`, and carries `C` in the
  `autoInviteSessions` and `pendingOwnerConfirmations` in-memory entries under their **existing
  TTL**.
- `C` is deleted from both entries on resolve or expiry, and never appears in
  `getPendingOwnerConfirmationStatus` or any log. The status payload has an allowlisted shape.
- The one-signer guard and steps 2–6 run at **owner Confirm**, with the confirmed guild id, in the
  same step as `upsertGuild`.
- `confirmation-status` carries `actorSigning` and its code. Core's server already proxies and acts
  on that payload (`server.js:2592`ff).

**Dedicated self-check call (R2 D11, D20).** `checkActorSigning({ consoleUrl, adapterToken, secret,
guildId, op, fingerprint })` is its own function:
- It **never** goes through `AdapterClient.request()` or `_resolveConfig`, so it can never reach the
  process-default Core.
- It also does **not** go through `resolveGuildRequestContext`, which is a deliberate refinement of
  ruling R2-D, recorded in the register. At handshake time the guild row holds the *previous*
  `console_url` and bearer, or no row at all. For auto-invite, `upsertGuild` runs only at owner
  Confirm (`setupServer.js:880`–`:900`), and a pending or inactive row makes the strict resolver
  refuse. The handshake must target the *submitted* URL and bearer. Isolation is kept by taking the
  target explicitly from the registration being processed, never from any other row or the process
  config, as A-T17 asserts.
- It uses the same `secureFetchDispatcher` (mentat#393), `redirect: "error"`, a 3 s timeout and
  signature v2.
- A non-JSON 2xx, a redirect or a fingerprint mismatch is a failure.
- A-T17 asserts with two stub Cores that the process-config Core receives **zero** requests for
  pending, inactive and unregistered guild ids.
- It is called only from registration, owner Confirm, the secret-only update path (§3.5.11) and the
  rate-limited heal re-verify (§3.5.5). v2's "Test signing" button is **dropped**: it would have
  been new ingress (NET2-7, R2 D07).

**Synthetic actor (R2 D52).** One shared fixture, used by K-T4, K-T7 and A-T7:
`{ guildId: <guild being checked>, channelId: "0", userId: <bot application id>, username:
"mentat-signing-check", roleIds: [], interactionId: <fresh id> }`.
- Core's `normalizeDiscordActor` requires `guildId`, `channelId`, `userId` and **`username`**
  (`policy.js:159`–`:168`). `interactionId` is optional and signed. U14 is closed.

**Check route (Core K2).** `POST /api/integrations/discord/actor-signature/check`.
- Auth: bearer plus `readJsonWithActorSignature(req, { requireActorSignature: true, fields:
  [...SIGNED_ACTOR_FIELDS_V2, "params"] })`. The `op` and `fingerprint` are therefore signed.
- It is the **only** route that may verify against the pending secret.
- No capability check and no DB access.
- Rate limit: 10 per minute per bearer.
- Every outcome is audited (`discord.actor_signature.check`, `.promote`, `.revert`) with no secret
  or fingerprint in the line.
- Catalog: `admin:signing-check`, internal.
- The response carries `features` (R2 D41). It is `[]` in 2a; 2b adds `"stock"`.
- On a Core older than K2 the route returns a JSON 404. mentat stores nothing and reports "your Core
  is too old for per-guild signing — update Core".

**Shown once; fingerprint for comparison.**
- mentat **never** displays, returns or logs the secret. Log field names avoid the substring
  "secret", because `format.js`'s `CREDENTIAL_KEY_PATTERN` would redact them wholesale: use
  `signing_set_at`, not `actor_signing_secret_set_at` (R2 D50).
- Both sides display a **fingerprint**: the first 12 hex characters of
  `SHA-256("mentat-actor-secret-fp:v1:" + secret)`. For a 256-bit random secret, a 48-bit hash
  prefix discloses nothing usable.

**Bearer and secret in one body (R2 D31).** The candidate travels in the same registration body as
the bearer, over the same HTTPS path through mentat-link's proxy. One leak of that body is
therefore full impersonation of mentat to that Core. Mitigations:
- mentat-link's Pages Function must not log bodies, and the observability setting is checked at
  its Layer 2;
- value-based redaction (§9);
- status payloads with allowlisted shapes.

Accepting this is **OD 10**. Separate delivery would need a new pull credential from mentat to Core.

**Path 2: self-hosted, via the setup portal.**
- The operator clicks "Enable signing" or "Regenerate" in Core. Core writes a pending `C` and
  reveals it **once**, with a copy button and a show/hide toggle. Enforcement is unchanged.
- The operator pastes it into mentat's `/setup/register` field or the secret-only update path
  (§3.5.11). That runs the same steps 1–6, so **there is no outage window on the paste path
  either**: the old secret keeps working until mentat promotes.
- The field is `type="password"`, `autocomplete="off"`, and never pre-filled or echoed. The
  validation copy says: "must be exactly 64 characters, 0-9 and a-f; copy it from Core's Discord
  settings" (R2 D72).
- **The adapter-token field becomes `type="password"` in the same PR.**

**Distinct per environment.** Core-generated candidates differ by construction, and `existing`
values equal to the process secret are refused.
- A guild pointed at a **cloned** Core (a disk clone, as in the 2026-09 prod1/prod2 history)
  inherits the clone's secret file. The runbook tells the operator to Regenerate after cloning or
  restoring a Core. Mechanical clone detection is deferred (R2 D62, §17).

**Core delta (Phase 2a, Core#1088).**

| # | Change |
|---|---|
| K1 | `adapterSettings.js` and `server.js`: pending generation (temp file + rename, 0600), the `candidate`/`existing` body field on hosted `/register` and `/auto-invite/start`, **no refusal** when the direct var is set, `process.env` updated on promote, fail-closed managed file, pending and `.prev` expiry, and deletion of pending and `.prev` on adapter disable (R2 D28). |
| K2 | The check route with `verify`/`promote`/`revert` as above. |
| K3 | Signature v2: `SIGNED_ACTOR_FIELDS_V2` and the equivalent write-bridge and stock sets, each with `guildOwnerId` added. The header `x-dune-actor-signature-version: 2`. `guildOwnerId` is kept only when v2 verified (§3.5.5, R2 D02). |
| K4 | Discord settings UI: the signing state (§3.5.11), the one-time reveal of the **pending** value, and "Enable signing"/"Regenerate". Reveal, Enable and Regenerate are gated on the console's highest settings permission, with explicit Deny evaluated before Allow, CSRF-protected, and audited with the console session user (`discord.actor_secret.reveal`/`.regenerate`) (R2 D21, D27). |
| K5 | Core redaction keys, docs (§3.5.9) and tests (§3.5.8). |

#### 3.5.4 Rotation, cadence and revocation (Requirements 27 and 7; R2 D01, D22, D27)

**Rotation is the same handshake.** The Core operator clicks **Regenerate**, which creates a new
pending `C'`. The old active secret keeps working until mentat verifies and promotes `C'`, then
stores it. The outcome is the same whichever way it goes:
- **Hosted:** Core pushes `C'` through the registration flow. That needs the operator's Discord
  OAuth session, and the UI re-authenticates **before** creating the pending value.
- **Self-hosted:** the operator pastes `C'`.
- Either way there is **no outage window** on the success path. If the handshake fails, the old
  secret stays active, because nothing was promoted.
- v2's "seconds to minutes" window and **Open Decision 8 (a dual-secret grace) are superseded.**
  The acceptance window ends at promote, not after N minutes.
- The only ways to lose availability are:
  - a mentat store failure after promote, which mentat reverts within 15 min;
  - a stored `C'` that Core later loses (restore from backup, clone). §3.5.12 covers that.

**Rollback.** Core's `revert` op (15 min, once, signed with the new secret). `.prev` is **deleted**
15 min after promote and is never verified against. Restoring `.prev` "to roll back" a
**leak-driven** rotation is forbidden, because it would re-arm the leaked key. The runbook says so.

**Cadence and triggers (R2 D22).** Every **12 months** (recommended; the operator may shorten it),
**and immediately** on:
- suspected compromise of the Core host, the bot VM, a backup or the proxy logs;
- a Core clone or restore;
- a change of the person operating the Core;
- a bearer rotation (the binding rule in §3.5.5 clears the secret anyway).

The status surface shows `signing_set_at`. A secret older than the cadence gets a warning on the
Core settings page.

**Rehearsal (Requirement 27).** Before 2a is called done, the hosted and the manual rotation are
each run on **dune-dev**, with timings and any observed failures recorded. This is an **A4 exit
criterion** (§13), and the evidence is posted on mentat#434.

**The process-wide secret** (`DUNE_DISCORD_ACTOR_SECRET` on the bot VM, still used by unprovisioned
guilds) keeps its existing rotation procedure: both sides, both restarts, and a Requirement 7
confirmation.

**Runbooks (named now, shipped in the 2a PRs):**
- Core `docs/security/actor-secret-rotation.md` (new);
- mentat `compliance/runbooks/actor-signing-secret.md` (new).

Today mentat's `compliance/runbooks/` holds only `backup-recovery.md` and `incident-response.md`,
and Core has no rotation runbook.

**Evidence and attribution (R2 D27).**
- mentat: an `encrypt` row in `secret_access_log`, and the log line `setup.actor_signing_set` with
  the guild id, fingerprint, outcome, **path** (`hosted`, `auto_invite` or `portal`) and **the
  registering Discord user id**.
- Core: audit lines `discord.actor_secret.regenerate`/`.promote`/`.revert`/`.reveal`, with the
  console session user when a person triggered the flow.
- Core's `audit()` has no authenticated-actor identity project-wide. That is Core #910, a linked
  dependency.

#### 3.5.5 Signing resolution, signature v2 and backward compatibility

`resolveGuildRequestContext(guildId, { purpose })` (§3.1) returns `{ coreUrl, token, secret,
signing }` from one row read.

| Guild state | `purpose: "legacy"` (every existing signed route, **including the write bridge**) | `purpose: "stock"` (the new route only) |
|---|---|---|
| No guild id (single-tenant, or system paths) | process config and process secret, or unsigned if unset (**unchanged**, v1 signature) | n/a (goals need the DB) |
| Registered and active, `actor_signing_secret` NULL | own `console_url`/token; process secret, or unsigned if unset (**unchanged**, v1) | **refuse**: `live_stock.signing_not_configured` |
| Registered and active, secret set, `verified_at` set | **the per-guild secret, signature v2** | the per-guild secret, signature v2 |
| Registered and active, secret set, `verified_at` NULL (heal found a mismatch, restore, or manual edit; R2 D03) | **refuse to sign** (log `actor_secret.unverified`) | refuse |
| Registered, secret set, but decrypt fails, or the stored value is not `enc:v1:`/`enc:v2:` (R2 D38) | **refuse to sign** (no request sent; log `actor_secret.decrypt_failed`). It never falls back to the process secret, because that would send a signature Core rejects anyway and would hide the real fault. | refuse |
| Guild id present but unregistered, inactive or suspended | **refuse** (`guild_unregistered`; strict, §3.1; R2 D11). v2 used the process config here. | refuse |
| Resolver query throws (missing column, SQLITE_BUSY) | **refuse** with its own log code, `actor_secret.resolver_error`, distinct from decrypt failure (QA2-3) | refuse |

**Binding (R2 D03, ruling R2-C).**
- In the same transaction as the change, `upsertGuild` clears `actor_signing_secret`, `_set_at` and
  `_verified_at`, and deletes the `secret_keys` row, whenever `console_url` or `adapter_token`
  changes. The comparison uses the raw URL, and the bearer compared through a decrypt of the old
  value; a decrypt failure counts as "changed".
  - The one exception is when the same request's handshake re-verifies a secret. K1 always sends
    `existing` or `candidate`.
  - Evidence: today's `upsertGuild` UPDATE touches only `guild_name, console_url, adapter_token,
    status` (`database.js:538`–`:560`).
  - Accepted cost: a bearer rotation on the *same* Core whose handshake fails transiently leaves the
    guild unprovisioned (fail-closed). A reconnect fixes it.
- `verified_at` is required explicitly for **both** purposes.
- **Heal re-verify.** On `invalid_actor_signature` from a guild signed per guild, mentat runs
  `verify` with the stored secret, at most once per 5 min per guild. If Core reports a mismatch,
  mentat sets `verified_at` NULL and logs `actor_secret.mismatch_detected`. The guild then refuses
  (above) until it is re-provisioned. Nothing falls back to another key.

**Signature v2 and `guildOwnerId` (R2 D02, ruling R2-B).**
- **The v2 claim that "2a changes only which key signs" was false.** Once a Core has a secret, it
  deletes the unsigned `actor.guildOwnerId` (`routes.js:212`–`:214`). Hosted tenants are unsigned
  today and get owner tier through real guild ownership (`policy.js` `discordActorTier` →
  `isRealGuildOwner`). Enabling signing would therefore drop them to whatever their roles map to.
  The hosted wizard cannot set an owner role: `MANAGED_ENV_KEYS` has no owner key.
- **Decision: option (a), sign it.** v2 field sets are each v1 set plus `guildOwnerId`:
  `SIGNED_ACTOR_FIELDS_V2`, `WRITE_BRIDGE_SIGNED_ACTOR_FIELDS_V2` and
  `STOCK_SIGNED_ACTOR_FIELDS_V2`.
  - mentat sends `x-dune-actor-signature-version: 2` for every per-guild-signed request. Core
    verifies with the set the header names, and keeps `guildOwnerId` **only** when v2 verified. On
    v1 it strips the claim exactly as today.
  - A v1 signature presented as v2, or the reverse, fails verification, so tampering with the
    header cannot escalate.
  - The process-secret path stays v1 and byte-for-byte unchanged.
  - This is the "coordinated, versioned" rollout that Core's #691 comment requires before the strip
    may be relaxed.
- **Option (b) rejected on code evidence.** (b) was: refuse to enable signing until an owner-role
  mapping exists. It would block essentially every hosted tenant, since the wizard has no owner-role
  key, and it would still demote a real owner who lacks the role.
- Tests: K-T8, A-T20, and the UAT A4 step "an owner-only command still works after provisioning".

**Signing API (R2 D13, ruling R2-D).** v2's `signedHeaders(actor, path, { secret })` would have
been read as the existing third positional `env` parameter. `actorSignatureSecret({secret})`
returns `""`, so the request would be sent **unsigned** (`src/actorSignature.js`
`signedHeaders(actorPayload, route, env = process.env)`; `writeBridgeSignedHeaders(..., params,
env = process.env)`). v3 therefore adds new, distinctly named functions:
- `signHeadersWithSecret(actorPayload, route, { secret, fields, version })`
- `writeBridgeSignHeadersWithSecret(actorPayload, route, { secret, action, params, version })`

Both **throw** `actor_secret_missing` on an empty secret. `request()` uses them for every
`"per_guild"` context. The env-based helpers stay untouched for `"process"` contexts. The
`AdapterClient` gains an injected `resolveGuildRequestContext` option, whose default keeps today's
process-env behaviour for existing `new AdapterClient(config, {...})` callers and tests.

**Decrypt cost and audit growth (R2 D37).** The decrypted secret is cached in memory keyed by
`(guildId, signing_set_at)`, and invalidated on store, clear, heal and decrypt failure. The setup
server runs in the same process. `decryptColumn` therefore logs a `decrypt` row only on a cache
fill, not per request. `secret_access_log` `decrypt` rows get a retention rule: pruned after 90
days by the existing maintenance path. `encrypt`, `rotate` and `decrypt_failed` rows are kept.
Evidence: `decryptColumn` inserts a row per call (`database.js:497`–`:511`), and nothing prunes the
table.

**Why the stock route needs a per-guild secret, with no shared-secret exception.**
- It would keep the shared-key posture that Open Decision 1 was decided against, on the most
  sensitive new route.
- The operator's own guilds are the first live test of 2a. They are provisioned by
  **regenerating** on Core. v2's "paste the value the Core already holds" is removed (R2 D04).

**Why the write bridge must switch too.** This is not optional.
- Core holds exactly one secret and verifies every route with it (F3).
- Once a guild's Core holds a per-guild value, any request signed with anything else fails.
- Phase 2a switches every signed call site through the single `request()` path.
- **Risk:** a resolver bug would break links and writes, not just stock. Mitigations:
  - golden vectors pin v1 output for NULL guilds (A-T8, §11.3);
  - rollout provisions dune-dev's guild first and exercises link, write-preview, an owner-only
    command and verify there before any other guild.

**Retiring the process-wide secret.** Once every registered guild has a per-guild secret, the
process-wide secret remains only for single-tenant mode and the no-guild system paths. Removing it
is a follow-up (§17).

#### 3.5.6 Where 2b depends on 2a
- `playerStock()` calls `resolveGuildRequestContext(guildId, { purpose: "stock" })`. With no
  verified per-guild secret it makes **zero** requests and shows the copy-table row
  `signing_not_configured` (§6.5), logging `live_stock.signing_not_configured`.
- `actor_signing_secret_verified_at` must be non-null. It is set only by a successful handshake and
  cleared by binding changes and heal. The resolver checks it explicitly, not by assumption
  (R2 D03).

#### 3.5.7 Failure modes and diagnosis (CLOUD-1; R2 D01, D09)

**Player text** comes from **one** copy table, `src/liveStockErrors.js` (M10), which this section
and §6.5 both reference. It is not written out twice (R2 D09). The table below gives the copy-table
key.
- The role name players are told to ask is **OD 13**. The recommended wording is "the person who
  connected this server to Mentat". "Server admin" (the Discord Admin role or the game operator?)
  and "bot operator" (the maintainer, in hosted mode) name no one a tenant player can find.

**Operator text** appears in Core's Discord settings (§3.5.11), in the handshake result and in
logs. None of it ever contains the secret.

| Condition | Detected as | Copy-table key (player) | Operator sees |
|---|---|---|---|
| mentat has no per-guild secret (stock route) | resolver, no request | `signing_not_configured` | Core settings: "signing: none"; log `live_stock.signing_not_configured` |
| Handshake refused by a guard (format, entropy, process-secret equality, shared Core) | mentat guards | n/a | registration result `refused: <reason>`; Core settings: "pending (not accepted: <reason>), expires …" |
| Handshake deferred (time budget) or failed | budget, or a verify/promote error | n/a | result `deferred`/`failed: <code>`; Core unchanged; "Enable signing" to retry |
| Promote succeeded, store failed | store throws | n/a | mentat reverts; Core settings "reverted <time>"; log `actor_secret.store_failed_reverted` |
| Values differ at runtime (restore, clone, a lost response) | 403 `invalid_actor_signature`, then heal verify | `signing_mismatch` | log `actor_secret.mismatch_detected`; fingerprints mentat `abc…` vs Core `def…`; action: Regenerate |
| Core has no secret; mentat signs a required route | 403 `actor_signing_disabled` | `core_signing_off` | "Core has no active actor signing secret; use Enable signing in Core's Discord settings" (v2's "configure DUNE_DISCORD_ACTOR_SECRET on both sides" is removed) |
| Clock skew beyond the window | 403 `stale_actor_signature` | `try_again` | "clock skew over DUNE_DISCORD_ACTOR_SIGNATURE_MAX_SKEW_SECONDS; check NTP on the bot VM and the Core host" |
| Signature headers missing (a mentat bug) | 403 `missing_actor_signature` | `internal_error` | "bug: request sent unsigned" (also a test assertion) |
| Stored value undecryptable or not `enc:` | resolver | `temporarily_unavailable` | log `actor_secret.decrypt_failed` + a `secret_access_log decrypt_failed` row |
| Core older than K2 | check JSON 404 | n/a | "Core too old for per-guild signing; update Core" |
| At-rest encryption not configured on the bot | at store time | n/a | store **refused**: "configure ACP_SECRETS_KEY_FILE / ACP_KEK_FILE first" (Open Decision 9) |
| Managed Core secret file unreadable | Core rejects everything | `core_signing_off` | Core log line and settings banner "signing file unreadable" |

A table-driven test over every row asserts the player key, the operator log line and that no
secret appears in either (A-T23, R2 D75).

#### 3.5.8 Tests (named)

**mentat**

| Id | Test |
|---|---|
| A-T1 | `schema v9→v10 migration adds the three nullable columns; existing guild rows intact; SCHEMA_VERSION 10` |
| A-T1b | `an injected non-duplicate ALTER failure leaves schema_version at 9 and startup fails loudly; PRAGMA assert catches a missing column` (R2 D05) |
| A-T2 | `v10 migration is not skipped on a DB already at v9 from #384` (frozen v9 DDL fixture, taken from `deploy/deploy`'s migration) |
| A-T2b | `migration guards are strictly ascending and SCHEMA_VERSION equals the highest guard`; `upgrading frozen v8/v9/v10 fixture DBs with the new code succeeds` (R2 D16, D66) |
| A-T3 | `rollback SQL returns a schema v9 code accepts` (valid only before any guild is provisioned, §3.5.2) |
| A-T4 | `setGuildActorSigningSecret stores ciphertext via encryptColumn, never plaintext, and logs an encrypt row` |
| A-T4b | `an UPDATE that throws after encrypt leaves the previous value decryptable; a guild removed or suspended during the await stores nothing` (R2 D36) |
| A-T5 | `store refused when encryption is not configured` (Open Decision 9) |
| A-T5b | `a plain:-tagged or untagged stored value resolves as decrypt_failed` (R2 D38) |
| A-T6 | `guards: only 64 lowercase hex after trim; fewer than 8 distinct chars refused; value equal to the process secret refused (constant-time); empty field leaves the stored value unchanged` (R2 D04) |
| A-T7 | `handshake: a failing verify or promote (each Core code, non-JSON 2xx, redirect, fingerprint mismatch) stores nothing; the previous value is kept only when console_url and bearer are unchanged` (ruling R2-C, R2 D20) |
| A-T8 | Resolver table, one test per §3.5.5 row, **including**: NULL guilds produce signed headers equal to **golden vectors computed on `main` before the change**, with `mock.timers`; the resolver throwing refuses with `actor_secret.resolver_error`; unknown or missing `purpose` throws (R2 D10, D11) |
| A-T9 | `write bridge in a provisioned guild signs v2 with the per-guild secret; in an unprovisioned guild it matches the golden v1 vector` |
| A-T10 | `getGuild omits actor_signing_secret; a canary never appears in JSON.stringify(guild)` (R2 D19) |
| A-T11 | **Canary test:** run register → verify → promote → store → sign → heal → failure flows with a distinctive secret. Capture stdout, stderr, the logger, `secret_access_log`, HTTP responses and setup HTML. Assert that the canary and its hex/base64 variants never appear. A value-based 64-hex redaction pattern covers these paths. The v2 "add to shouldRedactKey" is dropped: `CREDENTIAL_KEY_PATTERN` already matches `secret` (R2 D50). |
| A-T12 | `fingerprint matches the golden vector file shared with Core` |
| A-T13 | `/api/consoles/register accepts actorSigning {candidate, existing}; registration still succeeds without it; each outcome (verified/refused/deferred/failed) reported` |
| A-T13b | `auto-invite: candidate carried through both staging entries, absent from confirmation-status and logs, deleted on resolve and expiry; handshake runs at owner Confirm with the confirmed guild id` (R2 D15) |
| A-T14 | `rotation: the old per-guild value keeps signing until the new one is verified, promoted and stored` |
| A-T15 | `migration against a sanitised production-size copy` (a script run recorded as Requirement 26 evidence, not a unit test) |
| A-T16 | `re-registration with a new console_url, or a new bearer, clears secret, set_at, verified_at and the DEK row unless the same request re-verifies` (R2 D03) |
| A-T17 | **Isolation matrix:** two stub Cores (process-config Core + tenant Core), distinct process secret and bearer. For pending, inactive and unregistered guilds, the process Core receives **0** requests during registration, owner Confirm, heal and legacy write-bridge calls. The tenant Core sees exactly one request signed with the submitted secret. `actor.guildId !== guildId` throws (R2 D11) |
| A-T18 | `one signer per Core: provisioning refused when console_url equals another active guild's or the process adapter base URL` (R2 D14) |
| A-T19 | `idempotency and budget: a repeated register with the same fingerprint is a no-op; a slow Core makes mentat answer deferred within 12 s; store failure after promote calls revert` (R2 D01, D06) |
| A-T20 | `a provisioned guild's owner resolves to owner on a v2-capable Core stub; unprovisioned guilds send no version header` (R2 D02) |
| A-T21 | `signHeadersWithSecret / writeBridgeSignHeadersWithSecret throw on an empty secret; env helpers unchanged` (R2 D13) |
| A-T22 | `rotate-keys and recover-keys keep actor_signing_secret decryptable; reencrypt-secrets covers it; every encryptColumn caller's column is covered by reencrypt-secrets` (R2 D30) |
| A-T23 | Table-driven over §3.5.7: player key, operator line, no secret (R2 D75) |
| A-T24 | `clearGuildActorSigningSecret NULLs the three columns and deletes the DEK row; runs on guild delete/suspend` (R2 D28) |

**Tests that will need updating (R2 D13; QA2-14).**
- `test/database.test.js:184`, `:475`, `:520` and `test/rollbackV7Schema.test.js:52`–`:69` assert
  the schema version.
- `test/adapterClient.test.js` `expectedPathKeys` and `test/adapterContract.test.js`, if a new path
  key is added. The check call is deliberately **not** a `DEFAULT_PATHS` key: it is a dedicated
  function.
- `test/actorSignature.test.js`: the env helpers are unchanged. New tests go in the new functions'
  own file.
- `test/commandRegistryContract.test.js` and `scripts/validate-command-registry.js`, if the catalog
  changes.
- Every `new AdapterClient(config, {...})` in tests must keep working with the default resolver
  option.

**Core** (Core#1088)

| Id | Test |
|---|---|
| K-T1 | `candidate generation writes the pending file 0600 via temp+rename and never changes actorSignatureRequired(); promote sets process.env and .env` |
| K-T2 | `an existing direct-var or file secret is forwarded as mode existing and the connect proceeds; Regenerate disabled while the direct var is set` (R2 D04) |
| K-T3 | `hosted register and auto-invite bodies include actorSigning; audit lines and logs do not` |
| K-T4 | `check route: verify (pending then active), promote (fingerprint must match, idempotent), revert (window, once), pending accepted only here; missing_/invalid_/stale_actor_signature; actor without username → 400; 429; every outcome audited without the secret` |
| K-T5 | `.prev is deleted 15 min after promote and is never verified against` |
| K-T6 | `catalog includes admin:signing-check` |
| K-T7 | `golden signing vectors (v1 and v2), vendored byte-identical with mentat, verify through the real verifier` (R2 D10) |
| K-T8 | `v2-signed guildOwnerId kept; v1-signed guildOwnerId stripped; tampered guildOwnerId under v2 → invalid; version header/signature mismatch → invalid; v1 byte-for-byte unchanged` (R2 D02) |
| K-T9 | `a failed or 5xx hosted register logs no secret (fingerprint allowed)` (R2 D55) |
| K-T10 | `a failed handshake or no promote leaves enforcement unchanged, for a first connect and for a rotation` (R2 D01) |
| K-T11 | `managed file unreadable → fail closed + one log line; operator-set _FILE unreadable → today's behaviour + warning` (R2 D29) |
| K-T12 | `reveal/Enable/Regenerate: Deny beats Allow; non-privileged → 403; CSRF enforced; audited with the session user` (R2 D21) |

#### 3.5.9 Documentation impact (Phase 2a; R2 D23, D60)

| Doc | Change |
|---|---|
| mentat `docs/security-secrets-at-rest.md` (v2 named a non-existent `docs/security/multi-tenant-secrets-at-rest.md`) | Add `actor_signing_secret` to the encrypted-column inventory (next to `adapter_token`, `:10`). Encryption is required for this column. Key rotation note (`:90`). |
| mentat `compliance/policies/threat-model.md` (asset table `:80`–`:82`), `compliance/policies/data-classification.md`, `compliance/controls/soc2-matrix.md` (DP-01) | The new credential, its lifetime, the handshake and the rotation cadence |
| mentat `compliance/runbooks/actor-signing-secret.md` (new) | Provisioning, rotation, the cadence and triggers, revert, heal, restore, clone, offboarding |
| mentat setup/user docs, `docs/multi-tenant-design.md`, `docs/faq.md` ("Is this bot secure?"), `docs/privacy-policy.md` | Per-guild signing; the fingerprint check; hosted versus self-hosted provisioning |
| mentat `docs/architecture.md` | The resolver and signature v2 (§3.5.5) |
| mentat `scripts/reencrypt-secrets.js`, `recover-keys.js`, `rotate-keys.js` (docs + code) | The new column is covered (R2 D30) |
| mentat `CHANGELOG.md` | Schema v10; the new field; write-bridge signing now per guild, v2, when provisioned |
| Core `docs/security/secrets-management.md` credential inventory | The pending, active and `.prev` actor-secret files, their lifetimes and rotation column |
| Core `docs/security/actor-secret-rotation.md` (new) | §3.5.4 |
| Core `docs/security/discord-player-link-hardening.md` / `player-linking-security-architecture.md` | The "actor signing is opt-in / not integrated" rows get a current-status update; signature v2 |
| Core `docs/integrations/discord-integration/README.md`, `.env.example` | The managed file; direct var precedence and the migration |
| Core `docs/console/API-REFERENCE.md` | The check route **and** the changed hosted `/register` and `/auto-invite/start` bodies |
| Core `CHANGELOG.md` | "Connecting to the hosted bot now **offers** actor signing. Enforcement starts only after the bot verifies and promotes the new secret. An existing `DUNE_DISCORD_ACTOR_SECRET` is forwarded, not replaced. Signature v2 signs `guildOwnerId`." |

**Requirement 23 (network ingress) for 2a (R2 D60).**
- No new hostname, port or tunnel rule.
- New fields ride existing ingress: mentat `/api/consoles/register` (proxy-secret-exempt, direct to
  `mentat-backend`), `/api/consoles/auto-invite/*` and `/setup/*` (through mentat-link's Pages
  Functions).
- The new Core route rides the existing console hostname under `/api/integrations/discord/*`.
- Restart blast radius is unchanged.
- The pre-existing cleartext tunnel-to-VM LAN hop now also carries the candidate secret at
  registration, as it already carries the bearer (NET-6, pre-existing).

Reachability:
- mentat reaches operator Cores through their **public** hostnames, because `validateConsoleUrl`
  rejects RFC1918 addresses, so the path is bot VM → Cloudflare → tunnel → console.
- dune-dev UAT runs through `console-dev.darkdante.org`.
- A self-hoster without a public https console cannot use 2a or 2b.

#### 3.5.10 Layer 1 status for Phase 2a

**Round 2 ran** (register "Round 2": D01–D75). The v2 reviewer questions are answered:

| Question | Answer (v3) |
|---|---|
| Spoofing: who can set a guild's secret? | Path 1 inherits `verifyAndRegisterConsole`'s Discord-ownership re-verification. Auto-invite binds at owner Confirm. Path 2 and the secret-only update path re-verify ownership through OAuth. Promote needs a signature by the candidate itself. |
| Spoofing: cross-guild? | The self-check is a dedicated call to the submitted `console_url`, with zero requests to any other Core (A-T17). |
| Information disclosure | Allowlisted status shapes; value redaction plus a canary test; `getGuild` omits the column; proxy log check at mentat-link Layer 2; co-delivery with the bearer is OD 10. |
| Repudiation | mentat logs the user id and path; Core audits promote, revert, reveal and regenerate with the session user; Core #910 is linked. |
| Tampering (downgrade by replay) | A replayed `existing` registration can only re-verify what Core currently holds. `promote` needs a pending value signed by itself. `revert` works once, within 15 min. |
| DoS | Pending is never enforced. Revert on store failure. Idempotent, budgeted registration. Decrypt failure fails closed for that guild only. The migration fails closed. |
| Elevation of privilege | **v2's answer ("changes only which key signs") was false.** Signing strips `guildOwnerId`. Fixed with signature v2 (§3.5.5). |
| DBA | #438 gate; production-size migration; forward-only rollback; restore (§3.5.12). |
| QA | Golden vectors (§11.3); isolation matrix A-T17. |
| Network | Budget and idempotency; `redirect: "error"`; Requirement 23 table. |
| UX | Core settings status surface; secret-only update path; one copy table (§3.5.11). |

**Findings about the current system surfaced while specifying 2a** (filed or tracked in §14.1):
- The legacy setup form shows the adapter token and the stats-push secret in visible `type="text"`
  inputs.
- At-rest encryption of per-guild secrets is optional. With no key configured they are stored in
  plaintext, with only a startup log line.
- Schema v9 is on the deploy branch but not on `main` (mentat#438).
- There is no "edit my existing guild" issue. v2 miscited #312 (R2 D08).

#### 3.5.11 Operator status surface and existing-guild update path (R2 D07, D08, D72)

**Status surface: Core's Discord settings (K4).** That is the one place a Core operator already
manages this integration. It shows:
- **none**;
- **pending**, with its expiry and the last handshake result if one was refused, deferred or
  failed, with the reason;
- **active**, with the fingerprint, when it was promoted and through which flow (hosted,
  auto-invite or manual);
- **reverted** (time and reason).

Core reads the handshake result from the synchronous `/register` response, or from the
`confirmation-status` payload it already proxies server-side (`server.js:2592`ff).
- Because Core shows its **own** file state, a lost response cannot leave the page showing a
  failure while signing is actually active.
- v2's "setup-portal status page" and "Test signing" do not exist
  (`setupServer.js:254`–`:635` routes) and are dropped from 2a.
- A mentat-side, owner-authenticated status page would add new ingress. It is **OD 12**, recommended
  deferred.

**Secret-only update path (mentat#447).** This is a 2a deliverable, not deferred to an edit-guild
feature.
- A setup-portal flow re-verifies Discord ownership of the guild through the existing OAuth state,
  asks only for the pending secret, and runs the §3.5.3 handshake. It does **not** re-ask for the
  adapter token.
- It is reached only through mentat-link's `/setup/*` proxy, with CSRF/state protection and a
  per-guild rate limit (1 per 30 s).
- Hosted guilds use "Enable signing" in Core instead, which runs Path 1.
- Existing hosted installs see a Core banner: "Enable per-guild actor signing".

#### 3.5.12 Revocation, offboarding, backup and restore (R2 D28, D39)

**Revocation and offboarding.**
- `clearGuildActorSigningSecret(db, guildId)` NULLs the three columns and deletes the `secret_keys`
  row in one transaction, and logs it. It is called:
  - on guild delete or suspend (`onboarding.js` `handleGuildDelete`);
  - from the secret-only update path's "clear" action;
  - by the runbook.

  Evidence: `clearGuildStatsSharingSecret` (`database.js:1198`–`:1208`) leaves the DEK row behind,
  and that is not repeated here.
- Core deletes pending and `.prev` on adapter disable or disconnect. Re-adding the bot never
  silently re-arms an old key: re-provisioning runs the handshake.

**Backup and restore (mentat).**
- The mentat SQLite backup and **every retained KEK version** (`kek.age` / age identity) are one
  unit. Restoring a backup without its KEK versions makes every encrypted column unreadable,
  `adapter_token` included.
- **After any restore of the mentat DB,** run `verify` for every guild with a non-NULL secret, and
  clear `verified_at` where Core disagrees (heal). Otherwise a restore silently re-installs a stale
  secret that still reads "verified".
- A rotation done after the last daily backup is lost by a restore. The runbook states that RPO
  consequence.
- **After any restore or clone of a Core,** Regenerate (§3.5.4 triggers).
- Backups use `sqlite3 .backup` / `db.backup()`, never a file copy of a WAL database. Which one the
  production job uses cannot be verified from the repo, so it is a Layer 2 check.

## 4. Proposed Core Change (additive; Requirement 0)

**Ownership (Requirement 18, GRC-6).** This mentat-focused session does **not** implement C1–C9.
It files a Core issue with a self-contained implementation prompt, following the repo's
`*-implementation-prompt` convention, and hands it to a Core-focused session or the operator
(§14).

**Branch:** `feat/live-stock-self-read`, cut from a freshly re-verified `origin/main`
(Requirement 29), in a dedicated `git worktree`. Core's primary working tree is on another
session's branch.

### 4.1 Delta list (Core)

| # | File | Change |
|---|---|---|
| C1 | `console/api/src/duneDb.js` | New exported `playerStockTotals(db, { playerControllerId, playerPawnId, itemIdsLower })`. It runs one read-only statement (§4.3), reuses `baseInventoryTypeParams()` restricted to the storage/refining/crafting groups, and returns raw rows. |
| C2 | `.../inventoryProvider.js` | New `playerStockProvider(db, { playerControllerId, playerPawnId, itemIds })`. It validates (§4.4), de-dups case-insensitively, decides backpack availability, calls C1 inside a read-only bounded transaction (§4.5), converts and checks values (§4.3), and builds the **array** response (§4.6). DB errors are mapped to `stock_query_failed` (SEC-11). **No** `enrichWithDisplayName`. |
| C3 | `.../adapter.js` | `PLAYERS_STOCK: "/api/integrations/discord/players/stock"` in `DISCORD_ADAPTER_ROUTES` and `DISCORD_LIVE_ADAPTER_ROUTES`. |
| C4 | `.../policy.js` | New `STOCK_SELF_READ: "stock:self-read"`, added to the `observer` and explicit `moderator` sets. The capability definition gets a comment mirroring the self-scoped warning: "privacy is enforced by the handler having no target field; adding one makes this a cross-player read at Player tier" (CLOUD-5). |
| C5 | `.../routes.js` | Handler (§4.7). The order is the one in §4.5 (R2 D33):<br>1. `readJsonWithActorSignature(req, { requireActorSignature: true, fields: STOCK_SIGNED_ACTOR_FIELDS[_V2] })`;<br>2. capability check;<br>3. per-actor limiter;<br>4. in-flight semaphore;<br>5. `requireLinkedPlayer` **inside** the same bounded read-only transaction as the provider;<br>6. provider.<br>There is a whole-handler deadline, and `audit()` runs on **every** outcome, including denials. |
| C6 | `.../actorSignature.js` | `export const STOCK_SIGNED_ACTOR_FIELDS = [...SIGNED_ACTOR_FIELDS, "params"]`, and its v2 counterpart with `guildOwnerId` (§3.5.5; Core#1088 K3). `itemIds` travels as `body.params.itemIds` and is signed, so an envelope cannot be replayed with different ids (SEC-8). mentat mirrors both lists exactly (M3). The golden vectors in §11.3 cover the pairing. |
| C7 | `.../commandCatalog.js` | A `COMMAND_METADATA` entry with **`group: "goal", subcommand: "live-stock"`**. These names do not collide with any `player:*` subcommand. `params: []`, with the internal-aggregate comment (precedent `GUILD_FACTION_SUMMARY`, `:566`–`:577`). The expected mentat `/dune admin sync-commands` drift line is `added goal:live-stock (internal, no Discord surface)`, recorded in the PR body (ARCH-9). |
| C8 | docs | See §12. This includes fixing the `API-REFERENCE.md:1018`–`:1022` GET→POST drift **in the same PR**. It is not optional and not "or file it" (GRC-3). |
| C9 | tests + fixture | §11.1. This includes the canonical `console/api/test/fixtures/players-stock.json` and the vendored golden signing vectors (§11.3). **Fixture work is named (R2 D63).** No existing fixture has `permission_actor_rank`, `inventory_type`, `max_item_volume` and the link tables together: `baseContainerFixture.js` has no `permission_actor_rank` or `inventory_type`, which exist only in `basePermissions`/`vehicleStorageFixture.js`. The PR adds one composed production-shape fixture. |

**No schema change, no index, no new dependency, and no change to any existing route's
behaviour.** A Core with this change that is never called behaves exactly as today.
Requirement 26 is N/A for Core. An index, if ever needed, is a separate Requirement 26 issue
with a `DROP INDEX CONCURRENTLY` rollback (§17).

### 4.2 `[D5]` Capability and privacy model
- `STOCK_SELF_READ` is granted from `observer` (Player) up and checked with
  `requireDiscordCapability`. A `public`-tier caller is rejected.
- **Structural invariant:** the route accepts **no** target field. The only player read is
  `getLinkedPlayer(actor.userId)`, and every other body field is ignored (tested with real
  Postgres, §11.1 T3).
- Moderators and admins get **no wider visibility**. This route has no "other player" mode.
- **This design raises the security value of a Discord link (SEC-2).** Today an observer-tier
  link unlocks no Core data read. After this change it unlocks the linked character's stock
  counts. Two consequences:
  - (a) **Pre-enable gate:** before a Core's guild is added to the allowlist, run the one-time
    review of `console.discord_account_links` rows that could have been written by the
    since-disabled Steam path (`routes.js:544`–`:551`). What to do if any are found is **Open
    Decision 6**.
    - **Owner and evidence (R2 D59).** The operator runs it, **per Core**: dune-dev and dune-prod
      separately. They post a comment on mentat#434 with the Core, the date, the exact query text,
      the row count and the disposition.
  - (b) The Layer 2 audit must confirm that every link-creation path still enabled is proof of
    control.
  - (c) Per-guild character disable state (`discord_account_link_guild_state`) is **not**
    consulted. This matches every sibling route (`duneDb.js:16597`–`:16600`) and is deferred with
    a follow-up issue (§17). Only guilds that are allowlisted and have a per-guild secret
    are enabled (§3.2).

### 4.3 `[D3]` Query semantics
Illustrative shape; final SQL is re-derived against a real dune-dev `\d`.

```sql
-- $1 player_controller_id, $2 pawn id (>=1, or NULL when unavailable),
-- $3 lower-cased item ids, $4/$5 allowlist groups/building types (unnest, never interpolated)
with allowed as (
  select building_type from unnest($4::text[], $5::text[]) as t(group_key, building_type)
  where group_key in ('storage','refining','crafting')
), base_inv as (
  select distinct inv.id
  from dune.permission_actor_rank par
  join dune.actor_fgl_entities afe on afe.actor_id = par.permission_actor_id
  join dune.placeables p on p.owner_entity_id = afe.entity_id
  join allowed a on a.building_type = lower(p.building_type)
  join dune.inventories inv on inv.actor_id = p.id and inv.max_item_count >= 0
  where par.player_id = $1 and par.rank = 1
    and p.is_hologram = false and p.owner_entity_id is not null and p.owner_entity_id <> 0
), inv as (
  select id, 'base'::text as src from base_inv
  union all
  select id, 'backpack' from dune.inventories
  where $2::bigint is not null and actor_id = $2::bigint and inventory_type = 0
)
select lower(i.template_id) as tid,
       coalesce(sum(i.stack_size) filter (where inv.src = 'base'), 0)::text     as in_bases,
       coalesce(sum(i.stack_size) filter (where inv.src = 'backpack'), 0)::text as in_backpack
from inv join dune.items i on i.inventory_id = inv.id
where lower(i.template_id) = any($3::text[])
group by 1
```

Properties that must hold, whatever the final SQL is:

0. **Schema capability (R2 D68).** The provider probes `tableExists`/`columnsFor` for
   `inventory_type`, `permission_actor_rank` and `max_item_count` the way `baseInventory` does
   (`duneDb.js:12668`–`:12700`). A missing piece returns an explicit `stock_unsupported` outcome,
   not `stock_query_failed`. `db.transaction` rethrows `new Error(redactDbError(error))`, which drops
   `.code` (`db.js:88`–`:89`). The provider therefore logs the original SQLSTATE class server-side
   first (57014 timeout versus 42703 missing column). It is never sent to mentat.

1. **Exact, case-insensitive id match:** `lower(i.template_id) = any($3)`. Never `ilike` or `like`
   (DBA-2). The response uses the caller's requested spelling.
2. **Driven from the inventory set:**
   - Start from the player's small set of inventories and join to `dune.items`.
   - Never use an OR of IN-subqueries over `dune.items` (DBA-3).
   - The two branches are disjoint (pawn actor ≠ placeable actor, single id space), and `distinct`
     sits inside the base branch. Permission or FGL fan-out therefore cannot multiply rows (FM8).
3. **Base population = Core's own base-inventory classification.** It is the Storage, Refining
   and Crafting groups of `BASE_INVENTORY_TYPES`, plus `max_item_count >= 0`, non-hologram and
   rank 1 (DBA-1, F5). Generator, turbine and windtrap fuel slots, recycler, repair station and
   totem inventories are **excluded**. Whether Refining counts is **Open Decision 3**, and its
   default is included.
4. **Backpack:**
   - `inventory_type = 0` on the pawn, **all** such inventories summed (DBA-11).
   - If `getLinkedPlayer` returns a pawn id that is `'0'`, empty or not a positive safe integer,
     the provider passes `NULL`. The branch then contributes nothing, and the response marks the
     backpack **unavailable**.
   - `actor_id = 0` is **never** queried (DBA-6, ARCH-2, SEC-6).
   - `player_controller_id` is validated the same way. A non-positive or empty value gives
     `stock_query_failed`.
5. **One statement, one snapshot (DBA-10).** Backpack and bases come from the same statement.
   Re-implementing them as two queries is forbidden; a code comment pins this and a test asserts
   it (§11.1 T13).
6. **Types (DBA-5):**
   - SQL `coalesce(...)` makes every column non-null.
   - Values are returned as text and converted in JS with `Number()`, then asserted
     `Number.isSafeInteger(n) && n >= 0`. Any failure gives `stock_query_failed`, never a coerced 0.
   - `total = inBackpack + inBases` is computed only after conversion, and only when the backpack
     is available.
7. **Not counted, and stated to the player (DBA-11, U3):**
   - worn and held gear, schematics and emote containers (types 1, 15, 30, 14, 27);
   - vehicle holds and vehicle-module inventories;
   - item-owned (container-item) inventories;
   - exchange listings and mail;
   - bases where the character is rank 2/3;
   - bases transferred to a system custodian;
   - guild-shared storage;
   - other characters on the same Discord account.

### 4.4 `[D4]` Input validation
- Body: `{ actor, params: { itemIds: string[] } }`.
- `itemIds` must be an array of **1..16** strings after case-insensitive de-duplication.
- Each id must match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Every id in both catalogs matches (F2).
- `__proto__`, `constructor` and `prototype` are rejected in **any case** (SEC-1).
- Anything else gives 400 `invalid_item_ids`.
- Ids are not checked against the catalog. An unknown id returns zeros.
- 16 is enough: mentat sends at most 6 per goal (§5.3). It is not an invitation to scan.

### 4.5 `[D9]` Load, timeout and lock bounds (NET-3, DBA-4, DBA-9, SEC-4)
Each handler step runs in order, and a request that fails one step stops there:

1. **Per-actor limiter (R2 D34):** after the capability check, a
   **`createMutationRateLimiter`-style sliding window**, keyed on `actor.userId`. It records **per
   request**, and only after the signature verified. Default 6 requests per 60 s
   (`DUNE_STOCK_RATE_PER_MIN`, bounds 1–30).
   - There is an explicit global ceiling that one user cannot reach: `max(60, 10 ×
     per-user limit)` per minute.
   - Overflow returns **429 `rate_limited`** with `Retry-After`.
   - v2 named `createLoginRateLimiter` (`rateLimit.js:32`–`:96`). That limiter counts *failures*,
     blocks for 15 minutes and has a shared `__global__` key of 32. That would have turned six
     requests into a 15-minute lockout, and six players into a Core-wide lockout.
2. **In-flight cap:** an in-process semaphore, `DUNE_STOCK_MAX_INFLIGHT`, default **1**, bounds
   1–3. It is acquired **before** any pool client, **including** the link lookup, so an overflow
   request never holds one. Overflow returns **503 `stock_busy`** immediately (no queueing) with
   `Retry-After: 30`.
   - The permit is released in `finally` on success, provider throw, statement timeout and client
     close (T12b, R2 D51).
   - Denied requests (bad signature, 403, 400, 429) never take a permit or a limiter slot (T12c).
3. **One bounded transaction (R2 D33).** `requireLinkedPlayer` (`getLinkedPlayer`,
   `linkProvider.js:320`) and the stock statement run in **one** dedicated transaction, with one
   `connect()`, so there is no second pool wait. Its first statements are, in this order:
   `set transaction read only`;
   `select set_config('statement_timeout', $1, true)` with `DUNE_STOCK_QUERY_TIMEOUT_MS`
   (default **2000**, bounds 250–2500);
   `select set_config('lock_timeout', '500ms', true)`.
   T9 asserts the preamble is the first statement after `begin`.
4. **Whole-handler deadline:** 5 s from signature verification to response. On expiry the handler
   returns 503 `stock_busy`, releases the permit and cancels the query.
   - Worst case: 3 s pool wait + 2.5 s statement, capped by the 5 s deadline.
   - mentat gives `playerStock` a **route-specific timeout of 7 s**, not the operator-tunable global
     `REQUEST_TIMEOUT_MS` (`config.js:259`). A mentat abort therefore cannot leave a query running
     longer than the deadline.
5. **Retries:** mentat makes **one attempt per invocation** and never retries automatically
   (NET-4). (Core's hosted-register retry, §3.5.3, is a different flow.)
6. **mentat smoothing (R2 D35).**
   - A per-guild in-flight gate in mentat (at most 1 stock call per guild) fails fast locally with
     the "busy" copy and **no** cooldown.
   - A `stock_busy` or `rate_limited` response sets that user's cooldown to `Retry-After`, with a
     minimum of 30 s.
   - Expected throughput is roughly 0.5–1 request per second per Core at the default cap. The
     documented scaling knob is `DUNE_STOCK_MAX_INFLIGHT`, up to 3.
7. **Database role (R2 D32, OD 11).** The query runs on Core's shared pool as `DUNE_DB_USER`
   (`db.js:44`–`:46`), the game-DB owner role. Read-only rests on the preamble alone.
   - Recommendation (OD 11): support an **optional** `DUNE_DB_RO_USER` with `GRANT SELECT` on only
     the tables used, and use it for `playerStockTotals` when it is set.
   - Without it, the preamble plus T9 remain the control. That is recorded as an accepted GRC
     exception if the operator declines.

### 4.6 `[D7]` Response shape
Illustrative:
```json
{ "ok": true,
  "items": [ { "id": "Silicone", "total": 400, "inBackpack": 50, "inBases": 350 },
             { "id": "Oil", "total": null, "inBackpack": null, "inBases": 200,
               "unavailable": ["backpack"] } ],
  "requested": 2 }
```
- `items` is an **array in request order**, one element per de-duplicated requested id, with the
  caller's spelling. No object is ever keyed by a caller-supplied id, in Core or in mentat
  (SEC-1).
- `unavailable` appears only when a component could not be read. In v1 the only value is
  `"backpack"`, and then `total` and `inBackpack` are `null`.
- The response contains counts only. There is no character name, container, coordinate or stack id.
- The envelope is exactly what `json(res, 200, provider())` emits for sibling routes. It is pinned
  by the canonical fixture (§11.3), not by prose.

### 4.7 `[D8]` Audit (GRC-2, CLOUD-7, SEC-10)
Every request that reaches the handler writes one line,
`audit(config, req, "discord.player.stock_read", detail)`. `detail` contains:

| Field | Value |
|---|---|
| `actorId` | Discord user id, or `"unverified"` when signature verification failed |
| `guildId` | from the verified actor. **On any signature failure it is omitted**, and the line carries `claimedGuildId` plus `unverified: true` instead (R2 D54). |
| `interactionId` | signed; the correlation id mentat also stores (§7). On a signature failure, `claimedInteractionId` under `unverified: true`. |
| `playerControllerId` | internal id of the character actually read, or null if not linked |
| `outcome` | `ok` or the error code: `not_authorized`, `not_linked`, `invalid_item_ids`, `rate_limited`, `stock_busy`, `stock_query_failed`, `missing_actor_signature`, `invalid_actor_signature`, `stale_actor_signature`, `actor_signing_disabled` |
| `requestedCount` | number of ids requested |
| `backpackAvailable` | boolean |

- **No item ids, totals, names, signature or bearer values** appear in the line.
- The game server is identified implicitly by the per-Core audit log file.
- Retention and permissions are those of Core's existing `config.auditLog` (0600, append-only);
  C8 documents them.
- Denials thrown by `readJsonWithActorSignature` are caught by a route-local wrapper that audits
  and rethrows.

### 4.8 `[D10]` Actor signature required
The route passes `requireActorSignature: true`, so it fails closed when no secret is configured
(`actor_signing_disabled`). mentat signs it with the guild's verified per-guild secret, using
signature v2 (Phase 2a, §3.5.5). The route is new, so this cannot regress any current operator.

**Replay window (R2 D73).** There is no nonce store. A captured valid envelope can be replayed
verbatim to the same route within `DUNE_DISCORD_ACTOR_SIGNATURE_MAX_SKEW_SECONDS` (default 30 s).
- The route and `params.itemIds` are signed, so it cannot be replayed to another route or with
  other ids.
- A replay returns only the victim's own counts, to someone who already holds the bearer. It does
  spend one of the victim's limiter slots.
- This is documented, not hidden. T2b tests the stale and cross-route cases. An interaction-id
  dedupe is optional and not in v1.

## 5. Meaning of the Numbers

### 5.1 `[D11]` Definition of "on-hand"
A player's live on-hand of an item is the sum of two things:
- their **backpack** (all `inventory_type = 0` inventories on the linked character's pawn), when
  available; and
- the **Storage, Refining and Crafting inventories of every base the linked character owns**
  (rank 1, non-hologram, Core's `BASE_INVENTORY_TYPES`), across all maps.

Everything in §4.3 item 7, plus generator, turbine, windtrap, recycler, repair-station and totem
inventories, is **not** counted. Refinery and fabricator input slots are counted, which can
overstate "available" by inputs already committed to a running job (U5, Open Decision 3).

`inBackpack` and `inBases` are returned separately. A disputed number is therefore explainable,
and the definition can change without changing mentat.

### 5.2 `[D20]` Live stock is total stock, not an allocation (ARCH-5)
Sync credits the player's **whole** live stock of an item to the goal being synced. The same
physical stack counts toward **every** goal that needs that item: syncing goals #12 and #14, which
both need Iron Ingot, gives both the full count. A goal created for "100 Steel" by a player who
already stores 200 completes on its first applied sync. These are the intended v1 semantics. The
UI makes them visible:
- The preview footer says: "Live numbers are your total stock. They aren't reserved for this goal."
- Each node that also appears in another **active** personal goal shows "also counted in #12, #14".

"Credit only stock gained since the goal was created" would need a stored per-goal baseline and a
second schema change. It is deferred with that justification (§17).

### 5.3 `[D21]` Which nodes can be synced (ARCH-6, UX-4, QA-4)
- A goal node is **syncable** if its game item id is:
  - (a) a value in `RECIPE_KEY_TO_GAME_ITEM_ID` (the 27 verified bridge ids), or
  - (b) for a *simple* goal, a catalog item whose category is `resources`.
- Every other node is **manual only**. That includes:
  - `water`, which has no game item (`gameItemIdBridge.js`, "CONFIRMED EXCEPTION");
  - a craftable goal's root when the root is gear or a placeable;
  - simple goals on weapons, clothing, vehicles, placeables, consumables and other non-resource
    categories.

  Such items live in gear slots, `dune.placeables` or vehicle holds, which the query does not
  read. Syncing them would produce a structural false 0.
- Craftable intermediates that are bridge ids, such as Silicone Block or Duraluminum Ingot, are
  real stackable items and are counted like raw resources.
- mentat computes `syncNodes(goal)` from the shared `goalValidNodes(goal)` helper (M5) and sends
  only syncable ids, at most 6. **Every** node is listed in the preview. Manual-only nodes read
  "manual only — use `/dune goal on-hand`" and are never requested, never written, and never shown
  as 0.
- A goal with no syncable node makes **zero** adapter calls and says so.

## 6. Proposed mentat Change

### 6.1 Delta list (mentat)

| # | File | Change |
|---|---|---|
| M1 | `src/config.js` | `DEFAULT_PATHS["players-stock"]` / `DEFAULT_METHODS["players-stock"] = "POST"`, env overrides following `players-find`. Parse `MENTAT_LIVE_STOCK_GUILD_IDS` into `config.liveStock.guildIds` (a Set; empty by default). |
| M2 | `src/adapterClient.js` | `playerStock(actor, itemIds, guildId)`: `resolveGuildRequestContext(guildId, { purpose: "stock" })` from Phase 2a (§3.1, §3.5.5); body `{ actor, params: { itemIds } }`; signs with `STOCK_SIGNED_ACTOR_FIELDS_V2` through `signHeadersWithSecret`; `redirect: "error"`; a route-specific 7 s timeout (§4.5); refuses to send unless a verified per-guild secret exists (§3.5.6). The response must carry `contract: "players-stock/1"` (§11.3). Add `"players-stock"` to `UNMERGED_ROUTES` (fork-only; classification is informational). Update `test/adapterClient.test.js:277`/`:301`, `test/adapterContract.test.js:112`, and the `UPSTREAM_CONTRACT` table (QA-2). |
| M3 | `src/actorSignature.js` | `STOCK_SIGNED_ACTOR_FIELDS` and its v2 counterpart, identical to Core's C6. **No new variant of `signedHeaders`:** v2 proposed `signedHeaders(actor, route, { secret, fields })`, which collides with the existing third positional `env` parameter and would silently send unsigned requests (R2 D13). The stock route uses Phase 2a's `signHeadersWithSecret`, which throws on an empty secret. Existing callers are unchanged. |
| M4 | `src/commands.js` | Subcommand `/dune goal sync id:<int, autocomplete>`. **Preview only; there is no `apply` option** (§6.3). An `async executeGoalSync` is awaited in the existing async dispatch (`commands.js:567`–`:576`; this closes v1's U7). `actorFromInteraction` gains `interactionId: interaction.id` for this call. Personal-only autocomplete branch for `goal:sync` (ARCH-11). It is **DB-only and never calls Core**, because autocomplete has a hard 3 s limit with no defer (R2 D61). Labels are `#<id> <goal name> — <n> of <m> nodes syncable`. With no active personal goal, one entry reads "No active personal goals — create one with /dune goal create" (R2 D70). **Exact strings (R2 D74):** subcommand `sync`, description `Live stock.`, option `id` / `Id.` That is 20 chars, giving 7473 → 7493. Re-measure at branch cut, because other open PRs may spend the last 7 chars first. A `FORCE_EPHEMERAL_COMMANDS = new Set(["goal:sync"])` combined into the `deferReply` expression before `forcedPublic` (§6.8). Registered in `getCommandRegistry()` and `helpPayload()`. |
| M5 | `src/commands.js` | Extract `goalValidNodes(goal)` from `executeGoalOnHand` (`:1416`–`:1436`), plus `syncNodes(goal)` (§5.3). Refactor only; existing on-hand behaviour is unchanged. |
| M6 | `src/goalSyncConfirmation.js` (new) | Pending-preview store modelled on `writeConfirmation.js`: nonce → `{ userId, goalId, guildId, planned node values, snapshot of (quantity, updated_at) per node, expiresAt }`. TTL 120 s, in-memory, per process. Button handler for `Apply` and `Apply incl. decreases`. The handler **acknowledges first** (`deferUpdate` within 3 s) and then runs the synchronous transaction (R2 D61). The nonce `get` and `delete` happen **synchronously before the first `await`** (R2 D47). |
| M7 | `src/cooldown.js` | Per-command duration override: `COMMAND_COOLDOWN_MS = { "goal:sync": 15000 }`. The admin shortcut does **not** apply to that key. `goal:sync` is excluded from the generic end-of-dispatch `applyCooldown` (`commands.js:996`); the handler applies it only after a Core request was actually sent (§6.7). |
| M8 | `src/embedFormat.js` | `formatGoalSyncPreviewEmbed` / `formatGoalSyncAppliedEmbed`, using `duneEmbed` named colors (pitfall at `embedFormat.js:1822`). Copy in §6.6. |
| M9 | `src/database.js` | Schema **v11**: additive nullable provenance columns on `goal_audit_log` (§7). `appendGoalAuditLog` accepts `{ source, sourceGuildId, sourceRef }`; typed on-hand writes pass `source: "manual"`. |
| M10 | `src/liveStockErrors.js` (new) | `liveStockErrorMessage(error)` keyed on Core `body.error`, with separate player-facing and log-only text (§6.5). |
| M11 | docs | See §12. |

**Dependencies:** Phase 2a (§3.5) must be merged, deployed and provisioned on dune-dev, because M2
uses its resolver. M4/M6 use `goalTransaction`, which is **on `main`**: PR #435 merged, `db3db83`,
`src/commands.js:1314` (DBA-7, R2 D25).

### 6.2 `[D1]` Personal, active goals only
`sync` resolves the goal with `getGoalScoped(db, { id, ownerType: "player", ownerId: interaction.user.id })`
(`database.js:1319`) and never probes guild scope. A guild goal id, or someone else's id, reads as
"not found" with **zero** adapter calls. The goal must be `active`. A completed or archived goal
replies "Sync works on active goals only."

### 6.3 `[D12]` UX: preview command plus Apply buttons (ARCH-3, UX-2, UX-3, UX-10, SEC-9)
1. `/dune goal sync id:N` does the following checks, each a refusal with **no** Core call and
   **no** cooldown:
   - the guild is on the allowlist;
   - the guild is registered and active;
   - the goal is found, personal and active;
   - at least one node is syncable.
2. It then reads Core **once**, validates the response (§6.4), and builds the plan (§6.4 decision
   table).
3. The ephemeral preview shows **every** goal node:
   - saved value, live value (`backpack / bases` split), delta, and the planned action;
   - manual-only rows;
   - the source line;
   - who and where last set each saved value.

   The preview writes **nothing**.
4. The preview carries up to two buttons, owner-only and expiring after 120 s. The **button matrix**
   is fixed (R2 D42):

   | Plan contains | Buttons shown |
   |---|---|
   | increases/new entries, no decreases | **Apply** |
   | increases/new entries **and** decreases | **Apply**, **Apply incl. decreases** |
   | decreases only (no increases or new entries) | **Apply incl. decreases** only. There is no plain Apply, because it would write nothing. |
   | nothing to write (every row unchanged, none found, no data or skipped) | no buttons; the footer says "Nothing to apply" |

   **Neither button reads Core again.** Apply writes exactly the previewed numbers (ARCH-3 option b).
5. On click, the handler does the following:
   - It refuses a non-owner click, and refuses an expired or unknown nonce with "Preview expired —
     run `/dune goal sync` again". A bot restart also expires every preview.
   - It refuses a click whose `guildId` differs from the guild stored with the preview nonce
     (tenant isolation invariant, §3.1), with zero writes.
   - It then opens **one** `goalTransaction` (IMMEDIATE, §6.4 step 3) and writes.
6. **One nonce pair per preview, consumed together (R2 D46).** Both buttons carry the same preview
   nonce. The first click of **either** button deletes it, synchronously before any `await`
   (R2 D47). A second click on either button, including the other button, replies "Preview already
   used — run `/dune goal sync` again". Two concurrent clicks cannot both pass the lookup, and the
   CAS remains a second guard. M-T21 therefore re-runs `sync` between Apply and Apply incl.
   decreases.
7. **Expiry (R2 D69).** When a preview expires, and while the interaction token is still valid
   (15 min), the handler edits the message to disable its buttons. A bot restart (a deploy through
   `git push deploy deploy`) also expires previews; the "Preview expired" copy says so.
8. **SQLITE_BUSY (R2 D49).** `createDatabase` sets no `busy_timeout` (`database.js:255`–`:256`).
   Other connections (`rotate-keys.js`, `reencrypt-secrets.js`) can hold the write lock. A BUSY
   failure inside the IMMEDIATE transaction replies "The bot's database is busy; nothing was saved.
   Press Apply again." and **does not consume** the nonce. The nonce is restored only when the
   transaction never began.

Why buttons instead of v1's `apply:true`:
- A boolean option is the one thing users mis-set (UX-2).
- Buttons bind apply to what was previewed.
- Apply never repeats the Core query, so the cooldown never blocks it (UX-10).
- Dropping the option saves Discord budget (UX-1).

### 6.4 `[D13]` Response validation, decision table and write procedure (SEC-5, QA-7, QA-10, DBA-7, DBA-8)
**Step 1: validate the Core response** before building any plan.
- `ok === true` and `items` is an array.
- Build a `Map` from the elements. Accept an element only if `id` is a string equal
  case-insensitively to an id mentat requested. Unknown elements are ignored, and `__proto__`
  never becomes a key.
- For each available numeric field: `Number.isSafeInteger(v) && v >= 0`. Strings are rejected,
  not coerced.
- `total === inBackpack + inBases` when all three are non-null.
- **Any violation rejects the whole response:** "Unexpected response from the game server;
  nothing changed", logged with the route key only.
- Iterate **only mentat's own `syncNodes(goal)`**. A requested id with no element is
  **unavailable** and is never treated as 0.

**Step 2: plan per syncable node.** `s` = saved value (or none), `L` = live total, `B` = bases-only
value when the backpack is unavailable.

| Case | Preview shows | Apply | Apply incl. decreases |
|---|---|---|---|
| Node unavailable (no element) | "no data" | skip | skip |
| Backpack unavailable, no saved entry, `B` > 0 | `≥ B` (partial) | write `B` | write `B` |
| Backpack unavailable, no saved entry, `B` = 0 (R2 D44) | "none found in bases (backpack unavailable)" | skip | skip |
| Backpack unavailable, `B` > `s` | `≥ B` (partial) | write `B` (a true lower bound) | write `B` |
| Backpack unavailable, `B` ≤ `s` | "backpack unavailable; not changed" | skip | **skip, never** |
| `L` = `s` | "unchanged" | skip, no write, no audit | same |
| no entry, `L` = 0 | "none found" | skip, no zero row (keeps the 6-entry cap free) | same |
| no entry, `L` > 0 | "new" | write `L` (cap check; if the cap is full, skip and say so) | same |
| `L` > `s` | "+Δ" | write `L` | write `L` |
| 0 < `L` < `s` | "DECREASE −Δ" | skip | write `L` |
| `L` = 0 < `s` | "**NONE FOUND — was s**" plus a warning that stock may be in places not counted | skip | write 0 |
| `L` > 100,000 | "100,000 (capped)" | write 100,000 | write 100,000 |

**Clamp first, then compare (R2 D67).** `L` and `B` are clamped to the column's `CHECK (quantity
BETWEEN 0 AND 100000)` before any row is chosen. A node saved at 100,000 with a live 150,000 is
therefore "unchanged", not a repeated identical write plus an audit row.

**Backpack unavailable (R2 D44).** Every "backpack unavailable" row carries this player copy (draft,
final wording at Layer 2): "Your backpack couldn't be read, usually because your character isn't
loaded. Log in once and try again. Base storage is shown below." U11 records when the pawn id is 0.

**Step 3: write, on button click.** The procedure is:
1. All validation, conversion and clamping were already done at preview time.
2. Open **one** `goalTransaction(db, () => { ... })`. This is synchronous: no `await` inside,
   because better-sqlite3 transactions are synchronous.
3. Re-run `getGoalScoped(... ownerType:"player", ownerId: clicker)` and require `status =
   'active'`. Otherwise write nothing and reply "This goal changed since the preview" (SEC-9).
4. For each planned node:
   - re-read `(quantity, updated_at)`;
   - if it differs from the preview snapshot, **skip** the node and report "changed since preview;
     left as is" (DBA-8, compare-and-set);
   - otherwise run the cap check, then `setGoalOnHandEntry`, capturing `previous` from its return
     value, then `appendGoalAuditLog({ action: "on_hand_update", source: "live_sync",
     sourceGuildId, sourceRef: interactionId })`.
5. After the nodes, run the same completion check `executeGoalOnHand` runs, **once**. Completion
   writes its `complete` audit row with the same source fields.
6. Any exception rolls back **everything**, and the user is told nothing changed.
7. If nothing was written, the reply names **why** (R2 D42), with no audit rows (UX-5):
   - "Already up to date — nothing saved" **only** when every syncable row was "unchanged";
   - "Nothing saved. N decreases were not applied; use Apply incl. decreases." when plain Apply
     skipped decreases;
   - "Nothing saved. N nodes changed since the preview and were left as is." when the CAS skipped
     them.

The applied embed prints, per written node, "Previous: N (set by <@user> at time)" and a
copy-pasteable restore hint using the real goal id and the node's display name (UX-13).

### 6.5 `[D14]` Degradation and error mapping (ARCH-10, CLOUD-1, UX-7, NET-4, NET-7, QA-9)
Nothing is ever written on any row below. The player sees the short text. Operator detail goes
to logs only, with the route key and error code and without the body excerpt. The v1 1,200-char
adapter excerpt is **not** shown for this command.

**Single copy source (R2 D09).** This table and §3.5.7 are both rendered from one copy table in
`src/liveStockErrors.js`, and one test covers it (M-T16 plus A-T23). The two sections must not
diverge again. In v2 the same condition had two texts: `invalid_actor_signature` read "disagree on
their shared key. Ask a server admin." in one and "misconfigured. Ask the bot operator." in the
other. "Ask a server admin" below stands for the **OD 13** role name, recommended as "the person
who connected this server to Mentat". The final wording is the operator's decision and is not
decided silently here.

| Condition | Player sees |
|---|---|
| `db` null | existing guard message |
| DM (no guild) | "Run this in a server: live stock is read from that server's game server." |
| Guild not on the allowlist | "Live stock isn't enabled for this server yet." + manual hint |
| Guild not registered or inactive (strict resolver) | "This server isn't connected to a game server." + manual hint |
| No syncable node | "Nothing in this goal can be read live. Use `/dune goal on-hand`." |
| No verified per-guild signing secret (Phase 2a) | "Live stock isn't set up for this server yet. Ask a server admin." (log: `live_stock.signing_not_configured`) |
| Per-guild secret cannot be decrypted | "Live stock isn't available right now." (log: `actor_secret.decrypt_failed`) |
| 403 `not_linked` | "Link your character first: `/dune player link`." + manual hint |
| 403 `not_authorized` | "Your role can't use live stock. Ask a server admin." |
| 403 `actor_signing_disabled` | "Live stock isn't set up on this game server yet. Ask a server admin." (log: "Core has no active actor signing secret; use Enable signing in Core's Discord settings". v2's "configure DUNE_DISCORD_ACTOR_SECRET on both sides" is the retired shared model and is removed, R2 D23.) |
| 403 `invalid_actor_signature` | "The bot and this game server don't agree on their signing key. Ask a server admin." (log: "secret mismatch; heal re-verify scheduled", §3.5.5) |
| 403 `missing_actor_signature` | "Something went wrong on our side. Nothing was changed." (log: "bug: request sent unsigned") |
| 404/`stock_unsupported` (Core has 2a but not the stock route, or a schema lacks a table) | "This game server doesn't support live stock yet. Ask the person who runs the game server to update it." (R2 D41, D68) |
| 403 `stale_actor_signature` | "Please try again in a moment." (log: "clock skew") |
| 404 JSON `adapter_disabled` | "The game server's bot integration is off." |
| 404 JSON other code (route absent, older Core) | "This game server doesn't support live stock yet. Ask the person who runs the game server to update it." |
| 404 non-JSON, or 5xx non-JSON (proxy or tunnel) | "Couldn't reach the game server — nothing was changed. Try again later." (log: "non-JSON; check console_url") |
| 429 `rate_limited` / 503 `stock_busy` / mentat per-guild gate busy | "The game server is busy. Try again in a minute." (cooldown = `Retry-After`, minimum 30 s; not applied for the local gate, §4.5) |
| 503 `stock_query_failed` / other 5xx JSON | "The game server couldn't read your stock right now. Nothing was changed." |
| Timeout / abort | "Couldn't reach the game server in time. Nothing was changed. Try again later." |
| 200 failing §6.4 validation | "Unexpected response from the game server; nothing changed." |

### 6.6 Copy and visibility rules (UX-2, UX-8, UX-12, UX-13)
- **Preview** title: "Live Stock Preview — nothing saved". Warning color. Footer: "Nothing saved
  yet. Press Apply to save these numbers."
- **Applied** title: "Live Stock Applied". Success color.
- Every embed carries a fixed "Counted / Not counted" line: "Counted: backpack + storage,
  refineries and fabricators in bases you own. Not counted: gear, vehicles, co-owned bases,
  generators, the Exchange, mail." It also carries "As of the game's last save."
- Signals are text plus emoji, never color alone, and deltas are signed ("DECREASE −388 (was 400,
  now 12)").
- Numbers use the bot's existing formatting. The bot is English-only today, and item names come
  from the catalog.
- **Embed limits (R2 D71).** Discord allows 25 fields, 1024 characters per field and 6000 in total.
  Each node is one compact line inside a field, never one field per node, for example
  `Silicone — 350 → 400 (+50) · new · set by @u 2d ago`. If the text would exceed a limit, the
  remaining manual-only rows collapse to "+N manual-only nodes". Syncable rows are never dropped:
  there are at most 6. M-T10b renders the largest recipe in `CRAFTING_RECIPES` and asserts the
  limits.

### 6.7 `[D15]` Cooldown (ARCH-4, SEC-4, QA-14, UX-9, UX-10)
- `goal:sync` has a **15 s** per-user cooldown (M7). There is no admin shortcut.
- It is applied **only after a Core request was sent**. Local refusals cost nothing, so a
  misconfigured or unlinked user is not locked out. That includes the per-guild in-flight gate
  (§4.5.6).
- After `stock_busy` or `rate_limited` the cooldown is `max(15 s, Retry-After, 30 s)` (R2 D35).
- Apply buttons are not slash commands and do not touch Core, so they are **not** cooldown-gated.
  The intended preview-then-apply flow has no wait.
- The cooldown is in-memory and per process. It is a courtesy bound. The real protection of the
  shared Core pool is Core-side (§4.5).
- v1's "30 s using the existing mechanism" was false (F8) and is withdrawn.

### 6.8 `[D17]` Ephemeral is a requirement, not a preference (SEC-7, UX-11, GRC-5)
The reply shows the player's own holdings, and in a PvP game with base raiding that is actionable
intelligence. `deferReply` for `goal:sync` is therefore always ephemeral, via
`FORCE_EPHEMERAL_COMMANDS`, **regardless of `DISCORD_DEFAULT_EPHEMERAL`**. Button follow-ups
update the same ephemeral message. This is tested (§11.2 M-T14).

## 7. Data Model and Migration (Requirement 26) (GRC-1, DBA-12)

**Correction to v1 `[D2]`.** v1 said provenance "would need a table rebuild". That is overstated.
Only extending the `action` CHECK list needs a rebuild. Nullable columns are additive.

**Schema v10 → v11 (`src/database.js`).** v9 is #384's migration and v10 is Phase 2a's (F8, §3.5.2). This is a separate migration in the 2b PR. It cannot share one with 2a, because 2a ships first as its own PR.
```sql
ALTER TABLE goal_audit_log ADD COLUMN source TEXT;          -- 'manual' | 'live_sync'; NULL = row written before v11
ALTER TABLE goal_audit_log ADD COLUMN source_guild_id TEXT; -- guild whose Core was read (live_sync only)
ALTER TABLE goal_audit_log ADD COLUMN source_ref TEXT;      -- Discord interaction id (correlates with Core's audit line)
```
- **Mechanism (R2 D05):** a guarded `if (currentVersion.version < 11)` block. It uses the
  **fail-closed** form from §3.5.2: one transaction per step including its own version bump; catch
  only "duplicate column name"; a `PRAGMA table_info(goal_audit_log)` assert at startup. It does
  **not** copy the v5→v6 try/catch-all (`database.js:285`–`:297`) verbatim. The fresh-install
  `CREATE TABLE` gains the same three columns. Bump `SCHEMA_VERSION` to 11.
- **No CHECK** is added on `source`. Values are validated in `appendGoalAuditLog`, which avoids
  any future rebuild. `action` stays `on_hand_update` for sync writes.
- **Backward compatible:** v10 code inserts an explicit column list (`database.js:1369`) and
  keeps working against a v11 table. Old rows read `NULL`, rendered as "unknown (before v11)".
- **Rollback SQL:** `ALTER TABLE goal_audit_log DROP COLUMN source_ref; ... DROP COLUMN
  source_guild_id; ... DROP COLUMN source;` (SQLite 3.53.2 bundled, F8), then
  `UPDATE schema_version SET version = 10`. Alternatively, leave the columns: v10 code ignores
  them. The v11 rollback always runs **before** any v10 rollback (§3.5.2).
- **Growth (R2 D65).** One Apply writes at most 6 `on_hand_update` rows plus 1 `complete` row, at
  most once per 15 s per user. For a few hundred active users that is well under 10^5 rows per
  year, and the table is indexed on `goal_id`.
- **Tests (§11.2 M-T18):**
  - a v10 database with existing goal and audit rows upgrades to v11 with all rows intact and NULL
    source;
  - `appendGoalAuditLog` writes and reads all three values;
  - v10's insert statement succeeds against v11;
  - the rollback SQL yields a v10-compatible table;
  - the migration runs on a copy of a production-sized mentat DB, with size and structure but
    **not** real player data, and the timing is recorded (Requirement 26).
- **Backups:** synced values are ordinary `goal_on_hand_entries` rows, captured by the existing
  whole-file SQLite backup.
- `goals` / `goal_on_hand_entries` are unchanged. `updated_by` stays the Discord user id: the
  manual embed renders it as a mention, so no marker goes there.

## 8. RBAC, Privacy, Data Classification

| Question | Answer |
|---|---|
| Who can call the Core route? | `observer` (Player) tier and up, with a **signed** actor (§3.3) and a linked character. `public` is rejected. |
| Whose stock is returned? | Only `getLinkedPlayer(actor.userId)`. No target parameter exists (§4.2). Proven by a real-Postgres two-player test (§11.1 T3). |
| Can a player read another player's stock? | No. There is no way to name another player, extra body fields are ignored, and mentat builds `userId` from the interaction. |
| Who can sync a goal? | The goal's owner, on an active personal goal, in an allowlisted, registered guild. Button clicks are owner-checked. |
| Any admin path? | No. Admins get no extra read of members' stock. |

**Data classification and retention (GRC-5).**
- **Class:** per-player game-holdings counts for specific items. They are linked to a Discord user
  id and a game character. Sensitivity is **low-to-moderate**: not credentials or PII, but PvP-
  relevant ("who holds how much titanium"). That is why the reply is forced ephemeral (§6.8).
- **mentat stores only what the player applies.** It stores the integers the player chose to
  save. The preview itself is held in memory for at most 120 s and never persisted.
  - This is the same storage class as manual entries (Phase 3 `[H11]`).
  - What is new is persisted provenance (guild id, interaction id).
- **Retention:**
  - `goal_on_hand_entries` rows are deleted with their goal (FK `ON DELETE CASCADE`).
  - `goal_audit_log` rows, including previous/new quantities and the new provenance columns,
    **survive goal deletion indefinitely by design**, for disputes (`database.js:186`–`:188`).
    This is unchanged from Phase 3 and now stated explicitly. Retention is "indefinite, bounded by
    erasure requests". The growth estimate is in §7 (R2 D65).
- **Erasure:** a user's erasure request is handled as for Phase 3 goal data. The operator deletes
  that user's `goals` rows, which cascades to entries, and their `goal_audit_log` rows by
  `actor_id`, and records it. The mentat SQLite backup rotation bounds how long backups keep the
  data.
- **Core stores nothing new** except the counts-free audit line (§4.7).
- **Privacy policy:** at Layer 2, grep the published privacy policy and FAQ for a statement
  covering "game data read on your request" and record the result in the tracking issue. If none
  exists, the M11 docs delta adds one sentence.

## 9. Redaction and Logging
- The Core response and audit line carry counts or none: no item ids in the audit line, no names
  (§4.6, §4.7).
- Core provider errors are mapped to `stock_query_failed`, so no Postgres text (schema, table,
  column) reaches Discord (SEC-11).
- mentat logs, for this command:
  - route key, error code, guild id and latency (`recordLatency`);
  - **no** item ids, counts, `roleIds`, request body, `Authorization` header or signature
    headers (CLOUD-6).
  - Output still passes through `redactSecrets`.
- **Value-based redaction (R2 D50).** `redactSensitiveString` (`format.js:82`–`:92`) redacts only
  bearer and labelled credentials. A bare 64-hex value inside an error message would pass through.
  Phase 2a adds a 64-hex pattern for the signing and registration paths. The A-T11 canary test
  asserts the secret never appears in any output, rather than relying on redaction alone.
- Transport: bearer and counts travel exactly as for sibling routes. The cleartext-HTTP-on-LAN
  hop is pre-existing and documented in the operator notes (NET-6, §12).

## 10. Failure Modes

| # | Failure | Detected by | Effect | Mitigation |
|---|---|---|---|---|
| FM1 | Core older than this change | JSON 404 / 403 | Refused | §6.5; manual path intact |
| FM2 | Player not linked | 403 `not_linked` | Refused | §6.5 |
| FM3 | Adapter down or slow | abort / timeout | Refused, nothing written | One attempt, no retry (§4.5) |
| FM4 | Slow query | 2 s statement timeout | 503, nothing written | Inventory-driven shape (§4.3); EXPLAIN merge gate (§11.4) |
| FM5 | Id spelled differently in `dune.items` | Sweep; would read 0 | False "none found" | Case-insensitive match; U1 sweep gate; `0 < saved` needs the decreases button |
| FM6 | Stock in an uncounted place | Player | Understated | "Not counted" line; decreases are opt-in |
| FM7 | DB lags the game | Player | Stale number | "As of the game's last save"; U6 measured in UAT |
| FM8 | Fan-out double count | Integration fixture + oracle | Overstated | `distinct` inside the base branch; T5 |
| FM9 | numeric-as-string / NULL arithmetic | Unit tests | NaN or garbage | SQL coalesce; JS safe-integer check |
| FM10 | Same goal synced from two guilds | Source line + last-source display | Confusing overwrite | §3.1 |
| FM11 | Manual edit between preview and apply | CAS on `updated_at` | Would lose the manual edit | Node skipped and reported (§6.4) |
| FM12 | Discord 3 s ack | `deferReply` before dispatch | none | unchanged |
| FM13 | Pool exhaustion | Core semaphore | 503 `stock_busy` for the extra caller only | §4.5 |
| FM14 | Pawn id missing | Provider | Backpack unavailable | Never reads `actor_id = 0`; never decreases from it |
| FM15 | Unregistered guild | Strict resolver | Refused | Never uses the fallback adapter (§3.1) |
| FM16 | Hostile or buggy tenant Core | §6.4 validation | Whole response rejected | Only mentat's own nodes, safe integers |
| FM17 | Partial apply | `goalTransaction` | none | Rollback on any throw |
| FM18 | Signing secret mismatch (restore, clone, lost handshake response) | 403 codes, heal re-verify | Refused with the correct diagnosis | §3.5.5 heal, §3.5.7, §6.5 (v3: no rotation window, R2 D01) |

## 11. Testing Strategy

### 11.1 Core (`console/api/test/`, Requirement 8)
**Gate rule (QA-3).** The integration tests below run on real Postgres through
`withIsolatedDatabase`. That helper **skips** locally without Postgres, but **throws under `CI`**,
and CI provisions Postgres (F6). Layer 2 evidence must therefore be a CI run, or a local run with
Postgres, in which these tests are reported as **executed, not skipped**. A green run with skips
does not satisfy the gate. The QA-3 claim that CI would silently skip them is incorrect; see the
register.

| Id | Test (name) | Kind |
|---|---|---|
| T1 | `players/stock: capability matrix — public 403, observer/moderator/admin/owner 200` + existing `minTierForCapability` loop covers `STOCK_SELF_READ` | route, fake db |
| T2 | `players/stock: rejects unsigned (actor_signing_disabled without secret; missing_actor_signature with secret)`; `tampered params.itemIds after signing → invalid_actor_signature`; `a top-level itemIds or actor.itemIds is ignored — the provider reads only body.params.itemIds`. (v2's "itemIds outside the signature → invalid_actor_signature" was impossible: Core merges only `body.params` into the signed payload, so an unsigned top-level field still verifies. R2 D53.) | route |
| T2b | `players/stock replay: envelope after the skew window → stale_actor_signature; same envelope to another route → invalid_actor_signature; params.itemIds order is significant, object key order is not` (R2 D73) | route |
| T3 | **`players/stock integration: two linked players, same item, each reads only their own totals even when naming the other in the body`**. A = 100 (backpack 30 + base 70), B = 7000. A with body `{playerControllerId: B, actorId: B, discordUserId: B}` gets 100; B gets 7000. | **real Postgres** |
| T4 | `players/stock integration: base population`. Counted: storage container, refinery (capped inventory), fabricator, two owned bases summed. Not counted: generator (`Oil` 499), recycler, repair station, totem, hologram placeable, rank-2 base, the `max_item_count = -1` inventory, worn-gear inventory (type 1), item-owned inventory (`actor_id` null). Two type-0 inventories on one pawn are both summed. | real Postgres |
| T5 | `players/stock integration: fan-out fixture counts once and equals the naive oracle`. One placeable with 2 `actor_fgl_entities` and 2 `permission_actor_rank` rows (ranks 1 and 2), stack 100 → 100. The expectation is recomputed by a deliberately naive per-inventory SQL (sum per `inventory_id` from `dune.inventories` directly) and must match. | real Postgres |
| T6 | `players/stock integration: case-insensitive exact match` (`oil` row matches `Oil`; reply spelled `Oil`; `Silicone` does not match `SiliconeX`) | real Postgres |
| T7 | `players/stock integration: zero-fill and null handling` (only in bases → `inBackpack` 0, not null; only backpack; absent id → zeros) | real Postgres |
| T8 | `players/stock integration: pawn id '0' → unavailable backpack, and an actor_id=0 type-0 inventory holding the item is never counted` | real Postgres |
| T9 | `players/stock integration: runs read-only with lock_timeout` (a write attempted inside the provider transaction fails); `the preamble is the first statement after begin` (R2 D32) | real Postgres |
| T10 | `players/stock: input validation` (0 ids, 17 ids, non-array, non-string, `%`/space/quote/`;`, 65 chars, leading digit, case-insensitive duplicates de-duped, `__proto__`/`constructor`/`prototype` in any case → 400; afterwards `({}).total === undefined` and `Object.prototype` is unchanged) | route |
| T11 | `players/stock: provider converts numeric strings; an unsafe integer gives stock_query_failed` | unit |
| T12 | `players/stock: second concurrent call → 503 stock_busy without acquiring a pool client`; `7th call in 60 s → 429 rate_limited with Retry-After and no 15-min block` (R2 D34) | route, fake db that hangs |
| T12b | `permit released after provider throw, after statement timeout, after whole-handler deadline, and after res close`; `semaphore/limiter reset helpers keep tests isolated` (R2 D51) | route |
| T12c | `30 denied requests (bad signature, 403, 400, 429) take no permit or limiter slot; a valid request then succeeds` (R2 D51) | route |
| T13 | `players/stock SQL guard: query text contains "= any(" and "lower(", is one statement, and contains no "ilike"` (runs without Postgres) | unit |
| T14 | `players/stock: DB error → 503 stock_query_failed; body has no SQL text` | route |
| T15 | `players/stock: audit line on success and on each denial code has playerControllerId/outcome/interactionId and no item ids, totals, signature or token` | route |
| T16 | `players/stock contract: real handler output for the seeded fixture deep-equals test/fixtures/players-stock.json, including contract: "players-stock/1"` | real Postgres |
| T19 | `players/stock: missing inventory_type/permission_actor_rank → stock_unsupported; the SQLSTATE class is logged server-side, never returned` (R2 D68) | route/unit |
| T17 | catalog: `buildCommandCatalog()` succeeds with `goal:live-stock`; route present in `DISCORD_LIVE_ADAPTER_ROUTES` | unit |
| T18 | No regression: before implementing, run `git grep` on `origin/main` for tests that enumerate live routes or capabilities (`discordCommandCatalog.test.js`, `discordAdapterSettings*.test.js`, `discordPolicy.test.js`, adapter route-list assertions) and update them in the same PR. The full suite stays green. (QA-11) | suite |

Requirement 22: these are new `ours-only` files. `check-upstream-test-drift.sh` will list them as
fork-only, which is expected while the route is fork-only. The PR body says so.

### 11.2 mentat (`node --test`)

| Id | Test (name) |
|---|---|
| M-T1 | `config: MENTAT_LIVE_STOCK_GUILD_IDS unset → empty allowlist (feature off)`; CSV parsing; a malformed id is ignored with a warning (QA-6) |
| M-T2 | `adapterClient.playerStock: POST /api/integrations/discord/players/stock, body {actor, params:{itemIds}}, signed with STOCK_SIGNED_ACTOR_FIELDS` |
| M-T3 | `adapterClient.playerStock: inactive/unregistered guild throws, never uses the fallback config` (NET-1) |
| M-T4 | `adapterClient.playerStock: empty signing secret → throws, zero requests` (CLOUD-1) |
| M-T5 | `goal sync: guild not allowlisted / DM / db null / guild inactive → zero adapter calls, no cooldown` |
| M-T6 | `goal sync: guild goal id and another user's goal → not found, zero adapter calls`; `completed goal → active only` |
| M-T7 | `goal sync: water and non-resource simple-goal nodes are listed as manual only, never requested or written`; `goal whose only nodes are manual → zero adapter calls` (QA-4) |
| M-T8 | `for every CRAFTING_RECIPES goal: every syncNodes id matches the Core id regex, count ≤ 6` (QA-4) |
| M-T9 | `goal sync: response validation`. Missing element → "no data", not 0. Extra element ignored. `__proto__` element ignored with `Object.prototype` unchanged. String / float / negative / unsafe integer / `total` mismatch → whole response rejected, nothing written. (SEC-5, QA-7) |
| M-T10 | `goal sync: decision table`, one test per §6.4 row (including backpack-unavailable with B = 0, and clamp-then-compare at 100,000), and the §6.3 **button matrix** and "nothing saved" reasons (QA-10; R2 D42, D44, D67) |
| M-T10b | `goal sync: preview embed for the largest CRAFTING_RECIPES goal stays within 25 fields / 1024 per field / 6000 total; overflow collapses manual-only rows` (R2 D71) |
| M-T11 | `goal sync preview writes nothing`: `goal_on_hand_entries`, `goal_audit_log` and the goal row are byte-identical before and after; spies on `setGoalOnHandEntry`/`appendGoalAuditLog`/`completeGoal` show 0 calls (QA-5) |
| M-T12 | `goal sync apply`: writes exactly the previewed values even when the mock adapter would now return different ones (adapter call count on apply = 0); expired nonce refused and buttons disabled; another user's click refused; **two concurrent clicks** (`Promise.all` with a fake `deferUpdate` that yields) write once and the second gets "Preview already used"; the other button after a first click is refused (R2 D46, D47) |
| M-T13 | `goal sync apply`: CAS skip when `updated_at` changed; **absent at preview, present at apply** (manual entry typed in between) is skipped; same quantity with a different `updated_at` (set by direct SQL, never sleep) is skipped; two previews of one goal applied back to back, the second skipping via CAS; goal deleted or archived between preview and apply → nothing written; forced throw on the 3rd node → no entry or audit change (DBA-7, DBA-8, SEC-9; R2 D48) |
| M-T25 | `goal sync apply under a second better-sqlite3 connection holding the write lock: the transaction begins IMMEDIATE, BUSY gives the friendly message, the nonce is not consumed` (R2 D49) |
| M-T14 | `goal sync: deferReply called with ephemeral:true when defaultEphemeral=false` (SEC-7) |
| M-T15 | `cooldown: goal:sync is 15 s via mock.timers (blocked at 14.9 s, allowed at 15.1 s), no admin shortcut, not applied after a local refusal, not applied to Apply buttons`; unique `userId` per test + `resetCooldowns` (QA-14) |
| M-T16 | `goal sync: error mapping`, table-driven over every §6.5 row: player text + zero writes (includes `200 ok:false`, `200` non-JSON, `stale_actor_signature`, `adapter_disabled`, non-JSON 404) (ARCH-10, QA-9) |
| M-T17 | `goal sync: logs contain no item ids, counts, roleIds, body or auth/signature headers` (CLOUD-6) |
| M-T18 | `schema v10→v11 migration`: see §7 |
| M-T19 | `goal audit provenance: sync rows have source=live_sync + source_guild_id + source_ref; typed on-hand rows have source=manual` |
| M-T20 | `contract: test/fixtures/adapter/players-stock.json and the golden signing vectors are byte-identical to Core's at the pinned Core ref (fetched in CI; fails, never skips, under CI=true) and parse through the real validator` (QA-2; R2 D10) |
| M-T21 | `goal journey (sync): create → sync preview → Apply → progress → on-hand override → sync (decrease shown, Apply skips it) → Apply incl. decreases → delete` with AzuriteOre, plus a craftable recipe containing water (QA-13; extends `test/commands.test.js:1186`) |
| M-T22 | `command budget stays ≤ 7500` (the existing test, not re-baselined); `getCommandRegistry()`/`helpPayload()` include `goal sync`; `goal:sync` autocomplete returns no guild goals for admins (UX-1, ARCH-11) |
| M-T23 | `goalValidNodes refactor: existing on-hand tests unchanged and green` |
| M-T24 | `tenant isolation (two-guild fixture)`: guilds A and B with distinct `guilds` rows (`adapter_token`, `console_url` to distinct stub Cores, per-guild signing secrets). `goal sync` preview, Apply, decreases-Apply, autocomplete and every error path from guild A read only A's row, send only to A's stub Core with A's token and A's secret, never B's or the process config/secret; **the same matrix for the Phase 2a paths
(registration, owner Confirm, heal, secret-only update) and the legacy write-bridge purpose, with a
distinct process-wide `DUNE_DISCORD_ACTOR_SECRET` and process adapter token set so any use of
either is detectable** (R2 D11); an Apply button replayed in guild B for a preview made in A refuses with zero writes; the last-source line for a goal last synced in B shows "another Discord server" without reading B's row; `commandDefinitions()` has no option named `guild`, `guild_id`, `tenant` or `server_id` on `goal sync` (operator tenant isolation requirement) |

### 11.3 Contract fixture, golden signing vectors and a real drift gate (QA-2, QA-12; R2 D10)

**Why v2's check was not enough.** Each repo pinned a sha256 of its **own** copy of the fixture. A
coordinated change inside one repo (fixture and pin together) kept that repo green, while the other
repo's stale copy and pin stayed green too. Core's pairing test used a frozen *copy* of mentat's
signing function. The precedent failure is `test/actorSignature.test.js`: its cross-repo check
`return`s (skips) when Core is absent from a hardcoded path. That skip is how the #1070 field-set
drift went unnoticed.

**v3:**
- **Golden signing vectors.** One file, `actor-signature-vectors.json`, is vendored byte-identically
  in Core (`console/api/test/fixtures/`) and mentat (`test/fixtures/adapter/`). Each entry holds the
  secret, actor, params, route, fixed timestamp, field-set name, signature version and expected
  HMAC, for v1 and v2, generic, write-bridge, stock and check.
  - Each repo's **real** code asserts against it: Core's `verifyActorSignature` verifies every
    vector (K-T7), and mentat's signing functions reproduce every signature (A-T8, A-T12).
  - The vectors for NULL guilds are computed on `main` **before** 2a. A-T8 therefore pins today's
    behaviour, and never compares new code with new code or two clocks.
- **The canonical stock fixture** `players-stock.json` is produced in Core by the real handler over
  the seeded fixture, envelope included (T16), and copied to mentat.
- **A real cross-repo gate.** mentat CI fetches Core's `players-stock.json` and
  `actor-signature-vectors.json` at a **named Core ref**, recorded in a pinned file and updated
  deliberately, and compares bytes.
  - Under `CI=true` an unreachable ref or a mismatch **fails**; it never skips. The same rule
    applies to any mentat test that imports Core by path. This mirrors Core's `withIsolatedDatabase`
    skip-locally/throw-in-CI rule.
- **A runtime contract marker.** The stock response carries `contract: "players-stock/1"`. mentat
  rejects any other value as "Unexpected response" (M-T9), so skew shows up in production instead
  of as silently wrong numbers.

### 11.4 Live UAT on `dune-dev` only (executable; QA-8)
`dune-prod` is off-limits without explicit Requirement 7 approval.

**Prerequisites**
- Verify what dune-dev runs (U9).
- **All calls go through the public hostname** `console-dev.darkdante.org`, the real bot VM →
  Cloudflare → tunnel path. A LAN-only pass proves nothing about production (R2 D60).
- **Harness (R2 D12).** A named script, `scripts/uat/live-stock-probe.js` in mentat, run by the
  operator. It reads dune-dev's per-guild secret from the Core file on dune-dev, never prints or
  logs it, and signs exactly as mentat does (golden-vector-checked).
- **Test identities** the operator must have: character X (linked, Player tier), a second
  character Y that owns Base C and grants X rank 2, an unlinked Discord user, a `public`-tier user,
  and a moderator. Rows that need an identity the operator does not have are marked "covered by T4
  only".
- dune-dev's guild has a **verified per-guild signing secret** (Phase 2a), and its fingerprint
  matches the one dune-dev's Core shows and differs from prod's. dune-dev's bearer is its own, not
  prod's, checked by presence only (CLOUD-8).
- The dune-dev Discord guild is registered and active in mentat (§3.1).
- The Steam-link review has been done (§4.2a).

**Step 0: resolve U4 before Layer 2** (DBA-3). Read-only:
`select indexdef from pg_indexes where schemaname='dune' and tablename in ('items','inventories','permission_actor_rank','placeables','actor_fgl_entities')`
and `select reltuples from pg_class where oid='dune.items'::regclass`.

**Step 1: id sweep (U1)**
- `select template_id, count(*) from dune.items where lower(template_id) = any($bridge_lower) group by 1`.
- Pass: all 27 bridge ids present in some spelling, or a written per-id decision for each absent id
  (`Oil` and `T5RadiatedCoreComponent` are named).
- Also run `select count(*) from dune.inventories where actor_id = 0` and record the result.

**Step 2: seeded ground truth.** Every row names how it is seeded (R2 D12). "In-game" means the
operator plays X. Direct SQL is allowed **on dune-dev only**, with the exact statement recorded in
the evidence.

| Where | Item | Qty | Counted? | Seeding method |
|---|---|---|---|---|
| Backpack | Silicone | 50 | yes | console Give to X |
| Base A (rank 1) storage container | Silicone | 200 | yes | in-game deposit |
| Base A medium ore refinery (input slot) | Silicone | 30 | yes (Open Decision 3 default) | in-game deposit |
| Base B (rank 1) chest | Silicone | 120 | yes | in-game deposit |
| Hologram placeable in Base A | Silicone | 999 | **no** | **covered by T4 only.** A hologram is a build preview, and there is no known in-game or console way to put items in one. |
| Base C where X is rank 2 | Silicone | 500 | **no** | needs character Y. If Y is unavailable, **covered by T4 only**. |
| Base A oil generator | Oil | 499 | **no** | in-game fuel |
| Base A chest | Oil | 200 | yes | in-game deposit |

**Expected results**
- Silicone: `total 400, inBackpack 50, inBases 350`.
- Oil: `total 200` (plus any backpack Oil, which is recorded).
- A simple goal on an **equipped** stillsuit reads "manual only" (worn gear is never read; a
  worn-gear *resource* stack cannot exist in-game and is covered by T4).
- The independent ground-truth SQL sums per `inventory_id` directly from `dune.inventories` with
  explicit ids, not through the ownership join.

Pass: **exact equality**.

**Step 3: timing**
- The default limiter is 6 per minute per user, so 40 calls would hit `rate_limited` (R2 D12). For
  this step only, set `DUNE_STOCK_RATE_PER_MIN=30` on **dune-dev**. That is a console restart on
  dune-dev, and a Requirement 7 approval. Spread the calls over **at least 2 minutes**, and restore
  the default afterwards.
- 20 sequential calls through the tunnel hostname. Pass: p95 < 1 s. VLAN timing is recorded for
  comparison only.
- **Merge gate (R2 D40).** Record `EXPLAIN (ANALYZE, BUFFERS)`, the plan and the `reltuples` of the
  five tables against a **production-size restore** (a restored prod backup on a scratch Postgres),
  not only dune-dev. dune-dev's volume does not predict the prod planner.
  - Step 0 additionally checks the indexes on `permission_actor_rank(player_id)` and
    `placeables(owner_entity_id)`, not only `items(inventory_id)`.
  - dune-prod's first real calls are monitored for p95 and `stock_query_failed`.

**Step 4: lag (U6).** Move a known stack between backpack and chest and record the time until the
route reflects it. There is no pass threshold; the value goes into the user-facing "as of last
save" wording.

**Step 5: negative paths**
- unlinked test user; `public`-tier user; moderator (each only if the identity exists, otherwise
  "covered by T1");
- 17 ids; `__proto__`; foreign id in the body;
- unsigned request on a signed deployment;
- 7 calls in a minute (expect `rate_limited` with `Retry-After`), after restoring the default limit;
- dead console port (repoint mentat's test guild row; do not stop dune-dev services).
- `stock_busy` is **not** tested live. Two calls against a millisecond query do not overlap
  deterministically. T12 proves it (R2 D12).

**Step 6: end to end in Discord.** Personal goal → `sync` preview → **Apply** → `progress` →
decrease case → **Apply incl. decreases**.
- Verify: saved numbers; audit rows with `source`, `source_guild_id` and `source_ref`; Core audit
  line with the same interaction id; the reply is ephemeral.
- The bot is a **single production instance**; there is no test instance. The live
  `DISCORD_DEFAULT_EPHEMERAL=false` toggle is therefore **dropped**. M-T14 proves forced-ephemeral,
  and changing that env would restart the bot for every guild (Requirement 7) (R2 D12).

**Step 7:** post results, with seed table, SQL, timings and EXPLAIN, as a comment on the tracking
issues (Requirement 20).

## 12. Documentation Impact (Requirement 14 / GRC-3) — required section of both PR bodies

| Doc | Repo | Change |
|---|---|---|
| `docs/console/API-REFERENCE.md` | Core | New route (POST, body, response array, error codes, limits); **fix the GET→POST drift at `:1018`–`:1022` in the same PR** |
| Discord tier/capability doc (the doc listing `CAPABILITY_BY_TIER`; locate with `git grep -l INVENTORY_READ -- docs`) | Core | `STOCK_SELF_READ` at observer+ |
| `CHANGELOG.md` | Core | Entry: "no operator action required. Live stock needs per-guild actor signing, enabled from Discord settings with **Enable signing** (Phase 2a). New env: `DUNE_STOCK_QUERY_TIMEOUT_MS`, `DUNE_STOCK_MAX_INFLIGHT`, `DUNE_STOCK_RATE_PER_MIN`, optional `DUNE_DB_RO_USER` (OD 11)." (GRC-10). v2's "both must share `DUNE_DISCORD_ACTOR_SECRET`" was the retired shared model (R2 D23). |
| Actor-secret provisioning and rotation runbook | Core | `docs/security/actor-secret-rotation.md`, shipped with Phase 2a (§3.5.9), not with this PR |
| `docs/console/base-inventory.md` | Core | Note that the stock route reuses the Storage/Refining/Crafting groups |
| Operator notes in `docs/integrations/discord-integration/README.md` (Core has **no** `docs/networking.md`; v2's row was wrong, R2 D23) | Core | Signed path is baseUrl-relative (path-rewriting proxies break it); cleartext-HTTP LAN note (NET-6); public https console required for mentat to reach it (§3.5.9) |
| `docs/architecture.md` "Read Capabilities" (`:109`) | mentat | Add `players-stock` and the signed-fields note |
| `docs/user-guide.md` goal table (`:110`–`:118`) | mentat | `/dune goal sync`, buttons, what is counted, manual-only nodes |
| `docs/crafting-resource-planning-overview.md` | mentat | Phase 2 status |
| `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md` | mentat | Cross-reference: `sync` subcommand and v11 audit columns |
| `CHANGELOG.md` | mentat | Entry, including schema v11 and `MENTAT_LIVE_STOCK_GUILD_IDS` |
| `.env.example` / config docs | mentat | `MENTAT_LIVE_STOCK_GUILD_IDS` (empty = off, restart to change) |
| `docs/faq.md` / privacy text | mentat | One sentence on on-request game-data reads, if absent (§8) |
| Phase 2a docs | both | See §3.5.9. They ship with the Phase 2a PRs, not with this PR. |
| `README` Live Systems (meta repo) | meta | Only if the bot VM `.env` gains the allowlist (Requirement 23 not triggered: no new ingress) |

## 13. Rollout and Rollback

**Rollout order**

*Phase 2a, per-guild signing (§3.5). The order is fixed: **mentat first, then Core** (R2 D01).*
- **A0. Hard gates.** Every one of these must hold before any 2a code merges:
  - governance steps (§14.1);
  - Layer 1 round 2 reviewed (done);
  - **mentat#438 resolved**: the deploy branch is reconciled with `main`, that build is deployed
    and verified on its own, and its SHA is recorded as the A-T8 baseline (R2 D16);
  - **U13 resolved**: the operator's guilds are active `guilds` rows, required by the strict
    resolver's Requirement 0 gate (§3.1);
  - OD 9 settled and U12 verified;
  - OD 7 decided before the Core PR (R2 D26);
  - OD 14 decided.
- **A1. mentat 2a.** Implement (mentat#443–#448), run Layer 2 and Layer 3, merge, and deploy.
  Nothing changes until a Core sends `actorSigning`. NULL guilds match the golden v1 vectors
  (A-T8). The strict resolver's behaviour change for inactive guilds' background paths is
  expected.
- **A2. Core 2a** (Core#1088). A Core session implements K1–K5 and runs its Layer 2. It merges to
  fork `main` with a merge commit, and the operator deploys it to dune-dev. A pending secret that
  no mentat promotes simply expires, so this is safe in either order. The order is still fixed.
- **A3.** Hosted tenants get "Enable signing" once their Core updates. Nothing is forced.
- **A4. dune-dev.** The operator runs "Enable signing" (Path 1) and compares fingerprints. Then
  exercise: `/dune player link`/verify; a write-bridge preview; **an owner-only command** (signature
  v2, R2 D02); a **hosted rotation and a manual rotation**, with timings recorded (Requirement 27
  rehearsal, R2 D22); a forced store failure proving `revert` (on dune-dev only). Evidence goes on
  mentat#434. This is the 2a exit criterion.
- **A5. dune-prod.** Needs operator approval, and the Core deploy there is done by the operator.
  Subject to OD 14: if dune-prod is the bot's default-config Core, it stays on the legacy path
  until the default-config paths move.

*Phase 2b, stock route and sync:*
0. Governance steps (§14.1).
1. The Core session implements the stock route, tests it and runs Layer 2, then merges to fork
   `main` (§14.3 lifecycle).
2. The operator deploys Core to dune-dev.
3. UAT steps 0–5.
4. mentat branch `feat/goal-live-sync` starts after Phase 2a is merged, deployed and provisioned on
   dune-dev (PR #435 is already merged). It then goes through implementation, Layer 2
   and Layer 3 (`/code-review high`), and is merged. Open Decision 5 was decided on 2026-09-29.
5. Deploy mentat via `git push deploy deploy`, with the guardrail hook. The allowlist is still
   empty, so this is a no-op for users.
6. Add the dune-dev guild id to `MENTAT_LIVE_STOCK_GUILD_IDS`. This is a Requirement 7
   bot restart.
7. UAT step 6.
8. dune-prod only with explicit operator approval, after three things: the Core side is deployed
   there by the operator, prod's guild has a verified per-guild secret, and the §4.2a review has
   been done for prod.

Never allowlist a guild whose Core lacks the route. That would be harmless (FM1) but noisy.

**Rollback**
- **2b mentat:** remove the guild id from the allowlist, which is a Requirement 7 restart and **not
  instant**. Or revert the 2b merge. Schema v11 columns may stay, because v10 code ignores them;
  otherwise run the §7 rollback SQL, always before any v10 rollback. Already-applied on-hand numbers
  are ordinary saved entries the player can edit.
- **2b Core:** revert the route. There is no schema, data or index to undo, and nothing else calls
  it.
- **2a** is **forward-only** once any guild is promoted (§3.5.2, R2 D17).
  - Before that point, reverting either side is safe.
  - After it, "rollback" means a build that still reads the v10 columns.
  - A Core-side mistake within 15 min of a promote is undone with `revert`.
  - Otherwise use Regenerate followed by the handshake.

## 14. Governance and Cross-Repo Sequencing

### 14.1 Before implementation (Requirements 13, 15, 18, 20, 28, 29)
1. **Requirement 28 check, re-run for v3 (2026-09-29).**
   - `gh issue list --repo Project-Arrakis/dune-awakening-selfhost-docker --label ops-monitor
     --state open` shows the same three open issues:
     - **#1086**: fork/upstream divergence, 1533 ahead / 1404 behind. Relevant to any future
       upstream PR (Open Decision 7), not to the fork-only branch.
     - **#1085**: needs-human-review, "Upstream sync status". It says the raw commit counts are
       unreliable for this fork (squash-sync).
     - **#1069**: needs-human-review, upstream security-checks CI silently skips gitleaks.
       Relevant to Requirement 10 scan evidence for any upstream PR (R2 D56).
   - mentat has none.
   - #1085 and #1069 await the operator's review.
   - Re-run and record the check at branch creation.
2. **File issues and add them to the board with Priority and Workstream (Requirement 15).**
   - (a) Tracking issue: **mentat#434**, done. It now carries both rounds' registers and STRIDE
     tables as comments.
   - (b) The Phase 2b Core issue, with a self-contained implementation prompt covering C1–C9, §4,
     §11.1 **and the round-2 appendix in Core#1088**. It is filed at 2b branch cut. This session
     **hands off** and does not implement it (Requirement 18).
   - (c) Phase 2a: **done in round 2**. mentat#443, #444, #445, #446, #447, #448 (High), #449
     (Medium), #450 (Low bundle), and Core **#1088** (the Requirement 18 prompt). The schema gate is
     the existing **mentat#438**. The current-system findings in §3.5.10 are still to be filed.
   - (d) Follow-ups listed in §17.

   **Evidence map: layer × PR × issue (R2 D24).**

   | Deliverable | L1 (design) findings posted on | L2 (implementation) posted on | L3 (`/code-review high`) posted on | PR risk class |
   |---|---|---|---|---|
   | mentat 2a | mentat#434 (rounds 1 and 2) | mentat#443 | mentat#443 | **High**: it changes the signing path of link, verify and the write bridge in every provisioned guild |
   | Core 2a | mentat#434 (round 2) and Core#1088 | Core#1088 | Core#1088 | **High**: signature verification on every adapter route, plus a new credential |
   | Core 2b (stock route) | mentat#434 | the 2b Core issue (b) | same | **Medium**: a new route only |
   | mentat 2b (sync) | mentat#434 | mentat#434 | mentat#434 | **Medium** |

   - `/code-review ultra` is **not** the default (the 2026-09-29 correction). Because 2a changes the
     write bridge's signing and stores a credential, the operator may ask for `ultra` on the 2a
     PRs. That is an option, not a gate.
   - Versioning (R2 D58): mentat bumps `package.json` minor for 2a and minor for 2b, each with a
     CHANGELOG entry. Core entries go under "Unreleased on top of upstream"; Core's `VERSION` is
     upstream's.
   - mentat#433 (moderator-tier gap) already exists. The Layer 2 plan must reference it, and it
     must be verified on dune-dev with dune-dev's own bearer and its own per-guild actor secret
     (GRC-4, CLOUD-8).
3. **Requirement 29:** re-verify Core `origin/main` (this design cites `ace31877`, 2026-09-27)
   and mentat `main` when branches are cut and again before marking PRs ready. Re-run the §2
   citations that changed.

### 14.2 Requirement 19 gates a–g (applies only if Open Decision 7 chooses an upstream PR)

| Gate | Requirement | How satisfied / status |
|---|---|---|
| a | Full test suite green on the exact SHA | Core CI run on the PR head SHA, integration tests **executed** (§11.1 gate rule) |
| b | ≥1 full live server session | dune-dev UAT §11.4 over a full session. Achievable: dune-dev is single-operator but a live server. |
| c | Operator-facing changes documented, nothing superseded | §12 rows for Core; PR body labels implemented vs proposed |
| d | Eight Hats L1/L2/L3 complete, CRITICAL/HIGH resolved | This register (L1, rounds 1 and 2); L2 per repo; L3 `/code-review high` (2026-09-29 correction) |
| e | Cross-origin redirect E2E test | **N/A**: no redirect, OAuth or external auth in this feature |
| f | Changed-file list hand-reviewed for fork-internal artifacts | `gh pr diff --name-only`; strip fork `CHANGELOG.md` etc. from the upstream diff |
| g | Fixed PR-body structure | Executive summary; what/why and rejected alternatives (§3.3 options, v1's `apply:true`); fresh install / upgrade / break-fix behaviour, including "what if the actor secret is lost" (R2 D57): **mentat loses or cannot decrypt a guild's secret** → that guild refuses **every** signed call (link, verify, write bridge, stock), not only stock, by fail-closed design; recovery: Regenerate on Core, which runs the handshake.<br>**Core loses its active file** → the managed path fails closed (§3.5.3); recovery: "Enable signing".<br>**`ACP_KEK_FILE`, or every retained KEK version, is lost** → every provisioned guild degrades at once, and adapter tokens are unreadable too; recovery: re-register every guild. Backups plus KEK versions are one unit (§3.5.12).<br>No game data is lost in any of these cases.<br>Then: real test output; real security-scan output; eight-hat summary per round |

### 14.3 Branch lifecycle for a fork-only first release (GRC-7; R2 D26)
- **Fork-only is a fact, not only a preference.** The signing stack (`actorSignature.js`,
  `requireActorSignature`), `adapterSettings.js` and the hosted flow are not on `upstream/main`.
  `adapterSettings.js` and the hosted wizard exist upstream only inside the open PR #215.
- **OD 7 must be decided before the Core 2a PR opens.**
- If Open Decision 7 = fork-only (recommended), Requirement 21's **internal** lifecycle applies to
  Core: branch → PR to fork `main` → CI → **merge with a merge commit, not squash** (both repos
  allow squash, so the PR checklist names the button) → delete the branch.
- This is a **recorded, deliberate exception** to Requirement 21's "branch stays alive until the
  upstream merge". The branch is not an upstream candidate.
- Upstream prerequisites for any later Red-Blink PR: the actor-signing stack and #215 land upstream
  first.
- A later upstream PR is cut **fresh from `upstream/main`**, because #1086 makes the fork's `main`
  unsuitable as a base, and goes through gates a–g on its own.
- The v1 text keeping the branch "alive until Red-Blink merges or declines" is withdrawn for the
  fork-only path.

## 15. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Tier mismatch (F4) | High → Low | New `STOCK_SELF_READ` at Player tier; mentat#433 for the existing commands |
| R2 | Cross-player disclosure | High → Low | No target field (real-Postgres T3), signed actor + signed params, strict guild resolution, pawn-0 guard, ephemeral |
| R3 | Wrong totals trusted | Medium | Core allowlist population, case-insensitive match, oracle tests, seeded UAT, preview-then-button |
| R4 | Bridge-id spelling mismatch | Medium → Low | Case-insensitive match; U1 sweep gate; zero-over-saved needs explicit opt-in |
| R5 | Two guilds / two Cores overwrite each other | Medium → Low | Source line, last-source display, persisted `source_guild_id` |
| R6 | DB/pool degradation | Medium → Low | Semaphore, per-actor limiter, 2 s timeout, read-only, lock_timeout, EXPLAIN gate |
| R7 | Live decrease overwrites a manual number | Medium → Low | Decreases need a separate button; CAS; restore hint |
| R8 | Provenance lost | Low → resolved | v11 columns |
| R9 | Route classification in mentat tracks Red-Blink | Low | `UNMERGED_ROUTES` + updated tests |
| R10 | API-REFERENCE drift | Low → resolved | Fixed in the Core PR |
| R11 | Shared signing key across tenants | High → Low | Decided: per-guild secret (Phase 2a); the stock route never uses the process secret |
| R14 | Phase 2a regression breaks link/write signing for provisioned guilds | Medium | Golden vectors for NULL guilds (A-T8/A-T9); pending/promote/revert; dune-dev first (§3.5.5) |
| R16 | Core enforces a secret the bot does not hold (v2 design) | High → Low | Pending is never enforced; the mentat-driven handshake; revert; mentat ships first (§3.5.3, R2 D01) |
| R17 | Enabling signing demotes hosted guild owners | High → Low | Signature v2 signs `guildOwnerId` (§3.5.5, R2 D02) |
| R18 | Migration failure takes down every signed route | High → Low | Fail-closed migration and a PRAGMA assert (§3.5.2, R2 D05) |
| R19 | Rollback after hosted tenants are provisioned | Medium | Forward-only rule; `revert` window; runbook (§3.5.2, §13, R2 D17) |
| R15 | Schema-version collision with #384 (v9) | High → Low | v10/v11 numbering; A-T2/A-T2b; gate on mentat#438 (F8, R2 D16) |
| R12 | Historic unverified links become read credentials | Medium | §4.2a pre-enable review; Open Decision 6 |
| R13 | Command budget exhaustion | Medium → Low | Decided: `sync` takes 20 chars (7493/7500); everything after goes through the `/dune` split (mentat#423) |

## 16. Unverified (could not be established from git objects)
- **U1** Every bridge id's live spelling (UAT step 1).
- **U2** Whether permission/FGL fan-out occurs on real data. The design does not depend on it (§4.3.2).
- **U3** Other player-held storage. This is now partly resolved: item-owned and vehicle-module
  inventories exist and are excluded.
- **U4** `dune.items(inventory_id)` index and table size. Resolve at UAT step 0, **before Layer 2**.
- **U5** Committed refinery/fabricator inputs versus free stock.
- **U6** Game-to-Postgres persistence lag.
- **U8** Operator mapping of the Player role into Core's moderator list (tracked as mentat#433).
- **U9** What dune-dev currently runs.
- **U10** Any global limiter in front of the adapter (`server.js`).
- **U11** When `player_state.player_pawn_id` is NULL or 0 on a live server (for example while
  offline). The design is safe either way (§4.3.4).
- **U12** Two related checks, both done by presence and fingerprint only:
  - whether the process-wide `DUNE_DISCORD_ACTOR_SECRET` is configured on the bot VM, dune-dev and
    dune-prod today (it still matters for unprovisioned guilds and the rollback, §3.5.2);
  - whether `ACP_SECRETS_KEY(_FILE)` / `ACP_KEK_FILE` is configured on the bot VM. Open Decision 9
    makes that a precondition for storing any per-guild signing secret.
  - **Round 2 (R2 D04):** whether the process secret is 64-hex, and whether dune-dev's and
    dune-prod's Core values are equal. That equality is an **inference** from
    `src/actorSignature.js:66`–`:69`, which confirms only "production", and is **not verified**.
    The v3 guard does not depend on it: a value equal to the process secret is refused
    mechanically.
- **U13** Whether the operator's own Discord guilds are registered, **active** `guilds` rows, or
  rely on the global adapter fallback. **This is now a hard A0 gate (§13):** the strict resolver
  (§3.1) stops the fallback for guild-scoped paths.
- **U14 — closed (R2 D52).** Core's `normalizeDiscordActor` (`policy.js:159`–`:168`) requires
  `guildId`, `channelId`, `userId` and `username`, and treats `interactionId` as optional.
  `interactionId` is signed (`SIGNED_ACTOR_FIELDS`, `actorSignature.js:49`). The synthetic check
  actor includes `username` (§3.5.3).
- **U15** The adapter base URL the bot's process config targets (bot VM `.env`), which drives the
  one-signer-per-Core guard and OD 14. Presumed dune-prod; not verified.
- **U16** Whether `/dune player default` governs Core's `getLinkedPlayer`. Core deliberately ignores
  per-guild character state (`duneDb.js:16597`–`:16600`). Verified in Layer 2 so that the §3.1 copy
  names the right selection (R2 D43).
- **U17** Which backup method the production mentat backup job uses (`.backup` versus a file copy)
  (§3.5.12).

(v1's U7, async handler compatibility, is closed: goal handlers already run inside the async
`executeDuneCommand` try block after `deferReply`.)

## 17. Follow-Up / Deferred Work (each gets an issue, §14.1)
- **Retire the process-wide actor secret** for multi-tenant mode once every registered guild is
  provisioned (§3.5.5).
- ~~**Dual-secret rotation grace on Core**~~ — superseded: the pending/promote handshake has no
  rotation window (OD 8 closed).
- **"Edit my existing guild" setup path** (no issue exists yet; v2 miscited mentat#312, which is
  stats-sharing revocation and depends on this entry point). Phase 2a builds only the secret-only
  update path (§3.5.11, mentat#447).
- **Move the bot's default-config paths onto the guild resolver** (`scheduler.js`,
  `notifications.js`), so the operator's default Core can take a per-guild secret (OD 14).
- **Mentat-side owner-authenticated status page**, if OD 12 defers it.
- **Mechanical cloned-Core detection** (R2 D62). For example, Core stores a host-identity hash
  beside the secret and refuses or regenerates on a mismatch at startup. Runbook step only for now.
- **Sync all active goals in one call.** Deferred because it needs a multi-goal preview embed and
  batching past 16 ids, and 5 goals × 15 s is tolerable for v1 (UX-9).
- **Baseline ("gained since creation") semantics** (ARCH-5). Needs a stored per-goal baseline.
- **Honor per-guild character disable state** (`discord_account_link_guild_state`) for stock reads,
  as its own cross-route change (SEC-2d).
- **Choose which linked character to read** (multi-character accounts).
- **Owned `searchItemsInContainers` lacks the `is_hologram` filter** (`duneDb.js:17146`). Small
  separate fix.
- **Optional `dune.items(inventory_id)` index**, only if the U4/EXPLAIN evidence requires it.
  Separate Requirement 26 issue with `DROP INDEX CONCURRENTLY` rollback. Core's
  `ensureItemAuditLogIndexes` (`duneDb.js:3120`–`:3160`, #936) is precedent for automatic
  `create index concurrently` with operator sign-off. This design deliberately stays stricter:
  no automatic index (DBA-13).
- **Guild scope (Option 2).** Chosen 2026-10-01 as phase 2c (orders, `order:sync`): own design, own migration, Core change first. Not part of 2a/2b.
- **Catalog drift-check CI** (Phase 3 Gap 1). More valuable now that catalog ids are query keys.
- **Signed-body coverage for other read routes**, as done here with `params` (SEC-8 generalization).

## 18. Open Decisions for the Operator

1. **Actor signing in multi-tenant mode** — **DECIDED 2026-09-29: option A, a per-guild
   encrypted signing secret** (not the recommended option C). It is specified as Phase 2a (§3.5)
   and ships before the sync command.
2. **Player-tier capability.**
   - **Question:** grant new `STOCK_SELF_READ` to `observer`+, or reuse `INVENTORY_READ`
     (moderator+)?
   - **Recommendation:** new capability. Reusing `INVENTORY_READ` makes the feature unusable for
     Players, or widens other reads if roles are remapped.
3. **What counts as "bases".**
   - **Question:** Storage + Crafting always count, and Other/generators never count (both
     recommended). Should Refining count?
   - **Tradeoff:** including Refining reads input slots that may already be committed to a
     running job; excluding it hides ore a player parked in a refinery.
   - **Recommendation:** include Refining, rank 1 only, and revisit if players report
     overstatement.
4. **Decreases.**
   - **Options:** (a) a separate "Apply incl. decreases" button (recommended); (b) never apply a
     decrease from live data, so a decrease is always typed manually.
   - **Tradeoff:** (a) is convenient but can still overwrite a correct number the query can't
     see. (b) is safest but leaves stale high numbers for players who really spent stock.
5. **Command budget (UX-1)** — **DECIDED 2026-09-29: take the 20-char `sync` cost now.** The
   budget goes from 7473 to 7493 of the 7500 target, with no re-baseline. Every later subcommand
   goes through the `/dune` split (mentat#423; a separate design is being drafted). The budget
   test stays at ≤ 7500.
6. **Links from the disabled Steam path** (§4.2a).
   - **Question:** if the pre-enable review finds `discord_account_links` rows that cannot be
     shown to be whisper-verified, what happens to them?
   - **Options:** (a) ask those users to re-verify before their stock can be read; (b) exclude
     multi-account links from stock reads until Steam linking is rebuilt; (c) accept the risk.
   - **Recommendation:** run the review first. If rows exist, choose (a). (b) blocks all
     multi-account users.
7. **Upstream.**
   - **Question:** fork-only first, or plan a Red-Blink PR?
   - **Recommendation:** fork-only first, under the internal branch lifecycle (§14.3). Any
     upstream PR later starts from `upstream/main` (Core #1086) and passes gates a–g.
8. **Rotation grace (Phase 2a, §3.5.4)** — **CLOSED, superseded by the v3 handshake.** A new
   secret is pending (never enforced) until mentat verifies and promotes it. The old secret keeps
   working until promote, so there is no outage window to grace, and `.prev` is never verified
   against (R2 D01, D22).
9. **Require at-rest encryption before storing a per-guild signing secret (Phase 2a, §3.5.7).**
   - **Options:** (a) refuse to store the secret unless `ACP_SECRETS_KEY(_FILE)`/`ACP_KEK_FILE` is
     configured; (b) store it in plaintext with a warning, as adapter tokens are today.
   - **Tradeoff:** (a) blocks Phase 2a on a bot host without a key. (b) leaves an HMAC key that
     gates cross-player reads readable in the SQLite file and its backups.
   - **Recommendation:** (a). Verify the bot VM's key configuration first (U12).

**New in v3 (Layer 1 round 2).** Each has a safe default already specified, so none blocks the
design. The operator may change any of them.

10. **Bearer and signing secret in one registration body (R2 D31).**
    - **Question:** accept that one leak of the hosted registration body (proxy log, error body,
      HAR) yields both the bearer and the signing secret?
    - **Options:** (a) accept, with mitigations: no body logging on mentat-link (checked at its
      Layer 2), value redaction, allowlisted status shapes; (b) deliver the secret separately,
      which needs a new pull credential from mentat to Core.
    - **Recommendation:** (a). The co-delivery path is already the bearer's path, and (b) adds a
      credential and a new flow.
11. **Read-only DB role for the stock query (R2 D32).**
    - **Question:** should Core support a dedicated read-only role for `playerStockTotals`?
    - **Options:** (a) optional `DUNE_DB_RO_USER` with `GRANT SELECT` on the tables used, falling
      back to the preamble; (b) the preamble plus T9 only, recorded as a GRC exception.
    - **Recommendation:** (a), optional. It gives least privilege for operators who want it and
      breaks no one.
12. **Mentat-side owner status page (R2 D07).**
    - **Question:** build an owner-authenticated signing status page in mentat now, or rely on
      Core's Discord settings for 2a?
    - **Recommendation:** rely on Core settings for 2a (§3.5.11) and defer the mentat page (§17).
      Core shows its own authoritative state. A mentat page is new ingress needing OAuth, rate
      limits and a Requirement 23 row.
13. **Who players are told to ask (R2 D09).**
    - **Question:** which role name should player-facing error copy use?
    - **Options:** (a) "the person who connected this server to Mentat"; (b) "a server admin"; (c)
      "the bot operator".
    - **Recommendation:** (a). (b) is ambiguous between the Discord Admin role and the game-server
      operator, and (c) in hosted mode names the maintainer, whom a tenant player cannot reach.
      This is user-visible copy, so it is not decided silently.
14. **The Core the bot's default config targets (R2 D14).**
    - **Question:** Core holds one active secret. mentat's no-guild system paths (`scheduler.js`,
      `notifications.js`) sign with the process secret toward the process-config Core, presumed
      dune-prod (U15). Provisioning that Core's guild per guild would break those paths.
    - **Options:** (a) mentat refuses per-guild provisioning for that Core until the default-config
      paths move onto the guild resolver (follow-up, §17); (b) move them now as part of 2a.
    - **Recommendation:** (a). The guard is mechanical and safe. dune-dev provisions first anyway,
      and dune-prod's stock waits for the follow-up.
