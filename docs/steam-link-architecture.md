# Discord → Steam → Character Linking — Architecture

## Implementation Status (updated 2026-08-07, issue #86)

**Bot-side: implemented and wired.** `players-accounts-link-steam` is a
real, live Core route (verified 2026-08-06 against upstream
DISCORD_ADAPTER_ROUTES/routes.js at tag v1.3.79) and
`adapterClient.js:282`'s `linkAccountViaSteam()` calls it directly.
`UNMERGED_ROUTES` was reconciled in both directions (see that file's
SECOND/THIRD reconciliation comments) so nothing in the Steam path is
falsely marked unmerged anymore.

**End-to-end user-facing flow: still not reachable.** The bot-side OAuth
callback server (`src/steamLinkServer.js`, port 3101) is up and healthy,
but the Cloudflare Tunnel ingress only exposes the admin console's
tunnel hostname and `acp-setup.darkdante.org`; port 3101 is not routed, so a real user
clicking "Link via Steam" still gets a tunnel 404. That is a
deployment/CF-config gap, not a code gap — tracked in issue #86 (and
blocked on the same Cloudflare account access as issue #83). Once a
hostname is tunneled to 3101 the bot-side feature becomes testable
end-to-end as designed below.

## Overview

Two repositories change: `Arrakis-Control-Panel` (bot: OAuth callback
service, extended dispatch for the existing `player:link` command, new
interaction handling) and `dune-awakening-selfhost-docker` (Core: one
extension to the existing character-resolution query, one new provider
function, one new route, reusing FINDING-LINK-6's existing schema and
conflict-check). No new database, no new container, no new external
service beyond Discord's own OAuth endpoints.

**Revision note (2026-07-24):** this document originally described a
design where `/dune player link`'s `character` argument was optional, and
a "resolve everything reachable from your Steam connections" flow
presented a multi-candidate selection list. That design was corrected —
see `docs/steam-link-design.md`'s revision note for the full story. This
document has been rewritten to match: `character` is required, the
backend decides server-side (based on whether the named character already
has a Steam ID on file) whether to send a whisper or offer a Steam-link
button, and there is no candidate-selection list anywhere in the current
design.

## Why This Wasn't Previously Possible (And What Changed)

The prior conclusion — "Steam can't be used to verify a Discord↔character
link" — was correct for a specific problem: *the bot independently proving
a player owns a given Steam account*, with no web surface to run an OAuth
or OpenID flow. Two things changed:

1. **We don't need to independently prove Steam ownership.** Discord's own
   `connections` OAuth scope means *Discord* already proved it, the moment
   the player linked Steam in their own Discord Settings. The bot only
   needs the player's permission to *read* that already-established fact
   (`GET /users/@me/connections`), not re-verify it. Note this permission
   grant is itself unavoidable and cannot be checked in advance — see
   Design doc's Problem Statement for why this constrains the whole flow.
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
Express app pattern (as a separate app), not Core's `console/api`.**

Investigated both options directly before deciding:

| | `Arrakis-Control-Panel` (chosen) | Core `console/api` (rejected) |
|---|---|---|
| HTTP framework already present | Yes — Express 5, already a `package.json` dependency | Plain Node `http` module, hand-rolled routing (`server.js`), no Express |
| Existing OAuth code to extend | Yes — `setupServer.js` already implements a full Discord OAuth authorization-code flow (`/setup`, `/oauth/callback`) for an unrelated purpose (multi-tenant guild setup), including `state` generation/storage and token exchange against the exact same Discord endpoints this feature needs | No OAuth code exists anywhere in Core |
| TLS/HTTPS termination | Operator-provided (same requirement either way) but the bot's setup server is already documented as needing a public `ACP_BASE_URL` for multi-tenant mode — this feature reuses that same expectation | `console/api` binds `0.0.0.0:8088` (confirmed directly in `docker-compose.web.yml`/`server.js`) with **no in-process TLS** — an operator would need to newly stand up a reverse proxy specifically for this feature |
| Who "owns" Discord identity data | The bot already owns all Discord-side state (guild config, RBAC, cooldowns) | Core owns game-side state; adding Discord OAuth token handling to Core would be a layering violation |

This decision is unaffected by this document's revision — it was never
about the argument-optionality question, only about where the OAuth HTTP
surface lives.

## Single-Tenant Deployment Note (Important Constraint)

`setupServer.js` today is only started when `config.multiTenant` is true
(`src/index.js`). Most real deployments of this bot are **single-tenant**
(one guild, `.env`-configured, no SQLite multi-tenant database) — this is
the deployment model FINDING-LINK-1 through -6 were all built against.
This feature must run in **both** modes, so:

- A new, small Express app is started **unconditionally** (not gated
  behind `config.multiTenant`), separate from `setupServer.js`'s
  multi-tenant-only app, though it reuses `setupServer.js`'s Discord-OAuth
  helper functions (token exchange, `esc()` HTML escaping) via a shared
  module rather than duplicating them.
- New config: `ACP_STEAM_LINK_PORT` (default `3101`, distinct from
  `ACP_SETUP_PORT`'s default `3100` so both can run simultaneously in
  multi-tenant mode without a collision), `ACP_STEAM_LINK_BASE_URL`
  (falls back to `ACP_BASE_URL` if unset), `DISCORD_CLIENT_ID` (already
  exists), `DISCORD_CLIENT_SECRET`/`_FILE` (already exists for
  multi-tenant mode; this feature requires it in **both** modes now,
  since single-tenant mode previously never needed a client secret at
  all). This is a **breaking config-shape change for single-tenant
  operators who want this feature**: they must register an OAuth2
  redirect URI in the Discord Developer Portal and provide a client
  secret. This is unavoidable — the OAuth flow cannot exist without it.
  It is optional in the sense that matters most: single-tenant operators
  who never configure it keep getting the whisper flow for every
  character (Steam-linked or not — the bot just skips offering the button
  if the secret is unconfigured, per FINDING-STEAM-5), and the bot must
  start and run normally without it.

## Data Flow (Sequence)

```
Discord User          Bot                    Discord API          Core Adapter
    │                       │                     │                     │
    │ /dune player link      │                     │                     │
    │ <character-name>      │                     │                     │
    │──────────────────────►│                     │                     │
    │                       │  POST /players/link ─────────────────────►│
    │                       │  (resolves character, checks Steam ID     │
    │                       │   on file; if none, sends whisper NOW     │
    │                       │   and returns pending=true, hasSteam=false)│
    │                       │◄────────────────────────────────────────  │
    │ [Case A: no Steam ID] │                     │                     │
    │  "check your whispers"│                     │                     │
    │◄───���──────────────────│                     │                     │
    │                       │                     │                     │
    │ [Case B: has Steam ID]│                     │                     │
    │  (Core returns pending=true, hasSteam=true, playerControllerId)   │
    │                       │ generate state, store {playerControllerId,│
    │                       │  characterName, discordUserId, guildId,   │
    │                       │  interactionToken, expiresAt}             │
    │  [Link via Steam]     │                     │                     │
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
    │                       │ filter type==steam,   │                     │
    │                       │ check: does state's   │                     │
    │                       │ playerControllerId's  │                     │
    │                       │ on-file Steam ID      │                     │
    │                       │ appear in this array? │                     │
    │                       │                     │  POST /players/accounts/link-steam
    │                       │  [match] ──────────────────────────────────►│
    │                       │◄────────────────────────────────────────────│
    │                       │  (calls linkAdditionalAccount() directly,  │
    │                       │   same table/conflict-check as FINDING-    │
    │                       │   LINK-6's whisper flow, but a NEW         │
    │                       │   verification path — no whisper/code)     │
    │  success page         │                     │                     │
    │◄──────────────────────│                     │                     │
    │                       │  [no match] POST /players/link/verify -   │
    │                       │  send-whisper-now ─────────────────────────►│
    │                       │◄────────────────────────────────────────────│
    │  "sent a whisper      │                     │                     │
    │   instead" page       │                     │                     │
    │◄──────────────────────│                     │                     │
    │                       │ editReply() on the original                │
    │                       │ /dune player link interaction              │
    │  ✅ (Discord embed updates in place, either outcome)               │
    │◄──────────────────────│                     │                     │
```

Note there is no candidate-list rendering step anywhere in this sequence —
the callback either matches the one specific `playerControllerId` the
`state` was scoped to, or it doesn't; there is nothing to choose between.

## New Files / Modified Files — `Arrakis-Control-Panel`

```
src/steamLinkServer.js       — new Express app: GET /steam-link/start,
                                GET /steam-link/callback (no POST /select
                                needed in this revision — see Design doc,
                                there is no candidate list to submit a
                                selection against)
src/steamLinkStore.js        — state-token storage. Module-level in-memory
                                Map (matching cooldown.js's own singleton
                                pattern), NOT a reuse of setupServer.js's
                                SQLite oauth_sessions table — single-tenant
                                mode (the majority of real deployments)
                                opens no SQLite db at all. Each session is
                                now scoped to a single playerControllerId +
                                characterName (not a Steam-ID list to
                                resolve candidates from), reflecting the
                                simplified per-character flow.
src/htmlEscape.js            — new: esc() extracted out of setupServer.js
                                into its own shared module so
                                steamLinkServer.js's callback pages use the
                                exact same escaping function instead of a
                                second copy that could drift
src/commands.js               — `player:link`'s existing dispatch case is
                                extended (not branched on argument
                                presence — `character` stays required) to
                                check the Core response's `hasSteam` flag
                                and choose between showing the whisper
                                reply (unchanged) or the "Link via Steam"
                                button reply. No SlashCommandBuilder schema
                                change at all in this revision — the
                                `character` option's `.setRequired(true)`
                                is restored to match its pre-feature state.
src/adapterClient.js          — new method: linkAccountViaSteam(). The
                                existing playerLinkStart()/playerLink()
                                method's response shape gains two new
                                fields (hasSteam, playerControllerId) —
                                see Implementation Prompt Part 1 for the
                                exact Core-side response shape change.
src/config.js                — new ACP_STEAM_LINK_PORT / _BASE_URL config,
                                DISCORD_CLIENT_SECRET now read in
                                single-tenant mode too (optional)
src/index.js                 — new MessageComponentInteraction handling
                                branch (defensive; the Link-style button
                                itself needs no bot-side handler since
                                Discord opens it directly, but this closes
                                the "no component handling exists" gap
                                generally)
docs/user-guide.md            — updated command documentation
test/steamLinkServer.test.js  — new
test/discord-bot-test-harness.js — extended with the two-outcome case
                                (has Steam ID vs. does not)
```

## New Files / Modified Files — `dune-awakening-selfhost-docker` (Core)

```
console/api/src/duneDb.js
  - EXTEND the existing character-resolution path used by
    linkAccountProvider() (or add a thin wrapper around it) so that,
    alongside resolving the named character and (if no Steam ID is on
    file) sending the whisper as it does today, it ALSO checks
    dune.accounts.platform_name/platform_id for that same account and
    returns { pending: true, hasSteam: boolean, playerControllerId,
    characterName } instead of just { pending: true }. This is a
    response-shape addition to an existing function's return value, not a
    new query — the account row being resolved already has platform_name/
    platform_id available in the same row the character-name lookup
    already reads.
  - new function: characterHasSteamId(db, playerControllerId) if a
    reusable check function is preferred over inlining the field read —
    implementer's choice, either shape satisfies this requirement, but the
    two-repo boundary (see routes.js below) must expose hasSteam either
    way.
  - new function: matchSteamIdForCharacter(db, playerControllerId,
    steamId64List) — given the one specific playerControllerId a
    steam-link session is scoped to, and the array of SteamID64s Discord's
    connections endpoint returned, returns true if that character's
    on-file platform_id appears anywhere in the array. Read-only, no
    writes, no new table.

console/api/src/integrations/discord/multiAccountLinkProvider.js
  - new function: linkAccountViaSteamProvider(db, { discordUserId,
    playerControllerId }) — UNCHANGED from the prior revision of this
    document. Calls the EXISTING linkAdditionalAccount(db, discordUserId,
    playerControllerId) directly — NO new schema, NO new conflict-check
    logic. Trusts that the caller (the bot) has already verified the
    Discord OAuth grant and the Steam-ID match before calling this.

console/api/src/integrations/discord/adapter.js
  - one new entry in DISCORD_ADAPTER_ROUTES (down from two in the prior
    revision — resolve-steam is no longer needed since there's no
    candidate list to resolve):
    PLAYERS_ACCOUNTS_LINK_STEAM: "/api/integrations/discord/players/accounts/link-steam"
  - optionally, a small route for the whisper-fallback trigger if the
    "no match" path needs an explicit Core call rather than reusing the
    existing whisper-send path already triggered during the initial
    /dune player link request (implementer's choice — see Implementation
    Prompt Part 1 for the exact recommendation).

console/api/src/integrations/discord/routes.js
  - one new route block (PLAYERS_ACCOUNTS_LINK_STEAM), following the
    exact same shape as the existing PLAYERS_ACCOUNTS_* blocks: readJson
    -> validateDiscordActor -> requireSelfScopedCapability(actor, mapping,
    DISCORD_CAPABILITIES.ACCOUNT_LINK_WRITE) -> call provider -> json(res,
    200, result). POST, gated by the EXISTING ACCOUNT_LINK_WRITE
    capability — no new capability needed.
  - the existing players/link route's handler is extended to also return
    hasSteam/playerControllerId per the duneDb.js change above.

console/api/src/integrations/discord/policy.js
  - NO changes. ACCOUNT_LINK_WRITE already exists and is already
    self-scoped correctly for this exact use case.

console/api/test/discordAdapter.test.js — extended with the new route
console/api/test/duneDb.test.js         — extended with matchSteamIdForCharacter
console/api/test/discordMultiAccountLinkProvider.test.js — extended with linkAccountViaSteamProvider
```

## Why No New Core Schema Is Needed

`console.discord_account_links` (FINDING-LINK-6) already has the exact
shape this feature needs: composite-unique `(discord_user_id,
player_controller_id)`, standalone-unique `player_controller_id`,
`is_default` with the correct partial-unique-index semantics, and the
cross-table conflict check against the legacy single-link table. The
**only** new server-side logic is:

1. A read-only check matching a single character's on-file `platform_id`
   (SteamID64) against an array of Steam connection IDs — pure boolean
   logic over already-available row data, no writes, no new table.
2. A thin provider function that calls the existing
   `linkAdditionalAccount()` directly, skipping whisper
   generation/verification.

This is a deliberate, minimal-surface design: reusing a table and
conflict-check that has already been through a security review is safer
than designing a parallel schema that would need its own independent
review.

## Server Name Resolution for Error Messages

Unchanged in principle from the prior revision, though it now applies to a
narrower error case: if the Steam-match fails and whisper-fallback needs
to reference the game server by name (rather than a generic phrase), that
lookup reuses the same `adapterClient.status()` call `server:status`
already performs, reading `statusData.title` — a best-effort lookup that
falls back to a generic phrase if the status call itself fails, so a
transient status-lookup issue never blocks the (already-determined)
fallback response from rendering.

## Sources

- [Design](steam-link-design.md)
- [Security Review](steam-link-security-review.md)
- [GRC Review](steam-link-grc.md)
- `src/setupServer.js` — existing Express + Discord OAuth pattern this feature extends (token exchange, `esc()` escaping — now shared via `src/htmlEscape.js`)
- `src/cooldown.js` — existing module-level in-memory Map singleton pattern this feature's `steamLinkStore.js` follows (chosen over reusing `database.js`'s SQLite `oauth_sessions` table, since single-tenant mode opens no SQLite db at all)
- `console/api/src/integrations/discord/multiAccountLinkProvider.js` — FINDING-LINK-6, the schema and conflict-check this feature reuses directly
- `console/api/src/duneDb.js` (`linkAdditionalAccount`) — the exact function this feature's new provider calls
- Live schema verification, `dune-postgres` container, 2026-07-24:
  `\d dune.encrypted_player_state` (no unique constraint on `account_id`),
  `\d dune.encrypted_accounts` (unique on `user`, not on `platform_id` alone
  — multiple Steam accounts per Discord user is therefore not blocked by
  any uniqueness assumption on the game side either)
