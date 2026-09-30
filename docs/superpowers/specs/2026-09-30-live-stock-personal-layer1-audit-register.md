# Live Stock (Personal) — Layer 1 Audit Findings Register

**Target:** `docs/superpowers/specs/2026-09-30-live-stock-personal-design.md`
- **Audited version:** v1, commit `a0e0d3b`.
- **Dispositions refer to:** v2 of the same file. `§n` is a v2 section and `OD n` is an item of
  v2 §18.

**Layer:** Requirement 20, Layer 1 (design). There were eight independent hat dispatches:
Architect, Security, GRC, Network, Cloud Security, UI/UX, DBA and QA.

**Evidence base:**
- Core: `origin/main` `ace31877`, read through git objects only.
- mentat: worktree `phase2-design`.
- Hat claims that decide a design choice were re-verified before disposition, as the
  "Re-verified" notes below record.

## Counts by severity

| Severity | Found | Resolved in design | Resolved, pending an Open Decision | Partly deferred (justified) | Rejected outright |
|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 17 | 17 | 0 | 0 | 0 |
| Medium | 43 | 41 | 1 (SEC-2 → OD 6) | 1 (UX-9: the sync-all part) | 0 |
| Low | 27 | 26 | 0 | 1 (NET-6: cleartext LAN hop, pre-existing) | 0 |
| Info | 1 | 1 | 0 | 0 | 0 |
| **Total** | **88** | **85** | **1** | **2** | **0** |

**Operator decisions, 2026-09-29.**
- OD 1 was decided as option A, a per-guild encrypted signing secret, which becomes Phase 2a (v2
  §3.5).
- OD 5 was decided as taking the 20-char `sync` cost now.
- ARCH-1, SEC-3 and CLOUD-3 moved from "pending OD 1" to resolved. UX-1's sequencing question is
  closed.
- Phase 2a is new design material. It needs **its own Layer 1** before implementation: the
  question list is in v2 §3.5.10, and the dispatch has not run yet. Its findings will go in a
  separate register.

No finding was rejected outright. Two **sub-claims** were rejected with evidence:
- QA-3's claim that CI silently skips the integration tests;
- GRC-7's claim that gate 19b is not achievable.

Rows that are only partly deferred are those where the deferred part is secondary and the primary
issue is resolved:
- ARCH-5: the baseline alternative;
- SEC-2(c): per-guild disable state;
- NET-2: the warn-on-switch sub-suggestion.

Each such row states its deferred part explicitly.

## Findings

STRIDE is the category the hat assigned, adjusted where noted. "N/A" means the finding is a
correctness, UX or governance defect with no STRIDE mapping.

### Architect (ARCH)

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| ARCH-1 | High | Spoofing, DoS | Signed actor required, but mentat has one process-wide secret and goals exist only in multi-tenant mode | **Resolved in design.** OD 1 was decided on 2026-09-29 as option A, a per-guild encrypted signing secret, specified as Phase 2a (v2 §3.5), which ships before the sync command. The stock route requires a verified per-guild secret and never uses the process secret (§3.5.5–§3.5.6). Phase 2a has its own Layer 1 pending (§3.5.10). |
| ARCH-2 | Med | N/A | Backpack silently 0 when the pawn id is unknown | Resolved §4.3.4, §4.6 (`unavailable:["backpack"]`), §6.4 table (never decrease from it), T8 |
| ARCH-3 | Med | N/A | Preview and apply not bound; apply skips preview; decreases automatic | Resolved §6.3 (preview command + Apply buttons write exactly the previewed values), §6.4 (decreases need an explicit button, CAS) |
| ARCH-4 | Med | DoS | No per-command cooldown; 30 s would block the apply step | Resolved §6.7 / M7 (per-command 15 s, no admin shortcut, not applied to buttons or local refusals). The v1 claim is withdrawn. |
| ARCH-5 | Med | N/A | Live stock is a shared pool; goal on-hand behaves like an allocation | Resolved §5.2: semantics stated, footer copy, "also counted in #n". The baseline alternative is deferred (§17): it needs a stored baseline, which means a second schema change. |
| ARCH-6 | Med | N/A | Which nodes can sync is undefined (water, gear, deployables) | Resolved §5.3 (syncable = bridge ids + `resources` simple goals; everything else "manual only"), M-T7/M-T8 |
| ARCH-7 | Med | N/A | Process-wide flag cannot stage a per-guild rollout | Resolved §3.2 (`MENTAT_LIVE_STOCK_GUILD_IDS`, restart to change, visible-everywhere copy) |
| ARCH-8 | Low | Tampering, Repudiation | Multi-node apply not atomic | Resolved §6.4 step 3 (one IMMEDIATE `goalTransaction`, dependency on PR #435/#428 stated), M-T13 |
| ARCH-9 | Low | N/A | C6 catalog entry group/subcommand unspecified | Resolved §4.1 C7 (`goal:live-stock`, expected drift line recorded) |
| ARCH-10 | Low | N/A | Error messages need the Core error code, not the status | Resolved §6.5 / M10 (keyed on `body.error`), M-T16 |
| ARCH-11 | Low | N/A | Goal autocomplete offers guild goals to `sync` | Resolved M4 (personal-only branch), M-T22 |
| ARCH-12 | Low | Info. Disclosure | U7 resolvable; the `[D17]` precedent is not a reusable mechanism | Resolved: U7 closed (§16); §6.8 `FORCE_EPHEMERAL_COMMANDS` |

### Security (SEC)

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| SEC-1 | High | Tampering, EoP, DoS | Response object keyed by caller ids; the regex admits `__proto__`/`constructor`/`prototype` | Resolved §4.4 (reserved names rejected in any case; leading-letter regex, verified against both catalogs), §4.6 (array response), §6.4 (mentat builds a `Map` over its own nodes), T10, M-T9 |
| SEC-2 | Med | Spoofing, Info. Disclosure | A Player-tier read makes link integrity the sole authorization; Steam-era links; guild disable state | Resolved §4.2 (a: pre-enable review gate; b: Layer 2 check of link paths). **Open Decision 6** covers what to do with the review's result. Part (c), guild disable state, is deferred (§17): it matches every sibling route (`duneDb.js:16597`–`:16600`), and v1 is limited to operator guilds. |
| SEC-3 | Med | Spoofing, EoP | The process-global secret against per-guild Cores | **Resolved in design:** Phase 2a (§3.5), with per-tenant rotation and revocation (§3.5.4, Requirement 27) and a Credentials/lifecycle section (§3.4, §3.5.3) |
| SEC-4 | Med | DoS | 5-connection shared pool, no Core limiter, cooldown not implementable | Resolved §4.5 (semaphore → 503, per-actor 429, 2 s timeout), §6.7, T12 |
| SEC-5 | Med | Tampering | Apply writes unvalidated values from a tenant Core | Resolved §6.4 step 1 (safe integers, own nodes only, whole-response reject), M-T9, FM16 |
| SEC-6 | Med | Info. Disclosure | Pawn id `'0'` could read `actor_id = 0` inventories | Resolved §4.3.4 (`NULL`, never `0`), T8, UAT step 1 count |
| SEC-7 | Med | Info. Disclosure | Ephemeral left as "confirm at implementation" | Resolved §6.8 (hard requirement), M-T14 |
| SEC-8 | Low | Info. Disclosure, Tampering | `itemIds` outside the signed payload (30 s replay) | Resolved §4.1 C6 / M3 (`STOCK_SIGNED_ACTOR_FIELDS` with `params`), T2 |
| SEC-9 | Low | Tampering | Scoped read before the await, unscoped writes after | Resolved §6.4 step 3 (re-scope and status check inside the transaction), M-T13 |
| SEC-10 | Low | Repudiation | Sync and manual writes indistinguishable; no correlation id | Resolved §4.7 (`interactionId` in the Core audit line), §7 (`source_ref`) |
| SEC-11 | Low | Info. Disclosure | Raw DB error text reaches the user | Resolved §4.1 C2 (`stock_query_failed`), T14 |

### DBA

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| DBA-1 | High | N/A | "Bases" include generator, turbine and windtrap fuel slots | Resolved §4.3.3, F5. Re-verified: `BASE_INVENTORY_TYPES` `duneDb.js:12559`, `max_item_count >= 0` at `:12725`–`:12737`, `GENERATOR_TYPES` `:9183`. Also T4 and the UAT Oil row. |
| DBA-2 | Med | N/A | Case-sensitive match contradicts Core's case-insensitive engine | Resolved §4.3.1. Re-verified `duneDb.js:10191`–`:10193`. Also T6. |
| DBA-3 | Med | DoS | OR-of-IN shape cannot use an index; U4 answerable now | Resolved §4.3.2 (inventory-driven single statement), §11.4 step 0 before Layer 2 |
| DBA-4 | Med | DoS | Pool starvation | Resolved §4.5, T12 |
| DBA-5 | Med | N/A | NULL on the wrong column; `sum(bigint)` is numeric | Resolved §4.3.6. F6 corrected. T7, T11. |
| DBA-6 | Med | N/A | Pawn `'0'` silently zeroes the backpack | Resolved; same fix as ARCH-2 / SEC-6 |
| DBA-7 | Med | Repudiation | Not one transaction; depends on unmerged #428 | Resolved §6.4 step 3, §6.1 dependency statement. Re-verified: `goalTransaction` only on `fix/goal-followups-425-429`; PR #435 and #428 open. |
| DBA-8 | Low | N/A | A stale live value overwrites a newer manual entry | Resolved §6.4 (CAS on `updated_at`), M-T13 |
| DBA-9 | Low | Tampering, DoS | Read-only by convention; lock queue unbounded | Resolved §4.5 (`set transaction read only`, `lock_timeout 500ms`), T9 |
| DBA-10 | Low | N/A | Snapshot consistency needs a single statement | Resolved §4.3.5, T13 |
| DBA-11 | Low | N/A | Item-owned and vehicle-module inventories not listed as exclusions | Resolved §4.3.7, T4 |
| DBA-12 | Low | Repudiation | "Needs a table rebuild" overstated | Resolved §7 (v1 claim corrected; additive v9 columns designed with Requirement 26 rollback) |
| DBA-13 | Info | N/A | OD9 should cite `ensureItemAuditLogIndexes` precedent | Resolved §17 (precedent cited; the stricter choice is stated as deliberate) |

### GRC

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| GRC-1 | High | Repudiation | Sync audit rows cannot show sync or server | Resolved §7 (`source`, `source_guild_id`, `source_ref`, schema v9, rollback, tests M-T18/M-T19). R8 is re-rated and resolved. |
| GRC-2 | High | Repudiation | Core audit line lacks target character, outcome and correlation | Resolved §4.7 (`playerControllerId`, `outcome`, `interactionId`, `guildId`, denials audited, retention stated), T15 |
| GRC-3 | Med | N/A | Doc updates incomplete; "or file it" escape | Resolved §12 (Documentation Impact table, a required PR-body section; API-REFERENCE fixed in the same PR) |
| GRC-4 | Med | N/A | Moderator-tier gap untracked | Resolved: tracked as **mentat#433** (open, verified). §14.1 requires verification on dune-dev with its own secrets. |
| GRC-5 | Med | Info. Disclosure | Classification, retention and erasure not stated | Resolved §8 (classification, retention including audit-log survival, erasure procedure, privacy-policy check), §6.8 |
| GRC-6 | Med | N/A | Requirement 18/28 sequencing contradictory, no evidence | Resolved §4 ownership paragraph, §14.1 (hand-off; Requirement 28 check run and recorded 2026-09-29) |
| GRC-7 | Med | Repudiation | Requirement 19 gates not one-to-one; lifecycle conflated | Resolved §14.2 (a–g table, e = N/A with reason), §14.3 (fork-only internal lifecycle), OD 7. The claim that 19b is "not achievable" is **rejected**: dune-dev is a live server and one full session with the operator satisfies 19b as written. |
| GRC-8 | Low | N/A | Secret provisioning and rotation not referenced | Resolved §3.4, §12 runbook row |
| GRC-9 | Low | N/A | Requirement 26 statement missing | Resolved §4.1 (Core: N/A), §7 (mentat: v9 migration with rollback) |
| GRC-10 | Low | N/A | Changelog must state operator requirements | Resolved §12 Core CHANGELOG row |

### Network (NET)

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| NET-1 | High | Info. Disclosure, Spoofing | Silent fallback to the global adapter for an unregistered or inactive guild | Resolved §3.1 (`resolveGuildConfigStrict`, never the fallback), M-T3, M-T5, FM15. Re-verified `adapterClient.js:277`–`:283`, `index.js:164`–`:177`. |
| NET-2 | High | Tampering | Multi-instance guilds have no routing rule | Resolved §3.1 (invariant "1 guild = 1 Core"; multi-instance unsupported in v1; source line; last-source display; persisted `source_guild_id`). The "warn on guild switch" sub-suggestion is replaced by the last-source display, so no new state is needed. |
| NET-3 | Med | DoS | Timeout budget and pool math; message uses the wrong config | Resolved §4.5 (3 s + 2.5 s < 8 s, semaphore). The message fix (`cfg` vs `this.config`, `adapterClient.js:489`) is folded into M2. |
| NET-4 | Med | DoS | Tunnel behaviour, no retry policy | Resolved §4.5 (one attempt, no retry), §6.5 (non-JSON proxy rows), §11.4 step 3 (tunnel and VLAN p95) |
| NET-5 | Med | Repudiation | Source identity undefined; cloned or restored instances | Resolved §3.1 (label from mentat's `guilds` row), §7 (`source_guild_id`) |
| NET-6 | Low | Info. Disclosure | Path-rewriting proxy breaks the signature; cleartext LAN hop | (a) Resolved §12 operator-notes row. (b) The cleartext LAN hop is **deferred**: it is pre-existing for every adapter route and not introduced here, and it is documented in §9 and §12. |
| NET-7 | Low | N/A | Proxy 404 indistinguishable from an old Core | Resolved §6.5 (JSON versus non-JSON 404 rows) |

### Cloud Security (CLOUD)

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| CLOUD-1 | High | Spoofing, DoS | Unconfigured versus denied collapsed; the mentat secret silently empty | Resolved §3.4 (mentat never sends unsigned; startup warning disables the feature), §6.5 (per-code messages), M-T4, M-T16 |
| CLOUD-2 | High | Spoofing, Repudiation | Actor-secret lifecycle not designed | Resolved §3.4 (provisioning, identical both sides, rotation order and expected 403 window, runbook), §12, U12 |
| CLOUD-3 | Med | Spoofing, EoP | Shared single secret across tenants | **Resolved in design:** Phase 2a (§3.5). Each Core generates its own secret, and mentat stores it per guild, encrypted. |
| CLOUD-4 | Med | DoS | Kill switch needs a restart; a typo crashes startup | Resolved §3.2 (restart stated, Requirement 7; malformed entries are a warning, not a crash), §13 rollback text |
| CLOUD-5 | Med | Info. Disclosure, EoP | The no-target invariant has no structural guard | Resolved §4.1 C4 (warning comment on the capability), T3 (real-Postgres regression test) |
| CLOUD-6 | Low | Info. Disclosure | New async handler must not log actor, headers or body | Resolved §9, M-T17 |
| CLOUD-7 | Low | Repudiation | Denied attempts not audited | Resolved §4.7 (every outcome audited, with a wrapper for signature failures), T15 |
| CLOUD-8 | Low | Spoofing, Info. Disclosure | dune-dev must not reuse prod secrets | Resolved §3.4, §11.4 prerequisites |

### UI/UX (UX)

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| UX-1 | High | N/A | Command budget unaccounted | **Resolved in design.** Measured at 7473 today. The design costs **20 chars** (`sync`, "Live stock.", `id`, "Id."), and the button design removes the `apply` option. OD 5 was decided on 2026-09-29: take the cost now (7493/7500, no re-baseline); everything after goes through the `/dune` split (mentat#423). |
| UX-2 | High | Tampering (low) | Discoverability of `apply:true`; inversion risk | Resolved §6.3 (buttons replace the option), §6.6 (distinct titles, colors, footer) |
| UX-3 | High | N/A | A zero from a missing or misspelled id looks like a real zero | Resolved §6.4 table ("NONE FOUND — was s" warning; only the explicit decreases button writes it), §4.3.1 case-insensitive match, U1 gate |
| UX-4 | High | N/A | Ingredients with no game id not addressed | Resolved §5.3 (every node listed; "manual only" rows), M-T7 |
| UX-5 | Med | N/A | "Nothing changed" and all-skipped states undefined | Resolved §6.4 step 3.7, §6.4 table rows "unchanged" and "none found" |
| UX-6 | Med | N/A | Which server and which character | Resolved §3.1 (source line from the `guilds` row; "your default linked character"; name not shown, with the reason) |
| UX-7 | Med | N/A | Unlinked versus role-mapping jargon; adapter excerpt shown | Resolved §6.5 (separate player and operator text; no excerpt for this command) |
| UX-8 | Med | N/A | Under- and over-count causes not surfaced; user-guide missing | Resolved §6.6 (fixed Counted/Not counted line), §12 (`docs/user-guide.md` row) |
| UX-9 | Med | N/A | No sync-all; cooldown after failures | Cooldown part resolved §6.7 (no cooldown on local refusals; 15 s). Sync-all is **deferred** (§17): it needs a multi-goal preview and batching past 16 ids, and 5 × 15 s is tolerable for v1. |
| UX-10 | Med | N/A | Cooldown blocks the preview-then-apply happy path | Resolved §6.3 / §6.7 (buttons make no Core call and are not cooldown-gated) |
| UX-11 | Low | Info. Disclosure | Ephemeral is a privacy requirement | Resolved §6.8, M-T14 |
| UX-12 | Low | N/A | Emoji-only signals | Resolved §6.6 (text + emoji, signed deltas) |
| UX-13 | Low | N/A | Wording consistency, restore hint, locale | Resolved §6.4 ("Previous:" phrasing, real id and display name in the restore hint), §6.6 (English-only stated) |

### QA

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| QA-1 | High | Info. Disclosure | The privacy test can be a tautology | Resolved §11.1 T3 (real Postgres, two players, same item, distinct totals, cross-named bodies) |
| QA-2 | High | Tampering | Mock drift between mentat and Core | Resolved §11.3 (one canonical `players-stock.json`, byte-identical in both repos, shared sha256 pin, real-handler envelope), `UPSTREAM_CONTRACT` update in M2, T16, M-T20 |
| QA-3 | High | N/A | The double-count fixture is under-specified; integration tests silently skip | Resolved §11.1 T5 (fan-out fixture + naive oracle), T13 (SQL-text guard), gate rule (evidence must show the tests executed). **Sub-claim partly rejected with evidence:** `withIsolatedDatabase` throws, not skips, when `CI` is set (`test-support/pgIntegrationDb.js:108`), and Core CI provisions Postgres (`.github/workflows/ci.yml:42`–`:43`). The skip happens only in local runs, which the gate rule excludes. |
| QA-4 | High | N/A | No tests for water, intermediates or the id cap on the mentat side | Resolved §5.3 (intermediates stated as counted), M-T7, M-T8 |
| QA-5 | Med | N/A | "Preview writes nothing" under-specified | Resolved M-T11 |
| QA-6 | Med | N/A | Kill-switch default untested | Resolved M-T1 |
| QA-7 | Med | N/A | Missing, extra and mis-typed response keys | Resolved §6.4 step 1, M-T9 |
| QA-8 | Med | N/A | UAT not executable | Resolved §11.4 (seed table: 400 = 50 + 350; hologram, rank-2 and generator-fuel rows; worn gear handled as manual only; independent ground-truth SQL; exact-equality, p95 and EXPLAIN pass criteria; sweep pass criterion) |
| QA-9 | Med | N/A | Error-path distinctions untested | Resolved M-T16 |
| QA-10 | Med | N/A | Semantics gaps (zero over saved, intermediates, completed goals) | Resolved §6.4 decision table, §6.2 (active goals only), §5.3 |
| QA-11 | Med | N/A | Core test conventions and drift; existing enumerating tests | Resolved T18 (grep-and-update list), §11.1 Requirement 22 note |
| QA-12 | Med | N/A | No automated cross-repo boundary test | Resolved §11.3 (shared fixture + signing-pairing tests on both sides) |
| QA-13 | Low | N/A | Goal journey E2E not extended | Resolved M-T21 |
| QA-14 | Low | N/A | Cooldown timing and flakiness | Resolved M7, M-T15 (mock timers, unique users, reset) |

## Operator requirements (binding, not findings; not counted above)

| ID | Source | STRIDE | Requirement | Disposition |
|---|---|---|---|---|
| OP-1 | Operator, 2026-09-29 | Info. Disclosure, EoP (cross-tenant) | **Tenant isolation invariant:** each Discord guild is a distinct tenant bound to its own `guilds` row (encrypted `adapter_token`, own `console_url`, and after Phase 2a its own signing secret); one shared `DISCORD_BOT_TOKEN`; no cross-guild commands. A stock query for guild A can only use guild A's Core URL, token and signing secret; no guild parameter anywhere. | **Resolved by design:** v2 §3.1 (invariant added to the strict per-guild resolver section: 1 guild = 1 Core, no guild parameter, button guild must equal the preview's guild, process-wide legacy secret never selects a tenant and is never used for stock), §6.3 step 5 (cross-guild button refusal), M-T24 (two-guild fixture). **Text corrected:** v2 §3.1's "last synced from Server A" shown in Server B implied resolving another guild's row; it now says "another Discord server" and never reads that row. No other Phase 2/2a text was found implying cross-guild lookup; §3.3 options B and C (shared or derived keys) remain recorded as rejected. |

## Cross-hat conflicts and adjudications

1. **ARCH-1(i) "make the signature optional" vs SEC-3/CLOUD-3 "per-guild secret".**
   - The design presented both, plus HKDF and restrict-to-shared, as OD 1.
   - The operator chose the per-guild secret on 2026-09-29. Optional signing was not chosen.
   - Fact re-verified: when a Core has a secret configured, every adapter route already requires a
     valid signature (`routes.js:207`–`:210`). Making it optional would therefore only have
     affected unsigned Cores.
2. **Severity of the preview/apply problem.** ARCH-3 rated it Medium; UX-2 and UX-3 rated it High.
   UX is right that a silent overwrite with a false zero is the likeliest user harm. It is
   resolved at the High bar either way.
3. **Pawn id `'0'`.** ARCH-2 treats it as integrity and SEC-6 as cross-player disclosure. Both
   are right, for different consequences. One fix (never query `actor_id = 0`, mark the backpack
   unavailable) closes both.
4. **QA-3 CI claim.** Partly incorrect, per the evidence in its row.
5. **GRC-7 "19b not achievable".** Rejected, per its row.
6. **UX-1 cost estimate (110–160 chars).** The estimate assumed an `apply` option. With the
   button design the measured cost is 20 chars, so UX-1 is resolved on cost. Its sequencing
   question is OD 5.
7. **DBA-13 vs v1 OD9.** DBA is right that a precedent for automatic index creation exists. The
   design keeps the stricter "no automatic index" choice deliberately and cites the precedent.

## Layer 1 STRIDE report

| STRIDE category | Findings | Max severity | Resolution status |
|---|---|---|---|
| **Spoofing** | ARCH-1, SEC-2, SEC-3, CLOUD-1, CLOUD-2, CLOUD-3, CLOUD-8, NET-1 | High | Resolved in design. ARCH-1/SEC-3/CLOUD-3 are resolved through Phase 2a's per-guild secret (OD 1 decided 2026-09-29; Phase 2a Layer 1 pending). SEC-2 is pending OD 6 (the pre-enable review gate is designed). |
| **Tampering** | SEC-1, SEC-5, SEC-8, SEC-9, ARCH-8, DBA-9, NET-2, QA-2, UX-2 | High | Resolved in design |
| **Repudiation** | GRC-1, GRC-2, GRC-7, DBA-7, DBA-12, SEC-10, CLOUD-2, CLOUD-7, NET-5, ARCH-8 | High | Resolved in design (v9 provenance columns, Core audit on every outcome, shared correlation id) |
| **Information Disclosure** | SEC-2, SEC-6, SEC-7, SEC-8, SEC-11, GRC-5, NET-1, NET-6, CLOUD-5, CLOUD-6, CLOUD-8, UX-11, ARCH-12, QA-1 | High (NET-1, QA-1) | Resolved in design. NET-6's cleartext LAN hop is deferred as pre-existing and documented. |
| **Denial of Service** | ARCH-1, ARCH-4, SEC-1, SEC-4, DBA-3, DBA-4, DBA-9, NET-3, NET-4, CLOUD-1, CLOUD-4 | High | Resolved in design (Core semaphore/limiter/timeouts, per-command cooldown, fail-closed diagnosis) |
| **Elevation of Privilege** | SEC-1, SEC-3, CLOUD-3, CLOUD-5 | High (SEC-1) | Resolved in design (SEC-3 and CLOUD-3 via Phase 2a) |

These findings map to no STRIDE category (correctness, UX or governance), and are listed so their
absence from the table above is not mistaken for an omission:
- ARCH-2, 3, 5, 6, 7, 9, 10, 11;
- DBA-1, 2, 5, 6, 8, 10, 11, 13;
- GRC-3, 4, 6, 8, 9, 10;
- NET-7;
- UX-1, 3–10, 12, 13;
- QA-3–14.

Every STRIDE category has at least one finding in this layer. None is N/A.

## Next steps required by Requirement 20
- Post this register and the STRIDE table as a comment on the mentat tracking issue once it is
  filed (§14.1). Link the Core issue.
- File the deferred items (§17) as issues. Each carries the justification recorded here.
- OD 1 and OD 5 are decided. OD 2–4 and OD 6–9 remain. OD 8 and OD 9 are new with Phase 2a.
- Run the Phase 2a Layer 1 dispatch (v2 §3.5.10) before any Phase 2a implementation.
- Phase 2a must merge before Phase 2b, and so must mentat PR #384, which holds schema v9.
- Layer 2 (per repo, implementation) and Layer 3 (`/code-review high` on each PR) follow. The
  §11.4 UAT step 0 must be done before Layer 2.
