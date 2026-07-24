# Discord → Steam → Character Linking — GRC Review

## Status

Pre-implementation compliance review for `/dune player link-steam`. This
feature introduces a genuinely new data-handling category for this bot:
third-party OAuth tokens and Steam platform identifiers, however briefly
held. It does not assert any certification claim — see
[Arrakis-Control-Panel's SOC 2 Alignment Notes](soc2-alignment.md) for the
ecosystem-wide compliance posture this feature's evidence feeds into.

## Data Classification

| Category | Present? | Notes |
|---|---|---|
| Discord OAuth access/refresh tokens | Yes, transiently | Held only for the duration of the `/users/@me/connections` fetch; never persisted beyond the request per Security Review FINDING-STEAM-6. Classified as a secret-equivalent for the brief window it exists. |
| Steam `platform_id` (SteamID64) | Yes | Already classified as sensitive elsewhere in this codebase — `src/format.js`'s `LABELED_STEAM_ID_PATTERN` already redacts Steam IDs from bot output. This feature is consistent with that existing classification, not introducing a new one. |
| Discord user ID, username | Yes | Same classification as every existing linking flow (`player:link`/`whoami`, post-rename — see Design doc's Scope Addition) — already handled today, no new category. |
| Character name / `player_controller_id` | Yes | Same classification as every existing linking flow — no new category. |
| PII beyond the above | No | No email, no real name, no payment data. Discord's `identify` scope is requested WITHOUT `email` (Design/Architecture docs specify `scope=identify connections`, not `identify email connections`) — deliberately minimal scope request. |

## Third-Party Data Handling — Discord

- **Scope requested:** `identify connections` only. `identify` is required
  by Discord's OAuth2 implementation to identify which user is completing
  the flow at all (there is no way to request `connections` alone without
  also implicitly getting basic identity) — this is the minimum scope set
  for this feature's purpose, not an over-broad request.
- **Consent is Discord-native.** The player sees Discord's own consent
  screen, listing exactly `identify` and `connections`, before anything is
  shared with the bot. No separate consent UI is built or needed on the
  bot's side — this is a genuine advantage of building on Discord's OAuth
  rather than an independent Steam-verification mechanism, which would have
  required its own consent/disclosure UI.
- **Revocation:** a player can revoke this bot's access at any time via
  Discord's own Settings → Authorized Apps, independent of anything this
  bot does. This is disclosed in the user-guide update (see Design doc).

## Third-Party Data Handling — Steam

- This feature does **not** talk to Steam's API or Steam's OpenID endpoint
  at all in v1 (that's the deferred fallback). The only Steam-derived value
  used is the `platform_id` **Discord itself already reports** as part of
  a Steam-type connection object — this feature never independently
  contacts Steam.
- The underlying `platform_id` (SteamID64) already exists in the game's own
  `dune.accounts` table, populated by the game server itself when a player
  logs in via Steam — this feature does not introduce a new place where
  Steam identifiers are collected; it only adds a new way of *matching*
  an already-Discord-disclosed value against an already-game-collected
  value.

## Data-Drift / Third-Party API Risk

- **Discord API stability:** the `connections` scope and Connection Object
  schema (including `id` being the raw platform account ID for Steam
  connections) are documented, stable parts of Discord's public API
  (verified against https://discord.com/developers/docs/resources/user,
  2026-07-24) — not an undocumented or reverse-engineered behavior. Risk of
  breaking change is the same as any Discord API dependency this bot
  already has (e.g. slash-command registration, embed formatting).
- **Recommendation:** add a `SOURCE:`-style comment in
  `steamLinkServer.js` citing the exact Discord docs URL and verification
  date for the `id`-is-raw-SteamID64 behavior, matching the crafting
  calculator's `SOURCE:` citation convention for third-party data
  dependencies — so a future maintainer has a paper trail if Discord ever
  changes this field's semantics.

## Dependency and Supply-Chain Review

- **No new npm package required.** Express is already a `package.json`
  dependency (used by `setupServer.js`); this feature's Express app reuses
  it. No new OAuth library is needed — the token exchange is a plain
  `fetch()` POST with form-encoded body, exactly matching
  `setupServer.js`'s existing (unrelated) OAuth implementation.
- **Core side:** no new npm package required — `linkAdditionalAccount()`
  and the query infrastructure it depends on already exist.

## Required Evidence for the Implementation PR(s)

Per each repo's existing conventions
(`Arrakis-Control-Panel/docs/soc2-alignment.md`'s Required Evidence
Discipline; Core's `docs/security/discord-player-link-hardening.md`'s
Verification section as the format precedent):

- PR body using each repo's `.github/PULL_REQUEST_TEMPLATE.md` (bot) /
  standard PR description (Core).
- A durable change note: bot repo should add a `docs/changes/PR-####-*.md`
  entry per its existing convention; Core repo should extend
  `docs/security/discord-player-link-hardening.md` with a new
  "FINDING-STEAM-LINK" section (or a new dedicated doc cross-linked from
  it) rather than creating an entirely separate, disconnected security
  document, since this feature is a direct extension of that finding's
  FINDING-LINK-6 work.
- Passing tests: bot repo's `node --test` suite plus the new
  `test/steamLinkServer.test.js`; Core repo's existing `npm test --prefix
  console/api` plus the new/extended test files listed in the Architecture
  doc.
- Passing security gates: both repos' existing Semgrep/Gitleaks/Trivy/`npm
  audit` pipelines, no new findings expected given zero new dependencies.
- Explicit confirmation (per Security Review FINDING-STEAM-5) that both
  repos' test suites include a case proving each bot/service starts and
  runs normally with the new OAuth secret unconfigured.

## Non-Goals / Explicit Scope Boundary

- Not a claim that this feature achieves parity with any formal identity
  federation standard (SAML, OIDC certification, etc.) — it is a
  purpose-built, minimal OAuth2 authorization-code consumer for one
  specific read (`connections`), not a general-purpose identity provider
  integration.
- Does not change this bot's Privacy Policy in any way that requires a
  policy-text update beyond what a routine feature-list refresh would
  already need — no new data category is collected that the existing
  policy's language ("Discord actor context," "game identity fields") does
  not already cover. Recommend a one-line addition to the policy's feature
  list at ship time, not a structural rewrite.
- Does not extend to the deferred Steam OpenID fallback's own GRC
  considerations (informed-consent language would differ meaningfully for
  a flow where the bot itself, not Discord, is the party a player is
  trusting to relay a Steam identity claim) — revisit this document, not
  just extend it, if that fallback is ever built.

## Sources

- [Design](steam-link-design.md)
- [Architecture](steam-link-architecture.md)
- [Security Review](steam-link-security-review.md)
- [SOC 2 Alignment Notes](soc2-alignment.md)
- [Privacy Policy](privacy-policy.md)
- `src/format.js` — existing Steam ID data-classification precedent
- `docs/security/discord-player-link-hardening.md` (Core repo) — FINDING-LINK-6, the GRC-relevant precedent for third-party-data-derived identity linking already accepted in this ecosystem
