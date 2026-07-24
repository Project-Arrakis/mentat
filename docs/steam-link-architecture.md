# Discord → Steam → Character Linking — Architecture

## Overview

Two repositories change: `Arrakis-Control-Panel` (bot: OAuth callback
service, new command, new interaction handling) and
`dune-awakening-selfhost-docker` (Core: one new query function, one new
provider function, one new route, reusing FINDING-LINK-6's existing schema
and conflict-check). No new database, no new container, no new external
service beyond Discord's own OAuth endpoints (which every Discord bot
already depends on for its core auth).

## Why This Wasn't Previously Possible (And What Changed)

The prior conclusion — "Steam can't be used to verify a Discord↔character
link" — was correct for a specific problem: *the bot independently proving
a player owns a given Steam account*, with no web surface to run an OAuth
or OpenID flow. Two things changed:

1. **We don't need to independently prove Steam ownership.** Discord's own
   `connections` OAuth scope means *Discord* already proved it, the moment
   the player linked Steam in their own Discord Settings. The bot only
   needs to ask the player's permission to *read* that already-established
   fact (`GET /users/@me/connections`), not re-verify it.
2. **A web OAuth callback endpoint is required either way** — for the
   Discord-connections path chosen here, or for a Steam OpenID fallback if
   ever built later. Discord's OAuth2 authorization code grant fundamentally
   requires a `redirect_uri` that is a real, publicly reachable HTTPS URL
   the user's browser lands on after consenting
   (https://discord.com/developers/docs/topics/oauth2#authorization-code-grant,
   verified 2026-07-24). There is no way to complete this flow purely
   inside a Discord bot process with no HTTP presence.

## Where the OAuth Callback Service Lives (Decision + Rationale)

**Decision: extend `Arrakis-Control-Panel`'s existing `setupServer.js`
Express app, not Core's `console/api`.**

Investigated both options directly before deciding:

| | `Arrakis-Control-Panel` (chosen) | Core `console/api` (rejected) |
|---|---|---|
| HTTP framework already present | Yes — Express 5, already a `package.json` dependency | Plain Node `http` module, hand-rolled routing (`server.js`), no Express |
| Existing OAuth code to extend | Yes — `setupServer.js` already implements a full Discord OAuth authorization-code flow (`/setup`, `/oauth/callback`) for an unrelated purpose (multi-tenant guild setup), including `state` generation/storage and token exchange against the exact same Discord endpoints this feature needs | No OAuth code exists anywhere in Core |
| TLS/HTTPS termination | Operator-provided (same requirement either way) but the bot's setup server is already documented as needing a public `ACP_BASE_URL` for multi-tenant mode — this feature reuses that same expectation | `console/api` binds `0.0.0.0:8088` (confirmed directly in `docker-compose.web.yml`/`server.js`) with **no in-process TLS** — an operator would need to newly stand up a reverse proxy specifically for this feature, which is a materially larger ask than "you already need HTTPS for OAuth, same as before" |
| Who "owns" Discord identity data | The bot already owns all Discord-side state (guild config, RBAC, cooldowns) | Core owns game-side state; adding Discord OAuth token handling to Core would be a layering violation — Core would start depending on Discord's identity model, not just the bot relaying already-authenticated actor claims (which is the existing, deliberate boundary — see FINDING-LINK-1's actor-signature design) |

This is not a small decision reached by default — it was the deciding
factor once `console/api`'s actual network exposure was checked directly
(no TLS in-process, plain HTTP module, no Express) against
`setupServer.js`'s already-working, already-Express, already-OAuth-capable
alternative.

## Single-Tenant Deployment Note (Important Constraint)

`setupServer.js` today is only started when `config.multiTenant` is true
(`src/index.js:42-54`). Most real deployments of this bot are
**single-tenant** (one guild, `.env`-configured, no SQLite multi-tenant
database) — this is the deployment model FINDING-LINK-1 through -6 were all
built against. This feature must run in **both** modes, so:

- A new, small Express app is started **unconditionally** (not gated behind
  `config.multiTenant`), separate from `setupServer.js`'s multi-tenant-only
  app, though it reuses `setupServer.js`'s Discord-OAuth helper functions
  (token exchange, `esc()` HTML escaping) via a shared module rather than
  duplicating them.
- New config: `ACP_STEAM_LINK_PORT` (default `3101`, distinct from
  `ACP_SETUP_PORT`'s default `3100` so both can run simultaneously in
  multi-tenant mode without a collision), `ACP_STEAM_LINK_BASE_URL`
  (falls back to `ACP_BASE_URL` if unset), `DISCORD_CLIENT_ID` (already
  exists — reused, not duplicated), `DISCORD_CLIENT_SECRET`/`_FILE` (already
  exists for multi-tenant mode; this feature requires it in **both** modes
  now, since single-tenant mode previously never needed a client secret at
  all — confirmed via `config.js:115`, `clientSecret` is currently
  `multiTenant ? readSecret(...) : undefined`. This is a **breaking
  config-shape change for single-tenant operators who want this feature**:
  they must now register an OAuth2 redirect URI in the Discord Developer
  Portal and provide a client secret, which single-tenant mode never
  required before. This is unavoidable — the OAuth flow cannot exist
  without it. It is optional: single-tenant operators who never run
  `/dune player link` with the `character` argument omitted never need to
  configure it, and the bot must start and run normally without it, only
  refusing that specific invocation with a clear "not configured" message
  if it's missing — providing a `character` argument continues to work
  exactly as before regardless of whether this secret is configured).

## Data Flow (Sequence)

```
Discord User          Bot (Express)         Discord API          Core Adapter
    │                       │                     │                     │
    │ /dune player link      │                     │                     │
    │ (no character arg)    │                     │                     │
    │──────────────────────►│                     │                     │
    │                       │ generate state,      │                     │
    │                       │ store {discordUserId,│                     │
    │                       │  guildId, interaction│                     │
    │                       │  token, expiresAt}   │                     │
    │  [Sign in w/ Discord] │                     │                     │
    │◄──────────────────────│                     │                     │
    │                       │                     │                     │
    │ (browser) click link  │                     │                     │
    │───────────────────────────────────────────►  │                     │
    │        Discord consent screen (scope: identify, connections)      │
    │◄──────────────────────────────────────────── │                     │
    │ (user consents)       │                     │                     │
    │───────────────────────────────────────────►  │                     │
    │        redirect to /steam-link/callback?code=..&state=..           │
    │──────────────────────►│                     │                     │
    │                       │ validate state       │                     │
    │                       │ (exists, not expired, │                    │
    │                       │  not already used)    │                    │
    │                       │ POST /oauth2/token ──────────────────────► │
    │                       │◄────────────────────  │                     │
    │                       │ GET /users/@me/connections ───────────────►│
    │                       │◄────────────────────  │                     │
    │                       │ filter type==steam    │                     │
    │                       │                     │  POST /players/accounts/resolve-steam
    │                       │────────────────────────────────────────────►│
    │                       │                     │   (per Steam account id, queries
    │                       │                     │    dune.accounts.platform_id,
    │                       │                     │    returns candidate characters)
    │                       │◄────────────────────────────────────────────│
    │  candidate list page  │                     │                     │
    │◄──────────────────────│                     │                     │
    │ click "Link this      │                     │                     │
    │  character"           │                     │                     │
    │───────────────────────►│                     │                     │
    │                       │  POST /players/accounts/link-steam ───────►│
    │                       │◄────────────────────────────────────────────│
    │                       │  (calls linkAdditionalAccount() directly,  │
    │                       │   same table/conflict-check as FINDING-    │
    │                       │   LINK-6's whisper flow, but a NEW         │
    │                       │   verification path — no whisper/code)     │
    │  success page         │                     │                     │
    │◄──────────────────────│                     │                     │
    │                       │ editReply() on the original                │
    │                       │ /dune player link interaction              │
    │  ✅ (Discord embed updates in place)         │                     │
    │◄──────────────────────│                     │                     │
```

## New Files / Modified Files — `Arrakis-Control-Panel`

```
src/steamLinkServer.js       — new Express app: GET /steam-link/start,
                                GET /steam-link/callback, POST /steam-link/select
src/steamLinkStore.js        — state-token storage. Implemented as a
                                module-level in-memory Map (matching
                                cooldown.js's own singleton pattern), NOT
                                a reuse of setupServer.js's SQLite
                                oauth_sessions table — single-tenant mode
                                (the majority of real deployments) opens no
                                SQLite db at all, so an in-memory-only
                                store that works identically in both modes
                                was simpler than conditionally wiring a
                                second persistence backend. Sessions are
                                short-lived (10 min) and single-use, so a
                                lost session on process restart just means
                                re-running the command — an accepted,
                                documented tradeoff, not an oversight.
src/htmlEscape.js            — new: esc() extracted out of setupServer.js
                                into its own shared module so
                                steamLinkServer.js's callback pages use the
                                exact same escaping function instead of a
                                second copy that could drift
src/commands.js               — moves the 9 existing identity/linking
                                subcommands from the `data` group to a new
                                `player` group (breaking rename, see Design
                                doc's Scope Addition), makes `player:link`'s
                                `character` option OPTIONAL (was required),
                                and adds the Steam-connections branch inside
                                the SAME `player:link` dispatch case (not a
                                separate `link-steam` case) — see Design
                                doc's Unified Command Design section for why
                                this changed from the original per-command
                                proposal
src/adapterClient.js          — new methods: resolveSteamCandidates(),
                                linkAccountViaSteam()
src/config.js                — new ACP_STEAM_LINK_PORT / _BASE_URL config,
                                DISCORD_CLIENT_SECRET now read in
                                single-tenant mode too (optional)
src/index.js                 — new MessageComponentInteraction handling
                                branch (for a possible future Discord-side
                                component, currently only used by the
                                Link-style button which Discord handles
                                natively with no bot-side click callback —
                                this branch is added defensively for the
                                editReply-after-callback path's own button
                                if one is ever added, and to close the
                                "no component handling exists" gap
                                generally, matching the crafting
                                calculator's precedent of adding
                                autocomplete handling as its own explicit
                                interaction branch)
docs/user-guide.md            — new command documented; ALSO fixes
                                pre-existing unresolved git merge-conflict
                                markers found live on main (see
                                Security Review's informational finding)
test/steamLinkServer.test.js  — new
test/discord-bot-test-harness.js — extended with the new command
```

## New Files / Modified Files — `dune-awakening-selfhost-docker` (Core)

```
console/api/src/duneDb.js
  - new function: resolveCharactersBySteamId64(db, steamId64List)
    Queries dune.accounts (join dune.player_state) for
    lower(platform_name)='steam' and platform_id = any($1), returning
    candidate character rows. Read-only, no schema change — dune.accounts
    already has everything needed (see Design doc's cardinality section).

console/api/src/integrations/discord/multiAccountLinkProvider.js
  - new function: linkAccountViaSteamProvider(db, config, { discordUserId,
    playerControllerId }, dependencies)
    Calls the EXISTING linkAdditionalAccount(db, discordUserId,
    playerControllerId) directly — NO new schema, NO new conflict-check
    logic (both already exist and are reused as-is). The only genuinely
    new logic is skipping the whisper-code generation/verification steps
    that linkAccountProvider() (the existing whisper-based function) does,
    since Discord's OAuth grant is a different, already-completed proof of
    identity — this function trusts that the bot has already verified the
    OAuth grant before calling it, exactly the same trust boundary
    FINDING-LINK-1's actor-signature mechanism already establishes for
    every other self-scoped write.

console/api/src/integrations/discord/adapter.js
  - two new entries in DISCORD_ADAPTER_ROUTES, following the exact existing
    naming pattern (PLAYERS_ACCOUNTS_LINK, PLAYERS_ACCOUNTS_LIST, etc.
    already present at adapter.js:30-34):
    PLAYERS_ACCOUNTS_RESOLVE_STEAM: "/api/integrations/discord/players/accounts/resolve-steam"
    PLAYERS_ACCOUNTS_LINK_STEAM: "/api/integrations/discord/players/accounts/link-steam"

console/api/src/integrations/discord/routes.js
  - two new route blocks, inserted alongside the existing five
    PLAYERS_ACCOUNTS_* blocks at routes.js:272-329 (immediately after
    PLAYERS_ACCOUNTS_SET_DEFAULT, before PLAYERS_ME), following the exact
    same shape: readJson -> validateDiscordActor -> requireSelfScopedCapability(
    actor, mapping, DISCORD_CAPABILITIES.ACCOUNT_LINK_WRITE) -> call
    provider -> json(res, 200, result). Both POST, both gated by the
    EXISTING ACCOUNT_LINK_WRITE capability — no new capability needed.

console/api/src/integrations/discord/policy.js
  - NO changes. ACCOUNT_LINK_WRITE already exists and is already
    self-scoped correctly for this exact use case.

console/api/test/discordAdapter.test.js — extended with the two new routes
console/api/test/duneDb.test.js         — extended with resolveCharactersBySteamId64
console/api/test/discordMultiAccountLinkProvider.test.js — extended with linkAccountViaSteamProvider
```

## Server Name Resolution for Error Messages

Case 2's error message (Steam connection found, zero matching characters —
see Design doc) names the actual game server rather than a generic "this
server," since a player could plausibly be in Discord with more than one
Dune server community and have a real character on a different one than
the one they're trying to link on. This reuses the exact same lookup
`server:status`/`sendStatusCard()` already perform — `adapterClient.status()`,
reading `statusData.title` — via a small `resolveServerName()` helper in
`steamLinkServer.js` that never throws: a status-lookup failure falls back
to the literal string "this server" rather than blocking the (already
fully-determined) "no characters found" response from rendering. No new
Core route or adapter method was needed for this — `adapterClient.status()`
already exists and is already called elsewhere in this codebase for the
identical purpose.

## Why No New Core Schema Is Needed

`console.discord_account_links` (FINDING-LINK-6) already has the exact
shape this feature needs: composite-unique `(discord_user_id,
player_controller_id)`, standalone-unique `player_controller_id`,
`is_default` with the correct partial-unique-index semantics, and the
cross-table conflict check against the legacy single-link table. The
**only** new server-side logic is:

1. A read-only query resolving `platform_id` (SteamID64) → candidate
   character rows — pure `SELECT`, no writes, no new table.
2. A thin provider function that calls the existing `linkAdditionalAccount()`
   directly, skipping whisper generation/verification.

This is a deliberate, minimal-surface design: reusing a table and
conflict-check that has already been through a security review (this very
document's companion review references FINDING-LINK-6's own STRIDE
analysis) is safer than designing a parallel schema that would need its own
independent review.

## Sources

- [Design](steam-link-design.md)
- [Security Review](steam-link-security-review.md)
- [GRC Review](steam-link-grc.md)
- `src/setupServer.js` — existing Express + Discord OAuth pattern this feature extends (token exchange, `esc()` escaping — now shared via `src/htmlEscape.js`)
- `src/cooldown.js` — existing module-level in-memory Map singleton pattern this feature's `steamLinkStore.js` follows (chosen over reusing `database.js`'s SQLite `oauth_sessions` table, since single-tenant mode opens no SQLite db at all)
- `console/api/src/integrations/discord/multiAccountLinkProvider.js` — FINDING-LINK-6, the schema and conflict-check this feature reuses directly
- `console/api/src/duneDb.js:5346` (`linkAdditionalAccount`) — the exact function this feature's new provider calls
- Live schema verification, `dune-postgres` container, 2026-07-24:
  `\d dune.encrypted_player_state` (no unique constraint on `account_id`),
  `\d dune.encrypted_accounts` (unique on `user`, not on `platform_id` alone
  — multiple Steam accounts per Discord user is therefore not blocked by
  any uniqueness assumption on the game side either)
