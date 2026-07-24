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

**IMPORTANT — read the revision note at the top of `docs/steam-link-design.md`
before starting.** This feature's design has been corrected twice. The
current, correct shape is: `/dune player link <character-name>` keeps its
`character` argument **required**, exactly as it was before this feature
existed. The bot decides server-side, based on whether the named
character already has a Steam ID on file, whether to send the existing
in-game whisper or offer a "Link via Steam" button — never both in the
same reply, and never based on whether the player typed something or not.
There is no candidate-selection list anywhere in this design — every
Steam-link session is scoped to exactly one, already-named character.

---

## PART 1: Core repo (`dune-awakening-selfhost-docker`)

### Task

Extend the existing character-link-start path to also report whether the
resolved character has a Steam ID on file, and add one new route to
complete a link via a Steam-ID match instead of a whisper code. Reuse
FINDING-LINK-6's existing schema and capability model exactly — see
`docs/security/discord-player-link-hardening.md` for that finding's full
history before touching any of this code.

### Files to modify

1. **`console/api/src/duneDb.js`** — find the existing function the
   whisper-link-start route calls to resolve a character by name and
   generate/send the verification code (search for `resolvePlayerByName`
   and the function that calls `publishCarePackageWhisper` — see
   `docs/changes/PR-0091-upstream-feedback-resolution.md` for the exact
   names and line references from when that flow was built). Extend its
   return shape (or wrap it) so that, in addition to whatever it already
   returns, the caller also learns whether this account has a Steam ID on
   file:

   ```js
   // matchSteamIdForCharacter: read-only check used by the Discord bot's
   // Steam-connections-based linking flow (see
   // yacketrj/Arrakis-Control-Panel:docs/steam-link-architecture.md).
   // Given ONE specific playerControllerId (already resolved and named by
   // the player -- this is never a bulk/candidate-list lookup) and the
   // array of SteamID64 strings Discord's own GET /users/@me/connections
   // returned for the linking Discord user, returns true if that
   // character's on-file platform_id appears anywhere in the array.
   //
   // Live-schema verification (2026-07-24, dune-postgres container):
   // dune.accounts is a view over encrypted_accounts (no unique
   // constraint on platform_id); joined via dune.player_state, itself a
   // view filtering encrypted_player_state for character_state = 'Active'.
   export async function matchSteamIdForCharacter(db, playerControllerId, steamId64List) {
     const ids = (Array.isArray(steamId64List) ? steamId64List : [])
       .map((value) => String(value || "").trim())
       .filter((value) => /^[0-9]{17}$/.test(value)); // SteamID64 is always 17 digits
     if (!ids.length || !playerControllerId) return false;
     const result = await db.query(`
       select 1
       from dune.accounts ac
       join dune.player_state ps on ps.account_id = ac.id
       where lower(coalesce(ac.platform_name, '')) = 'steam'
         and ac.platform_id = any($1::text[])
         and ps.player_controller_id::text = $2
       limit 1`, [ids, String(playerControllerId)]);
     return result.rows.length > 0;
   }

   // characterHasSteamId: read-only check used when a player first runs
   // /dune player link <character-name>, BEFORE any OAuth flow starts --
   // this is what decides whether the bot offers a "Link via Steam"
   // button at all, or falls straight to the existing whisper flow with
   // no mention of Steam. Separate from matchSteamIdForCharacter() above,
   // which runs LATER, after the player has completed OAuth, to check
   // whether their specific connected Steam account(s) actually match.
   export async function characterHasSteamId(db, playerControllerId) {
     if (!playerControllerId) return false;
     const result = await db.query(`
       select 1
       from dune.accounts ac
       join dune.player_state ps on ps.account_id = ac.id
       where ps.player_controller_id::text = $1
         and lower(coalesce(ac.platform_name, '')) = 'steam'
         and ac.platform_id is not null
         and ac.platform_id != ''
       limit 1`, [String(playerControllerId)]);
     return result.rows.length > 0;
   }
   ```

2. **Extend the existing whisper-link-start route/provider** (the one
   `players/link` currently calls) so its response includes
   `hasSteam: await characterHasSteamId(db, playerControllerId)` alongside
   whatever it already returns. **Behavior for characters with
   `hasSteam: false` must be byte-for-byte unchanged** — same whisper
   sent, same response shape plus this one new boolean field. For
   characters with `hasSteam: true`, the route must **still send the
   whisper as a fallback-in-waiting is NOT required here** — sending it
   immediately regardless would defeat the purpose of offering an instant
   Steam-link path. Confirm with the actual `linkAccountProvider()` /
   equivalent function's current code before deciding whether "send
   whisper" and "check hasSteam" naturally happen in the same DB round
   trip or need to be sequenced — do not send the whisper for
   `hasSteam: true` characters at this stage; only send it later, from the
   new route below, if the Steam match ultimately fails.

3. **`console/api/src/integrations/discord/multiAccountLinkProvider.js`** —
   add one new provider function, placed after `linkAccountProvider()`:

   ```js
   // linkAccountViaSteamProvider: the Steam-OAuth-based counterpart to
   // linkAccountProvider() above. Trusts that the CALLER (the Discord bot)
   // has already completed and verified a genuine Discord OAuth
   // authorization-code grant with the "connections" scope for this exact
   // discordUserId, AND already confirmed (via matchSteamIdForCharacter())
   // that the named character's on-file Steam ID appears in that grant's
   // connections list, before calling this function -- there is no
   // whisper/code verification step here, because Discord's own OAuth
   // consent screen IS the identity proof for this path. This function
   // performs NO OAuth verification and NO Steam-ID matching itself -- it
   // is the bot's responsibility to have already done both before this
   // route is ever called. Reuses linkAdditionalAccount() UNCHANGED, so
   // every existing conflict-check/uniqueness guarantee applies
   // identically to links created this way.
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

4. **`console/api/src/integrations/discord/adapter.js`** — add one new
   entry to `DISCORD_ADAPTER_ROUTES` (alongside the existing
   `PLAYERS_ACCOUNTS_*` entries):

   ```js
   PLAYERS_ACCOUNTS_LINK_STEAM: "/api/integrations/discord/players/accounts/link-steam"
   ```

   (Only one new route in this revision — the prior revision's
   `PLAYERS_ACCOUNTS_RESOLVE_STEAM` is no longer needed, since there is no
   candidate list to resolve. `matchSteamIdForCharacter()` is called
   directly inside the callback handling below, not exposed as its own
   route — the bot's `steamLinkServer.js` calls the Core adapter's
   existing `players-link` route shape isn't quite right either; add
   whichever thin route shape lets the bot pass `{ playerControllerId,
   steamId64List }` and get back `{ matched: boolean }`. Name it
   consistently with the existing route-naming convention, e.g.
   `PLAYERS_ACCOUNTS_MATCH_STEAM: "/api/integrations/discord/players/accounts/match-steam"`
   if a dedicated route is cleaner than folding the check into
   `link-steam` itself — implementer's choice, but document whichever is
   chosen in this file's own comments so a future reader isn't confused by
   this prompt describing two options.)

5. **`console/api/src/integrations/discord/routes.js`** — add the new
   route block(s) following the exact same shape as the existing
   `PLAYERS_ACCOUNTS_*` blocks: `readJson` → `validateDiscordActor` →
   `requireSelfScopedCapability(actor, mapping,
   DISCORD_CAPABILITIES.ACCOUNT_LINK_WRITE)` → call provider → `json(res,
   200, result)`. Both/all new routes POST, gated by the EXISTING
   `ACCOUNT_LINK_WRITE` capability — no new capability needed.

   Add `matchSteamIdForCharacter`/`characterHasSteamId` to the existing
   `duneDb.js` import list at the top of `routes.js`, and
   `linkAccountViaSteamProvider` to the existing
   `multiAccountLinkProvider.js` import list.

### Tests to add

1. **`console/api/test/duneDb.test.js`** — add tests for
   `characterHasSteamId()` and `matchSteamIdForCharacter()`:
   - `characterHasSteamId()` returns `true` for a character whose account
     has a non-empty `platform_id` and `platform_name = 'steam'`
     (case-insensitive), `false` otherwise.
   - `matchSteamIdForCharacter()` returns `true` when the character's
     on-file Steam ID appears anywhere in a multi-element
     `steamId64List` (not just as the first element) — this is the core
     cardinality case (a Discord user with multiple linked Steam
     accounts) this whole feature exists to handle correctly.
   - `matchSteamIdForCharacter()` returns `false` for a well-formed but
     non-matching `steamId64List`, and silently ignores malformed entries
     (wrong length, non-numeric) rather than throwing.
   - Both functions return `false` (not throw) for a missing/invalid
     `playerControllerId`.

2. **`console/api/test/discordMultiAccountLinkProvider.test.js`** — add
   tests for `linkAccountViaSteamProvider()`:
   - Successfully links when no conflict exists.
   - Rejects (propagates `linkAdditionalAccount`'s existing error) when the
     character is already linked to a different Discord user — reuse the
     exact same mock-db conflict scenario already used for
     `linkAccountProvider()`'s equivalent test.
   - Rejects with `invalid_request` if `discordUserId` or
     `playerControllerId` is missing/empty.
   - Does NOT generate or check any verification code — confirm no call is
     made to any whisper/rate-limiter function this test file's existing
     mocks would otherwise detect.

3. **`console/api/test/discordAdapter.test.js`** — add end-to-end
   integration tests for the new route(s), following the exact pattern
   already used for the existing `PLAYERS_ACCOUNTS_*` routes in this file:
   - A `public`-tier actor is rejected with `403 not_authorized` (or
     whatever the existing self-scoped rejection status/code is).
   - A link-via-Steam request against a mocked db that has no conflict
     succeeds and returns the updated account list.
   - A link-via-Steam request against a mocked db with an existing
     conflicting link (different Discord user) returns the same generic
     `character_already_linked` error the existing whisper-based flow
     returns — assert the error message contains no identifying detail
     about the conflicting Discord user (per Security Review
     FINDING-STEAM-3).
   - The existing `players/link` route's response now includes
     `hasSteam: true`/`false` correctly for characters with/without a
     Steam ID on file, with no other change to that route's existing
     response fields or whisper-sending behavior for `hasSteam: false`
     characters.

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
   // In-memory store (a plain Map, matching cooldown.js's own singleton
   // pattern) -- works in both single-tenant and multi-tenant mode
   // without requiring a SQLite db to be open.
   //
   // Each entry: { state, discordUserId, guildId, interactionToken,
   //   commandInteractionId, playerControllerId, characterName,
   //   createdAt, expiresAt, consumedAt }
   //
   // playerControllerId/characterName are the SPECIFIC character this
   // session is scoped to, captured at /dune player link <character-name>
   // time -- NOT a list to resolve candidates from. See Security Review
   // FINDING-STEAM-1/-2 for why this binding is a hard security
   // requirement, not just a convenience.
   //
   // consumedAt is set (not deleted) on first successful callback use --
   // keep the row around briefly for idempotent-retry detection, but
   // ALWAYS treat a non-null consumedAt as "reject this state" (Security
   // Review FINDING-STEAM-1, single-use enforcement).
   export function createSteamLinkSession({ discordUserId, guildId, interactionToken,
     commandInteractionId, playerControllerId, characterName }) { /* ... */ }
   export function getSteamLinkSession(state) { /* ... */ }
   export function consumeSteamLinkSession(state) { /* atomic check+mark */ }
   ```

   `state` generated via `randomBytes(16).toString("hex")`, matching
   `setupServer.js`'s existing generation pattern exactly.

2. **`src/steamLinkServer.js`** — the new Express app. Reuses
   `src/htmlEscape.js`'s `esc()` and `setupServer.js`'s dark/sand visual
   style constants.

   Routes:
   - `GET /steam-link/start?state=<state>` — validates the state exists
     and is unexpired, then redirects (`302`) to
     `https://discord.com/oauth2/authorize?response_type=code&client_id=...&redirect_uri=...&scope=identify%20connections&state=...`.
   - `GET /steam-link/callback?code=...&state=...&error=...` — the OAuth
     redirect target. Implements Security Review FINDING-STEAM-1 (state
     validation, single-use enforcement, resolving the target character
     **exclusively** from the stored session, never from any part of the
     request itself) before doing anything else. On success: exchanges
     `code` for a token, calls `GET
     https://discord.com/api/v10/users/@me/connections` with the bearer
     token, filters `type === "steam"`, extracts the array of connection
     `id` values (these ARE the raw SteamID64s), and calls the Core
     adapter's match-check route with `{ playerControllerId: <from the
     stored session>, steamId64List }`.
     - **Match found:** call the Core adapter's `linkAccountViaSteam()`.
       On success, render a simple success page (no confirmation step —
       see Design doc's "Why Auto-Fallback" section for the parallel
       reasoning on the no-match side; the match side needs no extra
       confirmation because completing OAuth already was the
       confirmation) and `editReply()` the original Discord interaction
       to show the standard link-success embed.
     - **No match:** trigger the whisper fallback now, using the
       `characterName`/`playerControllerId` already stored in the
       session (see Core-side Part 1 for the route this calls — reuse
       whatever the initial `/dune player link` request's whisper-sending
       path is, called directly rather than re-resolving the character by
       name from scratch). Render a page explaining a whisper was sent
       instead, and `editReply()` the original interaction to show the
       same "check your in-game whispers" instructions the
       `hasSteam: false` path shows directly.
     - **Character already linked to a different Discord user:** render
       the generic conflict message (Security Review FINDING-STEAM-3) and
       do **not** trigger any whisper fallback in this specific case.
     **Never logs or persists the access token** (Security Review
     FINDING-STEAM-6).

   There is no `POST /steam-link/select` route in this revision — remove
   it if migrating from the prior implementation. There is nothing for
   the player to select; the callback resolves directly to one of the
   three outcomes above.

   Started unconditionally in `src/index.js` (not gated behind
   `config.multiTenant`), on `config.steamLink.port` (default `3101`).

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
   in single-tenant mode). Per Security Review FINDING-STEAM-5, the bot
   must start normally with this unset; in that case, `player:link` must
   **never** show a "Link via Steam" button for any character, regardless
   of that character's `hasSteam` status — it always falls back to the
   whisper flow. Do not show an error message about missing configuration
   in this case; the whisper flow was never contingent on this secret and
   should not appear degraded to a player who never asked for the Steam
   path.

2. **`src/adapterClient.js`** — add:
   ```js
   linkAccountViaSteam(actor, playerControllerId, guildId) {
     return this.request("players-accounts-link-steam", actor, { playerControllerId }, guildId);
   }
   matchSteamCandidate(actor, playerControllerId, steamId64List, guildId) {
     return this.request("players-accounts-match-steam", actor, { playerControllerId, steamId64List }, guildId);
   }
   ```
   (Method/route names for the match-check call should match whichever
   naming choice was made on the Core side in Part 1 step 4 — keep both
   repos' naming consistent.) Add the corresponding route path/method
   entries to `config.js`'s `DEFAULT_PATHS`/`DEFAULT_METHODS` objects
   (both `POST`), following the exact existing naming convention.

   The existing `playerLinkStart()` method's response is now expected to
   include `hasSteam` and (when true) `playerControllerId` — no method
   signature change needed, just consume the new fields in `commands.js`.

3. **`src/commands.js`** — **no `SlashCommandBuilder` schema change** in
   this revision. The `character` option on `player:link` keeps
   `.setRequired(true)` exactly as it had before this feature (if a prior
   implementation attempt removed `.setRequired(true)`, restore it).

   Extend the existing `player:link` dispatch case:
   ```js
   } else if (key === "player:link") {
     const characterName = interaction.options.getString("character");
     const result = await adapterClient.playerLinkStart(actor, characterName, guildId);
     if (result?.hasSteam && config.steamLink?.enabled) {
       // Character has a Steam ID on file AND Steam linking is configured
       // on this server -- offer the instant path instead of the whisper
       // reply. (If hasSteam is true but steamLink is NOT enabled, fall
       // through to the normal whisper payload below -- see
       // FINDING-STEAM-5, this must degrade silently to whisper-only.)
       const session = createSteamLinkSession({
         discordUserId: interaction.user?.id,
         guildId,
         interactionToken: interaction.token,
         commandInteractionId: interaction.id,
         playerControllerId: result.playerControllerId,
         characterName
       });
       const startUrl = `${config.steamLink.baseUrl}/steam-link/start?state=${session.state}`;
       const row = new ActionRowBuilder().addComponents(
         new ButtonBuilder().setLabel("Link via Steam").setStyle(ButtonStyle.Link).setURL(startUrl)
       );
       await interaction.editReply({
         content: `**${characterName}** is linked to a Steam account. Click below to verify instantly ` +
           "using your Discord's connected Steam account -- no in-game whisper needed. This link expires in 10 minutes.",
         components: [row]
       });
       applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
       return true;
     }
     // No Steam ID on file, or Steam linking not configured on this
     // server -- existing whisper-code flow, UNCHANGED response shape.
     payload = result;
   } else if (key === "player:verify") {
   ```

   Import `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle` from
   `discord.js` at the top of the file (new imports — confirm these
   aren't already imported before adding). Also import
   `createSteamLinkSession` from `./steamLinkStore.js`.

   **Known implementation bugs to avoid** (found and fixed during a prior
   implementation pass of an earlier revision of this design — still
   applicable to this revision's code, do not rediscover these):
   - **Embed color:** use the exact hex `0x2ECC71` for a Steam-link
     success embed, matching `embedFormat.js`'s existing
     `DUNE_COLORS.success` constant.
   - **Field naming on the link result:** the Core adapter's
     `linkAccountViaSteam()` response's `accounts` array entries use
     **snake_case** (`character_name`, `player_controller_id`). Do not
     index the result array by position (`accounts[0]`) — use
     `.find(a => a.player_controller_id === playerControllerId)` against
     the `playerControllerId` the session was scoped to.
   - **No `Authorization` header on the webhook-edit PATCH call:** when
     completing the flow via `PATCH
     /webhooks/{application.id}/{interaction.token}/messages/@original`,
     do not add an `Authorization: Bot <token>` header — this endpoint
     authenticates via the interaction token embedded in the URL path
     itself.
   - **Use the injectable `fetchImpl` parameter, not the global `fetch`,**
     for every outbound HTTP call in `steamLinkServer.js` (Discord token
     exchange, `connections` fetch, webhook-edit PATCH, and the Core
     adapter calls) — a prior pass found one call site hardcoded to the
     global `fetch` instead of the constructor-injected `fetchImpl` every
     other call site correctly used.

4. **`src/index.js`** — add a new `MessageComponentInteraction` branch to
   the existing `Events.InteractionCreate` handler (defensive; the
   Link-style button itself needs no bot-side handler since Discord opens
   it directly, but this closes the "no component handling exists at all"
   gap generally):
   ```js
   client.on(Events.InteractionCreate, async (interaction) => {
     try {
       if (interaction.isMessageComponent?.()) {
         return;
       }
       await executeDuneCommand(interaction, adapterClient, config, db);
     } catch (error) {
       logError("discord.interaction_failed", error);
     }
   });
   ```

5. **`src/index.js`** — start `steamLinkServer` unconditionally (not
   inside the `if (config.multiTenant)` block that starts `setupServer`):
   ```js
   const steamLinkApp = createSteamLinkServer({ config, adapterClient, client });
   steamLinkApp.listen(config.steamLink.port, () => {
     logInfo("steam_link_server.started", { port: config.steamLink.port, enabled: config.steamLink.enabled });
   });
   ```

6. **`docs/user-guide.md`** — update the "Linking Your Character"
   walkthrough and command table to describe the corrected flow: running
   `/dune player link <character-name>` either sends a whisper (as
   always) or shows a "Link via Steam" button, decided automatically by
   the bot — not by anything the player does differently. Remove any
   prior wording suggesting an optional argument or a "run the command
   with nothing after it" alternative path.

### Files to add (tests)

**`test/steamLinkServer.test.js`** — new. Must cover, at minimum:
- `state` validation: missing, expired, and already-consumed `state`
  values are all rejected with a clear error page (FINDING-STEAM-1).
- The callback's Steam-ID match check always uses the `playerControllerId`
  stored against the `state`'s own session, never a value from anywhere
  else in the request, even if one happens to be present (FINDING-STEAM-2).
- Match-found path: mocked Discord token-exchange, mocked `connections`
  response containing the matching Steam ID, mocked Core adapter success
  response — results in the success page and an `editReply()` call
  showing the standard link-success embed.
- No-match path: mocked `connections` response with no matching Steam
  ID — results in the whisper-fallback being triggered (assert the
  correct Core route/function was called with the session's stored
  character) and the "sent a whisper instead" page.
- Conflict path: mocked Core response indicating the character is already
  linked to a different Discord user — asserts the generic conflict
  message (no identifying detail, FINDING-STEAM-3) AND asserts the
  whisper fallback is NOT triggered in this specific case.
- The bot's HTTP server starts successfully and, with
  `DISCORD_CLIENT_SECRET` unset, `/dune player link <character>` never
  offers a Steam button for any character (FINDING-STEAM-5) — do not skip
  this test, it's the one proving backward compatibility for existing
  single-tenant deployments.
- No log line at any level contains a raw OAuth access token or refresh
  token value, even in an injected-error scenario (FINDING-STEAM-6).

**`test/discord-bot-test-harness.js`** — extend the existing "Command
Execution" suite with two `player:link` cases: one for a character with
`hasSteam: false` (asserting the existing whisper-flow reply, byte-for-byte
unchanged from before this feature), and one for a character with
`hasSteam: true` (asserting the Steam-button reply appears instead, with
no whisper text present in that reply).

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
  new route(s) existing.

## Sources

- `docs/steam-link-design.md`
- `docs/steam-link-architecture.md`
- `docs/steam-link-security-review.md`
- `docs/steam-link-grc.md`
- `docs/security/discord-player-link-hardening.md` (Core repo)
- `src/setupServer.js`, `src/database.js` — existing OAuth pattern this feature extends
- `console/api/src/integrations/discord/multiAccountLinkProvider.js`, `routes.js`, `adapter.js` (Core repo) — exact existing patterns the new Core-side code must match
