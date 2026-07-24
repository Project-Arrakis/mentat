# Discord → Steam → Character Linking — Design

## Overview

`/dune player link-steam` links a player's Discord account to their in-game
character via **Discord's own OAuth2 `connections` scope** — the player
authorizes the bot to read their linked third-party accounts (already
visible in Discord Settings → Connections), the bot reads any Steam
connections, matches the returned `SteamID64` against the game's own
`dune.accounts.platform_id` column, and resolves to the matching character(s).

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
[Architecture §Why This Wasn't Previously Possible](calculator-architecture.md)
— no, see the dedicated architecture doc's equivalent section, cross-linked
below.

## Problem Statement

The existing character-linking flow (`/dune data link <character-name>` →
in-game whisper code → `/dune data verify <code>` — see
[§Scope Addition](#scope-addition-new-dune-player-command-group-decided-during-design-review)
below for why these move to `/dune player` as part of this same feature)
requires the character to be **online** to receive the whisper. Players
who are offline, or whose whisper delivery fails for any reason, cannot
complete linking. Discord's `connections` OAuth scope offers a
whisper-free alternative: if a player has already linked Steam to their
Discord account (a one-time, native Discord Settings action, not something
the bot does), the bot can resolve their character(s) with zero in-game
round-trip.

This is **additive**, not a replacement. The existing whisper-based flow
(post-rename: `player:link`/`player:verify`/`player:unlink`) is untouched
in behavior and remains the default documented flow — only its command
group changes, from `data` to `player`, as part of this feature's scope.
Steam-linking is offered as a second, independent
path for players who have Steam connected in Discord already.

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

## Command Shape

```
/dune player link-steam
```

No parameters. The bot already knows the Discord user from the interaction
context; everything else is resolved via the OAuth flow this command kicks
off.

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

**Decision: split the 9 existing identity/linking subcommands (plus the
new `link-steam`) out of `data` into a new top-level `player` subcommand
group**, as part of this same feature's implementation. Discord's
top-level command has 8 of 25 subcommand-group slots used today
(`core`/`server`/`data`/`logs`/`ops`/`admin`/`infra`/`write`) — a 9th group
is well within the cap.

This is a **breaking rename** for every existing user's command habits:

| Old (removed) | New |
|---|---|
| `/dune data link <character>` | `/dune player link <character>` |
| `/dune data verify <code>` | `/dune player verify <code>` |
| `/dune data characters` | `/dune player characters` |
| `/dune data enable <character>` | `/dune player enable <character>` |
| `/dune data disable <character>` | `/dune player disable <character>` |
| `/dune data default <character>` | `/dune player default <character>` |
| `/dune data unlink <character>` | `/dune player unlink <character>` |
| `/dune data faction <name>` | `/dune player faction <name>` |
| `/dune data whoami` | `/dune player whoami` |
| *(new)* | `/dune player link-steam` |

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

1. Player runs `/dune player link-steam`.
2. Bot checks: does this Discord user already have a completed OAuth grant
   on file (see Architecture doc — grants are short-lived, not stored
   indefinitely)? If not, bot replies (ephemeral) with a **link button**
   (Discord's `ButtonBuilder` with `style: Link`) pointing to
   `GET {ACP_BASE_URL}/steam-link/start?state=<opaque>`, which itself
   redirects to Discord's OAuth authorize URL with `scope=identify connections`.
   This is a **new interaction-handling requirement**: no button/select-menu
   interaction handling exists anywhere in this codebase today (confirmed by
   direct search) — seeing this through requires adding a new
   `Events.InteractionCreate` branch for `MessageComponentInteraction`, not
   just extending the existing `ChatInputCommandInteraction` branch.
3. Player clicks the button, completes Discord's own consent screen (which
   shows exactly what's being requested: `identify`, `connections` — no
   Discord password or 2FA is ever seen by the bot, this is Discord's
   native OAuth consent page).
4. Discord redirects to `{ACP_BASE_URL}/steam-link/callback?code=...&state=...`.
   The bot's callback handler exchanges `code` for a token, calls
   `GET /users/@me/connections`, filters for `type === "steam"`, and for
   **each** returned Steam connection, queries the Core adapter for
   characters whose `platform_id` matches that Steam account's `id` field
   (Discord's connection `id` **is** the raw SteamID64 for Steam
   connections — confirmed via Discord's own Connection Object schema,
   `id: string — id of the connection account`).
5. **Zero matches:** callback page shows "No characters found for your
   linked Steam account(s). Make sure you're logged into the game with the
   same Steam account, or use `/dune player link <character-name>` instead."
6. **Exactly one match across all Steam accounts:** callback page shows a
   confirmation ("Link **PaulAtreides**?") with a **Confirm** button. On
   confirm, the bot writes the link and the interaction that started this
   (`/dune player link-steam`'s original ephemeral reply) is edited to show
   success — matching the existing `formatLinkEmbed()` success shape.
7. **Multiple matches (the common case given 1:N:N cardinality):** callback
   page shows a **list**, one row per character, each with its own
   Confirm-this-one button, grouped by which Steam account it came from if
   the player has more than one Steam connection linked. **Never
   auto-selects "the first one."** This directly implements the
   requirement surfaced by the cardinality correction — a player with two
   Steam accounts and three total characters across them must be able to
   pick exactly which one(s) to link, not have the bot guess.
8. Player can repeat step 7's selection multiple times in the same session
   to link more than one character (see
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

### Initial `/dune player link-steam` reply (ephemeral)

```
🔗 Link via Steam

Click below to connect your Discord's linked Steam account(s).
This uses Discord's own "Connections" feature — the bot never
sees your Discord password or any Steam credentials.

[ Sign in with Discord ]  (Link-style button, opens browser)

This link expires in 10 minutes. If it expires, just run this
command again.
```

### Callback page — multiple candidates found

```
🏜️ Choose Your Character(s)

Steam account "PaulA_76561198012345678":
  ○ PaulAtreides         [ Link this character ]
  ○ Muad'Dib             [ Link this character ]

Steam account "StilgarPlayer_76561198098765432":
  ○ Stilgar-Prime        [ Link this character ]

You can link more than one — just click each one you want.
```

### Callback page — zero candidates found

```
🏜️ No Characters Found

We checked your linked Steam account(s) but couldn't find a
matching character on this server.

- Make sure the Steam account you're logged into the game with
  is the same one linked in Discord Settings → Connections.
- If you're not sure, use /dune player link <character-name>
  instead — it works even without a Steam connection.
```

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

- No autocomplete needed — `/dune player link-steam` takes no parameters.
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
| OAuth `state` expired or invalid (player waited too long, or reused an old link) | Callback page: "This link has expired. Run `/dune player link-steam` again in Discord." |
| Player denies the OAuth consent screen | Discord redirects with an `error` query param; callback page: "Linking was cancelled. Run `/dune player link-steam` again if you'd like to try." |
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
- **Any change to the existing whisper-based `player:link`/`player:verify`
  flow's behavior, tables, or routes.** Only its command *group name*
  changes (`data` → `player`, per the Scope Addition above); everything
  else about how it works is untouched.

## Sources

- [Architecture](steam-link-architecture.md)
- [Security Review](steam-link-security-review.md)
- [GRC Review](steam-link-grc.md)
- [Implementation Prompt](steam-link-implementation-prompt.md)
- `docs/security/discord-player-link-hardening.md` (Core repo) — FINDING-LINK-6, the multi-account table and conflict-check this feature builds on
- Discord OAuth2 docs: https://discord.com/developers/docs/topics/oauth2 (verified 2026-07-24)
- Discord User Resource / Connection Object: https://discord.com/developers/docs/resources/user (verified 2026-07-24)
- Live schema verification against `dune-postgres` container, 2026-07-24 (see architecture doc for exact queries run)
