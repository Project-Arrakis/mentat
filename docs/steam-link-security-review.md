# Discord → Steam → Character Linking — Security Review

**Date:** 2026-07-24
**Reviewer:** OpenCode agent (pre-implementation design review)
**Scope:** `Arrakis-Control-Panel` (new `steamLinkServer.js` Express app, new
command, new adapter methods) and `dune-awakening-selfhost-docker` Core
(two new routes reusing FINDING-LINK-6's existing schema/capability, one
new read-only query, one new provider function). No changes to the
existing whisper-based linking flow in either repo.

## Executive Summary

This feature introduces the **first genuinely new network-facing attack
surface** in this bot's history: a public HTTP(S) OAuth callback endpoint.
Every prior `data:*` command is either fully read-only against Core, or (for
the existing whisper-link flow) write-capable but entirely mediated through
Discord's own interaction model with no separate public listener. This
changes that. The review below is scoped accordingly — more rigorous than
the crafting-calculator review, closer in weight to FINDING-LINK-1 through
-6's original review, because it shares the same risk category (identity
binding) and adds a new one (public HTTP OAuth surface) those findings
didn't have to consider.

No HIGH findings block this design, but two MEDIUM findings require
same-PR remediation (CSRF-equivalent `state` handling, and secret
provisioning for single-tenant mode), and this review carries forward two
Known Limitations directly from FINDING-LINK-6 (rate-limiter unbounded key
growth, in-memory-only state) rather than re-solving problems already
explicitly deferred there.

## Methodology

1. STRIDE analysis of the new OAuth callback surface specifically (Discord's
   own OAuth security guidance was read directly:
   https://discord.com/developers/docs/topics/oauth2#state-and-security,
   2026-07-24).
2. Direct comparison against FINDING-LINK-1 through -6's already-reviewed
   trust model, to identify where this feature can **reuse** an existing,
   reviewed control (e.g. `ACCOUNT_LINK_WRITE`, `otherTableLinkConflict()`)
   versus where it needs a genuinely new one (state-token CSRF protection —
   nothing in the existing linking flow has an equivalent, since it never
   had a browser-redirect step before).
3. Direct verification against the live `dune-postgres` schema (see
   Architecture doc) to confirm no new injection surface is introduced by
   the new `platform_id`-matching query.

## STRIDE Summary

| STRIDE Category | Applicability | Notes |
|---|---|---|
| Spoofing | **Applicable — FINDING-STEAM-1** | The OAuth `state` parameter is the only binding between "this browser session" and "this Discord interaction" — if it's guessable, replayable, or not checked for single-use, an attacker could complete someone else's linking flow. |
| Tampering | **Applicable — FINDING-STEAM-2** | The `code`→token exchange and the `connections` read happen server-side, not attacker-controlled — but the candidate-selection POST from the callback page IS attacker-reachable and must re-validate ownership server-side, not trust the page's own displayed list. |
| Repudiation | Not newly applicable | Reuses `linkAdditionalAccount()`'s existing transactional write; no new audit gap beyond what FINDING-LINK-6 already documented as open (no structured audit event for link/unlink — pre-existing, not introduced here). |
| Information disclosure | **Applicable — FINDING-STEAM-3** | The candidate list, if it ever showed a character already linked to a DIFFERENT Discord user, must not reveal *which* Discord user — see Design doc's Error UX table, which already specifies this, but it's called out here as a hard requirement, not a nicety. |
| Denial of service | **Applicable — FINDING-STEAM-4** | Same rate-limiting-Map-unbounded-growth characteristic FINDING-LINK-3/-6 already accepted as a known limitation — this feature's new rate limiter inherits it, not a new risk category. |
| Elevation of privilege | Not newly applicable | `ACCOUNT_LINK_WRITE` is already self-scoped (FINDING-LINK-2's pattern) and this feature reuses it unchanged — no new privilege tier introduced. |

## Detailed Findings

### FINDING-STEAM-1: OAuth `state` must be a genuine CSRF token, not just a correlation ID (MEDIUM)

- **Location:** proposed `src/steamLinkStore.js`, `src/steamLinkServer.js`'s
  `/steam-link/start` and `/steam-link/callback` handlers.
- **Risk:** `setupServer.js`'s existing OAuth implementation (which this
  feature's callback logic is modeled on) generates `state` via
  `randomBytes(16).toString("hex")` (128 bits) and stores it server-side
  before redirecting — this is already a reasonable CSRF-token shape, not a
  predictable value. The risk is in *validation*, not generation: the
  `state` row must be checked for (a) existence, (b) not-expired, (c)
  not-already-consumed (single-use), and (d) that the interaction it's
  bound to still belongs to the Discord user completing the callback — a
  state token, once issued, must never be usable by anyone other than the
  Discord user who ran `/dune player link` (with no character argument) in the first place. Discord
  itself does not enforce any of this; it is entirely this feature's
  responsibility.
- **Recommendation (required before merge):**
  1. Mark `state` rows single-use: delete or flag-consumed immediately upon
     first successful validation in `/steam-link/callback`, before doing
     any further work. A second request with the same `state` (replay) must
     fail with "expired or already used," not silently re-process.
  2. Set and enforce a short expiry (10 minutes, matching the Design doc's
     stated UX) — checked server-side on every callback request, not just
     assumed from generation time.
  3. `state` rows must store the originating `discordUserId` and
     `interactionToken` captured when `/dune player link` (no character
     argument) is invoked. The callback handler does not need to re-verify
     the *browser's* identity against this (the browser never authenticated
     to the bot directly) — it only needs the `state` to correctly route
     the eventual link/edit back to the right Discord interaction, which
     `steamLinkStore.js`'s in-memory session shape already supports.
  4. Do not accept `state` from any source other than the redirect
     `query` parameter Discord itself appends — no fallback to a cookie,
     header, or body field for this value.
- **Verification:** implementation must include a test proving a
  second use of the same `state` value is rejected, and a test proving an
  expired `state` is rejected even with a structurally valid format.

### FINDING-STEAM-2: Candidate-selection POST must re-verify ownership server-side, never trust the callback page's own rendered list (MEDIUM)

- **Location:** proposed `/steam-link/select` handler (or equivalent),
  proposed `linkAccountViaSteamProvider()` on the Core side.
- **Risk:** The callback page renders a list of candidate characters
  derived from the OAuth-authenticated session's Steam connections. The
  page itself is static HTML with plain `<button>` elements — nothing
  stops a browser's dev tools, or a replayed/modified POST, from submitting
  a `playerControllerId` that was **never actually in that session's
  candidate list** (e.g. a character belonging to a completely different
  Steam account the attacker doesn't control).
- **Recommendation (required before merge):**
  1. The `/steam-link/select` (or callback-continuation) handler must
     **re-derive** the valid candidate set server-side from the same
     session's stored Steam connection IDs — never trust a
     `playerControllerId` value from the POST body alone. Reject any
     submitted ID that is not in the session's own re-derived candidate
     set, even if that ID happens to be a real character in the database.
  2. This re-derivation should call the same
     `resolveCharactersBySteamId64()` Core route again at selection time
     (not just trust a cached result from the initial callback render),
     so a TOCTOU window where the underlying `dune.accounts` data changed
     between page-render and button-click cannot smuggle in a stale or
     manipulated candidate.
  3. `linkAccountViaSteamProvider()` on the Core side must still go through
     `linkAdditionalAccount()`'s existing conflict checks unconditionally —
     this finding's mitigation is defense-in-depth on the bot side; Core's
     existing conflict check is the actual authoritative guard and is not
     weakened or bypassed by this feature.

### FINDING-STEAM-3: Cross-user conflict disclosure must not reveal which Discord user holds a conflicting link (MEDIUM, carried into hard design requirement)

- **Location:** proposed `/steam-link/select` error handling, Design doc's
  Error UX table (already specifies the correct behavior — this finding
  formalizes it as a security requirement, not just a UX choice).
- **Risk:** If Player A's Steam-linked candidate list includes a character
  that's already linked to a different Discord user B (a real, expected
  scenario — e.g. shared Steam family accounts, or a stale/incorrect Steam
  link), the response must say only "already linked to another account,"
  never anything that could identify Discord user B (no username,
  no Discord ID, no character-ownership timestamp).
- **Recommendation:** `linkAdditionalAccount()`'s existing
  `character_already_linked` error (confirmed in `duneDb.js:5381-5386`)
  already returns a generic message with no other-user identifying detail
  — this feature's bot-side error handling must pass that message through
  unchanged, not enrich it with any additional lookup.
- **Verification:** test asserting the rendered error page/message contains
  no Discord snowflake, username, or timestamp belonging to the conflicting
  owner.

### FINDING-STEAM-4: Rate limiter shares FINDING-LINK-3/-6's known unbounded-key-growth characteristic (LOW, carried forward, not new)

- **Location:** proposed new rate limiter instance for
  `/players/accounts/link-steam` (Core side), following the exact pattern
  documented in `docs/security/discord-player-link-hardening.md`'s Known
  Limitations for FINDING-LINK-3 and FINDING-LINK-6.
- **Risk:** Identical to the already-accepted risk for the two existing
  link-verification rate limiters — an attacker with a valid bearer token
  (and, if configured, a valid actor signature) could submit many distinct
  fake `discordUserId` values to grow the limiter's in-memory `Map` without
  bound.
- **Recommendation:** Use `createLoginRateLimiter()` again (the same
  factory FINDING-LINK-3 and -6 both use), in its own env var namespace
  (`DUNE_DISCORD_STEAM_LINK_MAX_ATTEMPTS` etc.), accepting the same known
  limitation rather than attempting a bespoke fix here — per
  FINDING-LINK-6's own Known Limitations, this is "a shared follow-up
  rather than specific to \[any one] finding." Do not scope a bounded-LRU
  fix into this feature; it would need to apply to all three limiter
  instances at once to be worth the complexity.

### FINDING-STEAM-5: Single-tenant mode now requires a Discord OAuth client secret it never needed before (INFORMATIONAL — operator-facing change, not a vulnerability)

- **Location:** `src/config.js:115` (`clientSecret: multiTenant ?
  readSecret(...) : undefined`).
- **Risk:** None to the bot itself — this is a deployment/documentation
  concern, not a code vulnerability. Flagged here because it's a
  **backward-compatibility-relevant** config change: an operator who
  upgrades and wants to use `/dune player link` without a `character`
  argument (the Steam-connections flow) must now register a redirect URI
  in the Discord Developer Portal and provision
  `DISCORD_CLIENT_SECRET`/`_FILE`, neither of which single-tenant mode ever
  required before this feature. The existing `character`-argument flow
  (byte-for-byte unchanged whisper-code behavior) needs none of this.
- **Recommendation:** The bot must start and run **normally** without this
  secret configured (matching every other opt-in feature's backward-compat
  posture in this codebase — e.g. `DUNE_DISCORD_ACTOR_SECRET`'s
  opt-in-by-absence design in FINDING-LINK-1). Only the Steam-connections
  branch of `/dune player link` (i.e. invoked without `character`) should
  fail, with a clear "Steam linking is not configured on this server"
  message, if the secret is absent. This must be tested explicitly (a
  startup test with the secret unset, asserting the bot still starts,
  `/dune player link <character>` still works unchanged, and only the
  no-argument Steam flow reports the config error).

### FINDING-STEAM-6: OAuth token and Steam connection data must never be logged or persisted beyond the linking transaction (MEDIUM)

- **Location:** proposed `src/steamLinkServer.js`, proposed
  `src/logger.js` usage within it.
- **Risk:** Discord access tokens (even short-lived ones) and Steam
  `platform_id` values are sensitive — `src/format.js` already treats
  Steam IDs as a redaction-worthy pattern
  (`LABELED_STEAM_ID_PATTERN`, confirmed at `format.js:10`) for *output*
  redaction; this finding extends the same posture to *input handling* in
  a brand-new code path that doesn't yet exist to have been reviewed.
- **Recommendation:**
  1. Never log the raw Discord access/refresh token, at any log level,
     anywhere in `steamLinkServer.js`.
  2. Never persist the Discord access token beyond the single request that
     needs it (the `connections` fetch) — do not write it into
     `oauth_sessions`-equivalent storage the way `setupServer.js`'s
     existing (unrelated) flow does for its own multi-tenant purpose. This
     feature's session storage should hold only `state`, `discordUserId`,
     `interactionToken`, `guildId`, `expiresAt`, and (transiently, only
     between callback and select) the resolved candidate list — never the
     token itself.
  3. If any error path logs the OAuth callback's query string or request
     body for debugging, it must redact `code` and any token value first —
     matching `logger.js`'s existing `redactSecrets()` call pattern
     (confirmed already applied to all structured log entries).

## Recommended Remediation Order

### Required before merge (same PR)

1. FINDING-STEAM-1 — single-use, expiring, correctly-bound `state`.
2. FINDING-STEAM-2 — server-side re-derivation of the candidate set at
   selection time, never trusting the POST body's character ID alone.
3. FINDING-STEAM-3 — generic conflict message, no other-user disclosure
   (mostly already specified in the Design doc; this makes it a hard gate).
4. FINDING-STEAM-6 — no token logging/persistence beyond the request.

### Confirm at implementation time (verify, not necessarily new code)

5. FINDING-STEAM-5 — bot starts and runs normally with the secret unset;
   only the new command itself is gated.

### Accepted, carried-forward limitation (no new code required)

6. FINDING-STEAM-4 — rate limiter unbounded key growth, matching
   FINDING-LINK-3/-6's already-accepted posture.

## Informational Finding (Found During This Review, Unrelated to New Code)

While researching this feature, a **pre-existing, unrelated defect** was
found: `docs/user-guide.md` on `main` contains unresolved git merge-conflict
markers (`<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main`) at three
separate locations, describing two different, contradictory versions of the
existing whisper-link flow (one describing an older RCON-whisper design,
one describing the current 6-character-code design). This is a
documentation defect, not a security vulnerability, but it is being fixed
as part of this PR's docs changes (see Design/Architecture docs) since this
feature edits the same file's "Linking Your Character" section anyway —
fixing it opportunistically avoids a second PR touching the same broken
section. See `docs/security/discord-player-link-hardening.md` (Core repo)
Sources section, which already flagged this exact defect as an open item
from the FINDING-LINK-6 review pass.

## Evidence Artifacts

None yet — pre-implementation design review. Once implemented, standard
scanner output (Semgrep, Gitleaks, Trivy, `npm audit` for both repos) and
`npm test` results must be attached to the implementation PR(s), per each
repo's existing `docs/security-gates.md` (bot) and
`docs/security/discord-player-link-hardening.md` (Core) conventions.

## Sources

- [Design](steam-link-design.md)
- [Architecture](steam-link-architecture.md)
- [GRC Review](steam-link-grc.md)
- `docs/security/discord-player-link-hardening.md` (Core repo) — FINDING-LINK-1 through -6, the trust model and controls this feature reuses
- `src/format.js:10` — existing Steam ID redaction pattern this feature's logging must respect
- `src/setupServer.js` — existing OAuth `state` generation/storage pattern this feature's CSRF protection builds on
- Discord OAuth2 State and Security guidance: https://discord.com/developers/docs/topics/oauth2#state-and-security (verified 2026-07-24)
