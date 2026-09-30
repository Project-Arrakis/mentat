# Live Stock Integration, Personal Scope — Design (Phase 2), v2

**Status:** design v2, revised after the Requirement 20 **Layer 1** (eight-hat design)
audit. It is not implemented. It contains no code except illustrative query and
data shapes, which are clearly marked.

**Audit status:** Layer 1 ran on v1 (commit `a0e0d3b`). It found 0 Critical, 17
High, 43 Medium, 27 Low and 1 Info. Every finding and its disposition is in
`docs/superpowers/specs/2026-09-30-live-stock-personal-layer1-audit-register.md`,
which also holds the Layer 1 STRIDE table. Every High is resolved in this document.
One High (ARCH-1, together with CLOUD-2/CLOUD-3/SEC-3) is resolved *conditionally*:
the design below holds under every option, but which tenants can use the feature
depends on **Open Decision 1** (§18). Implementation must not start until the
operator has decided §18.1 and §18.5.

**Evidence base:** Core claims are cited as `path:line` on the fork's `origin/main`
(`ace31877`, 2026-09-27). Core was read only through `git show`/`git grep` against
git objects, never its working tree. mentat claims cite this worktree
(`docs/phase2-live-stock-design`, based on `f8709f0`) unless another branch is named.
Anything that could not be verified that way is listed under §16 (Unverified).

**Spec context:** Phase 2 of `docs/crafting-resource-planning-overview.md`. Phase 1
(`/dune data calculator`) and Phase 3 (`/dune goal`,
`docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md`, PR #430) are
shipped. Phase 2 lets a player **choose** to fill a **personal** goal's on-hand numbers
from the game database instead of typing them.

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
| Provenance | Not stored | Additive, nullable `source`, `source_guild_id`, `source_ref` on `goal_audit_log` (schema v9, Requirement 26) (GRC-1, DBA-12). |
| Load | 5 s timeout, mentat cooldown only | Core concurrency cap (503) + per-actor limiter (429) + 2 s timeout. mentat per-command 15 s cooldown (§6.7) (NET-3, DBA-4, SEC-4). |
| Tenancy | Global env kill switch, silent adapter fallback | Per-guild allowlist. Sync requires an active registered guild and never uses the fallback. Invariant: 1 guild = 1 Core (NET-1/2, ARCH-7). |
| Signing | Required, one global secret | Required. The multi-tenant key model is Open Decision 1 (ARCH-1). `itemIds` is inside the signed payload (SEC-8). |
| Command budget | Unaccounted | Measured at 7473/7500. The design costs 20 chars and is sequenced by Open Decision 5 (UX-1). |

## 1. Goal and Non-Goals

**Goal.** A player has linked their Discord account to their in-game character. For one
of their own **active personal** goals, they can ask mentat to read their current stock
of that goal's syncable items from their Discord server's game server. mentat shows them
exactly what would change. If they confirm, it saves those numbers as the goal's on-hand
values. The manual `/dune goal on-hand` path is unchanged and always available.

**Non-goals (explicit).**
- **Guild scope is OUT.** Guild goals and orders stay manual (Option 1). A real guild-base
  designation in Core (Option 2) stays deferred. mentat refuses to sync a guild goal `[D1]`.
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
- `goalTransaction(db, fn) = db.transaction(fn).immediate()` exists only on branch
  `fix/goal-followups-425-429` (`src/commands.js:1314`). That branch is PR **#435**, which fixes
  issue **#428**; both are open. It is not on `main`.
- The goal audit table has columns `id, goal_id, action, actor_id, node, previous_quantity,
  new_quantity, created_at` and no provenance column (`database.js:189`–`:199`).
  `appendGoalAuditLog` inserts an explicit column list (`database.js:1367`–`:1372`). The bundled
  SQLite is 3.53.2, so `ALTER TABLE ... DROP COLUMN` is available.

## 3. Tenant, Instance and Credential Model

### 3.1 `[D16]` One guild = one Core; strict resolution; no fallback
- **Invariant:** a Discord guild reads live stock from exactly one Core, the `console_url` of its
  own **active** `guilds` row. A guild that runs several battlegroups or instances (Instance 1/2/3
  in `multi-server-config.py`, or prod and dev both attached to one Discord) is **unsupported in
  v1**. It gets whichever single Core it registered, and the docs say so.
- **Strict resolution (NET-1):** sync uses a new `adapterClient.resolveGuildConfigStrict(guildId)`.
  It returns the guild's own active registration or throws `live_stock_guild_unregistered`, and
  it **never** falls back to `this.config`. `playerStock()` calls only this resolver. The
  fallback in `_resolveConfig` is unchanged for every other command.
  - Test: an inactive, unregistered or suspended guild makes **zero** adapter calls and shows the
    §6.5 message.
- **Source label (NET-5, UX-6):** every preview and apply embed shows `Read from: <guild_name> ·
  <console host>`. Both values come from mentat's own `guilds` row (`guild_name`, and the host
  part of `console_url`), never from Core, because Core returns counts only.
  - The character read is the **default linked character**. Its name is not returned by the
    stock route (`[D7]`). The embed says "your default linked character" and does not show a name.
    Showing the name would need an extra `players/me` call, which needs `INVENTORY_READ`
    (moderator+), so that is out of scope.
- **Persisted source:** the guild id and interaction id go into the audit rows (§7). A later
  dispute can then identify which server produced a number (NET-5, GRC-1).
- **Global goals versus per-guild stock:** personal goals are global across Discord servers
  (Phase 3). The preview always shows the saved value, who set it, when, and **from where** (the
  last audit row's `source_guild_id`). A player who syncs one goal from two guilds therefore sees
  "last synced from Server A" before overwriting it from Server B (FM10, UX-6).

### 3.2 `[D19]` Rollout control: per-guild allowlist, restart to change
- The kill switch is `MENTAT_LIVE_STOCK_GUILD_IDS`, a comma-separated list of Discord guild ids
  (snowflake-validated). **Empty or unset means off everywhere** (ARCH-7, CLOUD-4, QA-6). It
  replaces v1's process-wide `MENTAT_LIVE_STOCK_ENABLED`.
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

### 3.3 `[D18]` Actor signing in multi-tenant mode — **Open Decision 1**
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
| A | **Per-guild actor secret column**. `guilds.actor_signing_secret`: nullable, KEK/DEK-encrypted like `adapter_token`/`stats_push_secret`, entered by the tenant in the setup portal. `signedHeaders(actor, route, { secret })` takes the per-guild secret. NULL means that guild is unsigned. | Best. Per-tenant key, per-tenant rotation and revocation (Requirement 27). No shared key. It also fixes the **same pre-existing gap in the write bridge**. | Schema v10 + migration (Requirement 26), setup-portal UI, encryption, a rotation runbook, a signing-API change touching the write bridge. It is its own design. | Any tenant who configures a secret. |
| B | **HKDF-derived per-guild key** `K_g = HKDF(master, info="mentat-actor-sig:v1:"+guildId)`. The operator hands `K_g` to tenant g. | Master compromise exposes all tenants. Rotation is all-at-once unless a stored version is added. **Two guilds sharing one Core break**, because Core holds one secret. | No schema change, but a delivery channel for `K_g` is still needed. | Tenants who were handed their `K_g`. |
| C | **Restrict v1 to guilds whose Core already shares the bot's secret**, i.e. the operator's own Cores (dune-dev, dune-prod). This is enforced by the §3.2 allowlist. The global secret is never given to a third-party tenant. | No new key sharing. Same posture as today's write bridge. | None beyond §3.2. | Operator-run guilds only. |
| D | **Signature optional**, like every sibling read route: verified if the Core has a secret, accepted unsigned otherwise. | On an unsigned Core, a leaked bearer can read any linked user's stock counts. That is strictly less than PLAYERS_FIND already discloses there, but it is a new Player-data read. | None. | Every tenant. |

**Recommendation: C for v1, and file A as a separate design issue.** A should be scoped to fix
the write bridge too, before any hosted tenant is added to the allowlist. B is dominated by A:
it still needs a delivery channel, and it breaks shared Cores. D is rejected because it gives up
the one defence against a leaked bearer on exactly the route that makes a Discord link a
data-read credential (SEC-2).

The design below is written so that A drops in later. `playerStock()` takes its signing secret
from a `signingSecretForGuild(guildId)` function:
- under C it returns the process secret for allowlisted guilds, and throws otherwise;
- under A it would return the guild's decrypted column.

### 3.4 Secret lifecycle (CLOUD-1, CLOUD-2, CLOUD-8, GRC-8)
- **No new credential is created by this design** under Option C. It reuses
  `DUNE_DISCORD_ACTOR_SECRET` and the per-guild bearer. Requirement 27 therefore applies to
  existing credentials only.
- **Provisioning:** the secret is supplied through `DUNE_DISCORD_ACTOR_SECRET_FILE` (mode 0600)
  and is **byte-identical on the bot VM and on each allowlisted Core**.
- **Rotation order:**
  1. Write the new value to both files.
  2. Restart Core.
  3. Restart the bot (Requirement 7 confirmation for both).
  4. Expect **every signed route** (link, write bridge, stock) to return 403
     `invalid_actor_signature` between steps 2 and 3.

  The rotation runbook is part of the C8 documentation delta (§12). If the Core repo has no
  existing runbook, one is written there.
- **Fail-closed in mentat (CLOUD-1):**
  - `playerStock()` refuses to send a request when `signingSecretForGuild()` returns an empty
    value. It never sends an unsigned stock request.
  - At startup, if `MENTAT_LIVE_STOCK_GUILD_IDS` is non-empty and no secret is readable, mentat
    logs one non-secret warning (`live_stock.signing_secret_missing`) and treats the feature as
    disabled.
  - Test: an empty secret never produces a request.
- **Distinct secrets per environment (CLOUD-8):** dune-dev must use its own bearer and actor
  secret, not prod's. This is a UAT prerequisite recorded in the tracking issue (§11.4).
- **Unverified:** whether the bot VM, dune-dev and dune-prod currently have the secret configured
  and byte-identical (U12). This must be checked, by presence only and without printing the value,
  before §3.2 enables any guild.

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
| C5 | `.../routes.js` | Handler (§4.7): `readJsonWithActorSignature(req, { requireActorSignature: true, fields: STOCK_SIGNED_ACTOR_FIELDS })`, capability check, per-actor limiter, `requireLinkedPlayer`, in-flight cap, provider, and `audit()` on **every** outcome, including denials. |
| C6 | `.../actorSignature.js` | `export const STOCK_SIGNED_ACTOR_FIELDS = [...SIGNED_ACTOR_FIELDS, "params"]`. `itemIds` travels as `body.params.itemIds` and is signed, so an envelope cannot be replayed with different ids (SEC-8). mentat mirrors this list exactly (M3); the contract test in §11.3 covers the pairing. |
| C7 | `.../commandCatalog.js` | A `COMMAND_METADATA` entry with **`group: "goal", subcommand: "live-stock"`**. These names do not collide with any `player:*` subcommand. `params: []`, with the internal-aggregate comment (precedent `GUILD_FACTION_SUMMARY`, `:566`–`:577`). The expected mentat `/dune admin sync-commands` drift line is `added goal:live-stock (internal, no Discord surface)`, recorded in the PR body (ARCH-9). |
| C8 | docs | See §12. This includes fixing the `API-REFERENCE.md:1018`–`:1022` GET→POST drift **in the same PR**. It is not optional and not "or file it" (GRC-3). |
| C9 | tests + fixture | §11.1. This includes the canonical `console/api/test/fixtures/players-stock.json`. |

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
    since-disabled Steam path (`routes.js:544`–`:551`). Record the count and method in the
    tracking issue. What to do if any are found is **Open Decision 6**.
  - (b) The Layer 2 audit must confirm that every link-creation path still enabled is proof of
    control.
  - (c) Per-guild character disable state (`discord_account_link_guild_state`) is **not**
    consulted. This matches every sibling route (`duneDb.js:16597`–`:16600`) and is deferred with
    a follow-up issue (§17). Under Option C only operator-run guilds are enabled.

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

1. **Per-actor limiter:** after the capability check, `createLoginRateLimiter`-shaped, keyed on
   `actor.userId`. Default 6 requests per 60 s (`DUNE_STOCK_RATE_PER_MIN`, bounds 1–30).
   Overflow returns **429 `rate_limited`**.
2. **In-flight cap:** an in-process semaphore, `DUNE_STOCK_MAX_INFLIGHT`, default **1**, bounds
   1–3. It is acquired **before** `pool.connect()`, so an overflow request never holds a pool
   client. Overflow returns **503 `stock_busy`** immediately (no queueing).
3. **Transaction preamble:** a dedicated transaction whose first statements are
   `set transaction read only`,
   `select set_config('statement_timeout', $1, true)` with `DUNE_STOCK_QUERY_TIMEOUT_MS`
   (default **2000**, bounds 250–2500), and `select set_config('lock_timeout', '500ms', true)`.
   Mechanically this is `runOpsProvider` with the extra preamble.
4. **Worst-case budget:** 3 s pool wait + 2.5 s statement = 5.5 s, below mentat's 8 s adapter
   timeout (`config.js:259`). An aborted mentat request therefore leaves at most one Core query
   running, for at most 2.5 s.
5. **Retries:** mentat makes **one attempt per invocation** and never retries automatically
   (NET-4).

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
| `guildId` | from the actor |
| `interactionId` | signed; the correlation id mentat also stores (§7) |
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
(`actor_signing_disabled`). Who can satisfy that in multi-tenant mode is §3.3 (Open Decision 1).
The route is new, so this cannot regress any current operator.

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
| M2 | `src/adapterClient.js` | `resolveGuildConfigStrict(guildId)` (§3.1). `playerStock(actor, itemIds, guildId)`: strict config; body `{ actor, params: { itemIds } }`; signs with `STOCK_SIGNED_ACTOR_FIELDS` via `signingSecretForGuild`; refuses to send unsigned (§3.4). Add `"players-stock"` to `UNMERGED_ROUTES` (fork-only; classification is informational). Update `test/adapterClient.test.js:277`/`:301`, `test/adapterContract.test.js:112`, and the `UPSTREAM_CONTRACT` table (QA-2). |
| M3 | `src/actorSignature.js` | `STOCK_SIGNED_ACTOR_FIELDS`, identical to Core's C6. A `signedHeaders(actor, route, { secret, fields })` variant that throws on an empty secret instead of returning `{}`. Existing callers are unchanged. |
| M4 | `src/commands.js` | Subcommand `/dune goal sync id:<int, autocomplete>`. **Preview only; there is no `apply` option** (§6.3). An `async executeGoalSync` is awaited in the existing async dispatch (`commands.js:567`–`:576`; this closes v1's U7). `actorFromInteraction` gains `interactionId: interaction.id` for this call. Personal-only autocomplete branch for `goal:sync` (ARCH-11). A `FORCE_EPHEMERAL_COMMANDS = new Set(["goal:sync"])` combined into the `deferReply` expression before `forcedPublic` (§6.8). Registered in `getCommandRegistry()` and `helpPayload()`. |
| M5 | `src/commands.js` | Extract `goalValidNodes(goal)` from `executeGoalOnHand` (`:1416`–`:1436`), plus `syncNodes(goal)` (§5.3). Refactor only; existing on-hand behaviour is unchanged. |
| M6 | `src/goalSyncConfirmation.js` (new) | Pending-preview store modelled on `writeConfirmation.js`: nonce → `{ userId, goalId, guildId, planned node values, snapshot of (quantity, updated_at) per node, expiresAt }`. TTL 120 s, in-memory, per process. Button handler for `Apply` and `Apply incl. decreases`. |
| M7 | `src/cooldown.js` | Per-command duration override: `COMMAND_COOLDOWN_MS = { "goal:sync": 15000 }`. The admin shortcut does **not** apply to that key. `goal:sync` is excluded from the generic end-of-dispatch `applyCooldown` (`commands.js:996`); the handler applies it only after a Core request was actually sent (§6.7). |
| M8 | `src/embedFormat.js` | `formatGoalSyncPreviewEmbed` / `formatGoalSyncAppliedEmbed`, using `duneEmbed` named colors (pitfall at `embedFormat.js:1822`). Copy in §6.6. |
| M9 | `src/database.js` | Schema **v9**: additive nullable provenance columns on `goal_audit_log` (§7). `appendGoalAuditLog` accepts `{ source, sourceGuildId, sourceRef }`; typed on-hand writes pass `source: "manual"`. |
| M10 | `src/liveStockErrors.js` (new) | `liveStockErrorMessage(error)` keyed on Core `body.error`, with separate player-facing and log-only text (§6.5). |
| M11 | docs | See §12. |

**Dependency:** M4/M6 use `goalTransaction`, which is on PR **#435** (fixes **#428**) and not yet on
`main`. Implementation starts after #435 merges, or brings `goalTransaction` in unchanged (DBA-7).

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
4. The preview carries up to two buttons, owner-only and expiring after 120 s:
   - **Apply** writes the planned increases and new entries.
   - **Apply incl. decreases**, shown only when the plan contains decreases, writes those too.

   **Neither button reads Core again.** Apply writes exactly the previewed numbers (ARCH-3 option b).
5. On click, the handler does the following:
   - It refuses a non-owner click, and refuses an expired or unknown nonce with "Preview expired —
     run `/dune goal sync` again". A bot restart also expires every preview.
   - It then opens **one** `goalTransaction` (IMMEDIATE, §6.4 step 3) and writes.
6. The nonce is deleted on first use, so double clicks are idempotent.

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
| Backpack unavailable, `B` > `s` | `≥ B` (partial) | write `B` (a true lower bound) | write `B` |
| Backpack unavailable, `B` ≤ `s` | "backpack unavailable; not changed" | skip | **skip, never** |
| `L` = `s` | "unchanged" | skip, no write, no audit | same |
| no entry, `L` = 0 | "none found" | skip, no zero row (keeps the 6-entry cap free) | same |
| no entry, `L` > 0 | "new" | write `L` (cap check; if the cap is full, skip and say so) | same |
| `L` > `s` | "+Δ" | write `L` | write `L` |
| 0 < `L` < `s` | "DECREASE −Δ" | skip | write `L` |
| `L` = 0 < `s` | "**NONE FOUND — was s**" plus a warning that stock may be in places not counted | skip | write 0 |
| `L` > 100,000 | "100,000 (capped)" | write 100,000 | write 100,000 |

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
7. If nothing changed after skips, the reply is "Already up to date — nothing saved", with no audit
   rows (UX-5).

The applied embed prints, per written node, "Previous: N (set by <@user> at time)" and a
copy-pasteable restore hint using the real goal id and the node's display name (UX-13).

### 6.5 `[D14]` Degradation and error mapping (ARCH-10, CLOUD-1, UX-7, NET-4, NET-7, QA-9)
Nothing is ever written on any row below. The player sees the short text. Operator detail goes
to logs only, with the route key and error code and without the body excerpt. The v1 1,200-char
adapter excerpt is **not** shown for this command.

| Condition | Player sees |
|---|---|
| `db` null | existing guard message |
| DM (no guild) | "Run this in a server: live stock is read from that server's game server." |
| Guild not on the allowlist | "Live stock isn't enabled for this server yet." + manual hint |
| Guild not registered or inactive (strict resolver) | "This server isn't connected to a game server." + manual hint |
| No syncable node | "Nothing in this goal can be read live. Use `/dune goal on-hand`." |
| Signing secret missing in mentat | "Live stock isn't available right now. Ask the bot operator." (log: `live_stock.signing_secret_missing`) |
| 403 `not_linked` | "Link your character first: `/dune player link`." + manual hint |
| 403 `not_authorized` | "Your role can't use live stock. Ask a server admin." |
| 403 `actor_signing_disabled` | "Live stock isn't set up on this game server yet. Ask a server admin." (log: "operator: configure DUNE_DISCORD_ACTOR_SECRET on both sides") |
| 403 `missing_/invalid_actor_signature` | "Live stock is misconfigured. Ask the bot operator." (log: "secret mismatch") |
| 403 `stale_actor_signature` | "Please try again in a moment." (log: "clock skew") |
| 404 JSON `adapter_disabled` | "The game server's bot integration is off." |
| 404 JSON other code (route absent, older Core) | "This game server doesn't support live stock yet." |
| 404 non-JSON, or 5xx non-JSON (proxy or tunnel) | "Couldn't reach the game server — nothing was changed. Try again later." (log: "non-JSON; check console_url") |
| 429 `rate_limited` / 503 `stock_busy` | "The game server is busy. Try again in a minute." |
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

### 6.7 `[D15]` Cooldown (ARCH-4, SEC-4, QA-14, UX-9, UX-10)
- `goal:sync` has a **15 s** per-user cooldown (M7). There is no admin shortcut.
- It is applied **only after a Core request was sent**. Local refusals cost nothing, so a
  misconfigured or unlinked user is not locked out.
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

**Schema v8 → v9 (`src/database.js`):**
```sql
ALTER TABLE goal_audit_log ADD COLUMN source TEXT;          -- 'manual' | 'live_sync'; NULL = row written before v9
ALTER TABLE goal_audit_log ADD COLUMN source_guild_id TEXT; -- guild whose Core was read (live_sync only)
ALTER TABLE goal_audit_log ADD COLUMN source_ref TEXT;      -- Discord interaction id (correlates with Core's audit line)
```
- **Mechanism:** a guarded `if (currentVersion.version < 9)` block that runs each `ALTER` in a
  try/catch. This follows the v5→v6 `stats_push_secret` pattern (`database.js:285`–`:297`). The
  fresh-install `CREATE TABLE` gains the same three columns. Bump `SCHEMA_VERSION` to 9.
- **No CHECK** is added on `source`. Values are validated in `appendGoalAuditLog`, which avoids
  any future rebuild. `action` stays `on_hand_update` for sync writes.
- **Backward compatible:** v8 code inserts an explicit column list (`database.js:1369`) and keeps
  working against a v9 table. Old rows read `NULL`, rendered as "unknown (before v9)".
- **Rollback SQL:** `ALTER TABLE goal_audit_log DROP COLUMN source_ref; ... DROP COLUMN
  source_guild_id; ... DROP COLUMN source;` (SQLite 3.53.2 bundled, F8), then
  `UPDATE schema_version SET version = 8`. Alternatively, leave the columns: v8 code ignores them.
- **Tests (§11.2 M-T18):**
  - a v8 database with existing goal and audit rows upgrades to v9 with all rows intact and NULL
    source;
  - `appendGoalAuditLog` writes and reads all three values;
  - v8's insert statement succeeds against v9;
  - the rollback SQL yields a v8-compatible table;
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
    This is unchanged from Phase 3 and now stated explicitly.
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
| FM18 | Signing secret mismatch or rotation window | 403 codes | Refused with the correct diagnosis | §3.4, §6.5 |

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
| T2 | `players/stock: rejects unsigned (actor_signing_disabled without secret; missing_actor_signature with secret)` and `players/stock: itemIds outside the signature → invalid_actor_signature` | route |
| T3 | **`players/stock integration: two linked players, same item, each reads only their own totals even when naming the other in the body`**. A = 100 (backpack 30 + base 70), B = 7000. A with body `{playerControllerId: B, actorId: B, discordUserId: B}` gets 100; B gets 7000. | **real Postgres** |
| T4 | `players/stock integration: base population`. Counted: storage container, refinery (capped inventory), fabricator, two owned bases summed. Not counted: generator (`Oil` 499), recycler, repair station, totem, hologram placeable, rank-2 base, the `max_item_count = -1` inventory, worn-gear inventory (type 1), item-owned inventory (`actor_id` null). Two type-0 inventories on one pawn are both summed. | real Postgres |
| T5 | `players/stock integration: fan-out fixture counts once and equals the naive oracle`. One placeable with 2 `actor_fgl_entities` and 2 `permission_actor_rank` rows (ranks 1 and 2), stack 100 → 100. The expectation is recomputed by a deliberately naive per-inventory SQL (sum per `inventory_id` from `dune.inventories` directly) and must match. | real Postgres |
| T6 | `players/stock integration: case-insensitive exact match` (`oil` row matches `Oil`; reply spelled `Oil`; `Silicone` does not match `SiliconeX`) | real Postgres |
| T7 | `players/stock integration: zero-fill and null handling` (only in bases → `inBackpack` 0, not null; only backpack; absent id → zeros) | real Postgres |
| T8 | `players/stock integration: pawn id '0' → unavailable backpack, and an actor_id=0 type-0 inventory holding the item is never counted` | real Postgres |
| T9 | `players/stock integration: runs read-only with lock_timeout` (a write attempted inside the provider transaction fails) | real Postgres |
| T10 | `players/stock: input validation` (0 ids, 17 ids, non-array, non-string, `%`/space/quote/`;`, 65 chars, leading digit, case-insensitive duplicates de-duped, `__proto__`/`constructor`/`prototype` in any case → 400; afterwards `({}).total === undefined` and `Object.prototype` is unchanged) | route |
| T11 | `players/stock: provider converts numeric strings; an unsafe integer gives stock_query_failed` | unit |
| T12 | `players/stock: second concurrent call → 503 stock_busy without acquiring a pool client`; `7th call in 60 s → 429 rate_limited` | route, fake db that hangs |
| T13 | `players/stock SQL guard: query text contains "= any(" and "lower(", is one statement, and contains no "ilike"` (runs without Postgres) | unit |
| T14 | `players/stock: DB error → 503 stock_query_failed; body has no SQL text` | route |
| T15 | `players/stock: audit line on success and on each denial code has playerControllerId/outcome/interactionId and no item ids, totals, signature or token` | route |
| T16 | `players/stock contract: real handler output for the seeded fixture deep-equals test/fixtures/players-stock.json; fixture sha256 equals the pinned constant` | real Postgres |
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
| M-T10 | `goal sync: decision table`, one test per §6.4 row, both buttons (QA-10) |
| M-T11 | `goal sync preview writes nothing`: `goal_on_hand_entries`, `goal_audit_log` and the goal row are byte-identical before and after; spies on `setGoalOnHandEntry`/`appendGoalAuditLog`/`completeGoal` show 0 calls (QA-5) |
| M-T12 | `goal sync apply`: writes exactly the previewed values even when the mock adapter would now return different ones (adapter call count on apply = 0); expired nonce refused; another user's click refused; double click writes once |
| M-T13 | `goal sync apply`: CAS skip when `updated_at` changed; goal deleted or archived between preview and apply → nothing written; forced throw on the 3rd node → no entry or audit change (DBA-7, DBA-8, SEC-9) |
| M-T14 | `goal sync: deferReply called with ephemeral:true when defaultEphemeral=false` (SEC-7) |
| M-T15 | `cooldown: goal:sync is 15 s via mock.timers (blocked at 14.9 s, allowed at 15.1 s), no admin shortcut, not applied after a local refusal, not applied to Apply buttons`; unique `userId` per test + `resetCooldowns` (QA-14) |
| M-T16 | `goal sync: error mapping`, table-driven over every §6.5 row: player text + zero writes (includes `200 ok:false`, `200` non-JSON, `stale_actor_signature`, `adapter_disabled`, non-JSON 404) (ARCH-10, QA-9) |
| M-T17 | `goal sync: logs contain no item ids, counts, roleIds, body or auth/signature headers` (CLOUD-6) |
| M-T18 | `schema v8→v9 migration`: see §7 |
| M-T19 | `goal audit provenance: sync rows have source=live_sync + source_guild_id + source_ref; typed on-hand rows have source=manual` |
| M-T20 | `contract: test/fixtures/adapter/players-stock.json is byte-identical to Core's (sha256 constant) and parses through the real validator` (QA-2) |
| M-T21 | `goal journey (sync): create → sync preview → Apply → progress → on-hand override → sync (decrease shown, Apply skips it) → Apply incl. decreases → delete` with AzuriteOre, plus a craftable recipe containing water (QA-13; extends `test/commands.test.js:1186`) |
| M-T22 | `command budget stays ≤ 7500` (the existing test, not re-baselined); `getCommandRegistry()`/`helpPayload()` include `goal sync`; `goal:sync` autocomplete returns no guild goals for admins (UX-1, ARCH-11) |
| M-T23 | `goalValidNodes refactor: existing on-hand tests unchanged and green` |

### 11.3 One canonical contract fixture (QA-2, QA-12)
- `players-stock.json` is committed in Core (`console/api/test/fixtures/`) and copied
  **byte-identically** to mentat (`test/fixtures/adapter/`).
- Both repos pin the same sha256 constant in a test (T16, M-T20). Changing the shape therefore
  fails whichever side was not updated. That is the drift check, and it needs no network access in
  CI.
- The Core side is produced by the real route handler, envelope included, over the seeded
  fixture.
- A signing-pairing check lives with it:
  - a Core test builds a request exactly as mentat's `AdapterClient.request` does, using a copy of
    `STOCK_SIGNED_ACTOR_FIELDS` and the signing function, and asserts that it verifies;
  - the mentat test asserts that its field list equals the fixture's recorded list.

### 11.4 Live UAT on `dune-dev` only (executable; QA-8)
`dune-prod` is off-limits without explicit Requirement 7 approval.

**Prerequisites**
- Verify what dune-dev runs (U9).
- dune-dev has its **own** bearer and actor secret, not prod's, checked by presence and hash only
  (CLOUD-8).
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

**Step 2: seeded ground truth.** The operator's test character X is seeded with console Give or
in-game actions:

| Where | Item | Qty | Counted? |
|---|---|---|---|
| Backpack | Silicone | 50 | yes |
| Base A (rank 1) storage container | Silicone | 200 | yes |
| Base A medium ore refinery (input slot) | Silicone | 30 | yes (Open Decision 3 default) |
| Base B (rank 1) chest | Silicone | 120 | yes |
| Hologram placeable in Base A | Silicone | 999 | **no** |
| Base C where X is rank 2 | Silicone | 500 | **no** |
| Base A oil generator | Oil | 499 | **no** |
| Base A chest | Oil | 200 | yes |

**Expected results**
- Silicone: `total 400, inBackpack 50, inBases 350`.
- Oil: `total 200` (plus any backpack Oil, which is recorded).
- A simple goal on an **equipped** stillsuit reads "manual only" (worn gear is never read; a
  worn-gear *resource* stack cannot exist in-game and is covered by T4).
- The independent ground-truth SQL sums per `inventory_id` directly from `dune.inventories` with
  explicit ids, not through the ownership join.

Pass: **exact equality**.

**Step 3: timing**
- 20 sequential calls through the **tunnel hostname** (console-dev.darkdante.org) and 20 over the
  VLAN.
- Pass: p95 < 1 s on both.
- Record `EXPLAIN (ANALYZE, BUFFERS)`, the plan and the row count. This is a **merge gate** for
  Core.

**Step 4: lag (U6).** Move a known stack between backpack and chest and record the time until the
route reflects it. There is no pass threshold; the value goes into the user-facing "as of last
save" wording.

**Step 5: negative paths**
- unlinked test user; `public`-tier user; moderator;
- 17 ids; `__proto__`; foreign id in the body;
- unsigned request on a signed deployment;
- 2 concurrent calls (expect one `stock_busy`); 7 calls in a minute (expect `rate_limited`);
- dead console port (repoint mentat's test guild row; do not stop dune-dev services).

**Step 6: end to end in Discord.** Personal goal → `sync` preview → **Apply** → `progress` →
decrease case → **Apply incl. decreases**.
- Verify: saved numbers; audit rows with `source`, `source_guild_id` and `source_ref`; Core audit
  line with the same interaction id; reply ephemeral with `DISCORD_DEFAULT_EPHEMERAL=false` set on
  the test instance.

**Step 7:** post results, with seed table, SQL, timings and EXPLAIN, as a comment on the tracking
issues (Requirement 20).

## 12. Documentation Impact (Requirement 14 / GRC-3) — required section of both PR bodies

| Doc | Repo | Change |
|---|---|---|
| `docs/console/API-REFERENCE.md` | Core | New route (POST, body, response array, error codes, limits); **fix the GET→POST drift at `:1018`–`:1022` in the same PR** |
| Discord tier/capability doc (the doc listing `CAPABILITY_BY_TIER`; locate with `git grep -l INVENTORY_READ -- docs`) | Core | `STOCK_SELF_READ` at observer+ |
| `CHANGELOG.md` | Core | Entry: "no operator action required. To use live stock, both the bot and this Core must share `DUNE_DISCORD_ACTOR_SECRET` (see rotation runbook); new env `DUNE_STOCK_QUERY_TIMEOUT_MS`, `DUNE_STOCK_MAX_INFLIGHT`, `DUNE_STOCK_RATE_PER_MIN`" (GRC-10) |
| Actor-secret provisioning and rotation runbook | Core | Write it, or extend the existing one, per §3.4 (CLOUD-2, GRC-8) |
| `docs/console/base-inventory.md` | Core | Note that the stock route reuses the Storage/Refining/Crafting groups |
| Networking/operator notes (existing `docs/networking.md` if present) | Core | Signed path is baseUrl-relative (path-rewriting proxies break it); cleartext-HTTP LAN note (NET-6) |
| `docs/architecture.md` "Read Capabilities" (`:109`) | mentat | Add `players-stock` and the signed-fields note |
| `docs/user-guide.md` goal table (`:110`–`:118`) | mentat | `/dune goal sync`, buttons, what is counted, manual-only nodes |
| `docs/crafting-resource-planning-overview.md` | mentat | Phase 2 status |
| `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md` | mentat | Cross-reference: `sync` subcommand and v9 audit columns |
| `CHANGELOG.md` | mentat | Entry, including schema v9 and `MENTAT_LIVE_STOCK_GUILD_IDS` |
| `.env.example` / config docs | mentat | `MENTAT_LIVE_STOCK_GUILD_IDS` (empty = off, restart to change) |
| `docs/faq.md` / privacy text | mentat | One sentence on on-request game-data reads, if absent (§8) |
| `README` Live Systems (meta repo) | meta | Only if the bot VM `.env` gains the allowlist (Requirement 23 not triggered: no new ingress) |

## 13. Rollout and Rollback

**Rollout order**
0. Governance steps (§14.1).
1. The Core session implements, tests and runs Layer 2, then merges to fork `main` (§14.3
   lifecycle).
2. The operator deploys Core to dune-dev.
3. UAT steps 0–5.
4. mentat branch `feat/goal-live-sync` after PR #435 merges and after Open Decision 5 is settled:
   implementation, Layer 2 and Layer 3 (`/code-review high`), then merge.
5. Deploy mentat via `git push deploy deploy`, with the guardrail hook. The allowlist is still
   empty, so this is a no-op for users.
6. Add the dune-dev guild id to `MENTAT_LIVE_STOCK_GUILD_IDS`. This is a Requirement 7
   bot restart.
7. UAT step 6.
8. dune-prod only with explicit operator approval, after the Core side is deployed there by the
   operator and the §4.2a review has been done for prod.

Never allowlist a guild whose Core lacks the route. That would be harmless (FM1) but noisy.

**Rollback**
- **mentat:** remove the guild id from the allowlist, which is a Requirement 7 restart and
  **not instant**. Or revert the merge. Schema v9 columns may stay, because v8 code ignores them;
  otherwise run the §7 rollback SQL. Already-applied on-hand numbers are ordinary saved entries the
  player can edit.
- **Core:** revert the route. There is no schema, data or index to undo, and nothing else calls it.

## 14. Governance and Cross-Repo Sequencing

### 14.1 Before implementation (Requirements 13, 15, 18, 20, 28, 29)
1. **Requirement 28 check, done for this revision (2026-09-29).**
   - `gh issue list --label ops-monitor --state open` on Core shows #1086 (fork/upstream divergence,
     1533 ahead / 1404 behind), #1085 (upstream sync status) and #1069 (upstream security-checks
     skip).
   - mentat has none.
   - Relevance: #1086 affects any future upstream PR (Open Decision 7) but not the fork-only
     branch.
   - Re-run and record the check at branch creation.
2. **File issues and add them to the board with Priority and Workstream (Requirement 15).**
   - (a) mentat tracking issue for this feature. Post this register and the STRIDE table there
     (Requirement 20).
   - (b) Core issue with a self-contained implementation prompt covering C1–C9, §4 and §11.1.
     This session **hands off** and does not implement it (Requirement 18).
   - (c) mentat issue for Open Decision 1 option A (per-guild actor secret, including the write
     bridge).
   - (d) Follow-ups listed in §17.
   - mentat#433 (moderator-tier gap) already exists. The Layer 2 plan must reference it, and it
     must be verified on dune-dev with dune-dev's own bearer and actor secret (GRC-4, CLOUD-8).
3. **Requirement 29:** re-verify Core `origin/main` (this design cites `ace31877`, 2026-09-27)
   and mentat `main` when branches are cut and again before marking PRs ready. Re-run the §2
   citations that changed.

### 14.2 Requirement 19 gates a–g (applies only if Open Decision 7 chooses an upstream PR)

| Gate | Requirement | How satisfied / status |
|---|---|---|
| a | Full test suite green on the exact SHA | Core CI run on the PR head SHA, integration tests **executed** (§11.1 gate rule) |
| b | ≥1 full live server session | dune-dev UAT §11.4 over a full session. Achievable: dune-dev is single-operator but a live server. |
| c | Operator-facing changes documented, nothing superseded | §12 rows for Core; PR body labels implemented vs proposed |
| d | Eight Hats L1/L2/L3 complete, CRITICAL/HIGH resolved | This register (L1); L2 per repo; L3 `/code-review high` (2026-09-29 correction) |
| e | Cross-origin redirect E2E test | **N/A**: no redirect, OAuth or external auth in this feature |
| f | Changed-file list hand-reviewed for fork-internal artifacts | `gh pr diff --name-only`; strip fork `CHANGELOG.md` etc. from the upstream diff |
| g | Fixed PR-body structure | Executive summary; what/why and rejected alternatives (§3.3 options, v1's `apply:true`); fresh install / upgrade / break-fix behaviour, including "what if the actor secret is lost" (re-provision both sides; no data loss; stock sync unavailable meanwhile); real test output; real security-scan output; eight-hat summary per round |

### 14.3 Branch lifecycle for a fork-only first release (GRC-7)
- If Open Decision 7 = fork-only (recommended), Requirement 21's **internal** lifecycle applies to
  Core: branch → PR to fork `main` → CI → merge (no squash, so history stays attributable) →
  delete the branch.
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
| R8 | Provenance lost | Low → resolved | v9 columns |
| R9 | Route classification in mentat tracks Red-Blink | Low | `UNMERGED_ROUTES` + updated tests |
| R10 | API-REFERENCE drift | Low → resolved | Fixed in the Core PR |
| R11 | Shared signing key across tenants | High → gated | Open Decision 1 (C for v1; A before hosted tenants) |
| R12 | Historic unverified links become read credentials | Medium | §4.2a pre-enable review; Open Decision 6 |
| R13 | Command budget exhaustion | Medium | Open Decision 5 |

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
- **U12** Whether `DUNE_DISCORD_ACTOR_SECRET` is configured and identical on the bot VM, dune-dev
  and dune-prod (check by presence and hash only).
- **U13** Whether the operator's own Discord guilds are registered `guilds` rows, or rely on the
  global adapter fallback. If they rely on the fallback, registering them is a prerequisite of
  §3.1.
- **U14** Whether Core's `validateDiscordActor` accepts `interactionId`. It is in
  `SIGNED_ACTOR_FIELDS`; confirm in Layer 2.

(v1's U7, async handler compatibility, is closed: goal handlers already run inside the async
`executeDuneCommand` try block after `deferReply`.)

## 17. Follow-Up / Deferred Work (each gets an issue, §14.1)
- **Per-guild actor secret (Open Decision 1 option A)**, covering the write bridge too. This is a
  prerequisite for any hosted tenant.
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
- **Guild scope (Option 2).** Remains deferred: own design, own migration.
- **Catalog drift-check CI** (Phase 3 Gap 1). More valuable now that catalog ids are query keys.
- **Signed-body coverage for other read routes**, as done here with `params` (SEC-8 generalization).

## 18. Open Decisions for the Operator

1. **Actor signing in multi-tenant mode** (§3.3).
   - **Question:** which tenants can use live stock, and with what signing key?
   - **Options:**
     - A: per-guild encrypted secret column;
     - B: HKDF-derived per-guild keys;
     - C: v1 limited to guilds whose Core already shares the bot's secret (your own Cores),
       enforced by the allowlist;
     - D: signature optional.
   - **Tradeoffs:**
     - A is the correct long-term answer, and also fixes the write bridge, but it is its own
       design and migration.
     - B breaks two guilds sharing one Core and concentrates risk in one master key.
     - D weakens the only defence against a leaked bearer on a new Player-data read.
   - **Recommendation: C now, file A.**
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
5. **Command budget (UX-1).** `sync` + "Live stock." + `id` + "Id." costs **20 chars**: 7473 →
   7493 of the 7500 target.
   - **Options:**
     - (a) take it now; no re-baseline; everything after needs mentat#423 or a named trim;
     - (b) sequence implementation after the `/dune` split (mentat#423);
     - (c) trim a named description first.
   - **Recommendation:** (a). The button design already removed the `apply` option, and leaving
     7 chars of headroom is acceptable only because #423 is the agreed next step.
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
