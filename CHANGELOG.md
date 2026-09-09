# Changelog

This project follows Semantic Versioning for release tags. Security fixes,
dependency updates, and release evidence stay tied to pull requests and durable
change notes under `docs/changes/`.

## Unreleased

### Fixed (2026-09-08 remediation batch)
- **#286: `docs/user-guide.md`'s Command Groups tables had drifted significantly from the real, live command tree.** Re-verified against `src/commands.js`/`buildDuneCommand()` directly (the real source `GET /api/commands` serves), not the file the original finding mistakenly used. Fixed: `core` was missing `setup`; `server` was missing `readiness-detail`/`services-detail`/`maintenance`; `ops` was missing `announcements`/`alerts`; `admin` was missing `sync-commands`/`roles`; `inventory`/`storage`/`find` were miscategorized under `data` instead of `player` (all 12 real `player` subcommands now listed together). Added `test/userGuideDrift.test.js`, a permanent regression test that parses every `/dune <group> <subcommand>` mention out of the doc and fails CI if it ever diverges from the real registered command tree again — verified it actually catches drift via mutation testing before relying on it.
- **#281: `/dune core setup`'s generated invite link was missing `permissions=128` (VIEW_AUDIT_LOG), breaking inviter identification** — the exact same bug already fixed once for the landing-site/docs invite links (see #278), never applied to this bot-generated one. Added a regression test asserting the generated URL contains `permissions=128`; verified it fails without the fix.
- **#276 (partial): live stats (`players_online`, `spice_fields`) silently reported a fabricated `0` instead of "unavailable" when every guild's underlying Core call failed** (e.g. the systemic 403 `not_authorized` failure this issue's root-cause investigation found). `fetchAggregate()` now tracks per-field success independently of the running totals, so a field is only included in the aggregate when at least one guild's call for it actually succeeded — a real "0 online players" is still reported as 0, but "we never got a real answer from anywhere" is now correctly absent, matching `sietches`/`battlegroups`' already-correct behavior. Also: every previously-silent per-guild fetch failure (`opsActivity`/`status`/`opsResources`) is now logged with its real error/status, redacted to 200 chars — the systemic 403 that caused this issue was previously invisible in production logs, only an aggregate success/fail count was ever recorded. **The full fix (a legitimate service-to-service credential for the stats pusher, distinct from impersonating a Discord actor) is explicitly out of scope for this change** — the issue's own text says this needs a real Eight-Hats Layer 1 design pass, not an ad-hoc patch; #276 stays open to track that design.
- **#250: verified already resolved** (Steam-link Tunnel routing, fixed by the domain-consolidation cutover) — closed with live evidence, no code change needed.
- **#202: verified already resolved** (SEC-1 ineffective signature framework, removed in `406de51`) — no code change needed; the issue was simply never closed after the fix shipped in that commit.

### Added
- **`docs-check.yml` CI workflow** (`.github`#3): `link-check` (lychee, works immediately) and `docs-review` (an automated tech-writer-style review of doc changes — accuracy, staleness, clarity, completeness — via the org's shared `reusable-docs-review.yml`; skips cleanly until an `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` org secret is configured, see `Project-Arrakis/.github`'s `docs/anthropic-api-key-setup.md`). Triggered only on PRs touching markdown/docs paths.

### Fixed
- **`docs/installation-guide.md` overhauled for non-technical accessibility, plus a real self-hosted onboarding bug found in the same pass.** Added a scannable QR code (`assets/qr/invite-hosted.svg`, verified by decoding it back to plaintext, not just visually) alongside the existing hosted invite link, and a "Not sure which to pick?" decision helper up front. Removed Option 2's inline, incorrect Discord permission instructions (`Send Messages`/`Embed Links`/`Use Slash Commands` — didn't match the real invite URL's `permissions=128`, and omitted `View Audit Log` entirely, meaning self-hosters following it would never get inviter-detection working) in favor of a single cross-reference to `docs/discord-setup.md`, the one already-correct source. **Real bug found by an independent tech-writer review of this same change:** neither self-hosted path (Node.js or Docker) documented running `npm run register` — the bot would come online and respond to nothing, since slash command registration is a separate step `src/index.js` never calls itself. Added as an explicit, can't-miss step to both paths, plus a new troubleshooting entry. Also fixed: the Docker path's registration step correctly uses `node scripts/register-commands.js` directly rather than `npm run register`, since the Dockerfile deliberately strips `npm` from the final image (attack-surface reduction) — caught before shipping by testing the actual claim against the Dockerfile rather than assuming `docker compose exec ... npm run register` would work. Also fixed: stale "Arrakis Control Panel"/"ACP team" branding in `docs/admin-guide.md` and `docs/setup-portal-guide.md` (both linked from the primary, recommended hosted path), an internal step-count inconsistency, a missing "Console Adapter Credentials still applies to hosted users" scope note, and a handful of smaller clarity fixes (Role ID sourcing, `DISCORD_RBAC_MODE` explanation, Docker Desktop pointer for non-technical Docker installs, pm2-vs-systemd disambiguation).
- **`docs/admin-guide.md`/`docs/user-guide.md` never explained that this bot's role configuration and the game console's own role configuration are two separate, independently-checked decisions.** Companion to `dune-awakening-selfhost-docker`#703's L1 design doc and its own `operator-guide.md` rewrite. Added cross-references: an admin-facing note that bot roles only control which commands appear, never whether the console honors a privileged action; an end-user-facing note that a command listed and run but rejected by the console is a separate, console-side configuration issue, not a Discord role problem. Also found and filed separately as issue #286 (now fixed, see below) — the original finding compared against the wrong file, `src/commands-registry.json`, instead of the real source `src/commands.js`/the live `/api/commands` endpoint, and its "fictional `core` group" claim was itself wrong as a result (`core` is real and live); the actual drift, re-verified against `src/commands.js` directly, was `server`/`ops`/`admin` each missing several real subcommands and `player`-group commands miscategorized under `data`.

### Added
- **`requireProxySecret()` gate (`src/proxyAuth.js`)** validates a shared secret (`MENTAT_PROXY_SHARED_SECRET`/`_FILE`) against mentat-link's reverse proxy (issue #121) — `mentat-backend.darkdante.org`'s "internal-only, never advertised" posture was obscurity, not access control, since its Tunnel TLS cert is logged to public CT logs. Fail-open until the secret is configured on both sides (a deliberate two-phase rollout, not yet live).
- **Layer 2 audit hardening for the above** (issue #283, found by a retroactive eight-hats audit): `setupServer.js`'s gate now runs before `express.static()`/CORS (previously an implicit, unreviewed exemption for anything under `public/`); both apps now consistently exempt `/health`; a minimum-secret-length warning and a rollout-order warning are logged loudly at startup; the 403 response now gives an actionable message and, for a browser navigation, a rendered error page instead of a raw JSON blob; `.env.example` documents the variable with generation/rollout-order guidance.

### Changed
- **Discord Application identity swapped to the new "Sahir Venn" application** (`client_id` `1516816812006969494` → `1546203607807041697`), executed 2026-09-07 ~02:06 UTC per `docs/design/discord-application-replacement-l1-design-2026-09-06.md`. Bot token rotated, VM `.env` updated, `acp-bot.service` restarted under the new identity, slash commands re-registered. Four public-facing invite-link references (`README.md`, `docs/admin-guide.md`, `docs/quick-start-guide.md`, `docs/installation-guide.md`) updated to the new `client_id` (issue #278) — a fifth reference (`docs/DOMAIN-MIGRATION-ANALYSIS.md`) is accurate historical narrative and intentionally left as-is.

### Fixed
- **Incident record and design-doc runbook never updated after the 2026-09-07 Discord Application cutover actually happened** (issue #278). A retroactive audit had read the frozen 2026-09-06 design doc/incident record, concluded the live bot still ran the old client ID, and incorrectly filed a CRITICAL on `mentat-link` as a result (`mentat-link#120`, closed as invalid) — the real bug was the stale docs, not the bot. `compliance/evidence/incidents/2026-09-06-discord-bot-token-chat-exposure.md`'s Status/Assess/Verify sections and `docs/design/discord-application-replacement-l1-design-2026-09-06.md`'s §7 verification checklist now reflect what's independently verified (client ID live, service running) versus what's still genuinely outstanding (client secret rotation, old-token audit-log invalidation check, guild re-invite/removal, live RBAC command test) — not left implicit or assumed done.
- **Fixing the doc-staleness above surfaced a real, separate, still-open bug**: the design doc's own §3 step 6 claimed `setupPayload()`'s generated invite link (`permissions=0`) was "correct and sufficient," directly contradicting this repo's own `src/onboarding.js` comment history, which documents a real 2026-07-27 production bug where exactly that `permissions=0` shape broke audit-log-based inviter identification. The four doc files above correctly use `permissions=128` — `setupPayload()` itself does not, and was apparently never fixed after the landing site's identical bug was. Filed as issue #281 (not fixed in this change).
- **`/dune server status` used a PNG status-card image with stale "ARAKIS CONTROL PANEL" branding baked into the pixels** (issue #274). Every other command uses `duneEmbed()`; `server:status` alone still rendered a canvas-based PNG image (`sendStatusCard()`), whose background asset had the pre-Sentinel wordmark baked directly into the image pixels — missed by every text-based rebrand sweep since it's not text. The embed equivalent (`formatStatusEmbed(payload, "status")`) already existed as dead/unreachable code (an early `return true` after the PNG-card call). Removed the early return, deleted the now-fully-dead `src/statusCard.js`, `scripts/generate-status-card.js`, the wrongly-branded `assets/status-bg.png`, their exclusively-used font assets, `sendOpsCard()` (already dead from an earlier ops-group migration), and the now-unused `@napi-rs/canvas` dependency.
- **Onboarding DM silently failed to send: content exceeded Discord's 2000-character limit** (issue #272). The "Proclamation of the Mentat" rewrite (#271) never checked its content length — real messages ran ~2120-2150 characters depending on guild name/setup-link length, and Discord rejected them outright (`DiscordAPIError[50035]`), silently failing the entire onboarding DM for real guilds. Found via a live operator report. Trimmed the shared content, added `clampGuildName()` (guild names can be up to 100 characters; truncated to 40 in the greeting), and added a hard backstop `clampMessageContent()` that truncates cleanly at the last newline before 1900 characters if the message ever exceeds it for any reason — verified the absolute worst case (100-char guild name + a long custom `SETUP_URL`) now produces 1959 characters instead of exceeding the limit. 3 new regression tests pin both real-world and worst-case lengths.

### Changed
- **Onboarding DM copy rewritten in Sahir Venn's in-character Mentat voice** (issue #270). `setupMessageFor()`, `fallbackNoticeFor()`, and `ownerNoticeFor()` in `src/onboarding.js` now read as a formal "Proclamation of the Mentat" — framed as Sahir Venn's response to a guild accepting his offered service, not as an invitation itself. The two full-setup variants share a common header/footer (`proclamationHeader()`/`proclamationSetupSteps()`) so they can't drift out of voice with each other, differing only in their opening line (confirmed vs. presumed inviter). The real, functional setup steps and dynamic setup link are unchanged in substance — only reframed in voice.

### Fixed
- **`admin:broadcast` tier enforcement bug + `ops:location` raw-404 message** (issue #268), found during a read-only command-completeness audit. `canBroadcast()` passed a `null` requiredTier into `canWrite()`, which silently defaults to admin-tier — denying a moderator even though both the command's own Discord description ("moderator+") and its own denial error message ("requires moderator or admin role") advertised moderator access. Fixed to request "moderator" explicitly. Also fixed `/dune core help`'s classification of `admin:broadcast` (was using the generic any-configured-role default instead of the real gate, so a Player with no write access could see it listed as "available") and the live `GET /api/commands` registry entry (was `role: "admin"`, now `role: "moderator"` — this feeds the docs site's command-reference accordion directly, so it was a real user-facing inaccuracy). Separately, `ops:location` surfaced a raw `Adapter ops-location returned HTTP 404.` error instead of an actionable message — it's deliberately classified `PLANNED_ROUTES` (Core intends to ship it) rather than `MISSING_ROUTES`, but had no special-case error handling; added one. New regression tests in `test/broadcast.test.js` and `test/discord-bot-test-harness.js`.
- **Remaining docs flagged out-of-scope in #260, now fixed** (issue #260 follow-up). `docs/issue-bridge/github-app-manifest.json` had the same stale `yacketrj/arrakis-control-panel` URLs as the prose fixed in #261, but as a real GitHub App manifest (not prose) was deferred for its own pass — now points at `Project-Arrakis/mentat`. `book.json` (the live GitBook config) still branded the whole site "Arrakis Control Panel" in its title/description/author and pointed its sidebar links and `github` plugin at the stale `yacketrj/arrakis-control-panel` repo — rebranded to Mentat and repointed to `Project-Arrakis/mentat`. `docs/SUMMARY.md` and `docs/DEPLOYMENT-SUMMARY.md` had the same stale GitHub URLs. `docs/kv-replacement-evaluation.md` described the setup-portal route as reachable via `acp-setup.darkdante.org`, now `mentat-backend.darkdante.org` per the domain-consolidation work. `docs/releases/v1.0.0-rc.5.md`'s "Bot repository" line is accurate history for its release date — annotated with the current name rather than rewritten.
- **Architecture/hostname regressions and GitHub App account contradiction missed by #261** (issue #262). A follow-up `/code-review high` pass against #261 found real gaps it left in place: `compliance/runbooks/backup-recovery.md` and `INSTALL.md`'s Cloudflare Tunnel ingress examples still pointed the direct-to-VM route at `mentat-link.darkdante.org`, which is now a Cloudflare Pages custom domain, not a Tunnel target — corrected to the real internal-only `mentat-backend.darkdante.org` hostname, and the Steam-link path corrected from the old `/auth/steam` to the real `/steam-link`. `docs/issue-bridge/github-app.md` instructed creating the GitHub App under the personal `yacketrj` account with "Only on this account" scope, then installing it on the `Project-Arrakis` org's repos — a personal-account-scoped App cannot be installed elsewhere; fixed to consistently target the org throughout. `.env.example`'s `LIVE STATS` comment block still referenced `acp-setup.darkdante.org`/"the acp-landing site", both renamed everywhere else in the same file by #261. `docs/steam-link-architecture.md` flagged an already-fixed Steam-link Tunnel routing gap as still open — added a correction note.
- **Full documentation remediation before go-live** (issue #260). A
  dedicated tech-writer-style documentation review plus a `/code-review
  high` pass found a large amount of stale, fictional, or contradictory
  content accumulated across the Sentinel→Mentat rebrands and several
  infra migrations. Fixed: `README.md`'s command table (previously
  missing the entire `player` and `logs` groups) rebuilt from the real
  `src/commands.js` registry, plus its stale branding/clone-URL/version;
  `docs/quick-start-guide.md`'s "Available Commands" section (previously
  entirely fictional bare commands like `/status`/`/link-steam`) rewritten
  to real `/dune <group> <subcommand>` examples, and its false Discord
  "Browse Available Bots" discoverability claim removed;
  `docs/installation-guide.md`'s env vars, systemd, and Docker sections
  rewritten to match reality (pointed at this repo's own real
  `systemd/acp-bot.service`/`docker-compose.example.yml` instead of
  divergent hand-written copies; noted plainly that no published
  container image exists); `INSTALL.md`'s "no shared hosted bot" claim,
  which directly contradicted the real hosted-bot model documented
  elsewhere, corrected, and its R740 co-location section marked
  superseded/historical (that plan was rejected in favor of a dedicated
  Services-VLAN VM); `docs/discord-setup.md` given a self-hosted/DIY
  clarifying banner matching `docs/admin-guide.md`'s existing pattern;
  `.env.example`/`docs/configuration.md` given the previously-undocumented
  `MENTAT_*`/`SENTINEL_*`/`ACP_*` canonical/legacy env var scheme and the
  Steam-link port/base-URL settings; 7 `docs/issue-bridge/*` files' stale
  `yacketrj/*` slugs fixed to `Project-Arrakis/*`;
  `docs/DOMAIN-MIGRATION-ANALYSIS.md` marked superseded/historical;
  `docs/setup-portal-guide.md` and `docs/troubleshooting.md` both had the
  same real, blocking wrong env var name
  (`DUNE_BOT_API_TOKEN_FILE` → `DUNE_DISCORD_ADAPTER_TOKEN_FILE`), fixed
  in both places, and `setup-portal-guide.md`'s role-field count corrected
  (2 documented vs. the real 3: Admin/Moderator/Player); stale
  `acp-setup.darkdante.org` hostname references fixed across
  `docs/admin-guide.md`, `compliance/runbooks/backup-recovery.md` (which
  also had its one "ACP bot" phrasing corrected to Mentat/Sahir Venn), and
  the files above; stale GitHub issue links fixed in
  `docs/troubleshooting.md`/`docs/user-guide.md`.
- **`/dune core about` no longer reports the bot's name as `arrakis-control-panel`.** `aboutPayload()`'s hardcoded `bot.name` field was missed by the Phase 4 Mentat rebrand (which only covered embed footers, onboarding DMs, setup-portal pages, `/api/version`/`/health`, the status-card caption, and `package.json` — not this specific API-response field). Corrected to `mentat`, matching `package.json`'s own `name`. Also fixes the Steam-link health endpoint's `service` field (`acp-steam-link` → `mentat-steam-link`, matching the sibling setup server's own `mentat-setup` naming). Found by a dedicated documentation review pass, not a targeted search — the test asserting the old value (`test/discord-bot-test-harness.js`) had itself hardcoded the stale name as its own expectation, so this had zero test-driven pressure to fix until now.
- **#196 (registry/command-tree divergence) and #208 (registry-loader cleanup) resolved.** Direct re-verification found #196's own four-part remediation (curated `getCommandRegistry()` serves the public `GET /api/commands` contract; `registryLoader.js`'s module comment re-scopes `commands-registry.json` as an internal Core-catalog artifact, not a full command reference; `syncCommandsPayload`'s false "bot will use updated commands" claim already removed; the committed artifact already regenerated via the fixed envelope/v2 transform) was already shipped in the 2026-08-20 remediation batch — the issue was simply never closed. The 29-subcommand-vs-56-real-command count this issue's title describes is not itself a defect under that corrected scope (the registry deliberately only covers Core-routed commands); closed with that evidence rather than chasing a 1:1 count match. #208's remaining 2 of 5 sub-findings (3 were already fixed alongside #196) are genuinely fixed here: the one-line "sum subcommands across groups" reduce, previously duplicated across `registryLoader.js`/`commands.js`/`scripts/generate-command-registry.js`/`scripts/validate-command-registry.js`, is now `catalogTransform.js`'s single exported `countSubcommands()`; the committed registry no longer doubles its size storing each subcommand's already-redundant `routes[]` array (confirmed via full-codebase grep that nothing ever read it) — `src/commands-registry.json` roughly halved in size as a direct result.
- **`/dune player faction` no longer claims to "set your faction."** Core's real `players-faction` route (`dune-awakening-selfhost-docker#696`) is read-only, auto-detected from the caller's real `dune.player_faction` — it never accepted the old `name` option's value even before this fix, since the route didn't exist at all until then. Removed the now-meaningless option, corrected the description everywhere this repo hand-maintains it, and added a dedicated `formatFactionEmbed()`.
- **`guild_settings.faction` (per-Discord-server cosmetic theme) is reachable again.** `setGuildFaction()` had been defined but never called by any command since it shipped. `/dune player faction` now triggers a best-effort background sync (`guildFactionSync.js`) that tallies each bot-active Discord member's real **in-game guild's** faction (`dune-awakening-selfhost-docker#699`/`#700`'s `guilds/faction-summary` route — a different game concept from an individual's own personal faction) and updates the theme from the majority result. Member list comes from a new local `guild_member_activity` table (schema v5), not a real Discord member fetch, since this bot only holds the `Guilds` gateway intent.
  - **Regressed by the v6→v7 SQLite hardening pass below, same Unreleased section (mentat#276, L2 finding on #277):** `guild_member_activity` — this feature's only data source — was deleted as dead weight without noticing it was load-bearing for this entry. `guildFactionSync.js`/`syncGuildFactionTheme()` are gone and `/dune player faction` no longer calls either, so `setGuildFaction()` is once again uncalled dead code and every guild's themed-embed faction is stuck at the empty-string default — the exact state this entry describes as fixed. See mentat#311 for the follow-up decision (reintroduce a manual setter vs. remove the dead column/functions). Left as a documented known limitation rather than silently shipping this entry's claim as false.

### Added
- **Mentat voice pass**: `src/quotes.js`'s flavor-text pool now mixes
  genuine Frank Herbert Dune-novel lines about Mentats/logic (verified
  against the books, not the 1984 film's "It is by will alone..." mantra,
  which is a film-only invention and deliberately not used) with original
  lines written in the same computational voice. New
  `randomComputationOpener()` adds a short computation-style line above
  the status header in `formatStatusEmbed`, `formatStatusDetailEmbed`,
  `formatPopulationEmbed`, and `formatDoctorEmbed` — e.g. "*First-level
  analysis complete.*" above a server status report. New
  `test/quotes.test.js` covers both functions directly (previously
  `quotes.js` had no dedicated test file, only indirect coverage via
  embed-format regression tests).
- **Sahir Venn — the bot's named persona.** "Mentat" remains the
  role/category (Dune-lore usage: "a Mentat"); Sahir Venn is introduced
  as the specific one serving Dune: Awakening Docker. Embed footers and
  the status-card caption now read "Sahir Venn — Mentat of Dune:
  Awakening Docker"; the onboarding welcome DM and owner notice
  introduce Sahir Venn by name; flavor-text quotes shown in embeds
  (`src/quotes.js` via `duneEmbed()`) are now signed "— Sahir Venn".
  Deliberately unchanged: the `/dune core help` embed title and the
  synthetic system-actor username used in scheduler/stats/notification
  audit-log attribution — these are functional/reference labels, not
  persona-voiced moments.

### Changed
- **RBAC: owner-tier access is now derived exclusively from real Discord
  guild ownership, never a role — aligned with `dune-awakening-selfhost-docker`'s
  tier1-upstream console design (issue #238).** Previously an operator could
  map any Discord role to the "owner" tier during `/setup`, with no tie to
  who actually owns the server — a real divergence from Core's design
  (`rfc-console-auth.md` sec2.1.1: owner "never from a role"), risking the
  bot allowing an action Core would deny (or vice versa) for the same
  Discord member.
  - The "Owner Role" setup-form field is removed. Owner-tier access
    (`canWrite(requiredTier="owner")`, admin-gate bypass, command
    authorization) now always belongs to whoever Discord itself reports as
    the guild's owner (`interaction.guild.ownerId`), checked live on every
    command — no configuration needed, and it can never be reassigned.
  - **Backward compatible, no schema change**: an existing guild's stored
    `role_type='owner'` row in `guild_roles` (from before this change) is
    left in the database untouched but is now inert for authorization; the
    `/dune core roles` display surfaces a one-time notice when this is
    detected so operators aren't left wondering why it stopped working.
  - **Lockout risk removed, not just parity**: the previous "must map at
    least an Admin or Owner role, or nobody can administer the bot" setup
    validation is gone — it's now structurally impossible to lock out the
    real server owner, since they always have owner-tier access regardless
    of role configuration.
  - **Separation of duties enforced**: `/setup/register` now rejects (and
    names) a submission that maps the same Discord role to two different
    tiers (admin/moderator/observer), matching Core's own SoD behavior on
    its Settings panel.
  - `DISCORD_WRITE_OWNER_ROLE_IDS` (single-tenant env-var deployments) no
    longer grants owner-tier access — it's folded into the admin-equivalent
    set instead (matching `isAdminActor()`'s existing back-compat
    behavior), so an existing deployment doesn't lose admin-level access,
    but can no longer reach owner-tier write actions via that env var.
- **Rebrand: Sentinel → Mentat (Phase 4 of the Project Arrakis rename).**
  Application branding (embed footers, onboarding DMs, setup-portal pages,
  `/api/version`, `/health`, the status-card image caption, `package.json`)
  now says "Mentat" instead of "Sentinel". See
  `docs/env-var-compatibility.md` for the new environment-variable
  compatibility layer this introduces.
  - New `MENTAT_*` canonical environment variables, with `SENTINEL_*` and
    `ACP_*` accepted as deprecated aliases (`SENTINEL_*` takes precedence
    over `ACP_*` if both are set to different values) for: `BASE_URL`,
    `MULTI_TENANT`, `SETUP_PORT`, `CONSOLE_DASHBOARD_URL`,
    `GRAFANA_DASHBOARD_URL`, `OAUTH_REDIRECT_URI`, `STEAM_LINK_PORT`,
    `STEAM_LINK_BASE_URL`, `INSTANCE_ID`, `STATS_ENABLED`, `SETUP_URL`.
    Existing `ACP_*` deployments continue to work unchanged; a one-line
    deprecation warning (variable names only, never values) is logged once
    per process start for anyone still on the old names.
  - **`ACP_DB_PATH` is intentionally NOT yet included above.** It is
    deferred until the `acp.db` → `mentat.db` file migration ships
    (tracked separately) — adding a `MENTAT_DB_PATH` alias before that
    migration exists could point a fresh deployment at a silently-created,
    empty database. Set `ACP_DB_PATH` as before in the meantime.
  - The synthetic system-actor username in stored notification/audit
    records changes from `"ACP"` to `"Mentat"` going forward only —
    existing historical records are not rewritten.
  - Legacy alias removal will only happen in a future release explicitly
    marked "breaking" in this file.

### Added
- **Phase 2: Bot-side command registry generator** (#180, depends on
  dune-awakening-selfhost-docker#337 Phase 1 Core endpoint):
  
  **SCOPE: Generation-only. Phase 3 (runtime loading) is a separate PR.**
  
  - New `scripts/generate-command-registry.js` — fetches Core's catalog
    endpoint (`GET /api/integrations/discord/catalog`) and generates
    `src/commands-registry.json` artifact with bot-side overrides applied.
    Validates that Core provides minimum required routes for bot operation.
  - New `src/commandOverrides.json` — allowlist, rename rules, and tier
    adjustments (exclusions, renames, retier) for bot-specific command
    customization (documented in RFC Phase 2 section)
  - New `src/commands-registry.json` — committed artifact (generated by
    generator script) that serves as audit trail of command definitions
    at each version. **Currently not loaded at runtime** (Phase 3 work).
  - New CI gate `npm run registry:validate` — validates committed registry
    is well-formed (schema, structure, metadata)
  - New npm scripts: `registry:generate` (requires Core), `registry:validate` (CI)
  - Comprehensive test suite: catalog schema validation (L0), route
    coverage (L1), override application (L2), Discord constraints (L3),
    metadata (L4), boundary conditions (L5)
  - Fully documented in `docs/rfc-command-discovery.md` Phase 2 section
  
- **Phase 3: Runtime registry loading + Core catalog drift check** (#181;
  scope corrected 2026-08-20 by the #190 review remediation — this entry
  previously claimed ETag conditional requests, `registryToDiscordFormat()`
  runtime conversion, registry-driven `getCommandRegistry()`, and
  graceful degradation on load failure, none of which was true of the
  code as shipped):

  - New `src/registryLoader.js` — loads the committed
    `src/commands-registry.json` at startup (`loadRegistryAtStartup()`),
    validates it (Discord naming/size constraints), and caches it
    in-memory (`getRegistryFromCache()`). Loading is **mandatory**: the
    bot refuses to start (`process.exit(1)`) on a missing/invalid
    registry — there is deliberately no degraded mode.
  - The committed registry is an INTERNAL artifact describing Core's
    Discord-adapter catalog. The public `GET /api/commands` contract
    remains the curated list in `getCommandRegistry()` (see Security
    below for why).
  - New operator command `/dune admin sync-commands` — a **read-only
    drift check**: fetches the invoking guild's own Core catalog,
    validates it, and reports how it differs from the committed
    artifact. It never mutates shared state and never re-registers
    Discord commands (registration only changes on deploy); drift is
    acted on by regenerating the artifact (`npm run registry:generate`)
    and deploying.
  - New shared `src/catalogTransform.js` — envelope unwrap + v2
    `routes[]` flattening + override application, used identically by
    the Phase 2 generator and the runtime drift check, tested against a
    captured real production catalog fixture.

### Security
- **2026-08-20 code-review remediation** (tracking issue #190; 25
  verified findings from a max-effort multi-agent review of the Phase 3
  branch, all filed as issues #191–#208):
  - Untracked `runtime/bot.db` (multi-tenant credential store schema)
    from git and ignored `runtime/`, `data/`, `*.db` (#191). The
    committed blob was schema-only — no secret leaked.
  - Removed the cross-tenant registry poisoning path: one guild's
    `/dune admin sync-commands` could overwrite the registry served to
    every tenant and the public API with its own Core's (potentially
    hostile) catalog (#192). Syncs are now side-effect-free per-guild
    drift checks.
  - Restored the public `GET /api/commands` contract
    (`{group,title,commands:[{name,desc,role}]}`) that the acp-landing
    accordion consumes — the branch had broken the production landing
    page and simultaneously disclosed Core's internal adapter routes/
    capabilities/methods to unauthenticated callers (#193, #203). The
    shape is now pinned by `test/commandRegistryContract.test.js`.
  - Removed the ineffective SEC-1 registry-signature framework
    (committed default HMAC key, short-circuiting compare,
    `signatureVerified` always false, nothing signs) — #202 tracks a
    real Core-side signing design.
  - Setup portal: removed the Generate-token button that minted tokens
    Core can never accept (#194); guild names are now resolved
    server-side instead of persisting "Unknown" for every setup (#195);
    the console-restart warning now gives the correct, working command
    (`dune console restart`) instead of naming a nonexistent compose
    service (#197); the success page looks the guild up by id instead
    of double-decoding attacker-influencable query text (#198); the
    setup log no longer records each tenant's console host (#207).
  - sync-commands failures are classified by the adapter's real HTTP
    status instead of message substrings (#199); `sync-commands` is
    listed in `/dune core help` (#200); the register endpoint's covering
    test asserts the real 302 contract (#201); registry name validation
    rejects uppercase names again (#206); dead
    `registryToDiscordFormat()`/ETag state removed (#208).

### Fixed
- **2026-08-20 UI/UX verification-pass remediation** (a second, independent
  UI/UX Designer hat dispatch verified the remediation below against real
  rendered output and real Core provider shapes; found and fixed one
  regression the remediation itself introduced plus residual gaps,
  issues #219–#221):
  - **Security regression, introduced by the #210 fix and closed same-day**
    (#219): the ops group and `infra:version` built their embeds at
    dispatch time from the payload BEFORE `redactSecrets()` ran, so a
    secret in an ops/version response could reach the sent embed
    verbatim. Dispatch now records the formatter, never a built embed;
    the embed is always built after redaction.
  - **Dedicated ops formatters read field names Core never sends** (#220):
    verified against Core's real providers (`console/api/src/duneDb.js`)
    that `formatResourcesEmbed`/`formatEconomyEmbed`/`formatCombatEmbed`
    used invented field names (`smallActive`, `totalSietches`,
    `totalCurrency`, object-shaped `deathCauses`) instead of Core's real
    ones (`sizes[]`, `haggaBasin.instances`, `totalSupply`,
    array-shaped `deathsByCause`) — real deployments would have seen
    self-contradicting zeros and "— None —" on data that was actually
    present. Rewritten against Core's real shapes with legacy fallbacks,
    pinned by fixtures matching the real provider return values.
  - `/dune ops alerts` gets a dedicated formatter — was rendering firing
    alerts as `[object Object]` (#221).
  - Residual "observer" leaks removed from the `admin roles` slash-command
    description and help metadata — "player" is now the label everywhere
    a user can see it, completing the #217 directive.
  - `/dune server summary` no longer shows a bolded "**unknown**" for
    missing region/mode/population.
  - `formatVersionEmbed` field names no longer show literal `**asterisks**`
    (Discord doesn't render markdown in field names).
  - A log line containing a literal triple-backtick can no longer break
    out of the log code fence.
- **2026-08-20 UI/UX review remediation** (27 verified findings from a
  dedicated UI/UX Designer hat review of all bot output, issues
  #210–#218; "Player" is now the canonical user-facing tier label on
  every display surface — internal config/DB keys keep "observer" so no
  operator deployment breaks):
  - `/dune core help` now renders the FULL command surface via the
    dedicated help formatter, one field per group — the generic
    formatter's 5-item slice hid ~90% of commands (#210). The embed
    selection chain no longer overwrites dispatch-chosen embeds, which
    had also silently discarded every dedicated ops/version formatter.
  - `/dune ops alerts` fixed (fell through to a nonexistent adapter
    method and replied with a raw JS error, #211); `/dune ops resources`
    no longer crashes on summary-less payloads (`sf`/`ssf`
    ReferenceErrors), and empty top-lists no longer emit empty fields
    Discord rejects (#212).
  - Multi-tenant first-run dead ends closed (#213): unconfigured guilds
    get the setup-portal link instead of a blanket denial; `/dune core
    setup` shows the portal link in multi-tenant mode; denials name the
    next step; the portal requires an Admin/Owner role mapping instead
    of completing a setup that locks everyone out.
  - Setup portal (#214): token instructions now include creating the
    token file (Core only reads it — following the old instructions
    verbatim dead-ended at a missing file and a 503); register errors
    render styled pages instead of raw JSON; dead notification markup
    removed.
  - Accuracy (#215): error footers show the real version (ESM `require`
    bug made every error footer "vunknown"); missing population data
    renders an honest warning instead of a green "unknown players
    online"; "saved securely" is only claimed when at-rest encryption is
    actually configured; `/api/version` reads package.json;
    storage/economy status colors key on rendered data.
  - `admin:latency`/`admin:events` now enforce the admin gate their
    documentation always claimed (#216).
  - Consistency (#217): one tier vocabulary (Player/Moderator/Admin/
    Owner) across portal, help, public registry, and setup embed; public
    registry roles/names corrected to match real enforcement (logs and
    maintenance are player-tier; `logs console` →
    `redblink-dune-docker-console`); one footer format; one error red.
  - Polish (#218): no flavor quotes on error/denial embeds ("Obey or be
    destroyed." under a denial read as taunting); 🏜️ welcome instead of
    the 🐛 bug emoji; honest onboarding time estimate; markdown-safe
    truncation; status card gains a text summary (screen readers,
    notification previews) and a population-aware cache key; overflowing
    embeds say "…and N more" instead of silently dropping fields.
- Upstream compatibility pin refresh, `v1.3.79` -> `v1.3.87` (#172). Found
  and fixed a real production 404 bug and a documentation defect:
  - **False LIVE claim, now corrected:** `players-accounts-list`,
    `players-accounts-unlink`, and `players-accounts-link-steam` were
    marked LIVE and "verified 2026-08-06 at upstream tag v1.3.79" -- that
    claim was false. Direct inspection of every tagged upstream release
    (`v1.3.79` through `v1.3.87`) found these `players/accounts/*`
    multi-account routes have never existed in any tag. They were
    transiently added in an untagged upstream commit (2026-08-10) alongside
    a provider file that was never actually committed (broken import,
    server crashed on boot), then fully reverted the next day, before ever
    reaching a tag. Real, live blast radius against any real,
    unmodified, current upstream-based Core install: `/dune player
    characters`, `/dune player unlink <playerControllerId>`, and the
    Steam-link OAuth callback flow (the internet-facing
    `acp-setup.darkdante.org/steam-link/*` endpoint) all 404 today. All
    three are now correctly classified `MISSING_ROUTES` in
    `src/adapterClient.js`.
  - **Real regression:** `ops-dashboard` was genuinely LIVE at `v1.3.79`
    but upstream's replacement `opsRoutes` dispatch table silently omits
    it, so `/dune ops dashboard` now 404s at `v1.3.87`. Reclassified
    `MISSING_ROUTES`.
  - **Stub-to-hard-404 drift:** `ops-location` was already correctly
    classified as returning a `{ status: "planned" }` stub, but the same
    dispatch-table change means it now hard-404s instead -- kept
    `PLANNED_ROUTES` (the feature intent is unchanged) but callers must no
    longer assume "planned" means "safe 200".
  - **Safe-direction correction:** `backups`, `announcements`, and
    `maintenance` were classified `PLANNED`/`MISSING` at `v1.3.79` but now
    have real, working handlers at `v1.3.87` -- reclassified `LIVE_ROUTES`.
  - Added graceful, actionable error handling at every real call site
    instead of a raw 404/502: `src/commands.js`'s command-dispatch catch
    block now gives a clear "not available on this Core installation...
    known limitation, not a configuration problem" message for any
    `MISSING_ROUTES` failure (covers `/dune player characters`, `/dune
    player unlink`, `/dune ops dashboard`); `src/steamLinkServer.js`'s
    Steam-link OAuth callback now falls back to the existing, working
    whisper-code verification flow instead of a generic "Something Went
    Wrong" page.
  - `scripts/operator-smoke.js`/`scripts/mock-adapter.js`: removed
    `ops-dashboard`/`ops-location` from the routes the operator smoke
    check exercises -- both now genuinely 404 against real upstream, so
    `npm run smoke:adapter` against any real, current Core install would
    otherwise throw an uncaught error and crash the entire smoke check
    instead of reporting a clean per-route pass/fail.
  - Updated `docs/adapter-contract.md`, `docs/upstream-source.md`,
    `docs/upstream-write-adapter-rfc.md`, `docs/roadmap.md`,
    `docs/steam-link-architecture.md` to the corrected `v1.3.87` evidence
    and route table. `docs/ro-roadmap-state-2026-08-06.md` (the prior
    evidence snapshot containing the false claim) carries an explicit
    correction notice at its top rather than being silently rewritten.

### Security
- Phase 1 of the ecosystem-wide secrets management epic (#112, design doc
  `docs/design/pki-cmk-secrets-l1-design-audit-2026-08-08.md`), closing
  issues #107 (SEC-1: `ACP_SECRETS_KEY` visible in `/proc`), #108 (GRC-1:
  no break-glass recovery path), and #109 (SEC-2: single master key
  encrypts all rows):
  - New KEK/DEK hierarchy: an operator-controlled age identity key
    decrypts a KEK, which unwraps a per-row DEK for each individual
    `adapter_token`/`access_token` value. Compromising one row's wrapped
    DEK exposes only that row, not every secret in the database. Wired
    into `getGuild()`/`upsertGuild()`/`getOauthSession()`/
    `updateOauthSession()` — every existing caller continues to receive
    plain values exactly as before.
  - `scripts/setup-keys.js` — generates the age identity, KEK, and (by
    default) Shamir M-of-N recovery shares or a QR code backup.
  - `scripts/rotate-keys.js` — non-breaking KEK rotation: only the
    32-byte wrapped DEKs are re-wrapped, no data row is re-encrypted, and
    every row remains readable throughout.
  - `scripts/recover-keys.js` — break-glass recovery from Shamir shares
    or a decoded QR code, with a real encrypt/decrypt round-trip
    verification before ever writing a recovered identity to disk (a
    wrong or insufficient set of shares fails loudly, not silently).
  - New `key_versions`/`secret_keys`/`secret_access_log` tables (schema
    v4, purely additive — existing databases gain these empty tables on
    next start with no migration step). `secret_access_log` is an
    append-only audit trail of every encrypt/decrypt/decrypt-failure/
    rotate event (GRC-2, issue #111) — never the secret value, DEK, or
    KEK itself.
  - Existing `enc:v1:` (single-key) rows remain readable unchanged and
    are only upgraded to the per-row DEK format on their own next write —
    no forced migration.
  - `/proc` exposure mitigation: a startup warning when `ACP_SECRETS_KEY`
    is set as a direct env var (SEC-1), recommending the file-based
    `_FILE` variant or the KEK/DEK path instead.
  - Startup file-permission check (SEC-4) warning on any configured
    secret file (`ACP_SECRETS_KEY_FILE`, `ACP_AGE_IDENTITY_FILE`,
    `ACP_KEK_FILE`) that isn't mode 0600/0400.
  - Also fixed, while touching this exact code: `loadKEK()`'s `age
    --decrypt` invocation used a shell-interpolated command string
    (`execSync`) despite its inputs (`ACP_KEK_FILE`/
    `ACP_AGE_IDENTITY_FILE`) being operator-controlled env vars, not
    hardcoded constants — a real, if narrow, command-injection surface.
    Switched to `execFileSync()` with an argument array, matching every
    other `age` invocation across the three new scripts.
  - New dependencies: `shamirs-secret-sharing` (Shamir secret sharing,
    zero transitive deps) and `qrcode` (QR code image generation).
  - See `docs/security-secrets-at-rest.md`'s new "KEK/DEK hierarchy"
    section for setup, rotation, and recovery instructions.
- `POST /api/alerts/relay` (issue #167) had zero authentication — anyone
  who discovered the URL (publicly routable through the Cloudflare Tunnel
  at `acp-setup.darkdante.org`) could inject arbitrary-looking Alertmanager
  firing/resolved payloads and have them relayed to the real, configured
  Discord channel as if genuine (spoofed outage alerts, or suppressing
  awareness by mixing in falsified "resolved" noise). Added an optional,
  backward-compatible shared-secret check: `DUNE_ALERT_RELAY_TOKEN` (direct
  value or `_FILE` path, matching this repo's existing secret-handling
  convention) is validated against the request's `Authorization: Bearer`
  header using a constant-time comparison. If unset, the route still
  accepts requests (logging a warning on every one) so existing
  deployments are not broken the moment this ships — but any deployment
  that has `DUNE_ALERT_WEBHOOK_URL` pointed at a real channel should set
  this. See `dune-awakening-selfhost-docker`'s companion fix (wiring
  Alertmanager's own `webhook_configs[].http_config.authorization` to send
  this token) for the other half of this fix.

### Fixed
- `main`'s CI had been red for 6 days (issue #162) after the v1.0.0-rc.5
  "OPS embeds" release changed all 10 `ops:*` commands from PNG status-card
  rendering to Discord embeds without updating the tests that pinned the old
  behavior. Real, verified failure count was **12** (not the 49 originally
  reported in #162, which double-counted the Node test runner's spec-reporter
  output — once during the run, once again in its trailing summary):
  - 10 `test/discord-bot-test-harness.js` cases (`ops:activity` through
    `ops:announcements`) asserted `interaction._editReply.files[0]` (a
    `status-card.png` attachment); updated to assert
    `interaction._editReply.embeds[0]` instead, matching the real,
    current `src/commands.js` dispatch.
  - `test/operatorValidation.test.js`'s "malformed JSON response is handled
    gracefully" test asserted `AdapterClient.parseResponseBody()`'s
    *pre-rc.5* contract (`{ ok: true, body: text }`); updated to assert the
    real, current, deliberately fail-safe contract
    (`{ ok: false, error: "Unexpected response format (...)" }`).
  - `test/commands.test.js`'s `helpPayload` regression guard expected 55
    registered non-write commands but `helpPayload()`'s hardcoded command
    list was actually missing `ops:alerts` (registered and dispatchable via
    `buildDuneCommand()`/`OPS_SUBCOMMAND_NAMES`, but never added to
    `helpPayload()`'s `all` array) — a real, separate `/dune help`
    completeness bug, not just a stale test expectation. Added the missing
    entry to `src/commands.js`.
  - `addon/addon.json`'s version (`1.0.0-rc.2`) had not been bumped since
    rc.2, three releases behind `package.json`'s `1.0.0-rc.5` — `npm run
    check`'s `release:check` step was failing independently of the test
    failures above. Bumped to match.
  - `docs/releases/v1.0.0-rc.5.md` and this file's own `## v1.0.0-rc.5` entry
    (see below) had never been added at release time — `release:check`'s
    release-notes-file and changelog-entry gates were failing for this
    reason too. Added retroactively.
- Corrected 10 files that falsely described the ACP bot's planned OCI-to-R740
  migration as already completed (#164) — the bot remains a live,
  currently-running production service on its existing OCI VPS; the R740
  `dune-prod` VM does not exist yet (confirmed via `qm list` on the live
  Proxmox host). Affected: `README.md`, `INSTALL.md`,
  `docs/admin-guide.md`, `docs/configuration.md`,
  `docs/multi-tenant-design.md`, `docs/kv-replacement-evaluation.md`,
  `docs/openbao-transit-evaluation.md` (including a specific, concrete
  false claim: "verified on the live R740 DB"), `docs/steam-link-architecture.md`,
  `scripts/deploy-post-receive.sh`, `compliance/runbooks/backup-recovery.md`.
- `scripts/deploy-post-receive.sh` was missing a dirty-working-tree guard
  before `git reset --hard` (#2) — a debugging session on the deploy
  target would have its in-progress work silently discarded by the next
  deploy. Added an explicit check that refuses to deploy if the working
  tree has local modifications.
- `src/scheduler.js`'s daily digest previously hardcoded the original
  maintainer's own real dashboard URLs (console + Grafana) directly in
  source — every deployment of this bot would have posted those same
  links regardless of who was actually running it. Added
  `ACP_CONSOLE_DASHBOARD_URL`/`ACP_GRAFANA_DASHBOARD_URL` config vars;
  the digest now omits these lines entirely when unset instead of
  showing a dead placeholder link.

### Added
- **ACP Issue Bridge** (#184) — fail-closed synchronization between the
  public community repository (`yacketrj/acp-discordbot`) and this
  engineering repository. Public issues/comments/edits/closes/reopens/
  allowlisted-labels mirror inward automatically; private engineering
  activity only ever crosses outward through an explicit, authorized
  `/public`, `/public-status`, or `/public-resolution` command, gated by
  a permission matrix, a security-sensitive lockdown with two-step
  recovery, and an outbound secret/private-URL scanner. See
  `docs/issue-bridge/` for the full architecture, STRIDE threat model,
  command reference, and administration guide, and the implementation
  report on issue #184 for test evidence and a live smoke-test
  transcript against the real repositories. 240 automated tests
  (188 unit, 52 integration/security), 0 semgrep/gitleaks findings.
  GitHub App creation is a documented, one-time manual operator step
  (`docs/issue-bridge/github-app.md`) — GitHub Apps cannot be created
  headlessly; everything else is fully implemented and fails closed
  until the App exists.
- `tests/no-personal-identifiers.sh` — this repo had no guard against
  committing real personal infrastructure identifiers (the real OCI VPS
  IP had been sitting in git history with nothing to catch it). Ported
  from `r740-dune-deployment-kit`'s identical guard, scoped to this
  repo's own real values. Wired into `.pre-commit-config.yaml` and a new
  `personal-identifier-guard` CI job in `.github/workflows/security-gates.yml`.
  Deliberately excludes `acp-setup.darkdante.org` from its denylist —
  that's a real, intentionally-public product URL already shown openly
  in `README.md`/`docs/admin-guide.md`/`docs/setup-portal-guide.md`, not
  sensitive infrastructure.

## v1.0.0-rc.5 - 2026-08-10

Fifth release candidate. OPS commands (`activity`, `combat`, `resources`,
`economy`, `armory`, `location`, `soc`, `prometheus`, `dashboard`,
`announcements`) migrated from PNG status-card rendering to Discord embeds via
a unified output pipeline, plus UX polish. Consolidated here from the tagged
release (`v1.0.0-rc.5`) because the corresponding `docs/releases/` file and
`CHANGELOG.md` entry were never added at release time (#162's release-gate
audit) — this entry and `docs/releases/v1.0.0-rc.5.md` are being added
retroactively, verified directly against the current code rather than
reconstructed from commit messages the squashed repository history no longer
carries granular detail for.

### Changed
- All 10 `ops:*` subcommands now render as Discord embeds
  (`formatActivityEmbed`, `formatCombatEmbed`, `formatResourcesEmbed`,
  `formatEconomyEmbed`, `formatOpsInventoryEmbed`, `formatLocationEmbed`,
  `formatSocEmbed`, `formatPrometheusEmbed`, `formatDashboardEmbed`,
  `formatAnnouncementsEmbed` in `src/embedFormat.js`), dispatched from
  `src/commands.js`'s ops-group handler. `sendStatusCard()` (PNG rendering) is
  now used only for `server:status`; `sendOpsCard()` (`src/statusCard.js`) is
  no longer called anywhere and is dead code pending removal.
- Introduced a unified output pipeline (`src/output/pipeline.js`,
  `src/output/enricher.js`) as the intended single call site for bot
  responses (embed, card, error, ephemeral), replacing what had been four
  independently-maintained output paths.
- `AdapterClient.parseResponseBody()` (`src/adapterClient.js`) now fails safe
  on a non-JSON 2xx response body, returning `{ ok: false, error: "Unexpected
  response format (...)"}` instead of throwing an unhandled JSON parse error.

### Known Limitation From This Release (found and fixed 2026-08-16, #162)
- The OPS-embeds migration above was shipped without updating
  `test/discord-bot-test-harness.js`, which still asserted the old PNG
  status-card behavior for all 10 `ops:*` commands, and without updating
  `test/operatorValidation.test.js`'s malformed-JSON-response test, which
  still asserted the old `{ ok: true, body: text }` contract instead of the
  new fail-safe `{ ok: false, error }` shape — both left `main`'s CI red for
  6 days before being caught and fixed. See the `## Unreleased` section
  above for the fix.

## v1.0.0-rc.3 - 2026-08-08

Third release candidate. Adds security hardening (PKCE OAuth, session absolute
max age, systemd directives, audit logging), setup portal UI redesign, Core
OPS provider wiring (activity/combat/resources/economy → real duneDb queries),
and deploy guardrail fix (TAP `not ok` detection).

### Added
- PKCE (S256) in Discord OAuth authorization code flow (#180)
- Session absolute max age (7-day `iat` field in cookie payload, #179)
- Systemd hardening: 18 directives (PrivateDevices, CapabilityBoundingSet,
  UMask, ProtectHostname, IPAddressDeny/Allow, RemoveIPC, etc.) (#96)
- Audit logging in Discord link/unlink handlers (#171)
- Stale link cleanup on startup (#183)
- getAllLinkedPlayers tests (#184)

### Changed
- Setup portal UI: extracted shared CSS to setupLayout.js, replaced `alert()`
  with styled inline notifications, server errors render styled HTML pages,
  responsive at 480px (#98)
- Deploy hook now catches TAP `not ok N` format in test output (#97)
- Core opsResourcesProvider now computes totalValueRemaining for statsPusher
  spice_fields (#95)
- Core OPS providers (activity, combat, resources, economy) wired to real
  addonOps* duneDb aggregate queries
- Link prompt text updated for accuracy (#174)

### Fixed
- `pool`→`db` variable bug in linked characters API (#167)
- getAllLinkedPlayers includes legacy discord_player_links table (#173)

## v1.0.0-rc.2 - 2026-07-18

Second release candidate for the read-only `R1.0.0` production target. Adds
multi-tenant architecture, status card rendering, faction theming, OPS commands,
and Cloudflare tunnel support.

### Added (v1.0.0-rc.3, continued)

- Multi-tenant architecture with per-guild console routing and SQLite storage.
- OAuth2 setup portal with dark Dune theme matching `acp.darkdante.org`.
- Guild-scoped RBAC with per-guild role configuration via web portal.
- Canvas status card rendering (1200×640 PNG, Dune Rise typeface, faction colors).
- Faction theming for embeds and status cards (Atreides, Harkonnen, Fremen).
- OPS commands (9 subcommands: activity, combat, resources, economy, inventory,
  location, soc, prometheus, dashboard) with status card output.
- Infra commands (`/dune infra version`, `servers`, `ports`, `db`).
- Player faction system (`/dune data faction`).
- Write command scaffold (12 subcommands, disabled by default).
- Cloudflare Tunnel for setup portal (`acp-setup.darkdante.org`).
- Cloudflare KV stats aggregation for cross-instance live stats.
- Git-based deployment pipeline with pre-deploy test guardrails.
- DM-based guild onboarding on `guildCreate` events.
- Human-readable test reporter.
- Multi-tenant design documentation.
- Terms of Service and Privacy Policy documents.
- `.semgrepignore` for false positive suppression.
- Shared quote pool module (`src/quotes.js`) for embed and card footers.
- 30-second LRU cache for status card generation.
- Error/offline status card variant with red-tinted theme.

### Changed

- Project renamed from "Thumper" to "Arrakis Control Panel" (ACP).
- Player commands moved from `/dune player` group to `/dune data` group.
- All documentation updated with new repo URL (`yacketrj/Arrakis-Control-Panel`).
- `src/config.js` supports multi-tenant mode with optional env vars.
- `src/adapterClient.js` supports guild-scoped config lookup.
- `src/commands.js` RBAC supports both single-tenant (env) and multi-tenant (DB) modes.
- OPS commands now render as status cards instead of text embeds.
- Default database path changed from `data/thumper.db` to `data/acp.db`.
- Environment variable prefix changed from `THUMPER_*` to `ACP_*`.
- Upstream compatibility baseline advanced to `v1.3.60`.

### Fixed

- XSS vulnerabilities in setup server HTML templates (all user values now escaped).
- OAuth2 session state bug (state stored in DB before redirect).
- Empty server dropdown in setup portal (relaxed guild permission filter).
- RBAC array parsing bug in `getGuildRoles` (flat array vs object mismatch).
- Embed formatting standardized across all commands (consistent footers, empty states).
- Semgrep false positives for setup server and test files.
- Test compatibility with new config signature.
- Player command paths in documentation (`/dune player` → `/dune data`).
- Scheduler default value in documentation (5min → 30min).
- Test count in CONTRIBUTING.md (153 → 205+).

### Removed

- `/* nosemgrep */` comments from HTML templates.

### Security

- All setup portal HTML templates use server-side escaping for user input.
- OAuth2 state tokens stored server-side before redirect (prevents CSRF).
- Multi-tenant mode isolates guild data in SQLite with foreign key constraints.
- Status card cache limited to 50 entries with 30-second TTL.

### Added (v1.0.0-rc.3, shipped 2026-08-08)

- `logs` command group with per-service subcommands (`dune-postgres`, `dune-redis`,
  `dune-nginx`, `dune-orchestrator`, `dune-console`, `dune-steamcmd`).
- `data:verify` subcommand for two-step character linking with in-game whisper code verification.
- Setup portal guide (`docs/setup-portal-guide.md`) for new users.
- Post-receive hook fix: replaced broken `git fetch origin` with `git pull deploy`.
- Stats pusher now writes to both `acp-stats-${INSTANCE_ID}` and `acp-stats-aggregate` KV keys.
- Root landing page at `/` on the setup server (dark Dune theme, links to `/setup`).
- `scripts/deploy-post-receive.sh`: canonical, versioned deploy hook (test guardrail,
  restart, health check, and auto-re-registration of slash commands when
  `src/commands.js`/`src/opsCommands.js` change in the pushed range). The live
  OCI hook must be kept in sync with this file.
- `scripts/command-defs-changed.sh` fail-safe range checker used by the hook.
- `scripts/reencrypt-secrets.js` bulk re-encryption tool for existing
  installs (dry-run, WAL-consistent backup, no-key abort, idempotent) --
  `npm run reencrypt`.
- Bats coverage for the deploy hook (`test/deploy-hook.bats`), run by
  `npm test` after the node suite.

### Changed

- `data:link` now uses two-step verification via an in-game whisper code sent
  through RabbitMQ. **Correction (2026-07-24):** this entry originally also
  claimed a "Discord's verified Steam connection (instant link)" primary
  path; that was never actually implemented at this release — verified
  against `a15d4a8`'s actual code (no OAuth/connections-scope code existed
  anywhere in the repo at that commit). Only the whisper-code flow shipped.
  The real Steam-connections-based linking feature was designed and
  implemented starting 2026-07-24 — see `docs/steam-link-design.md`.
- `admin:broadcast` marked as planned until upstream implements the route.
- Setup portal intro clarified: only console `.env` editing required, not bot config.
- Setup portal docker restart command uses `-f docker-compose.web.yml` and service name.
- `aboutPayload` `readOnly` changed to `false` (bot supports write operations for player linking).
- `/dune help` (`helpPayload`) now lists the full registered command surface
  (54 non-write commands, plus the 12 command-write commands only when that
  group is enabled) -- it previously omitted the entire `player` group, the
  entire `logs` group, and 3 `server` subcommands, hiding real commands from
  users. Pinned by `test/commands.test.js`.
- Adapter route tables reconciled (LIVE 28 / PLANNED 8 / UNMERGED 7 /
  MISSING 6): twelve previously-unclassified route keys are now classified,
  including nine player routes the bot calls daily and
  `players-accounts-link-steam` (live), `maintenance` (missing -- declared
  upstream but never registered, every call 404s), and the dead
  `player-links*` config keys. Pinned by `test/adapterClient.test.js`; no
  config route key may be unclassified now. See
  `docs/ro-roadmap-state-2026-08-06.md`.
- Re-linking an already-linked character shows a distinct "Already Linked"
  message instead of a generic success line.

### Fixed

- Guild onboarding DM error now logged with actual error message (was silently swallowed).
- Landing page counter reset bug: `animateCounter` now preserves previous values
  between fetches instead of always starting from 0.
- `/dune ops announcements` threw a `TypeError` in production: the dispatch
  derived method name `opsAnnouncements` from route `ops-announcements`, a
  method that only ever existed in the test mock -- the real `AdapterClient`
  exposes `announcements()`, which the ops subcommand now routes to (the
  `ops-announcements` route path itself has never existed on Core; the real
  route is `/api/integrations/discord/announcements`).
- Player route status reporting: nine player routes the bot calls daily
  reported `"unknown"` status because they had been removed from
  `UNMERGED_ROUTES` in the 2026-07-26 reconciliation without being added to
  `LIVE_ROUTES` (all are real, live Core routes since the PR #91 merge).

### Removed

- `data:maintenance` subcommand (route does not exist in upstream console).

### Security

- Character linking requires ownership proof: Discord Steam connection or
  in-game RCON code. No public info (Steam ID) can bypass verification.
- Unique constraint on `player_controller_id` prevents duplicate links.

## v1.0.0-rc.1 - 2026-07-03

Release candidate for the read-only `R1.0.0` production target. This candidate
keeps the bot read-only and packages the completed operator validation,
upstream compatibility, security review, and release-roadmap evidence for
prerelease validation.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Draft upstream write-adapter RFC with proposed disabled-by-default write
  routes, schemas, fixtures, STRIDE notes, abuse cases, and maintainer
  questions.
- Production release plan and release train strategy for the read-only
  `R1.0.0` target.
- Full release roadmap that keeps `R1.0.0` read-only and maps later major
  trains toward controlled write-capable features.
- Refreshed current upstream compatibility evidence to
  `Red-Blink/dune-awakening-selfhost-docker@5163bd8`, tag `v1.3.41`.
- Detailed `R1.x` to `R2.x` roadmap with release cadence, entry criteria,
  train scopes, and go/no-go gates.
- Operator validation checklist and read-only adapter smoke command for the
  `R1.1` validation path.
- Read-only production readiness security review current through PR #38 and
  upstream `v1.3.41`.
- Durable documentation guard for tool and provider references in docs and PR
  templates.
- Workflow policy guard requiring GitHub Actions references to use immutable
  commit SHA pins.

### Changed

- Replaced workspace-specific upstream clone paths with portable sibling-path
  references in source-bound documentation.
- Advanced the release planning baseline from `R0.1.5` to `R0.9.0` release
  candidate freeze for the `v1.0.0-rc.1` preparation.

### Security

- Recorded current STRIDE, privacy, SOC 2 alignment, supply-chain, release
  readiness, and finding disposition evidence for the read-only production
  boundary.
- Pinned GitHub Actions workflow dependencies to immutable commit SHAs to close
  the Semgrep mutable-action supply-chain finding tracked in issue #30.
- Updated pinned workflow action SHAs for setup-python and upload-artifact
  after dependency review and successful security gates.

## v0.1.1 - 2026-06-28

Stable promotion of the `v0.1.1-rc.1` release candidate after candidate
workflow validation, GitHub prerelease publication, and published artifact
checksum verification.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Release-candidate workflow support for prerelease SemVer tags and GitHub
  prereleases.
- Roadmap guidance for candidate validation before stable promotion.

### Changed

- Upstream evidence records the standalone Windows reference clone and the
  latest observed upstream release-candidate tag separately from the stable
  compatibility baseline.

## v0.1.1-rc.1 - 2026-06-28

Release candidate for the release-candidate workflow and roadmap update.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Release-candidate workflow support for prerelease SemVer tags and GitHub
  prereleases.
- Roadmap guidance for candidate validation before stable promotion.

### Changed

- Upstream evidence now records the standalone Windows reference clone and the
  latest observed upstream release-candidate tag separately from the stable
  compatibility baseline.

## v0.1.0 - 2026-06-28

Initial read-only release for the self-hosted Discord bot.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Read-only `/dune` command family for about, ping, health, status,
  status-summary, readiness, and services.
- Restricted-by-default Discord RBAC with role and user allow-lists.
- Configurable read-only adapter routes aligned with the upstream WebUI
  Discord adapter.
- Local adapter mock and route compatibility fixtures.
- Zero-permission addon package generation with SHA-256 checksum.
- CycloneDX SBOM generation with SHA-256 checksum.
- Docker runtime hardening and healthcheck support.

### Security

- No Docker socket mount, database access, game-file access, shell execution, or
  write-capable adapter routes.
- Redaction for credentials, authorization headers, emails, SteamIDs,
  FuncomIDs, and explicit real-name fields before output reaches Discord or
  logs.
- Required PR gates for unit tests, npm audit, Semgrep, Gitleaks, Trivy
  filesystem scanning, dependency review, SBOM generation, Docker build, and
  Trivy image scanning.
- STRIDE review completed for the read-only boundary.

### Evidence

- Release notes: `docs/releases/v0.1.0.md`
- Read-only security review: `docs/security-review-2026-06-28.md`
- Upstream compatibility baseline:
  `Red-Blink/dune-awakening-selfhost-docker@1bb72c5`, tag `v1.3.37`

## [1.0.0-rc.4] — 2026-08-10

### Added
- Unified output pipeline: enricher.js (shared footer/timestamp/version) + pipeline.js (sendEmbed, sendCard, sendError, sendText, sendEphemeral)
- Dedicated formatters for server:services, admin:roles, logs, infra:version, player commands, core:help
- Steam-link embeds (styled embed + button instead of raw text)
- Auth/cooldown denials now use ephemeral styled embeds

### Fixed
- Dead OPS embed formatters removed from import chain (#114)
- fmtBool(undefined) shows "— Unknown —" instead of "❌ No" (#121)
- Dynamic colors on population/storage/unlink/ports (warning on empty, success on data) (#122)
- formatReadinessDetailEmbed treats undefined ready correctly (#124)
- formatGenericEmbed shows "— None —" instead of silently dropping null fields
- formatPopulationEmbed "?" replaced with "— Unknown —"
- Map names show "Unknown Map" instead of "undefined" (#127)
- Diagnostic data pipeline: safeStatusProvider now passes {diagnostic} opts through
- fmt() uses **bold** for string values (consistent with dedicated formatters) (#128)
- Stale /dune data → /dune player command paths fixed (5 locations)
- sendError parses JSON body, shows only error/message field
- formatPayload fallback uses embed instead of raw JSON dump
- enricher setTimestamp passes Date object (not ISO string), fixing CI crash
- opsPlaceholder no longer mentions GitHub org reference
- Capability enum errors replaced with user-friendly role-based messages

### Changed
- parseResponseBody returns ok:false for non-JSON responses (not phantom success)
- Field names truncated to 256 chars in duneEmbed
- !payload?.ok checks replaced with data field presence checks in inventory/link/whoami

## [1.0.0-rc.5] — 2026-08-11

### Changed
- OPS commands now use embeds instead of PNG cards (#155)
- server:status non-diagnostic uses embed (unified output)

### Fixed
- All 10 OPS embed formatters updated to match Core response fields (#147, #156-158)
- formatSocEmbed: platformHealth, bridgeRequests, bridgeErrors (#150)
- formatDashboardEmbed: reads nested dashboard.{section}.result structure
- formatPrometheusEmbed: reads flat services object
- formatAnnouncementsEmbed: handles object structure {settings, defaults}
- formatEconomyEmbed: totalSupply/totalCurrencyHolders (#149)
- formatResourcesEmbed: per-instance sizes[] array (#157)
- formatOpsInventoryEmbed: dropped non-existent fields (#158)
- statusSummaryPayload reads result directly (#148)
- Steam link endpoint enabled (#238)
- duneEmbed import for Steam-link flow
- let embed hoisted before OPS dispatch
- OPS test assertions restored after embed revert (#154)
- server:maintenance fallback handles null payload
- Discord OAuth SameSite=None cookie fix (#224)
- save-oauth-secret requires overwrite:true for existing secrets (#225)
