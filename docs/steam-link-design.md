# Discord → Steam → Character Linking — Design

**Revision note (2026-07-24, second revision):** this document has now been
corrected twice. The **first** revision merged a proposed separate
`/dune player link-steam` command into `/dune player link`'s `character`
argument becoming *optional* (omit it to trigger a Steam-connections
flow). That design shipped in an initial implementation, but direct user
feedback surfaced a real UX problem with it: **omitting an argument is not
a discoverable UI signal.** Discord's slash-command autocomplete shows the
`character` option as available the whole time a player is typing: nearly
every player will type a name out of habit and never discover that leaving
it blank does something completely different. A hidden behavior reachable
only by *not* typing something is a bad command surface, full stop.

**This second revision corrects that:** `character` is **required again**,
exactly as it was before this feature existed. The choice of whisper vs.
Steam is no longer made by what the player types — it's made **entirely by
the backend**, based on data it already has, and shown to the player as
**one deterministic outcome**, never a choice between two competing
instruction sets in the same reply. See
[§Unified Command Design](#unified-command-design-second-revision) below
for the full mechanics. `link-steam` still does not exist as its own
command anywhere in this document or the implementation — that part of the
original correction stands.

## Overview

`/dune player link <character-name>` — unchanged command surface, exactly
as it existed before this feature — now does one additional thing
server-side before deciding how to respond: it checks whether the named
character's account already has a Steam ID on file
(`dune.accounts.platform_name = 'steam'`). If it does, the bot offers to
complete the link **instantly via Discord's own OAuth2 `connections`
scope** instead of the in-game whisper. If it doesn't, nothing changes —
the player sees exactly the same whisper-code reply they always have.

**v1 scope is Discord-connections-only.** A Steam OpenID fallback (for
players who don't want to link Steam↔Discord natively) is explicitly
deferred — see [§Non-Goals](#explicit-non-goals-v1).

This supersedes prior guidance that Steam-based Discord linking was
infeasible for this bot. That conclusion was correct for a different
problem (the bot independently verifying a Steam-ownership claim with no
web surface) — it does not apply once the *user's own Discord OAuth grant*
does the identity verification for us, which requires no independent
Steam-ownership proof from the bot at all. See
[Architecture §Why This Wasn't Previously Possible](steam-link-architecture.md#why-this-wasnt-previously-possible-and-what-changed)
for the full reasoning.

## Problem Statement

The existing character-linking flow (`/dune player link <character-name>`
→ in-game whisper code → `/dune player verify <code>`) requires the
character to be **online** to receive the whisper. Players who are
offline, or whose whisper delivery fails for any reason, cannot complete
linking that way — even though many of those players already did a
one-time, native Discord action (linking Steam to their Discord account in
Discord's own Settings) that could prove the same thing instantly, with no
in-game round-trip at all.

**Important constraint this revision is built around:** the bot cannot
silently check whether a Discord user has authorized *this bot specifically*
to read their Steam connection. Discord's `connections` OAuth scope
requires a live, user-initiated consent redirect **every time a new app
requests it for the first time** — there is no bot-token lookup, no cached
check, no way to "peek" ahead of time. The player having already linked
Steam to Discord natively is necessary but not sufficient; granting *this
bot* permission to read that fact is a separate, unavoidable step. This
single fact is why the design below still requires exactly one click
through Discord's own consent screen for the Steam path — it is a platform
requirement, not a design choice, and no version of this feature can
remove it.

This is **additive to the underlying whisper mechanism**, not a
replacement — `player:verify`'s whisper-code consumption is untouched for
every character that doesn't have a Steam ID on file.

## Unified Command Design (Second Revision)

**Command surface (unchanged from before this feature existed):**

```
/dune player link character:<required string>
```

There is no optional argument, no hidden branch reachable by omission, and
no separate command. The player always names their character, exactly as
today. Everything else happens **after** that, server-side, invisibly to
the player until the bot has already decided which single path to show
them.

**Dispatch logic inside `executeDuneCommand()`:**

```
1. Resolve the named character (existing logic, unchanged).
2. Ask Core: does this character's account have a Steam ID on file?
   a. NO  -> send the whisper exactly as today. Show the existing
             "check your in-game whispers" reply. (Byte-for-byte
             unchanged behavior and response shape.)
   b. YES -> do NOT send a whisper. Show a reply with ONLY a
             "Link via Steam" button. No whisper text anywhere in
             this reply.
```

The player is never shown both a whisper instruction and a Steam button in
the same message — the backend has already determined, before generating
any reply at all, which single path applies to this specific character.
This directly avoids the confusion of presenting two different sets of
instructions and asking the player to guess which one is "for them."

### Handling Multiple Steam Accounts and Multiple Characters (Cardinality)

The live-schema/API cardinality fact from the original design still holds
and still matters, but it now resolves far more simply because a specific
character is always named up front:

```
1 Discord user ──< N Steam accounts   (GET /users/@me/connections returns an array;
                                        Discord allows linking more than one Steam
                                        account to a single Discord account)
1 Steam account ──< N characters      (dune.encrypted_player_state.account_id is a
                                        non-unique foreign key to encrypted_accounts;
                                        no schema constraint limits one Steam-linked
                                        game account to one character)
```

**Multiple Steam accounts on one Discord user:** when the OAuth callback
completes, the bot has an *array* of Steam connections (Discord's
`GET /users/@me/connections` response, filtered to `type === "steam"`).
The match check is: does the **named character's** on-file Steam ID appear
**anywhere in that array**, not just as the first or only entry? A player
with three linked Steam accounts and a character tied to the third one
still matches correctly.

**Multiple characters under one Steam account:** does not need any special
handling in this flow at all, because the player already told the bot
which character they mean by naming it in step 1. If a Steam account has
three characters linked to it and the player named one of them, only that
one is ever checked or linked — the other two are simply irrelevant to
this specific command invocation.

**Linking more than one character:** the player runs `/dune player link
<name>` once per character, exactly as the existing whisper flow and
FINDING-LINK-6's multi-account design already require — there has never
been a "link all my characters in one command" concept anywhere in this
codebase, and this feature does not introduce one. Each invocation
independently resolves one named character and performs its own
independent Steam-ID-array membership check.

This eliminates the entire "candidate selection list" UI the original
two-revision-ago design required (grouped-by-Steam-account lists, "never
auto-pick when ambiguous," a whole Case 3a/3b split) — there is never more
than one character being resolved at a time, so there is never a list to
show.

## Flow

1. Player runs `/dune player link <character-name>` (character required,
   exactly as before this feature existed).
2. Bot resolves the character (existing logic, unchanged) and — as part of
   that same request — Core checks whether the resolved account has a
   Steam ID on file (`platform_name = 'steam'`, `platform_id` set).
3. **Character has no Steam ID on file:** Core generates and sends the
   in-game whisper code exactly as today; the bot's reply is the existing
   "check your in-game whispers" embed, completely unchanged. Nothing
   below this point applies to this player.
4. **Character has a Steam ID on file:** Core does **not** send a whisper.
   It returns enough information for the bot to start a Steam-link
   session scoped to this one character (`playerControllerId`,
   `characterName`). The bot's reply is a **link-style button** ("Link via
   Steam") and nothing else — no whisper text, no "or you could also..."
   framing. This is a **new interaction-handling requirement**: no
   button/select-menu interaction handling existed anywhere in this
   codebase before this feature.
5. Player clicks the button, which opens
   `GET {ACP_STEAM_LINK_BASE_URL}/steam-link/start?state=<opaque>` in
   their browser, which redirects to Discord's OAuth authorize URL with
   `scope=identify connections`.
6. Player completes Discord's own consent screen (shows exactly
   `identify`, `connections` — no Discord password or 2FA is ever seen by
   the bot). **This step cannot be skipped or pre-checked** — see the
   constraint called out in [§Problem Statement](#problem-statement).
7. Discord redirects to
   `{ACP_STEAM_LINK_BASE_URL}/steam-link/callback?code=...&state=...`. The
   bot validates `state` (single-use, unexpired, correctly bound — see
   Security Review FINDING-STEAM-1, unchanged from before), exchanges
   `code` for a token, and calls `GET /users/@me/connections`, filtering
   for `type === "steam"`.
8. **Match found** (the named character's on-file Steam ID appears
   anywhere in the returned Steam connections array): the bot calls the
   Core adapter's `linkAccountViaSteam()` (re-verified server-side against
   fresh data — see Security Review FINDING-STEAM-2), which links
   immediately. **No confirmation screen, no further prompts** — the
   player already proved ownership by completing OAuth; asking them to
   confirm again would be redundant. The callback page shows success, and
   the bot's original ephemeral reply is edited in place (via
   `interaction.editReply()`, using the stored interaction token) to show
   the same success shape a completed whisper-verified link would show.
9. **No match** (the player has no Steam connections at all, or none of
   them match this character's on-file Steam ID): the bot **automatically
   triggers the in-game whisper now**, using the character name it
   already has from step 1 — the player never has to re-run the command.
   The callback page explains what happened ("that Steam account didn't
   match — we sent a verification code to your character in-game
   instead") and the bot's original ephemeral reply is edited to show the
   normal "check your in-game whispers" instructions.

### Why Auto-Fallback to Whisper, Not Just an Error

If the Steam check fails, the character named in step 1 still exists and
is still linkable via whisper — the bot already has everything it needs
to send that whisper immediately, with no extra input from the player.
Making them re-run the whole command from scratch after a failed Steam
attempt would be a worse experience than just completing the fallback
automatically. This was an explicit design decision, not a default.

### Why a Web Callback Page, Not a Discord-Native Confirmation

Discord's OAuth redirect **must** land on a real HTTP page (the
`redirect_uri`) before the bot can act on anything — there is no way to
short-circuit that back into a pure Discord interaction. The callback page
itself is deliberately minimal (reuses `setupServer.js`'s existing
`esc()`-based HTML templating and dark/sand visual style for consistency)
and, in this revised design, needs **no interactive element at all** in
the common case — it only needs to show a result (success, or "sent a
whisper instead"), since the match/no-match decision requires no further
player input.

## Response Shapes

### Reply when character has no Steam ID on file (unchanged from before this feature)

```
🔗 Character Link Started

We sent a verification code to PaulAtreides in-game via whisper.
Use /dune player verify <code> to complete the link. Codes expire
after 5 minutes.
```

### Reply when character has a Steam ID on file

```
🔗 Link via Steam

PaulAtreides is linked to a Steam account. Click below to verify
instantly using your Discord's connected Steam account — no
in-game whisper needed.

[ Link via Steam ]  (Link-style button, opens browser)

This link expires in 10 minutes. If it expires, just run this
command again.
```

### Callback page — success (Steam match found)

```
✅ Linked!

PaulAtreides is now linked to your Discord account. You can
close this tab and return to Discord.
```

The bot's original ephemeral reply is edited to match the existing
successful-link embed shape used elsewhere in this codebase — no new
embed format is needed for the success case, only the *path* to reach it
differs from the whisper flow.

### Callback page — no match, whisper sent automatically

```
🏜️ Sent a Verification Code Instead

We checked your linked Steam account(s) but couldn't confirm
PaulAtreides that way. We've sent a verification code to
PaulAtreides in-game via whisper instead — check your whispers
and run /dune player verify <code> to complete the link.
```

The bot's original ephemeral reply is edited to show the same
"check your in-game whispers" instructions the no-Steam-ID path shows
directly — from the player's perspective, they end up at the same next
step either way, just via a slightly different route depending on which
error message they saw on the callback page.

## Multi-Character Linking (Reusing FINDING-LINK-6)

This feature is designed to link into the **existing**
`console.discord_account_links` multi-account table (FINDING-LINK-6,
already implemented server-side, not yet bot-integrated) rather than the
older single-link `console.discord_player_links` table. Reasons:

- `discord_account_links` already supports N characters per Discord user —
  the correct cardinality for a bot where a player might legitimately have
  more than one linked character. The single-link table's
  `UNIQUE(discord_user_id)`-style constraint (one link, ever, silently
  overwritten on re-link) is structurally wrong for that.
- FINDING-LINK-6's cross-table conflict check (`otherTableLinkConflict()`)
  already guards against a character being claimed by two different
  Discord users regardless of which of the two tables the claim comes
  through — this feature inherits that protection for free.
- FINDING-LINK-6's routes (`/players/accounts/link`,
  `/players/accounts/link/verify`, etc.) already exist server-side but
  have **zero bot-side integration** today. This feature's whisper path is
  the first real consumer of that route set — closing that gap is a side
  effect of this work, not a separate task.

**Important distinction from FINDING-LINK-6's original verification
design:** the existing `linkAccountProvider()` still requires an **online,
whisper-delivered code** for each additional character. Steam-linking uses
a **parallel verification path** that trusts Discord's OAuth grant
instead. See the Architecture doc for the new
`linkAccountViaSteamProvider()` this requires on the Core side.

## Scope Addition: New `/dune player` Command Group (Decided During Design Review, Unaffected by This Revision)

**This section is unchanged from the original design** — the command-group
restructuring decision below was orthogonal to the argument-optionality
question this revision corrects, and remains exactly as designed.

While designing this feature's command placement, a related structural gap
was surfaced and decided: the existing `data` subcommand group had grown
to **15 of Discord's 25-per-group hard cap** by mixing three genuinely
different concerns — player identity/linking (9 subcommands: `link`,
`verify`, `characters`, `enable`, `disable`, `default`, `unlink`,
`faction`, `whoami`), inventory/storage (3: `inventory`, `storage`,
`find`), and server/world data (3: `population`, `backups`, `maps`).

**Decision: split the 9 existing identity/linking subcommands out of
`data` into a new top-level `player` subcommand group.** This is a
**breaking rename** for every existing user's command habits:

| Old (removed) | New |
|---|---|
| `/dune data link <character>` | `/dune player link <character>` — `character` remains REQUIRED (see this document's revision note — an earlier draft made it optional; that was corrected) |
| `/dune data verify <code>` | `/dune player verify <code>` |
| `/dune data characters` | `/dune player characters` |
| `/dune data enable <character>` | `/dune player enable <character>` |
| `/dune data disable <character>` | `/dune player disable <character>` |
| `/dune data default <character>` | `/dune player default <character>` |
| `/dune data unlink <character>` | `/dune player unlink <character>` |
| `/dune data faction <name>` | `/dune player faction <name>` |
| `/dune data whoami` | `/dune player whoami` |

`data` retains exactly `population`, `backups`, `maps`, `inventory`,
`storage`, `find` (6 subcommands).

This rename must be:
1. Documented prominently in the implementation PR's description and
   change note — this breaks muscle memory for any existing server that
   has this bot installed.
2. Reflected in `docs/user-guide.md`'s command tables and the "Linking
   Your Character" walkthrough section in full.
3. Picked up automatically by Discord's own slash-command re-registration
   — no special migration step needed beyond a normal command-definition
   push.

## Autocomplete / UI Details

- No autocomplete needed for the Steam-connections decision itself — it
  takes no new parameters and is decided entirely server-side after the
  (unchanged) `character` argument is resolved.
- The Link-style button (`ButtonStyle.Link`) requires no interaction
  response beyond opening the URL in the player's browser — Discord
  handles this natively.
- The callback page itself needs no interactive `<button>` elements in the
  common case (unlike the prior design's candidate-selection list) — it
  renders a single outcome (success, or "sent a whisper instead") and the
  bot proactively edits the original Discord ephemeral reply via
  `interaction.editReply()` using the stored interaction token, which
  `discord.js` supports for up to 15 minutes after the original
  interaction.

## Error UX

| Condition | Response |
|---|---|
| OAuth `state` expired or invalid (player waited too long, or reused an old link) | Callback page: "This link has expired. Run `/dune player link <character-name>` again in Discord." |
| Player denies the OAuth consent screen | Discord redirects with an `error` query param; callback page auto-sends the whisper fallback and explains: "Linking via Steam was cancelled — we sent a verification code to your character in-game instead." |
| No Steam connections found at all, or none match this character | Auto-sends the whisper fallback (see [§Flow](#flow) step 9) — this is not treated as a dead-end error, it's a graceful degrade to the always-available path. |
| Character already linked to a different Discord user (cross-table conflict) | Callback page: "This character is already linked to a different Discord account." (No identifying detail about which account — see Security Review FINDING-STEAM-3.) No whisper fallback in this case, since sending one wouldn't help — the character is already claimed by someone else. |
| Rate limit exceeded (see security doc) | Callback page: "Too many attempts. Try again in a few minutes." |

## Explicit Non-Goals (v1)

- **Steam OpenID fallback** — deferred. If a player doesn't want to link
  Steam↔Discord natively (privacy preference), their character simply has
  no Steam ID on file from the bot's perspective, and they always see the
  whisper path. Revisit only if this becomes a real, observed support
  request.
- **Unlinking via the web callback page** — unlinking remains exclusively
  a Discord-side action (`/dune player unlink`, `/dune player disable`).
  The web page only ever adds links, never removes them.
- **Auto re-sync** — once linked, a character's link is not automatically
  re-verified if the player's Steam connection is later removed from
  Discord. This matches the existing whisper flow's behavior.
- **A candidate-selection UI of any kind.** The previous revision of this
  design required one (to handle "which of your several Steam-matched
  characters did you mean?"). This revision removes that need entirely by
  requiring the character name up front — see
  [§Unified Command Design](#unified-command-design-second-revision).
- **Any change to the existing whisper-based flow's internal behavior,
  tables, or routes for characters with no Steam ID on file.**
  `player:verify`'s whisper-code consumption is completely untouched, and
  the `character` argument on `player:link` is required exactly as it was
  before this feature — the *only* command-surface change from the
  pre-feature state is the group rename (`data` → `player`, per the Scope
  Addition above).

## Sources

- [Architecture](steam-link-architecture.md)
- [Security Review](steam-link-security-review.md)
- [GRC Review](steam-link-grc.md)
- [Implementation Prompt](steam-link-implementation-prompt.md)
- `docs/security/discord-player-link-hardening.md` (Core repo) — FINDING-LINK-6, the multi-account table and conflict-check this feature builds on
- Discord OAuth2 docs: https://discord.com/developers/docs/topics/oauth2 (verified 2026-07-24)
- Discord User Resource / Connection Object: https://discord.com/developers/docs/resources/user (verified 2026-07-24)
- Live schema verification against `dune-postgres` container, 2026-07-24 (see architecture doc for exact queries run)
