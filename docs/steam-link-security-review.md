# Discord → Steam → Character Linking — Security Review

**Date:** 2026-07-24
**Reviewer:** OpenCode agent (pre-implementation design review)
**Scope:** `Arrakis-Control-Panel` (new `steamLinkServer.js` Express app,
extended `player:link` dispatch, new adapter method) and
`dune-awakening-selfhost-docker` Core (one new route reusing
FINDING-LINK-6's existing schema/capability, one extended query, one new
provider function). No changes to the existing whisper-based linking
flow's behavior for characters with no Steam ID on file.

**Revision note:** this review originally covered a design with a
candidate-selection list and an optional `character` argument. That design
was corrected (see `docs/steam-link-design.md`'s revision note) — the
argument is required again, and the flow now resolves to exactly one
outcome per character with no list. This revision updates the findings
below accordingly. FINDING-STEAM-2 in particular is substantially
narrower now (single-target re-verification instead of re-deriving a
whole candidate set), and a former "auto-select when count is 1"
consideration no longer applies since there is never more than one
possible target.

## Executive Summary

This feature introduces the **first genuinely new network-facing attack
surface** in this bot's history: a public HTTP(S) OAuth callback endpoint.
Every prior command is either fully read-only against Core, or (for the
existing whisper-link flow) write-capable but entirely mediated through
Discord's own interaction model with no separate public listener. This
changes that.

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
   versus where it needs a genuinely new one (state-token CSRF protection).
3. Direct verification against the live `dune-postgres` schema to confirm
   no new injection surface is introduced by the Steam-ID match check.

## STRIDE Summary

| STRIDE Category | Applicability | Notes |
|---|---|---|
| Spoofing | **Applicable — FINDING-STEAM-1** | The OAuth `state` parameter is the only binding between "this browser session" and "this Discord interaction, for this specific character." If it's guessable, replayable, or not checked for single-use, an attacker could complete someone else's linking flow, or link a character to the wrong Discord user. |
| Tampering | **Applicable — FINDING-STEAM-2 (narrowed)** | The `code`→token exchange and the `connections` read happen server-side, not attacker-controlled. The match check (does this character's Steam ID appear in the returned connections array) must be re-derived from the `state`-bound `playerControllerId`, never from any client-supplied value — there is no longer a POST body with an attacker-choosable target character, since the character was fixed at session-creation time from the original slash-command interaction. |
| Repudiation | Not newly applicable | Reuses `linkAdditionalAccount()`'s existing transactional write; no new audit gap beyond what FINDING-LINK-6 already documented as open (no structured audit event for link/unlink — pre-existing, not introduced here). |
| Information disclosure | **Applicable — FINDING-STEAM-3** | If the named character is already linked to a DIFFERENT Discord user, the error must not reveal *which* Discord user. |
| Denial of service | **Applicable — FINDING-STEAM-4** | Same rate-limiting-Map-unbounded-growth characteristic FINDING-LINK-3/-6 already accepted as a known limitation — this feature's new rate limiter inherits it, not a new risk category. |
| Elevation of privilege | Not newly applicable | `ACCOUNT_LINK_WRITE` is already self-scoped (FINDING-LINK-2's pattern) and this feature reuses it unchanged. |

## Detailed Findings

### FINDING-STEAM-1: OAuth `state` must be a genuine CSRF token bound to one specific character, not just a correlation ID (MEDIUM)

- **Location:** proposed `src/steamLinkStore.js`, `src/steamLinkServer.js`'s
  `/steam-link/start` and `/steam-link/callback` handlers.
- **Risk:** `setupServer.js`'s existing OAuth implementation (which this
  feature's callback logic is modeled on) generates `state` via
  `randomBytes(16).toString("hex")` (128 bits) and stores it server-side
  before redirecting — this is already a reasonable CSRF-token shape. The
  risk is in *validation*, not generation: the `state` row must be checked
  for (a) existence, (b) not-expired, (c) not-already-consumed
  (single-use), and (d) that the interaction it's bound to still belongs
  to the Discord user completing the callback. **New in this revision:**
  the `state` row must also carry the specific `playerControllerId` and
  `characterName` this session was created for (from the original
  `/dune player link <character-name>` invocation) — without this
  binding, a completed OAuth grant for user A could be misapplied to
  whatever character happened to be named in a *different*, unrelated
  session if state validation only checked the Discord user and not the
  specific character too.
- **Recommendation (required before merge):**
  1. Mark `state` rows single-use: delete or flag-consumed immediately upon
     first successful validation in `/steam-link/callback`, before doing
     any further work. A second request with the same `state` (replay) must
     fail with "expired or already used," not silently re-process.
  2. Set and enforce a short expiry (10 minutes, matching the Design doc's
     stated UX) — checked server-side on every callback request.
  3. `state` rows must store the originating `discordUserId`,
     `interactionToken`, **and** the `playerControllerId`/`characterName`
     this specific link attempt is for. The Steam-ID match check in the
     callback (FINDING-STEAM-2) must check against this stored
     `playerControllerId`, never any value derived from the request itself.
  4. Do not accept `state` from any source other than the redirect
     `query` parameter Discord itself appends.
- **Verification:** implementation must include a test proving a second
  use of the same `state` value is rejected, a test proving an expired
  `state` is rejected, and a test proving the match check is scoped to the
  `state`'s own stored `playerControllerId` even if a different
  `player_controller_id` is somehow supplied elsewhere in the request.

### FINDING-STEAM-2: The Steam-ID match check must re-derive its target from the server-stored session, never trust anything client-supplied (MEDIUM, narrowed from the prior revision)

- **Location:** `/steam-link/callback` handler, proposed
  `matchSteamIdForCharacter()` on the Core side.
- **Risk:** This finding is substantially narrower than the prior revision
  of this document, because there is no longer a candidate-selection POST
  with an attacker-choosable `playerControllerId` in the request body —
  the character was fixed at session-creation time (from the original
  slash-command interaction, before any browser involvement) and stored
  server-side in `steamLinkStore.js`. The remaining risk is a
  session-fixation-adjacent one: the callback handler must read the target
  character **from the stored session**, not from any query parameter or
  header that could theoretically be manipulated in the redirect chain.
- **Recommendation (required before merge):**
  1. The `/steam-link/callback` handler must resolve the character to
     check **exclusively** from `steamLinkStore.getSession(state)`'s
     stored `playerControllerId` — never from a query parameter, request
     header, or any other client-influenced source.
  2. The Core-side `matchSteamIdForCharacter()` call must be re-run at
     callback time using fresh data (not any cached result from the
     original `/dune player link` request), so a TOCTOU window where the
     character's on-file Steam ID changed between the initial command and
     the OAuth callback completing cannot produce a stale match/no-match
     decision.
  3. `linkAccountViaSteamProvider()` on the Core side must still go through
     `linkAdditionalAccount()`'s existing conflict checks unconditionally —
     this finding's mitigation is defense-in-depth on the bot side; Core's
     existing conflict check is the actual authoritative guard.

### FINDING-STEAM-3: Cross-user conflict disclosure must not reveal which Discord user holds a conflicting link (MEDIUM, carried into hard design requirement)

- **Location:** `/steam-link/callback` error handling, Design doc's Error
  UX table (already specifies the correct behavior — this finding
  formalizes it as a security requirement).
- **Risk:** If the named character is already linked to a different
  Discord user B (a real, expected scenario — e.g. a stale or incorrect
  prior link), the response must say only "already linked to another
  account," never anything that could identify Discord user B (no
  username, no Discord ID, no character-ownership timestamp).
- **Recommendation:** `linkAdditionalAccount()`'s existing
  `character_already_linked` error already returns a generic message with
  no other-user identifying detail — this feature's bot-side error
  handling must pass that message through unchanged. Per the revised
  Design doc's Error UX table, this specific case does **not** trigger the
  whisper auto-fallback (sending a whisper wouldn't help — the character
  is already claimed by someone else, and whispering them a code that can
  never successfully complete a new link would be actively misleading).
- **Verification:** test asserting the rendered error page/message
  contains no Discord snowflake, username, or timestamp belonging to the
  conflicting owner, and a test asserting no whisper is triggered in this
  specific error case.

### FINDING-STEAM-4: Rate limiter shares FINDING-LINK-3/-6's known unbounded-key-growth characteristic (LOW, carried forward, not new)

- **Location:** proposed new rate limiter instance for
  `/players/accounts/link-steam` (Core side), following the exact pattern
  documented in `docs/security/discord-player-link-hardening.md`'s Known
  Limitations for FINDING-LINK-3 and FINDING-LINK-6.
- **Risk:** Identical to the already-accepted risk for the two existing
  link-verification rate limiters — an attacker with a valid bearer token
  (and, if configured, a valid actor signature) could submit many distinct
  fake `discordUserId` values to grow the limiter's in-memory `Map`
  without bound.
- **Recommendation:** Use `createLoginRateLimiter()` again (the same
  factory FINDING-LINK-3 and -6 both use), in its own env var namespace
  (`DUNE_DISCORD_STEAM_LINK_MAX_ATTEMPTS` etc.), accepting the same known
  limitation rather than attempting a bespoke fix here.

### FINDING-STEAM-5: Single-tenant mode now requires a Discord OAuth client secret it never needed before (INFORMATIONAL — operator-facing change, not a vulnerability)

- **Location:** `src/config.js` (`clientSecret: multiTenant ?
  readSecret(...) : undefined`).
- **Risk:** None to the bot itself — this is a deployment/documentation
  concern, not a code vulnerability. Flagged here because it's a
  **backward-compatibility-relevant** config change: an operator who
  upgrades must now register a redirect URI in the Discord Developer
  Portal and provision `DISCORD_CLIENT_SECRET`/`_FILE` to enable the
  Steam-link button for any character, neither of which single-tenant
  mode ever required before this feature.
- **Recommendation:** The bot must start and run **normally** without this
  secret configured. If it's unset, the bot must never show a "Link via
  Steam" button at all (regardless of whether a given character has a
  Steam ID on file) — every `/dune player link <character>` invocation
  falls back to the existing whisper flow unconditionally in that case,
  with no error message needed, since the whisper path was never
  contingent on this secret to begin with. This must be tested explicitly
  (a startup test with the secret unset, asserting the bot still starts
  and `/dune player link <character>` still works, whisper-only, for
  every character regardless of Steam-ID status).

### FINDING-STEAM-6: OAuth token and Steam connection data must never be logged or persisted beyond the linking transaction (MEDIUM)

- **Location:** proposed `src/steamLinkServer.js`, proposed
  `src/logger.js` usage within it.
- **Risk:** Discord access tokens (even short-lived ones) and Steam
  `platform_id` values are sensitive — `src/format.js` already treats
  Steam IDs as a redaction-worthy pattern (`LABELED_STEAM_ID_PATTERN`) for
  *output* redaction; this finding extends the same posture to *input
  handling* in a brand-new code path.
- **Recommendation:**
  1. Never log the raw Discord access/refresh token, at any log level,
     anywhere in `steamLinkServer.js`.
  2. Never persist the Discord access token beyond the single request that
     needs it (the `connections` fetch). This feature's session storage
     should hold only `state`, `discordUserId`, `interactionToken`,
     `guildId`, `playerControllerId`, `characterName`, `expiresAt` — never
     the token itself.
  3. If any error path logs the OAuth callback's query string or request
     body for debugging, it must redact `code` and any token value first —
     matching `logger.js`'s existing `redactSecrets()` call pattern.

## Recommended Remediation Order

### Required before merge (same PR)

1. FINDING-STEAM-1 — single-use, expiring, character-bound `state`.
2. FINDING-STEAM-2 — match check always reads its target from the
   server-stored session, never a client-supplied value.
3. FINDING-STEAM-3 — generic conflict message, no other-user disclosure,
   no whisper fallback in the conflict case specifically.
4. FINDING-STEAM-6 — no token logging/persistence beyond the request.

### Confirm at implementation time (verify, not necessarily new code)

5. FINDING-STEAM-5 — bot starts and runs normally with the secret unset;
   every character falls back to whisper-only in that case.

### Accepted, carried-forward limitation (no new code required)

6. FINDING-STEAM-4 — rate limiter unbounded key growth, matching
   FINDING-LINK-3/-6's already-accepted posture.

## Informational Finding (Found During This Review, Unrelated to New Code)

While researching this feature, a **pre-existing, unrelated defect** was
found: several files on `main` contained unresolved git merge-conflict
markers (`docs/user-guide.md`, `docs/troubleshooting.md`,
`docs/roadmap.md`, `docs/releases/v1.0.0-rc.2.md`, `docs/configuration.md`,
`CHANGELOG.md`, `docs/faq.md`), describing contradictory versions of the
whisper-link flow and, in some cases, a factually incorrect claim that a
"Steam instant link" capability had already shipped in a past release
(verified against the actual code at that commit — it never had). This is
a documentation defect, not a security vulnerability, and was fixed
opportunistically as part of this feature's docs work rather than left for
a separate PR.

## Evidence Artifacts

None yet — pre-implementation design review. Once implemented, standard
scanner output (Semgrep, Gitleaks, Trivy, `npm audit` for both repos) and
`npm test` results must be attached to the implementation PR(s).

## Sources

- [Design](steam-link-design.md)
- [Architecture](steam-link-architecture.md)
- [GRC Review](steam-link-grc.md)
- `docs/security/discord-player-link-hardening.md` (Core repo) — FINDING-LINK-1 through -6, the trust model and controls this feature reuses
- `src/format.js` — existing Steam ID redaction pattern this feature's logging must respect
- `src/setupServer.js` — existing OAuth `state` generation/storage pattern this feature's CSRF protection builds on
- Discord OAuth2 State and Security guidance: https://discord.com/developers/docs/topics/oauth2#state-and-security (verified 2026-07-24)
