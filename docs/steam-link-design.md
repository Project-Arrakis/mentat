# Discord → Steam → Character Linking — Design

**Revision note (2026-07-24):** the original version of this document
proposed `/dune player link-steam` as a separate command alongside the
existing `/dune player link <character>`. During implementation, this was
reconsidered and merged: `/dune player link`'s `character` argument is now
**optional**. Provide it to use the existing whisper flow directly (no
change in behavior); omit it to trigger the Steam-connections flow this
document describes. See [§Unified Command Design](#unified-command-design-revised)
below for the full rationale — this was a deliberate correction, not a
minor edit, and is called out explicitly because the four-role design
review that produced the original version did not catch it on its own; a
direct follow-up question surfaced it. `link-steam` no longer exists as its
own command anywhere in this document or the implementation.

## Overview

`/dune player link` (with no `character` argument) links a player's Discord
account to their in-game character via **Discord's own OAuth2
`connections` scope** — the player authorizes the bot to read their linked
third-party accounts (already visible in Discord Settings → Connections),
the bot reads any Steam connections, matches the returned `SteamID64`
against the game's own `dune.accounts.platform_id` column, and resolves to
the matching character(s).

**v1 scope is Discord-connections-only.** A Steam OpenID fallback (for
players who don't want to link Steam↔Discord natively) is explicitly
deferred — see [§Non-Goals](#explicit-non-goals-v1) and the companion
architecture doc's rationale for why both paths need the same new piece of
infrastructure (a public HTTPS OAuth callback) regardless, so deferring the
fallback defers a *second code path*, not the infrastructure itself.

This supersedes prior guidance that Steam-based Discord linking was
infeasible for this bot. That conclusion was correct for a different
problem (the bot independently verifying a Steam-ownership claim with no
web surface) — it does not apply once the *user's own Discord OAuth grant*
does the identity verification for us, which requires no independent
Steam-ownership proof from the bot at all. See
[Architecture §Why This Wasn't Previously Possible](steam-link-architecture.md#why-this-wasnt-previously-possible-and-what-changed)
for the full reasoning.

## Problem Statement

The existing character-linking flow (`/dune data link <character-name>` →
in-game whisper code → `/dune data verify <code>` — see
[§Scope Addition](#scope-addition-new-dune-player-command-group-decided-during-design-review)
below for why these move to `/dune player` as part of this same feature)
requires the character to be **online** to receive the whisper, AND
requires the player to already know and type their character's exact
name. Players who are offline, or whose whisper delivery fails for any
reason, cannot complete linking that way. Discord's `connections` OAuth
scope offers an alternative that solves both problems at once: if a player
has already linked Steam to their Discord account (a one-time, native
Discord Settings action, not something the bot does), the bot can resolve
their character(s) with zero in-game round-trip AND with no need for the
player to type a name at all — the bot already knows every character
reachable from their Steam identity.

This is **additive to the underlying whisper mechanism**, not a
replacement — `player:verify`'s whisper-code consumption is untouched. But
per the Unified Command Design below, it is **not** a separate entry point
from the player's perspective: `/dune player link` is the single command
for "link my Discord to my character," and it picks the right mechanism
based on whether a character name was provided.

## Unified Command Design (Revised)

The original design (see the revision note at the top of this document)
proposed `link-steam` as its own command. This was corrected after
implementation-time review surfaced that it created an unnecessary second
entry point for a single user intent ("link my Discord to my character"),
and that the *original* whisper flow already had its own unaddressed UX
gap: a player must already know their exact in-game character name to use
it at all, with no way to ask the bot "which characters could even be
mine?"

**Revised command:**

```
/dune player link [character:<optional string>]
```

Dispatch logic inside `executeDuneCommand()`:

```
if character argument IS provided:
    → existing whisper flow, UNCHANGED (resolvePlayerByName, pending code, whisper delivery)
if character argument is NOT provided:
    → Steam-connections flow (this document's main subject)
```

This means a player who already knows their character name keeps the
exact same fast path they have today (`/dune player link PaulAtreides`).
A player who doesn't want to type a name, doesn't remember it exactly, or
whose character is offline, just runs `/dune player link` with nothing
after it, and the bot figures out the rest from their Discord-linked Steam
account(s).

### Three-Case Resolution (After the Player Completes Discord OAuth Consent)

Once the player has clicked "Sign in with Discord" and approved the
`identify`/`connections` scopes (this step cannot be skipped or checked in
advance — see [§Why a Web Callback Page](#why-a-web-callback-page-not-a-discord-native-confirmation)
for why Discord requires this to be a real browser redirect, not something
the bot can pre-check silently), the callback resolves to exactly one of
three cases:

1. **No Steam connection linked in Discord at all** (`connections` scope
   returns zero `type === "steam"` entries) — distinct error: "no Steam
   connection found, link one in Discord Settings → Connections, or use
   `/dune player link <character-name>` instead."
2. **Steam connection(s) found, zero matching characters on this server**
   (the Core adapter's `resolveCharactersBySteamId64()` returns an empty
   candidate list for every linked Steam ID) — a **different**, more
   specific error naming the actual server (see
   [§Server Name in Error Messages](#server-name-in-error-messages)):
   "couldn't find a matching character on **{server name}** — make sure
   you're logged into the game with the same Steam account." These two
   error cases are kept **distinct on purpose** — they point at different
   fixes (link Steam in Discord vs. log into the game with the right Steam
   account), and collapsing them into one generic message would leave the
   player guessing which fix applies to them.
3. **One or more matching characters found** — this is a single
   unified branch regardless of whether the matches came from one Steam
   account or several, and regardless of whether one Steam account
   contributed one or several characters (see the cardinality section
   above: 1:N:N means "single Steam connection" does NOT imply "single
   character"). **Any time the total candidate count is exactly 1, the bot
   links it directly with a lightweight confirmation; any time it's greater
   than 1, the bot always shows the full selection list — it never
   auto-picks "the most recent" or "the first" character when real
   ambiguity exists,** whether that ambiguity comes from multiple Steam
   accounts, multiple characters under one Steam account, or both at once.

This resolves cleanly to your original three-case framing (single
connection → show the one match; multiple connections → show a list; no
connection → show the "link Steam first" error) while additionally
handling the case that framing didn't explicitly cover: a *single* Steam
connection that itself has more than one character. Per the earlier
cardinality correction, this is not a hypothetical — the database schema
has no constraint preventing it.

### Server Name in Error Messages

The "no matching character" error (case 2 above) names the actual game
server, rather than saying "this server" — relevant for players who might
be in Discord with more than one Dune server community, where they may
have a real character on a *different* server than the one they just tried
`/dune player link` on. Resolved via the same `adapterClient.status()` call
`server:status`/`sendStatusCard()` already use for `statusData.title` — a
best-effort lookup that falls back to a generic "this server" phrase if the
status call itself fails, so a transient status-lookup issue never blocks
the (already-determined) "no characters found" response from rendering.

## Corrected Cardinality (Load-Bearing Fact)

Verified directly against the live schema and Discord's own API docs
(not assumed):

```
1 Discord user ──< N Steam accounts   (GET /users/@me/connections returns an array;
                                        Discord allows linking more than one Steam
                                        account to a single Discord account)
1 Steam account ──< N characters      (dune.encrypted_player_state.account_id is a
                                        non-unique foreign key to encrypted_accounts;
                                        no schema constraint limits one Steam-linked
                                        game account to one character)
```

**Net: Discord user → Steam account(s) → character(s) is 1:N:N, not 1:1.**
Every part of this design — the selection UI, the link table shape, and the
conflict-check logic — is built around this, not around a simplifying "one
Steam account, one character" assumption that the schema does not actually
enforce.

### Scope Addition: New `/dune player` Command Group (Decided During Design Review)

While designing this feature's command placement, a related structural gap
was surfaced and decided: the existing `data` subcommand group has grown to
**15 of Discord's 25-per-group hard cap** by mixing three genuinely
different concerns — player identity/linking (9 subcommands: `link`,
`verify`, `characters`, `enable`, `disable`, `default`, `unlink`,
`faction`, `whoami`), inventory/storage (3: `inventory`, `storage`,
`find`), and server/world data (3: `population`, `backups`, `maps`).
Adding `link-steam` as a 16th `data` subcommand would still fit
numerically, but would deepen an already-crowded, conceptually-mixed group.

**Decision: split the 9 existing identity/linking subcommands out of
`data` into a new top-level `player` subcommand group**, as part of this
same feature's implementation. Discord's top-level command has 8 of 25
subcommand-group slots used today
(`core`/`server`/`data`/`logs`/`ops`/`admin`/`infra`/`write`) — a 9th group
is well within the cap. (Note: `link-steam` does NOT become a 10th
subcommand here — per the Unified Command Design revision above, the
Steam-connections flow is reached through `player:link` itself, via an
optional argument, not a separate subcommand name.)

This is a **breaking rename** for every existing user's command habits:

| Old (removed) | New |
|---|---|
| `/dune data link <character>` | `/dune player link [character]` — `character` is now OPTIONAL; provided = whisper flow (unchanged), omitted = Steam-connections flow (new) |
| `/dune data verify <code>` | `/dune player verify <code>` |
| `/dune data characters` | `/dune player characters` |
| `/dune data enable <character>` | `/dune player enable <character>` |
| `/dune data disable <character>` | `/dune player disable <character>` |
| `/dune data default <character>` | `/dune player default <character>` |
| `/dune data unlink <character>` | `/dune player unlink <character>` |
| `/dune data faction <name>` | `/dune player faction <name>` |
| `/dune data whoami` | `/dune player whoami` |

`data` retains exactly `population`, `backups`, `maps`, `inventory`,
`storage`, `find` (6 subcommands) — a coherent "server/world data and my
stuff" group with substantial headroom for future growth, matching the
group's own description text ("Server population, backups, map, inventory,
and storage") far more accurately than it did with 9 identity commands
mixed in.

This rename must be:
1. Documented prominently in the implementation PR's description and
   change note (not buried) — this breaks muscle memory for any existing
   server that has this bot installed.
2. Reflected in `docs/user-guide.md`'s command tables and the "Linking
   Your Character" walkthrough section in full (not partially).
3. Discord's own slash-command re-registration (`commandDefinitions()` /
   whatever deployment step pushes command definitions to Discord's API)
   picks this up automatically the next time commands are re-registered —
   no special migration step is needed on Discord's side beyond a normal
   command-definition push, since old command names simply cease to exist
   and new ones are registered in their place.

### Flow

1. Player runs `/dune player link` — **with no `character` argument**. (If
   a `character` argument is provided, none of the rest of this section
   applies — the bot uses the existing, unchanged whisper flow instead.)
2. Bot replies (ephemeral) with a **link button** (Discord's
   `ButtonBuilder` with `style: Link`) pointing to
   `GET {ACP_STEAM_LINK_BASE_URL}/steam-link/start?state=<opaque>`, which
   itself redirects to Discord's OAuth authorize URL with
   `scope=identify connections`. This is a **new interaction-handling
   requirement**: no button/select-menu interaction handling existed
   anywhere in this codebase before this feature (confirmed by direct
   search) — this requires a new `Events.InteractionCreate` branch for
   `MessageComponentInteraction`, not just extending the existing
   `ChatInputCommandInteraction` branch.
3. Player clicks the button, completes Discord's own consent screen (which
   shows exactly what's being requested: `identify`, `connections` — no
   Discord password or 2FA is ever seen by the bot, this is Discord's
   native OAuth consent page). This step cannot be skipped, pre-checked, or
   short-circuited — Discord only exposes a user's connections after that
   specific user completes this consent screen; there is no way for the
   bot to "peek" at connections ahead of time with just a bot token.
4. Discord redirects to
   `{ACP_STEAM_LINK_BASE_URL}/steam-link/callback?code=...&state=...`. The
   bot's callback handler exchanges `code` for a token, calls
   `GET /users/@me/connections`, and filters for `type === "steam"`.
5. **Case 1 — no Steam connections at all:** callback page shows "No Steam
   connection found in your Discord account. Add one in Discord Settings →
   Connections, or use `/dune player link <character-name>` instead." This
   is a distinct error from Case 2 below on purpose — it points at a
   different fix (link Steam in Discord, not log into the right game
   account).
6. For every Steam connection found, the bot queries the Core adapter for
   characters whose `platform_id` matches that Steam account's `id` field
   (Discord's connection `id` **is** the raw SteamID64 for Steam
   connections — confirmed via Discord's own Connection Object schema,
   `id: string — id of the connection account`), across **all** linked
   Steam connections at once, not just the first one found.
7. **Case 2 — Steam connection(s) found, but zero matching characters
   anywhere:** callback page shows "We checked your linked Steam
   account(s) but couldn't find a matching character on **{server
   name}**" (the actual game server's display name, resolved via
   `adapterClient.status()` — see
   [§Server Name in Error Messages](#server-name-in-error-messages) — not
   a generic "this server" unless that lookup itself fails). "Make sure
   the Steam account you're logged into the game with is the same one
   linked in Discord Settings → Connections, or use
   `/dune player link <character-name>` instead."
8. **Case 3 — one or more matching characters found:** if the total
   candidate count across all Steam connections is exactly 1, the callback
   page shows a lightweight confirmation for that one character. If it's
   greater than 1 — whether from multiple Steam connections, multiple
   characters under one Steam connection, or both — the callback page
   shows the **full selection list**, grouped by which Steam account each
   character came from. **Never auto-selects "the first one" or "the most
   recently active one" whenever real ambiguity exists.** This directly
   implements the requirement surfaced by the corrected cardinality — a
   player with two Steam accounts and three total characters across them
   must be able to pick exactly which one(s) to link, not have the bot
   guess; the same is true even for a single Steam account with two
   characters under it.
9. On confirming a character (single-match case) or clicking a specific
   row's confirm button (list case), the bot writes the link and the
   interaction that started this (`/dune player link`'s original ephemeral
   reply) is edited to show success — matching the existing
   `formatLinkEmbed()` success shape.
10. Player can repeat step 8's selection multiple times in the same
    session to link more than one character (see
    [§Multi-Character Linking](#multi-character-linking-reusing-finding-link-6) below) —
    each selection is its own explicit confirm action, never a bulk "link
    all" default.

### Why a Web Callback Page, Not a Discord-Native Confirmation

Discord's OAuth redirect **must** land on a real HTTP page (that's the
`redirect_uri`) before the bot can act on anything — there is no way to
short-circuit that back into a pure Discord interaction. The callback page
itself is deliberately minimal (reuses `setupServer.js`'s existing
esc()-based HTML templating and dark/sand visual style for consistency, not
a new design system) and its **only** required action is presenting the
candidate list and letting the player confirm — everything else (the actual
write) happens server-side, authenticated by the same `state` token that
tied this callback back to the original Discord interaction.

## Response Shapes

### Initial `/dune player link` (no character argument) reply (ephemeral)

```
🔗 Link via Steam

Click below to connect your Discord's linked Steam account(s).
This uses Discord's own "Connections" feature — the bot never
sees your Discord password or any Steam credentials.

[ Sign in with Discord ]  (Link-style button, opens browser)

This link expires in 10 minutes. If it expires, just run this
command again.
```

### Callback page — Case 1: no Steam connection linked at all

```
🏜️ No Steam Connection Found

No Steam connection found in your Discord account. Add one in
Discord Settings → Connections, or use
/dune player link <character-name> instead.
```

### Callback page — Case 2: Steam connection(s) found, zero matching characters

```
🏜️ No Characters Found

We checked your linked Steam account(s) but couldn't find a
matching character on Tabr-Tau.

- Make sure the Steam account you're logged into the game with
  is the same one linked in Discord Settings → Connections.
- If you're not sure, use /dune player link <character-name>
  instead — it works even without a Steam connection.
```

("Tabr-Tau" here is the actual game server's own display name, resolved
live — not a placeholder string the bot would ever literally send. See
[§Server Name in Error Messages](#server-name-in-error-messages).)

### Callback page — Case 3a: exactly one match (no list needed)

```
🔗 Link This Character?

PaulAtreides

[ Confirm Link ]
```

### Callback page — Case 3b: more than one match (list, grouped by Steam account)

```
🏜️ Choose Your Character(s)

Steam account "PaulA_76561198012345678":
  ○ PaulAtreides         [ Link this character ]
  ○ Muad'Dib             [ Link this character ]

Steam account "StilgarPlayer_76561198098765432":
  ○ Stilgar-Prime        [ Link this character ]

You can link more than one — just click each one you want.
```

This exact shape also covers the case of a SINGLE Steam account
contributing more than one character (e.g. only "PaulA_76561198012345678"
is linked, but it has both PaulAtreides and Muad'Dib) — the "more than one
candidate → always show the list" rule applies regardless of how many
distinct Steam accounts contributed the candidates.

### Success (both the callback page AND the original Discord ephemeral reply update)

Matches the existing `formatLinkEmbed()` shape exactly — same title, same
color, same "Linked as **X**" phrasing — so a player linking via Steam sees
a visually identical confirmation to a player linking via the whisper flow.
No new embed format needed for the success case; only the *path to get
there* differs.

## Multi-Character Linking (Reusing FINDING-LINK-6)

This feature is designed to link into the **existing** `console.discord_account_links`
multi-account table (FINDING-LINK-6, already implemented server-side, not
yet bot-integrated) rather than the older single-link `console.discord_player_links`
table. Reasons:

- `discord_account_links` already supports N characters per Discord user —
  exactly the cardinality this feature needs. The single-link table's
  `UNIQUE(discord_user_id)`-style constraint (one link, ever, silently
  overwritten on re-link) is structurally wrong for a feature whose entire
  premise is "you might have more than one."
- FINDING-LINK-6's cross-table conflict check (`otherTableLinkConflict()`)
  already guards against a character being claimed by two different Discord
  users regardless of which of the two tables the claim comes through — this
  feature inherits that protection for free by using the same table, with no
  new conflict-check code needed on the Core side.
- FINDING-LINK-6's routes (`/players/accounts/link`, `/players/accounts/link/verify`,
  etc.) already exist server-side but have **zero bot-side integration**
  today (documented as an open item in
  `docs/security/discord-player-link-hardening.md`). This feature is the
  first real consumer of those routes — closing that long-standing gap is a
  side effect of building this, not a separate task.

**Important distinction from FINDING-LINK-6's original verification
design:** the existing `linkAccountProvider()` still requires an **online,
whisper-delivered code** for each additional character — it was designed
before this Steam-linking feature existed. Steam-linking needs a
**parallel verification path** that trusts Discord's OAuth grant instead of
an in-game whisper. See the architecture doc for the new
`linkAccountViaSteamProvider()` this requires on the Core side — it reuses
`discord_account_links`'s schema and `otherTableLinkConflict()` check, but
calls a different, new verification function, not the whisper-based one.

## Autocomplete / UI Details

- No autocomplete needed for the Steam-connections flow itself (it takes no
  new parameters — it's reached via `player:link`'s existing, optional
  `character` argument simply being omitted).
- The Link-style button (`ButtonStyle.Link`) requires no interaction
  response beyond opening the URL in the player's browser — Discord
  handles this natively, no bot-side click handler needed for that specific
  button.
- The **candidate-selection buttons on the web callback page** are plain
  HTML `<button>` elements posting to the callback service (not Discord
  components) — the selection happens on the web page, not back inside
  Discord, because that's where the OAuth-derived candidate list already
  lives. After a successful selection, the bot proactively edits the
  original Discord ephemeral reply (via `interaction.editReply()`, using
  the stored interaction token) to reflect the result — this is the one
  place a background process pushes an update into a Discord interaction
  after its initial reply, which `discord.js` supports for up to 15 minutes
  after the original interaction.

## Error UX

| Condition | Response |
|---|---|
| OAuth `state` expired or invalid (player waited too long, or reused an old link) | Callback page: "This link has expired. Run `/dune player link` again in Discord." |
| Player denies the OAuth consent screen | Discord redirects with an `error` query param; callback page: "Linking was cancelled. Run `/dune player link` again if you'd like to try." |
| No Steam connections found at all (player has Discord connected accounts but none are Steam) | "No Steam connection found in your Discord account. Add one in Discord Settings → Connections, or use `/dune player link <character-name>` instead." |
| Steam connection found, zero character matches | See zero-candidates response above. |
| Character already linked to a different Discord user (cross-table conflict) | Callback page shows that specific row as "Already linked to another Discord account" (not which account — no cross-user information disclosure), button disabled for that row only; other rows remain selectable. |
| Rate limit exceeded (see security doc) | Callback page: "Too many attempts. Try again in a few minutes." |

## Explicit Non-Goals (v1)

- **Steam OpenID fallback** — deferred. If a player doesn't want to link
  Steam↔Discord natively (privacy preference), they have no Steam-based
  path in v1; they use the existing whisper flow. Revisit only if this
  becomes a real, observed support request, not speculatively.
- **Unlinking via the web callback page** — unlinking remains exclusively a
  Discord-side action (`/dune player unlink`, `/dune player disable`), matching
  the existing FINDING-LINK-6 command surface. The web page only ever adds
  links, never removes them.
- **Auto re-sync** — once linked, a character's link is not automatically
  re-verified if the player's Steam connection is later removed from
  Discord. This matches the existing whisper flow's behavior (a completed
  link persists until explicitly unlinked) and is a deliberate consistency
  choice, not an oversight.
- **Any change to the existing whisper-based flow's internal behavior,
  tables, or routes.** `player:verify`'s whisper-code consumption is
  completely untouched. Two things about `player:link` DO change relative
  to the pre-feature `data:link`: its command group (`data` → `player`,
  per the Scope Addition above) and its `character` argument becoming
  optional (per the Unified Command Design revision above) — but providing
  a character name still produces byte-for-byte the same behavior as
  before.

## Sources

- [Architecture](steam-link-architecture.md)
- [Security Review](steam-link-security-review.md)
- [GRC Review](steam-link-grc.md)
- [Implementation Prompt](steam-link-implementation-prompt.md)
- `docs/security/discord-player-link-hardening.md` (Core repo) — FINDING-LINK-6, the multi-account table and conflict-check this feature builds on
- Discord OAuth2 docs: https://discord.com/developers/docs/topics/oauth2 (verified 2026-07-24)
- Discord User Resource / Connection Object: https://discord.com/developers/docs/resources/user (verified 2026-07-24)
- Live schema verification against `dune-postgres` container, 2026-07-24 (see architecture doc for exact queries run)
