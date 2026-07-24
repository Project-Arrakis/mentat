# Implementation Prompt — Discord → Steam → Character Linking

This is a ready-to-run prompt for a future implementation session (Claude
Sonnet 5 or equivalent). This feature spans **two repositories** — implement
Core's changes first (they're smaller and the bot depends on them), then
the bot's changes. Paste the relevant section below as the task prompt for
each repo's session; do not attempt both repos in a single session unless
your tooling can operate across two working directories simultaneously.

**Do not redesign anything specified below.** If you believe something is
wrong, stop and ask before deviating — read all four companion documents in
full first: `docs/steam-link-design.md`, `docs/steam-link-architecture.md`,
`docs/steam-link-security-review.md`, `docs/steam-link-grc.md`.

---

## PART 1: Core repo (`dune-awakening-selfhost-docker`)

### Task

Implement the two new Core-side routes this feature needs, reusing
FINDING-LINK-6's existing schema and capability model exactly — see
`docs/security/discord-player-link-hardening.md` for that finding's full
history before touching any of this code.

### Files to modify

1. **`console/api/src/duneDb.js`** — add one new read-only query function,
   placed near `linkAdditionalAccount()` (around line 5346):

   ```js
   // resolveCharactersBySteamId64: read-only lookup used by the Discord bot's
   // Steam-connections-based linking flow (see
   // yacketrj/Arrakis-Control-Panel:docs/steam-link-architecture.md). Given a
   // list of raw SteamID64 strings (as returned by Discord's own
   // GET /users/@me/connections for type=="steam" connections), returns
   // candidate character rows. No writes. No new table.
   export async function resolveCharactersBySteamId64(db, steamId64List) {
     const ids = (Array.isArray(steamId64List) ? steamId64List : [])
       .map((value) => String(value || "").trim())
       .filter((value) => /^[0-9]{17}$/.test(value)); // SteamID64 is always 17 digits
     if (!ids.length) return [];
     const result = await db.query(`
       select
         ac.platform_id as steam_id64,
         ps.player_controller_id::text as player_controller_id,
         ps.player_pawn_id::text as player_pawn_id,
         ps.character_name,
         ps.online_status::text as online_status
       from dune.accounts ac
       join dune.player_state ps on ps.account_id = ac.id
       where lower(coalesce(ac.platform_name, '')) = 'steam'
         and ac.platform_id = any($1::text[])
         and ps.player_pawn_id is not null
       order by ps.character_name`, [ids]);
     return result.rows;
   }
   ```

   Cite the exact live-schema verification already done (2026-07-24,
   `dune-postgres` container: `dune.accounts` is a view over
   `encrypted_accounts`/no unique constraint on `platform_id`; joined via
   `dune.player_state`, itself a view filtering `encrypted_player_state`
   for `character_state = 'Active'`) in a comment above this function —
   do not re-derive these facts from scratch, they are already confirmed.

2. **`console/api/src/integrations/discord/multiAccountLinkProvider.js`** —
   add one new provider function, placed after `linkAccountProvider()`:

   ```js
   // linkAccountViaSteamProvider: the Steam-OAuth-based counterpart to
   // linkAccountProvider() above. Trusts that the CALLER (the Discord bot)
   // has already completed and verified a genuine Discord OAuth
   // authorization-code grant with the "connections" scope for this exact
   // discordUserId before calling this function -- there is no
   // whisper/code verification step here, because Discord's own OAuth
   // consent screen IS the identity proof for this path (see
   // docs/steam-link-architecture.md's "Why This Wasn't Previously
   // Possible" section in the bot repo for the full reasoning). This
   // function performs NO OAuth verification itself -- it is the bot's
   // responsibility to have already done that before this route is ever
   // called. Reuses linkAdditionalAccount() UNCHANGED, so every existing
   // conflict-check/uniqueness guarantee (including the cross-table check
   // against the legacy single-link flow) applies identically to links
   // created this way.
   export async function linkAccountViaSteamProvider(db, { discordUserId, playerControllerId }) {
     if (!discordUserId || !String(discordUserId).trim()) {
       throw policyError("invalid_request", "discordUserId is required.");
     }
     if (!playerControllerId || !String(playerControllerId).trim()) {
       throw policyError("invalid_request", "playerControllerId is required.");
     }
     const accounts = await linkAdditionalAccount(db, discordUserId, String(playerControllerId).trim());
     return { ok: true, accounts };
   }
   ```

   Import `linkAdditionalAccount` (already imported at the top of this
   file for `linkAccountProvider`'s own use — no new import needed).

3. **`console/api/src/integrations/discord/adapter.js`** — add two new
   entries to `DISCORD_ADAPTER_ROUTES` (around line 30-34, alongside the
   existing five `PLAYERS_ACCOUNTS_*` entries):

   ```js
   PLAYERS_ACCOUNTS_RESOLVE_STEAM: "/api/integrations/discord/players/accounts/resolve-steam",
   PLAYERS_ACCOUNTS_LINK_STEAM: "/api/integrations/discord/players/accounts/link-steam",
   ```

4. **`console/api/src/integrations/discord/routes.js`** — add two new
   route blocks, inserted immediately after the existing
   `PLAYERS_ACCOUNTS_SET_DEFAULT` block (around line 329) and before
   `PLAYERS_ME`:

   ```js
   // Multi-account via Steam: resolve candidate characters from a list of
   // Discord-connections-derived SteamID64 values. Read-only.
   if (path === DISCORD_ADAPTER_ROUTES.PLAYERS_ACCOUNTS_RESOLVE_STEAM && req.method === "POST") {
     const body = await readJson(req);
     const actor = validateDiscordActor(body.actor);
     requireSelfScopedCapability(actor, mapping, DISCORD_CAPABILITIES.ACCOUNT_LINK_WRITE);
     return json(res, 200, {
       ok: true,
       candidates: await resolveCharactersBySteamId64(db, body.steamId64List)
     });
   }

   // Multi-account via Steam: complete the link. Caller (the bot) must
   // have already verified the Discord OAuth grant before calling this.
   if (path === DISCORD_ADAPTER_ROUTES.PLAYERS_ACCOUNTS_LINK_STEAM && req.method === "POST") {
     const body = await readJson(req);
     const actor = validateDiscordActor(body.actor);
     requireSelfScopedCapability(actor, mapping, DISCORD_CAPABILITIES.ACCOUNT_LINK_WRITE);
     return json(res, 200, await linkAccountViaSteamProvider(db, {
       discordUserId: actor.userId,
       playerControllerId: body.playerControllerId
     }));
   }
   ```

   Add `resolveCharactersBySteamId64` to the existing `duneDb.js` import
   list at the top of `routes.js`, and `linkAccountViaSteamProvider` to the
   existing `multiAccountLinkProvider.js` import list.

   **Note:** `requireSelfScopedCapability()` for these two routes still
   checks `actor.userId` against nothing but itself (it's inherently
   self-scoped, matching every other `ACCOUNT_LINK_WRITE` route) — there is
   no separate "target user" concept here any more than there is for the
   existing five routes. `resolve-steam`'s response (a list of *candidate*
   characters) is not itself a write and does not need the requesting actor
   to already own anything; the actual ownership check happens inside
   `linkAdditionalAccount()` when `link-steam` is called.

### Tests to add

1. **`console/api/test/duneDb.test.js`** — add tests for
   `resolveCharactersBySteamId64()`:
   - Returns matching rows for a valid 17-digit SteamID64 with a real,
     active `player_state` row.
   - Returns an empty array for a well-formed but non-matching SteamID64.
   - Rejects (filters out, does not throw) malformed IDs (wrong length,
     non-numeric) — the function should silently drop invalid entries from
     the input array rather than erroring, since the bot may pass a mixed
     batch across multiple Steam connections.
   - Returns multiple rows when one SteamID64 has multiple active
     characters (this is the core cardinality case this whole feature
     exists to handle correctly — do not skip this test).
   - `platform_name` matching is case-insensitive (`'Steam'`, `'STEAM'`,
     `'steam'` all match) per the existing `lower(coalesce(...))` pattern
     already used elsewhere in this file for the same column.

2. **`console/api/test/discordMultiAccountLinkProvider.test.js`** — add
   tests for `linkAccountViaSteamProvider()`:
   - Successfully links when no conflict exists.
   - Rejects (propagates `linkAdditionalAccount`'s existing error) when the
     character is already linked to a different Discord user — reuse the
     exact same mock-db conflict scenario already used for
     `linkAccountProvider()`'s equivalent test, since this function calls
     the identical underlying function.
   - Rejects with `invalid_request` if `discordUserId` or
     `playerControllerId` is missing/empty.
   - Does NOT generate or check any verification code — confirm no call is
     made to any whisper/rate-limiter function this test file's existing
     mocks would otherwise detect.

3. **`console/api/test/discordAdapter.test.js`** — add end-to-end
   integration tests for the two new routes, following the exact pattern
   already used for the five existing `PLAYERS_ACCOUNTS_*` routes in this
   file:
   - A `public`-tier actor is rejected from both new routes with
     `403 not_authorized` (or whatever the existing self-scoped rejection
     status/code is — match it exactly, don't invent a new one).
   - An `observer`-tier (or above) actor can reach `resolve-steam` and get
     a normal (possibly empty) `candidates` array.
   - A full link-steam request against a mocked db that has no conflict
     succeeds and returns the updated account list.
   - A link-steam request against a mocked db with an existing conflicting
     link (different Discord user) returns the same generic
     `character_already_linked` error the existing whisper-based flow
     returns — assert the error message contains no identifying detail
     about the conflicting Discord user (per Security Review
     FINDING-STEAM-3).

### Verification before considering Core-side work done

```bash
npm test --prefix console/api
npm audit --prefix console/api --audit-level=moderate
npm run build --prefix console/web
gitleaks detect --no-git
trivy fs --scanners secret --severity HIGH,CRITICAL
semgrep --config p/default .
ggshield secret scan pre-push
```

All must pass with zero new findings, matching the exact verification list
in `docs/security/discord-player-link-hardening.md`'s own Verification
section. Update that document with a new subsection (or a cross-linked new
doc) recording this feature's addition, following that document's existing
structure (Source Findings → STRIDE Notes → Remediation Status table).

---

## PART 2: Bot repo (`Arrakis-Control-Panel`)

**Do not start this part until Core's changes are merged and deployed** (or
at minimum, available on a branch you can point a local Core instance at)
— the bot-side integration tests need the real routes to exist, even if
mocked at the HTTP layer for unit tests.

### Files to create

1. **`src/steamLinkStore.js`** — state-token storage. Shape:

   ```js
   // In-memory store by default (works in both single-tenant and
   // multi-tenant mode without requiring a SQLite db to be open).
   // If db is provided (multi-tenant mode), persists to a new
   // steam_link_sessions table instead -- see database.js additions below.
   //
   // Each entry: { state, discordUserId, guildId, interactionToken,
   //   commandInteractionId, createdAt, expiresAt, consumedAt }
   //
   // consumedAt is set (not deleted) on first successful callback use --
   // keep the row around briefly for idempotent-retry detection, but
   // ALWAYS treat a non-null consumedAt as "reject this state" (Security
   // Review FINDING-STEAM-1, single-use enforcement).
   export function createSteamLinkStore({ db = null, ttlMs = 10 * 60 * 1000 } = {}) { /* ... */ }
   ```

   Functions: `createSession({ discordUserId, guildId, interactionToken,
   commandInteractionId })` (generates `state` via
   `randomBytes(16).toString("hex")`, matching `setupServer.js`'s existing
   generation pattern exactly), `getSession(state)`, `consumeSession(state)`
   (atomically marks consumed AND returns the row in one call — must not be
   two separate calls with a race window between them), `pruneExpired()`.

2. **`src/steamLinkServer.js`** — the new Express app. Reuses
   `setupServer.js`'s `esc()` HTML-escaping helper (extract it to a shared
   `src/htmlEscape.js` if it isn't already exported, rather than
   duplicating it) and its dark/sand visual style constants (extract the
   shared `<style>` block to `src/setupPageStyles.js` if reasonable, or
   duplicate the CSS block if extraction is too invasive — your call, but
   do not invent a visually different design language for this feature's
   pages).

   Routes:
   - `GET /steam-link/start?state=<state>` — validates the state exists and
     is unexpired, then redirects (`302`) to
     `https://discord.com/oauth2/authorize?response_type=code&client_id=...&redirect_uri=...&scope=identify%20connections&state=...`.
     This is the URL the Link-style Discord button points at directly (see
     command implementation below) — this endpoint exists so the actual
     Discord `client_id`/`redirect_uri` never has to be embedded in a
     Discord message component's URL in a way that's harder to rotate;
     it's a thin indirection layer, matching why `setupServer.js`'s own
     `/setup` route does the same thing rather than building the Discord
     authorize URL directly in the calling code.
   - `GET /steam-link/callback?code=...&state=...&error=...` — the OAuth
     redirect target. Implements Security Review FINDING-STEAM-1 (state
     validation, single-use enforcement) before doing anything else. On
     success: exchanges `code` for a token (same `fetch()` pattern as
     `setupServer.js`'s existing `/oauth/callback`), calls
     `GET https://discord.com/api/v10/users/@me/connections` with the
     bearer token, filters `type === "steam"`, calls the Core adapter's new
     `resolveSteamCandidates()` method (see adapterClient.js changes below)
     with the list of Steam connection `id` values, and renders the
     candidate-selection page (or the zero-candidates page) per the Design
     doc's exact response shapes. **Never logs or persists the access
     token** (Security Review FINDING-STEAM-6).
   - `POST /steam-link/select` — body: `{ state, playerControllerId }`.
     Implements Security Review FINDING-STEAM-2: **re-derives** the valid
     candidate set server-side (re-calls the Core adapter's
     `resolveSteamCandidates()` again using the Steam connection IDs stored
     against this `state`'s session — do not trust a cached list from the
     callback step alone) and rejects any `playerControllerId` not in that
     freshly-re-derived set, before calling the Core adapter's
     `linkAccountViaSteam()` method. On success, renders a success page AND
     calls `interaction.editReply()` on the original Discord interaction
     (using the stored `interactionToken`/`commandInteractionId` via
     discord.js's webhook-edit mechanism — see discord.js docs for editing
     a deferred reply via `client.rest` or the stored interaction's own
     `editReply()` if the interaction object itself is cached; if neither
     is directly available this many minutes later, use Discord's
     `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original`
     REST endpoint directly with the stored token — this does not require
     the original `Interaction` object to still be in memory, only the
     token string, which is exactly why it's the field being stored).

   Started unconditionally in `src/index.js` (not gated behind
   `config.multiTenant` — see Architecture doc's Single-Tenant Deployment
   Note), on `config.steamLink.port` (default `3101`).

### Files to modify

1. **`src/config.js`** — add:
   ```js
   steamLink: {
     enabled: Boolean(optionalEnv(env, "DISCORD_CLIENT_SECRET") || optionalEnv(env, "DISCORD_CLIENT_SECRET_FILE")),
     port: parsePositiveInteger(env.ACP_STEAM_LINK_PORT, 3101),
     baseUrl: optionalEnv(env, "ACP_STEAM_LINK_BASE_URL") || optionalEnv(env, "ACP_BASE_URL") || "http://localhost:3101"
   }
   ```
   And change `discord.clientSecret` to be read **unconditionally** (not
   `multiTenant ? ... : undefined`) but **optionally** (do not throw if
   absent — use `optionalEnv`, not `readSecret`'s required-throw behavior,
   in single-tenant mode; multi-tenant mode's existing required-secret
   behavior is unchanged). Per Security Review FINDING-STEAM-5, the bot
   must start normally with this unset; only `player:link-steam` itself
   should fail cleanly if `config.steamLink.enabled` is false.

2. **`src/adapterClient.js`** — add:
   ```js
   resolveSteamCandidates(actor, steamId64List, guildId) {
     return this.request("players-accounts-resolve-steam", actor, { steamId64List }, guildId);
   }
   linkAccountViaSteam(actor, playerControllerId, guildId) {
     return this.request("players-accounts-link-steam", actor, { playerControllerId }, guildId);
   }
   ```
   And add the two new route path/method entries to `config.js`'s
   `DEFAULT_PATHS`/`DEFAULT_METHODS` objects (both `POST`), following the
   exact existing naming convention (`players-accounts-resolve-steam`,
   `players-accounts-link-steam`, mapping to
   `/api/integrations/discord/players/accounts/resolve-steam` and
   `/api/integrations/discord/players/accounts/link-steam`).

3. **`src/commands.js`** — this step has TWO parts. Do both together, in
   the same commit — do not ship the new command under the old `data`
   group even temporarily, since that would mean re-registering commands
   twice.

   **Part A — create the new `player` subcommand group and move the 9
   existing identity/linking subcommands into it, renaming their dispatch
   keys to match.** This was a deliberate scope decision made during design
   review (see `docs/steam-link-design.md`'s "Scope Addition" section for
   the full rationale) — `data` had grown to 15 of Discord's 25-per-group
   cap by mixing three unrelated concerns; splitting identity/linking out
   leaves both groups with headroom and a coherent purpose.

   In the `SlashCommandBuilder` construction (around line 47 today), REMOVE
   these 9 `.addSubcommand(...)` blocks from the `data` group: `link`,
   `verify`, `characters`, `enable`, `disable`, `default`, `unlink`,
   `faction`, `whoami`. ADD a new top-level group:
   ```js
   // ── player group ──
   .addSubcommandGroup((g) => g.setName("player").setDescription("Link your Discord to your game character, and manage linked characters.")
     .addSubcommand((c) => c.setName("link").setDescription("Link your Discord to your game character.")
       .addStringOption((o) => o.setName("character").setDescription("Your character name").setRequired(true)))
     .addSubcommand((c) => c.setName("link-steam").setDescription("Link via your Discord's connected Steam account (no whisper needed)."))
     .addSubcommand((c) => c.setName("verify").setDescription("Verify a pending character link with a code.")
       .addStringOption((o) => o.setName("code").setDescription("Verification code from in-game whisper").setRequired(true)))
     .addSubcommand((c) => c.setName("characters").setDescription("List your verified characters."))
     .addSubcommand((c) => c.setName("enable").setDescription("Enable a character in this guild.")
       .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
     .addSubcommand((c) => c.setName("disable").setDescription("Disable a character in this guild.")
       .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
     .addSubcommand((c) => c.setName("default").setDescription("Set your default character for this guild.")
       .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
     .addSubcommand((c) => c.setName("unlink").setDescription("Unlink a character from your Discord.")
       .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
     .addSubcommand((c) => c.setName("faction").setDescription("Set your faction for themed embeds.")
       .addStringOption((o) => o.setName("name").setDescription("atreides, harkonnen, or fremen").setRequired(true)
         .addChoices({ name: "Atreides", value: "atreides" }, { name: "Harkonnen", value: "harkonnen" }, { name: "Fremen", value: "fremen" })))
     .addSubcommand((c) => c.setName("whoami").setDescription("Show your linked game character info.")))
   ```
   (Place this new group alongside the other `addSubcommandGroup` calls,
   order doesn't matter functionally — grouping it near the now-slimmer
   `data` group is a reasonable readability choice but not required.)

   In `executeDuneCommand()`'s dispatch chain, RENAME every
   `key === "data:link"` / `"data:verify"` / `"data:characters"` /
   `"data:enable"` / `"data:disable"` / `"data:default"` /
   `"data:unlink"` / `"data:faction"` / `"data:whoami"` check to
   `"player:link"` / `"player:verify"` / etc. (same handler bodies,
   unchanged — only the string literal `key` is being matched against
   changes). Do this as a careful rename, not a copy — the old `data:*`
   dispatch branches must be fully removed, not left dead alongside new
   ones.

   Update `docs/changes/`, `test/discord-bot-test-harness.js`, and any
   other test file that references the old `data:link`/`data:verify`/etc.
   dispatch keys or `/dune data link` command strings — search the whole
   repo for `"data:link"`, `"data:verify"`, `"data:unlink"`,
   `"data:whoami"`, `"data:faction"`, `"data:characters"`, `"data:enable"`,
   `"data:disable"`, `"data:default"` and `/dune data link`, `/dune data
   verify`, etc. as literal strings before considering this rename
   complete — do not rely on memory of "which files probably reference
   this," grep for it.

   **Part B — add the new `link-steam` dispatch case** inside the same
   `player:*` dispatch block (not a separate one):
   ```js
   } else if (key === "player:link-steam") {
     if (!config.steamLink?.enabled) {
       await interaction.editReply(formatError(new Error(
         "Steam linking is not configured on this server. Ask an admin to set DISCORD_CLIENT_SECRET, " +
         "or use /dune player link <character-name> instead."
       )));
       return true;
     }
     const session = steamLinkStore.createSession({
       discordUserId: interaction.user.id,
       guildId,
       interactionToken: interaction.token,
       commandInteractionId: interaction.id
     });
     const startUrl = `${config.steamLink.baseUrl}/steam-link/start?state=${session.state}`;
     const row = new ActionRowBuilder().addComponents(
       new ButtonBuilder().setLabel("Sign in with Discord").setStyle(ButtonStyle.Link).setURL(startUrl)
     );
     await interaction.editReply({
       content: "Click below to connect your Discord's linked Steam account(s). " +
         "This link expires in 10 minutes.",
       components: [row]
     });
     return true;
   }
   ```
   Import `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle` from
   `discord.js` at the top of the file (new imports — confirm these aren't
   already imported before adding, but per the research pass, no
   component-builder imports exist anywhere in this file today).

4. **`src/index.js`** — add a new `MessageComponentInteraction` branch to
   the existing `Events.InteractionCreate` handler, per Architecture doc
   (defensive; the Link-style button itself needs no bot-side handler since
   Discord opens it directly, but this closes the "no component handling
   exists at all" gap generally and is required if any future
   confirm/cancel button is added to this or another feature). At minimum,
   add:
   ```js
   client.on(Events.InteractionCreate, async (interaction) => {
     try {
       if (interaction.isMessageComponent?.()) {
         // No bot-owned components exist yet that need handling here --
         // the Steam-link flow's only button is a Link-style component
         // Discord handles client-side with no interaction event fired to
         // the bot at all. This branch exists so future component-based
         // features have a home, and so an unexpected/unhandled component
         // interaction fails loudly (via Discord's own "interaction failed"
         // UI) rather than being silently swallowed by falling through to
         // executeDuneCommand's isChatInputCommand?.() early-return.
         return;
       }
       await executeDuneCommand(interaction, adapterClient, config, db);
     } catch (error) {
       logError("discord.interaction_failed", error);
     }
   });
   ```

5. **`src/index.js`** — start `steamLinkServer` unconditionally (not inside
   the `if (config.multiTenant)` block that starts `setupServer`):
   ```js
   const steamLinkStore = createSteamLinkStore({ db: config.multiTenant ? db : null });
   const steamLinkApp = createSteamLinkServer({ config, adapterClient, client, steamLinkStore });
   steamLinkApp.listen(config.steamLink.port, () => {
     logInfo("steam_link_server.started", { port: config.steamLink.port, enabled: config.steamLink.enabled });
   });
   ```

6. **`docs/user-guide.md`** — **NOTE: as of this design pass, the
   pre-existing unresolved git merge-conflict markers this file had (three
   blocks, describing two contradictory versions of the whisper-link flow)
   were already found and fixed directly during design review** — confirm
   this is still true when you start implementation (`grep -n "<<<<<<<"
   docs/user-guide.md` should return nothing; if it does, something
   regressed and must be fixed the same way: keep the 6-character
   `ACP-XXXXXX` whisper-code version matching what `linkProvider.js`
   actually implements, discard the stale RCON-whisper-only version).

   What you DO need to do here: update every `/dune data link`, `/dune
   data verify`, `/dune data characters`, `/dune data enable`, `/dune data
   disable`, `/dune data default`, `/dune data unlink`, `/dune data
   faction`, `/dune data whoami` reference in this file's command tables
   and walkthrough prose to `/dune player <same-subcommand>`, matching the
   `commands.js` rename from step 3 above exactly. Grep for `dune data
   link`, `dune data verify`, etc. across this file and fix every match —
   do not assume the "Linking Your Character" section is the only place
   these appear (the top command-group summary table near the start of the
   file also lists them). Add `/dune player link-steam` as a documented
   alternative within the same walkthrough, per
   `docs/steam-link-design.md`'s exact wording — a design-review pass
   already drafted this exact prose; reuse it rather than re-deriving new
   copy, so the implementation matches what was actually reviewed.

### Files to add (tests)

**`test/steamLinkServer.test.js`** — new. Must cover, at minimum:
- `state` validation: missing, expired, and already-consumed `state`
  values are all rejected with a clear error page, not a crash or a 500
  with no body (FINDING-STEAM-1).
- Successful callback flow end-to-end with a mocked Discord token-exchange
  and mocked `connections` response, mocked Core adapter response,
  resulting in the correct candidate-list HTML being rendered.
- `/steam-link/select` rejects a `playerControllerId` not present in the
  re-derived candidate set, even when that ID is a "valid-looking" string
  (FINDING-STEAM-2) — mock the Core adapter to return a DIFFERENT candidate
  set on the second call than the first, and assert the originally-shown
  (now-stale) candidate is rejected.
- Conflict error message (character already linked to another user)
  contains no Discord snowflake, username, or timestamp
  (FINDING-STEAM-3) — assert this via a regex/substring check against the
  rendered response body.
- The bot's HTTP server starts successfully and `/dune player link-steam`
  returns the "not configured" message when `DISCORD_CLIENT_SECRET` is
  unset (FINDING-STEAM-5) — do not skip this test, it's the one proving
  backward compatibility for existing single-tenant deployments.
- No log line at any level contains a raw OAuth access token or refresh
  token value, even in an injected-error scenario (FINDING-STEAM-6) —
  spy on the logger and assert.

**`test/discord-bot-test-harness.js`** — extend the existing "Command
Execution" suite with a `player:link-steam` case, following the exact
pattern already used for the other `player:*` cases (post-rename from
`data:*` — see step 3 above) in this file.

### Verification before considering bot-side work done

```bash
npm run check
npm audit --audit-level=moderate
semgrep scan --config p/default --config p/secrets --error --severity ERROR --severity WARNING --exclude node_modules --exclude .git --exclude package-lock.json .
```

If pre-commit is installed, `pre-commit run --all-files` should also pass.
Add a `docs/changes/PR-####-steam-link.md` change note following
`docs/changes/PR-0091-upstream-feedback-resolution.md`'s exact format
(`# PR Change Summary` → `## Addressed Items` → numbered subsections with
Problem/Solution/Commands/Implementation Details), and a row in
`docs/changes/README.md`'s index table.

## PR Requirements (Both Repos)

- Open each repo's PR against its own `main` from its own new feature
  branch (neither repo is a fork with an upstream to worry about leaking
  into, per prior session confirmation for `Arrakis-Control-Panel`; confirm
  the same status for Core if unverified at implementation time — Core
  **is** a fork of `Red-Blink/dune-awakening-selfhost-docker`, so its PR
  must target `yacketrj/dune-awakening-selfhost-docker:main`, never
  upstream, matching the established convention for all prior FINDING-LINK
  work).
- Reference all four companion docs
  (`docs/steam-link-design.md`/`-architecture.md`/`-security-review.md`/`-grc.md`)
  in both PR descriptions.
- Core's PR should land and be verified first; the bot's PR depends on its
  new routes existing.

## Sources

- `docs/steam-link-design.md`
- `docs/steam-link-architecture.md`
- `docs/steam-link-security-review.md`
- `docs/steam-link-grc.md`
- `docs/security/discord-player-link-hardening.md` (Core repo)
- `src/setupServer.js`, `src/database.js` — existing OAuth pattern this feature extends
- `console/api/src/integrations/discord/multiAccountLinkProvider.js`, `routes.js`, `adapter.js` (Core repo) — exact existing patterns the new Core-side code must match
