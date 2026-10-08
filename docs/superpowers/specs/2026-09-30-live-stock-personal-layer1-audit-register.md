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
  question list is in v2 §3.5.10. (Round 2 update: that dispatch ran on v2 `2dd3158`; its findings
  are in the "Round 2" section at the end of this file, not a separate register.)

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
| DBA-12 | Low | Repudiation | "Needs a table rebuild" overstated | Resolved §7 (v1 claim corrected; additive **v11** columns designed with Requirement 26 rollback; corrected in round 2 from "v9") |
| DBA-13 | Info | N/A | OD9 should cite `ensureItemAuditLogIndexes` precedent | Resolved §17 (precedent cited; the stricter choice is stated as deliberate) |

### GRC

| ID | Sev | STRIDE | Title | Disposition |
|---|---|---|---|---|
| GRC-1 | High | Repudiation | Sync audit rows cannot show sync or server | Resolved §7 (`source`, `source_guild_id`, `source_ref`, schema **v11** — corrected in round 2 from "v9", rollback, tests M-T18/M-T19). R8 is re-rated and resolved. |
| GRC-2 | High | Repudiation | Core audit line lacks target character, outcome and correlation | Resolved §4.7 (`playerControllerId`, `outcome`, `interactionId`, `guildId`, denials audited, retention stated), T15 |
| GRC-3 | Med | N/A | Doc updates incomplete; "or file it" escape | Resolved §12 (Documentation Impact table, a required PR-body section; API-REFERENCE fixed in the same PR) |
| GRC-4 | Med | N/A | Moderator-tier gap untracked | Resolved: tracked as **mentat#433** (open, verified). §14.1 requires verification on dune-dev with its own secrets. |
| GRC-5 | Med | Info. Disclosure | Classification, retention and erasure not stated | Resolved §8 (classification, retention including audit-log survival, erasure procedure, privacy-policy check), §6.8 |
| GRC-6 | Med | N/A | Requirement 18/28 sequencing contradictory, no evidence | Resolved §4 ownership paragraph, §14.1 (hand-off; Requirement 28 check run and recorded 2026-09-29) |
| GRC-7 | Med | Repudiation | Requirement 19 gates not one-to-one; lifecycle conflated | Resolved §14.2 (a–g table, e = N/A with reason), §14.3 (fork-only internal lifecycle), OD 7. The claim that 19b is "not achievable" is **rejected**: dune-dev is a live server and one full session with the operator satisfies 19b as written. |
| GRC-8 | Low | N/A | Secret provisioning and rotation not referenced | Resolved §3.4, §12 runbook row |
| GRC-9 | Low | N/A | Requirement 26 statement missing | Resolved §4.1 (Core: N/A), §7 (mentat: **v11** migration with rollback; corrected in round 2 from "v9") |
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
| **Repudiation** | GRC-1, GRC-2, GRC-7, DBA-7, DBA-12, SEC-10, CLOUD-2, CLOUD-7, NET-5, ARCH-8 | High | Resolved in design (v11 provenance columns — corrected in round 2 from "v9", Core audit on every outcome, shared correlation id) |
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
- Run the Phase 2a Layer 1 dispatch (v2 §3.5.10) before any Phase 2a implementation. (Done: Round 2 below.)
- Phase 2a must merge before Phase 2b, and so must mentat PR #384, which holds schema v9. (Round 2: the real gate is mentat#438 resolved, not only #384 merged; see D16.)
- Layer 2 (per repo, implementation) and Layer 3 (`/code-review high` on each PR) follow. The
  §11.4 UAT step 0 must be done before Layer 2.

---

# Round 2 — Layer 1 re-audit of design v2 including the Phase 2a addendum (§3.5)

**Audited version:** v2, commit `2dd3158`. It was the first audit of Phase 2a.
**Dispositions refer to:** design **v3** in the same file. `§n` is a v3 section and `OD n` is an item of v3
§18.

**Layer:** Requirement 20, Layer 1, round 2. There were eight independent hat dispatches: Architect
(ARCH2), Security (SEC2), GRC (G2), Network (NET2), Cloud Security (C2), UI/UX (UX2), DBA (DBA2)
and QA (QA2).

**Evidence base:**
- Core: `origin/main` `ace31877`, which is still Core `main` on 2026-09-29.
- mentat: worktree `phase2-design` and `origin/main` `db3db83` (PR #435 merged 2026-09-30T00:18Z).
- The local `deploy/deploy` ref is `be8f605`. It was **not** re-fetched from the bot VM and may be stale.

Every finding that a v3 design change depends on was spot-verified against code (`file:line`)
before disposition. Corrected hat claims are listed below.

**Issues filed for this round** (Requirement 20: issues first, then design edits). All are on board
Project 1 with Priority and Workstream set.

| Issue | Severity | Clusters |
|---|---|---|
| mentat#443 | High | D01, D04, D06, D14, D15, D18: provisioning handshake, rollout order, registration budget, existing secrets, one signer per Core, auto-invite |
| mentat#444 | High | D02: signed `guildOwnerId` (signature v2) |
| mentat#445 | High | D03, D11, D13, D19, D20, D28: binding, atomic strict resolver, self-check, signing API, `getGuild`, revocation |
| mentat#446 | High | D05, D16, D17, D30, D36–D39: migration fail-closed, storage integrity, #438 sequencing, rollback |
| mentat#447 | High | D07, D08, D09, D41: operator status surface, secret-only update path, copy table |
| mentat#448 | High | D10, D12, D46–D52: golden vectors and drift gate, UAT executability, QA mediums |
| mentat#449 | Medium | D22–D27: Requirement 27 cadence and rehearsal, docs and inventory, evidence map, stale facts, upstream sequencing, attribution |
| mentat#450 | Low | D53–D75: bundled Lows with dispositions |
| dune-awakening-selfhost-docker#1088 | High | Requirement 18 Core hand-off: K1–K5 (pending/promote/revert, check route, v2 `guildOwnerId`, fail-closed managed file, console authz), plus the appendix of 2b stock-route changes (D21, D29, D32–D35, D40) |

Also added to the board in this round, because Requirement 15 found them missing: mentat#434 (the
tracking issue), mentat PR #437 and mentat#438.

## Round 2 counts

**Per hat (raw, as each hat reported, corrected where noted):**

| Hat | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Architect (ARCH2) | 0 | 3 | 8 | 4 | 15 |
| Security (SEC2) | 0 | 2 | 6 | 8 | 16 |
| GRC (G2) | 0 | 2 | 7 | 4 | 13 |
| Network (NET2) | 0 | 2 | 6 | 4 | 12 |
| Cloud Security (C2) | 0 | 2 | 7 | 5 | 14 |
| UI/UX (UX2) | 0 | 4 | 8 | 4 | 16 |
| DBA (DBA2) | 0 | 1 | 6 | 9 | 16 |
| QA (QA2) | 0 | 4 | 14 | 4 | 22 (the hat's summary said 12 Medium / 20 total; it lists 22) |
| **Raw total** | **0** | **20** | **62** | **42** | **124** |

**Deduplicated:** 75 findings, each row below. Severity is the maximum across merged raw findings
unless an adjudication says otherwise.

| Severity | Deduped | Resolved in v3 design | Resolved, pending an Open Decision | Deferred (justified) |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 12 | 10 | 2 (D07 part → OD 12; D09 role name → OD 13) | 0 |
| Medium | 40 | 37 | 3 (D14 process-default Core → OD 14; D31 → OD 10; D32 → OD 11) | 0 |
| Low | 23 | 22 | 0 | 1 (D62: clone detection, runbook now) |
| **Total** | **75** | **69** | **5** | **1** |

"Pending an Open Decision" means the design specifies a safe default and recommendation. The operator
decides whether to change it. No High is left without a safe default.

## Round 2 findings (deduplicated)

Columns:
- **ID**: the round-2 dedup row.
- **Raw IDs**: every hat finding merged into the row.
- **Sev**, **STRIDE**.
- **Summary**.
- **Ruling**: controller ruling R2-A..G where one applies, else the disposition.
- **Where resolved**: the v3 section and the issue.

### High

| ID | Raw IDs | Sev | STRIDE | Summary | Ruling | Where resolved |
|---|---|---|---|---|---|---|
| D01 | ARCH2-1, ARCH2-8, SEC2-1, G2-1, NET2-2, C2-1 | High | DoS (Tampering of enforcement state) | Core writes the secret and enforces it on every adapter route before mentat has verified or stored it. A failed or partial connect, a failed rotation push, or a Core released before mentat 2a gives a total signed-route outage reported as success (Requirement 0). Verified: Core `routes.js:200-215`, `actorSignature.js` `actorSignatureSecret` reads per call. | **R2-A.** A pending secret is never enforced. The mentat-driven handshake is verify (fingerprint compare) → promote → store → revert-on-store-failure. mentat 2a ships before Core. Rotation uses the same flow, so there is no outage window and OD 8 is superseded. First generation reverts to "no secret". | §3.5.3, §3.5.4, §3.5.7, §13; mentat#443, Core#1088 |
| D02 | ARCH2-2, SEC2-2 | High | EoP, DoS | Enabling signing strips the unsigned `guildOwnerId`, so hosted guild owners lose owner tier. v2's "2a changes only which key signs" is false. Verified: `routes.js:212-214`, `policy.js` `discordActorTier`, `adapterSettings.js` `MANAGED_ENV_KEYS` has no owner-role key. | **R2-B, option (a):** signature v2 = v1 fields + `guildOwnerId`, selected by header; Core keeps the claim only when v2 verified. Option (b) (refuse until an owner-role mapping exists) was rejected on code evidence: the wizard cannot set an owner role, and (b) still demotes owners who lack the role. | §3.5.5, §3.5.10; mentat#444, Core#1088 |
| D03 | ARCH2-3, SEC2-3, C2-2, QA2-15, DBA2-09 | High | Tampering, Spoofing, DoS | The stored secret is not bound to the Core it was verified against. `upsertGuild` (`database.js:538-560`) keeps the secret and `verified_at` when `console_url` or the bearer changes. There is no row for "set but not verified". | **R2-C.** Clear the secret, `set_at` and `verified_at` and delete the DEK row in the same transaction when `console_url` or `adapter_token` changes, unless the same request re-verifies. The resolver requires `verified_at` non-null. A runtime `invalid_actor_signature` triggers a rate-limited re-verify. A-T7 corrected. | §3.5.5, §3.5.6, §3.5.8 (A-T7, A-T16); mentat#445 |
| D04 | G2-2, UX2-4, ARCH2-13, SEC2-9, SEC2-6, C2-3, C2-14 | High (adjudicated: G2/UX High beat ARCH/SEC Low, because it breaks a working flow) | DoS, Spoofing, Info. Disclosure | K1's refusal on the direct `DUNE_DISCORD_ACTOR_SECRET` blocks the reconnect flow that works today. "Paste the value your Core already holds" makes dev and prod per-guild rows equal to the shared process secret. The 64-hex check does not stop low-entropy values. | **R2-E.** Core forwards an existing active secret in `existing` mode and does not refuse. mentat stores it only if it is 64 lowercase hex, has at least 8 distinct characters, and is **not** equal to the process-wide secret (constant-time compare). Otherwise the guild stays on the unchanged legacy path. The paste advice is removed; operator guilds regenerate. The direct-var migration is documented. Format verified: Core documents no format for the actor secret (`.env.example:191-192`), while every Core-generated value is 64-hex. | §3.5.3, §3.5.5, §3.5.8 (A-T6, A-T18); mentat#443, Core#1088 |
| D05 | DBA2-01, ARCH2-9, QA2-3 | High | DoS | The copied migration idiom swallows every `ALTER` error and bumps the version anyway (`database.js:285-297`, `:322-338`). The new column is read on every signed request, so one failed `ALTER` is a bot-wide outage that cannot self-repair. | **R2-F.** Catch only "duplicate column name". Run each step and its bump in one transaction. Assert with `PRAGMA table_info` and refuse to start. A-T1b adds an injected failure. | §3.5.2, §7; mentat#446 |
| D06 | NET2-1, NET2-11 | High | DoS, Repudiation | The registration chain has no time budget. Discord calls plus the self-check can exceed Core's 15 s, and Core retries once (`httpWithRetry.js`), which gives split state and a double handshake. | Handshake Core calls have a 3 s timeout each. The response deadline is 12 s, and signing is deferred (no promote) if under 7 s remains. Registration is idempotent (same guild + same fingerprint → no-op success). The NET2-11 wording fix is folded in. | §3.5.3; mentat#443 |
| D07 | UX2-1, NET2-7, UX2-6 | High | N/A (Info. Disclosure if unauthenticated) | The "setup-portal status page" and "Test signing" do not exist (`setupServer.js` routes). The verification result is not persisted anywhere an operator can see it. | Core Discord settings is the 2a status surface (pending/active/reverted, fingerprint, last handshake result through `/register` or `confirmation-status`, which Core's server already proxies at `server.js:2592ff`). "Test signing" is dropped (it would be new ingress). A mentat owner status page is **OD 12** (recommend defer). | §3.5.11, §18 OD 12; mentat#447 |
| D08 | UX2-2 | High | N/A | Existing guilds cannot add or rotate the secret without redoing OAuth and re-entering the bearer. v2's citation of mentat#312 as the edit path is wrong (#312 is stats-sharing revocation). | A secret-only update path (ownership re-verify, no token re-entry, same handshake) is a 2a deliverable. Hosted guilds use "Enable signing" in Core. The #312 citation is corrected. | §3.5.1, §3.5.11, §17; mentat#447 |
| D09 | UX2-3, UX2-5 | High | N/A | The same condition has contradictory player copy in §3.5.7 and §6.5. "Server admin" and "bot operator" name no one a tenant player can find. The obsolete shared-secret log text remains. | One copy table in `liveStockErrors.js`, referenced by both sections and covered by one test. The role name players are told to ask is **OD 13** (recommend "the person who connected this server to Mentat"). The transient rotation window is gone under D01. | §3.5.7, §6.5, §18 OD 13; mentat#447 |
| D10 | QA2-1, QA2-10 | High | Tampering, Repudiation | A per-repo sha pin cannot detect cross-repo drift. K-T7 uses a frozen copy of the signing code (the #1070 precedent: `test/actorSignature.test.js` skipped silently). A-T8's "before/after" comparison is a tautology or flaky. | Vendored golden signing vectors (v1 and v2) asserted by each repo's real code. mentat CI fetches Core's files at a named ref and fails (does not skip) under `CI=true`. A runtime contract marker. A-T8 uses vectors computed on `main` with `mock.timers`. | §11.3, §3.5.8; mentat#448 |
| D11 | QA2-2, ARCH2-5, SEC2-5, C2-4, QA2-16 | High | Spoofing, Info. Disclosure, EoP | Config and secret come from two reads keyed by `guildId`. `_resolveConfig` falls back to the process config (`adapterClient.js:277-283`, `index.js:164-177`). The self-check could hit the default Core. There is no `actor.guildId === guildId` assertion. `purpose` is untested. | **R2-D.** `resolveGuildRequestContext(guildId,{purpose})` returns `{coreUrl, token, secret, signing}` from one row read, strict in multi-tenant mode with a guild id. The self-check is a dedicated explicit-target call. The guild id is asserted. Requirement 0 gate: U13 is a hard A0 precondition. | §3.1, §3.5.5, §3.5.8 (A-T8, A-T17), M-T24; mentat#445 |
| D12 | QA2-4, QA2-5 | High | N/A | The UAT cannot run as written: step 3 exceeds the route's 6/min limiter; step 5's concurrency does not overlap; seeding needs identities and methods that are not specified; step 6 assumes a test bot instance. | Step 3 raises the limit on dune-dev only (a Requirement 7 restart) and spreads the calls. `stock_busy` is proven by T12 only. Every seed row names its method and identities, or is "T4 only". The live ephemeral toggle is dropped (M-T14 covers it). A named harness. | §11.4; mentat#448 |

### Medium

| ID | Raw IDs | Sev | STRIDE | Summary | Ruling | Where resolved |
|---|---|---|---|---|---|---|
| D13 | ARCH2-4, QA2-14 | Med | Tampering | `signedHeaders(actor, route, {secret})` collides with the existing third positional `env` parameter (`actorSignature.js`), which silently gives `{}`. The mentat "tests that break" list is missing (schema-version asserts, `expectedPathKeys`, DI seam). | **R2-D.** New `signHeadersWithSecret` / `writeBridgeSignHeadersWithSecret`, which throw on an empty secret. Env helpers untouched. A DI seam option. A tests-that-break table. | §3.5.5, §3.5.8; mentat#445 |
| D14 | ARCH2-6, SEC2-11 | Med | DoS | One Core holds one secret, but several signers can target it: the bot's default config, two guilds sharing a Core. Rotating for one breaks the others. | **R2-E.** mentat refuses per-guild provisioning when the `console_url` equals the process config's adapter base URL or another active guild's `console_url` ("one signer per Core"). How to move the operator's default-config paths is **OD 14**. | §3.5.3, §18 OD 14; mentat#443 |
| D15 | ARCH2-7, SEC2-8 | Med | Info. Disclosure, DoS, Spoofing | Auto-invite `/start` has no guild id (`setupServer.js:843-866`). The secret's carriage and lifetime through the two in-memory stores are unspecified. | **R2-F.** The candidate is carried in both stores under the same TTL, deleted on resolve, never in status payloads. The handshake runs at owner Confirm with the confirmed guild id. A-T13b. | §3.5.3; mentat#443 |
| D16 | ARCH2-10, G2-6, DBA2-16, QA2-20 | Med | N/A | mentat#438 is not cited. #384 is a draft. `deploy/deploy` (`be8f605`, local ref) is 22 commits ahead and 20 behind `main`, so A3 would ship the whole main delta. There is no schema reservation or guard test. | **R2-F.** No migration lands until #438 is resolved (deploy reconciled and deployed on its own, A-T8 baselined on the deployed SHA). A static ascending-guard test. Frozen DDL fixtures. The refs used may be stale (not re-fetched from the bot VM). | §2 F8, §3.5.2, §13 A0; mentat#446, mentat#438 |
| D17 | ARCH2-11, DBA2-02 | Med | DoS | Rolling back 2a (code or SQL) after hosted tenants are provisioned is an outage the bot operator cannot fix. "Leave the columns" is schema-compatible but not behaviour-compatible. | **R2-F.** 2a is forward-only once any tenant is promoted. Rollback means reverting to a build that still reads the v10 columns. The rollback SQL is only valid while no guild is provisioned. The code-rollback pre-check is required. Rollback order is v11 before v10. | §3.5.2, §13; mentat#446 |
| D18 | NET2-3, ARCH2-12 | Med (NET Med beats ARCH Low) | DoS | Writing `.env` does not reach a running container (compose interpolates at create, `docker-compose.web.yml:99-100`). K1 must set `process.env` in-process (precedent `adapterSettings.js:278-280`). | Specified in K1 plus the K-T1 assertion. | §3.5.3 K1; Core#1088 |
| D19 | QA2-12, ARCH2-14 | Med | Info. Disclosure | `getGuild`'s `SELECT *` plus spread (`database.js:532-535`) carries the new column into every guild object. A-T10 tests the wrong thing. | `getGuild` omits the column. A-T10 asserts the key is absent and a canary is absent from `JSON.stringify`. | §3.5.2, §3.5.8; mentat#445 |
| D20 | SEC2-4, NET2-8 | Med | Spoofing, Info. Disclosure | Self-check success is undefined. `request()` follows redirects (no `redirect` option, `adapterClient.js:447-451`) and turns a non-JSON 2xx into success. | Success = HTTP 200 JSON with `ok === true` **and** a constant-time fingerprint match. `redirect: "error"` on the check and every signed POST. A dedicated dispatcher-backed call. | §3.5.3; mentat#445 |
| D21 | SEC2-7 | Med | EoP, Info. Disclosure, Repudiation | Console authorization, CSRF and audit for reveal and Regenerate are unspecified. | K4: the highest settings permission, Deny before Allow, CSRF, and an audited reveal. A server-enforced one-time reveal of the pending value only. K-T12. | §3.5.3 K4; Core#1088 |
| D22 | G2-3, SEC2-10, C2-10 | Med | Info. Disclosure, Spoofing | Requirement 27 is partly met: no cadence or trigger list, no rehearsal, runbook paths unnamed, `.prev` kept indefinitely (and restoring it re-arms a leaked key). | Cadence (12 months plus triggers). `.prev` is deleted 15 min after promote and never verified. A dune-dev rotation rehearsal is an A4 exit criterion. Runbook paths are named. | §3.5.4; mentat#449 |
| D23 | G2-4, NET2-12, UX2-12 | Med | N/A | Documentation-impact tables are incomplete or wrong: the mentat path `docs/security/multi-tenant-secrets-at-rest.md` does not exist (real: `docs/security-secrets-at-rest.md`); the Core `secrets-management.md` inventory is missing; the compliance docs are missing; the §12 CHANGELOG row and the §6.5 log text still describe the shared secret; Core has no `docs/networking.md`. | Tables corrected. The stale text is rewritten. | §3.5.9, §6.5, §12; mentat#449 |
| D24 | G2-5, ARCH2-15 | Med | Repudiation | There is no layer × PR × issue map. The round-1 register text still says "v9" (GRC-1, GRC-9, DBA-12, STRIDE row). The header claim "every High resolved" was ambiguous about §3.5. | The §14.1 map was added. The register text was corrected in this round (see "Round 1 rows found incomplete"). The header was restated. | §14.1, header; mentat#449 |
| D25 | G2-7 | Med | N/A | Stale facts: PR #435 merged (`db3db83`), but v2 says it is open and `goalTransaction` is not on main. | Corrected: `goalTransaction` is on `origin/main` `src/commands.js:1314`. The branch rebase is noted for Requirement 29. | §2 F8, §6.1, §13; mentat#449 |
| D26 | G2-8 | Med | N/A | The signing stack and hosted flow are fork-only (not on `upstream/main`). OD 7 is undecided before A1. The Requirement 21 exception is not recorded. The merge button is unstated. | OD 7 must be decided before the Core 2a PR. The fork-only exception is recorded. "Merge commit, not squash". Upstream prerequisites are listed. | §14.3; mentat#449 |
| D27 | G2-9 | Med | Repudiation | Set, rotate, promote and revert events are not attributable to a human. Core `audit()` has no authenticated actor (Core #910). | mentat logs the registering Discord user id and the path. Core audit carries the console session user. Core #910 is linked. | §3.5.4; mentat#449, Core#1088 |
| D28 | C2-5, DBA2-12 | Med | Info. Disclosure, Repudiation | There is no revocation or offboarding path. Guild delete keeps credentials. The stats precedent leaves the DEK row behind. | `clearGuildActorSigningSecret` NULLs the three columns and deletes the DEK. It runs on guild delete or suspend and from the secret-only update path. Core deletes pending and `.prev` on adapter disable. | §3.5.12; mentat#445 |
| D29 | C2-6 | Med | Tampering, EoP | Core fails open when the secret file is unreadable, empty or torn (`actorSignatureSecret` returns `""`). | K1: temp file plus `rename`. The **managed** file path fails closed with one loud log line. An operator-set arbitrary `_FILE` keeps today's behaviour with a warning (Requirement 0). | §3.5.3 K1; Core#1088 |
| D30 | C2-7, QA2-13 | Med | DoS, Info. Disclosure | `reencrypt-secrets.js` `TABLES` lists only `adapter_token`. No test covers the new column through rotate-keys or recover-keys. | Add the column (and `stats_push_secret`). An enumeration test. A-T22. | §3.5.9, §3.5.8; mentat#446 |
| D31 | C2-8 | Med | Info. Disclosure | The bearer and the signing secret travel in one body, so one leak of that body is full impersonation. | **OD 10**, recommend accepting with mitigations: proxy logging off, value redaction, allowlisted status shapes. Separate delivery would need a new mentat-to-Core pull credential. | §3.5.3, §18 OD 10 |
| D32 | C2-9 | Med | EoP, Tampering | The stock query runs as the game-DB owner role. Read-only rests only on a per-transaction preamble. | **OD 11**, recommend an optional `DUNE_DB_RO_USER` with a preamble fallback. T9 asserts the preamble is first. | §4.5, §18 OD 11; Core#1088 appendix |
| D33 | NET2-4 | Med | DoS | The 5.5 s budget omits `requireLinkedPlayer`'s own pool wait. A mentat abort leaves the semaphore held. | Semaphore before `requireLinkedPlayer` in one bounded transaction. A 5 s whole-handler deadline. A route-specific mentat timeout. | §4.5; Core#1088 appendix |
| D34 | NET2-5 | Med | DoS | `createLoginRateLimiter` counts failures, blocks for 15 min and has a shared global key (`rateLimit.js:32-96`). | A `createMutationRateLimiter`-style window keyed on the user, recorded after the signature verifies, with an explicit global ceiling and Retry-After. | §4.5; Core#1088 appendix |
| D35 | NET2-6 | Med | DoS | A cap of 1 per Core plus the per-user cooldown gives a busy/retry storm, and mentat does no smoothing. | A per-guild mentat in-flight gate (fails fast, no cooldown). Honour Retry-After (minimum 30 s). Documented throughput. | §4.5, §6.7 |
| D36 | DBA2-03 | Med | Tampering, DoS | Encrypt upserts the DEK before the row UPDATE (`database.js:445-458`), with no transaction and a store after an await. A failure destroys the old secret. | One synchronous transaction after the await. It re-reads the guild and asserts `changes === 1`. A-T4b. | §3.5.2; mentat#446 |
| D37 | DBA2-04, SEC2-12, C2-13 | Med | Repudiation, DoS | A decrypt per signed request writes a `secret_access_log` row (never pruned). The evidence gets buried. | In-memory cache keyed `(guildId, set_at)`. Log on cache fill only. Retention for `decrypt` rows. | §3.5.5; mentat#446 |
| D38 | DBA2-05 | Med | Info. Disclosure | The read path accepts untagged or `plain:` values as decrypted (`secretsCrypto.js:386-390`). | The resolver requires `enc:v1:` or `enc:v2:`, else `decrypt_failed`. A-T5b. | §3.5.5; mentat#446 |
| D39 | DBA2-06 | Med | Repudiation, DoS | Backup and restore are not designed. A restore re-installs a stale secret that still reads "verified". The KEK/backup unit is unstated. The A-T15 sanitisation list is incomplete. | A restore procedure (re-verify all provisioned guilds and clear on failure). Backup plus KEK versions are one unit. The sanitisation list is extended. `.backup` over a file copy. | §3.5.12; mentat#446 |
| D40 | DBA2-07 | Med | DoS | The EXPLAIN merge gate runs only on dune-dev, whose data volume does not predict the prod plan. | EXPLAIN on a production-size restore. Index checks on three tables. The first prod call is monitored. | §11.4; Core#1088 appendix |
| D41 | UX2-7 | Med | N/A | A Core with 2a but without the stock route gives the operator no signal. | The check response carries `features`; 2b adds `"stock"`. Player copy names who can update the Core. | §3.5.3 K2; mentat#447 |
| D42 | UX2-8 | Med | N/A | "Already up to date" is wrong when Apply skipped decreases. The button matrix is unspecified. | A button matrix (Apply hidden when it would write nothing). Distinct outcome copy. M-T10. | §6.3, §6.4 |
| D43 | UX2-9 | Med | N/A | Which character is read is undiscoverable. `/dune player default` may not govern Core's `getLinkedPlayer`. | L2 verification (U16). The copy must name the governing selection. It never ships silent. | §3.1, §16 U16 |
| D44 | UX2-10 | Med | N/A | Backpack-unavailable has no player copy or remedy. A decision-table row is missing (no entry, B = 0). | Copy with the remedy (log in once). The row was added. | §6.4 |
| D45 | UX2-11 | Med | Info. Disclosure | The source line shows the tenant's console host to every player. mentat already treats the host as sensitive (#207). | The source line shows the guild name only. | §3.1 |
| D46 | QA2-6 | Med | N/A | Two buttons against a single-use nonce contradict M-T21. | One nonce pair per preview, consumed together. M-T21 re-runs `sync` between applies. | §6.3; mentat#448 |
| D47 | QA2-7 | Med | Tampering | A double-click test can pass while the race exists (an await before the nonce delete). | Synchronous get plus delete before the first await. A `Promise.all` test with a yielding `deferUpdate`. | §6.3; mentat#448 |
| D48 | QA2-8 | Med | N/A | CAS test gaps: 1 s `updated_at`, absent → present, two previews. | M-T13 cases added, using direct SQL or `mock.timers`, never sleep. | §11.2; mentat#448 |
| D49 | QA2-9 | Med | N/A | No IMMEDIATE or SQLITE_BUSY test. No `busy_timeout`. | A second-connection lock test. Friendly message on BUSY. Nonce policy on BUSY (not consumed). | §6.4, §11.2; mentat#448 |
| D50 | QA2-11, C2-11 | Med (QA Med beats C Low) | Info. Disclosure | A-T11 will fail or pass vacuously. A bare 64-hex value in a string is not redacted (`format.js:82-92`). Log fields containing "secret" are redacted wholesale. | A canary test over all outputs. A value-based 64-hex redaction pattern on these paths. Log fields renamed (`signing_set_at`). | §3.5.8 A-T11, §9; mentat#448 |
| D51 | QA2-17 | Med | DoS | Semaphore and limiter leak and ordering cases are untested. | T12b (permit released on throw, timeout or close), T12c (denied requests take no slot), reset helpers. | §11.1; Core#1088 appendix |
| D52 | QA2-18, SEC2-16 (Low) | Med | N/A | The synthetic self-check actor omits `username`, which Core requires (`policy.js:159-168` `normalizeDiscordActor`). U14 is answerable. | The full synthetic actor is specified as a shared fixture. U14 is closed (`interactionId` optional, `username` required). | §3.5.3, §16; mentat#448 |

### Low

All are bundled in **mentat#450** with dispositions.

| ID | Raw IDs | STRIDE | Summary | Where resolved |
|---|---|---|---|---|
| D53 | SEC2-13 | Tampering | T2's second case asserts an impossible invariant | §11.1 T2 |
| D54 | SEC2-14 | Repudiation | Denied audit lines record unverified ids as facts | §4.7 |
| D55 | SEC2-15 | Info. Disclosure | Core redaction of the secret field is untested | §3.5.8 K-T9 |
| D56 | G2-10 | N/A | Requirement 13/15/28 process gaps | §14.1; this round's filing |
| D57 | G2-11 | DoS | "What if lost" answer is incomplete (KEK loss) | §14.2 g |
| D58 | G2-12 | N/A | No per-PR risk classification or version plan | §14.1 |
| D59 | G2-13 | Spoofing | The pre-enable review has no owner or evidence template | §4.2(a) |
| D60 | NET2-9 | DoS | Reachability matrix; hairpin through Cloudflare | §3.5.9, §11.4 |
| D61 | NET2-10 | N/A | Discord 3 s limits for autocomplete and buttons | §6.1 |
| D62 | C2-12 | Spoofing | Clone detection is runbook-only | **Deferred** (§17): runbook step now |
| D63 | DBA2-08 | N/A | No composed Core fixture | §11.1 |
| D64 | DBA2-10 | Repudiation | The "last synced from" query is unspecified | §3.1 |
| D65 | DBA2-11 | Info. Disclosure, Repudiation | Audit retention and growth | §7, §8 |
| D66 | DBA2-13 | N/A | `db.exec(SCHEMA)` runs before the ALTERs | §3.5.2 |
| D67 | DBA2-14 | Repudiation | Clamp, then compare | §6.4 |
| D68 | DBA2-15 | N/A | Schema capability probe; SQLSTATE lost | §4.3 |
| D69 | UX2-13 | N/A | Expired buttons stay clickable | §6.3 |
| D70 | UX2-14 | N/A | Autocomplete label and empty state | §6.1 |
| D71 | UX2-15 | N/A | Embed limits | §6.6 |
| D72 | UX2-16 | N/A | Paste-field ergonomics | §3.5.11 |
| D73 | QA2-19 | Repudiation, DoS | Replay tests | §4.8, §11.1 |
| D74 | QA2-21 | N/A | Budget exact strings | §6.1 |
| D75 | QA2-22 | N/A | Failure-mapping tests | §3.5.8 A-T23 |

## Round 2 STRIDE report

| STRIDE category | Findings (dedup rows) | Max severity | Resolution status |
|---|---|---|---|
| **Spoofing** | D03, D04, D11, D15, D20, D22, D59, D62 | High | Resolved in v3. D62 is deferred (runbook now). |
| **Tampering** | D01, D03, D10, D13, D29, D32, D36, D47, D53 | High | Resolved in v3. D32 is pending OD 11 (a safe default is specified). |
| **Repudiation** | D06, D10, D21, D24, D27, D28, D37, D39, D54, D64, D65, D67, D73 | High | Resolved in v3 |
| **Information Disclosure** | D04, D11, D15, D19, D20, D21, D22, D28, D30, D31, D38, D45, D50, D55, D65 | High | Resolved in v3. D31 is pending OD 10. |
| **Denial of Service** | D01, D02, D03, D04, D05, D06, D14, D15, D17, D18, D30, D33, D34, D35, D36, D37, D39, D40, D51, D57, D60, D73 | High | Resolved in v3. D14 is pending OD 14 (the guard refuses by default). |
| **Elevation of Privilege** | D02, D11, D21, D29, D32 | High | Resolved in v3 (D02 by signature v2) |

These rows map to no STRIDE category (correctness, UX or governance). They are listed so their
absence above is not mistaken for an omission: D07, D08, D09, D12, D16, D23, D25, D26, D41, D42, D43,
D44, D46, D48, D49, D52, D56, D58, D61, D63, D66, D68, D69, D70, D71, D72, D74, D75.

Every STRIDE category has at least one finding in round 2.

## Round 1 rows found incomplete by round 2

| Round-1 row | What round 2 found | Round-2 row |
|---|---|---|
| ARCH-1, SEC-3, CLOUD-3 | Phase 2a resolved the shared key only for freshly generated values. It added new outage and privilege paths (premature enforcement, owner strip, stale binding). | D01, D02, D03, D04 |
| CLOUD-2 | The lifecycle ordering was wrong and revocation was missing | D01, D28 |
| CLOUD-8 | "Distinct by construction" does not hold for pasted values | D04 |
| GRC-8 | The runbook was not located; no cadence | D22, D23 |
| GRC-1, GRC-9, DBA-12, the Repudiation STRIDE row | Register text said "v9". Provenance is **v11** and the signing secret is **v10**. **Corrected in place this round.** | D24 |
| QA-2, QA-12 | The sha-pin drift check cannot detect cross-repo drift | D10 |
| QA-8 | The UAT is still not executable (limiter, seeding, test instance) | D12 |
| NET-3, SEC-4, DBA-4 | The budget omitted the `requireLinkedPlayer` pool wait. The wrong limiter type was named. | D33, D34 |
| SEC-8 (T2) | T2's second case was impossible | D53 |
| NET-5, UX-6 | The source line leaked the console host. Character selection was undiscoverable. | D45, D43 |
| UX-5 | "Already up to date" was wrong with skipped decreases | D42 |
| GRC-2, CLOUD-7 | Denied audit lines claimed unverified ids | D54 |

## Cross-hat conflicts and adjudications (round 2)

1. **SEC2-6 vs C2-3 on cross-guild secret comparison.** SEC2-6 proposed refusing a secret already
   stored for another guild. C2-3 warned that this is a cross-tenant oracle. **Adjudicated for C2-3:**
   compare only against the process-wide secret. Two guilds per Core are handled by the
   `console_url` guard (D14), never by comparing values.
2. **ARCH2-1's capability flag (`supportsActorSigning`).** Not needed once promotion is driven by
   mentat: Core never enforces a pending secret, so an old mentat cannot cause an outage. Recorded as
   superseded, not wrong.
3. **DBA2-02's "OD 8 grace as the real mitigation"** is superseded by the pending/promote handshake
   (D01). OD 8 is closed as superseded.
4. **Severity adjudications:**
   - D04 is High (G2/UX High over ARCH/SEC Low), because it breaks a flow that works today.
   - D18 is Medium (NET over ARCH).
   - D19 is Medium (QA over ARCH).
   - D50 is Medium (QA over Cloud).
   - D52 is Medium (QA over SEC).
5. **R2-C's clear-on-bearer-change.** A bearer rotation on the *same* Core also clears the secret.
   The same request's handshake (`existing` mode, which K1 always sends) re-verifies it. If that
   handshake fails transiently, the guild is left unprovisioned: it fails closed, and a reconnect
   recovers it. Accepted as the ruling's cost. It is recorded, not silently changed.
6. **R2-D's strict resolution** changes behaviour for inactive guilds on guild-scoped background paths
   (`atlasRefresh.js:47`, `statsPusher.js:73`): they refuse instead of reaching the operator's Core.
   System paths with no guild id (`scheduler.js`, `notifications.js`) are unchanged. Requirement 0
   gate: U13 (the operator's guilds are active rows) is a hard A0 precondition.

7. **Ruling R2-D, "self-check goes through the same resolver": refined on code evidence.** The
   handshake cannot use `resolveGuildRequestContext`:
   - At handshake time the guild's row holds the *previous* `console_url` and bearer, or no row at
     all. For auto-invite, `upsertGuild` runs only at owner Confirm (`src/setupServer.js:880-900`).
   - A pending or inactive row makes the strict resolver refuse.
   - The handshake must target the *submitted* URL and bearer.

   v3 therefore keeps the ruling's intent (never the default Core; zero requests to any other
   Core) with a dedicated explicit-target call. It uses the same dispatcher and `redirect: "error"`,
   and A-T17 enforces it. Every *signed request after* provisioning uses the resolver, as ruled.

## Hat claims corrected (verified against code or GitHub)

- **QA hat counts:** it reported "High 4, Medium 12, Low 4 (20)". It lists QA2-1..22, which is
  **14 Medium, 22 total**. The tables above use 22.
- **QA2's negative result "`goalTransaction` does not exist on main":** true at the audit base
  `f8709f0`, but stale. PR #435 merged 2026-09-30T00:18Z, and `origin/main` `db3db83` has
  `goalTransaction` at `src/commands.js:1314`.
- **SEC2-6 "dune-dev and dune-prod hold the same value":** an inference. The code comment
  (`src/actorSignature.js:66-69`) confirms the secret on the bot VM and "in production" only.
  Dev/prod equality is **unverified** (U12). The finding stands because the guard is mechanical.
- **G2-2 "operators using write … will have the direct var set":** partly corrected. They may use
  `_FILE` instead (`.env.example:191-192`; compose passes both, `docker-compose.web.yml:99-100`). K1
  treats both as `existing`.
- **Design v2 and UX2-2 citing mentat#312 as the "edit my existing guild" path:** #312 is stats-sharing
  revocation. It *depends on* an edit entry point that has no issue. Corrected in v3 §3.5.1/§17. The
  edit path is covered by mentat#447.
- **ARCH2-10 deploy/deploy counts:** measured on a local ref that was not re-fetched from the bot VM
  (it may be stale). Re-measured against current `origin/main` `db3db83`: 22 commits not on main, 20
  main commits missing. Same as the hat's figures.

## Requirement 28 (re-run 2026-09-29, this round)

`gh issue list --repo Project-Arrakis/dune-awakening-selfhost-docker --label ops-monitor --state open`:
- **#1086** (bug, severity:high): fork/upstream divergence 1533 ahead / 1404 behind. Relevant to any
  future upstream PR (OD 7). The fork-only branch is unaffected.
- **#1085** (needs-human-review): "Upstream sync status". It notes the raw commit counts are
  unreliable for this fork (squash-sync). Report to the operator.
- **#1069** (type:vulnerability, severity:medium, needs-human-review): upstream security-checks CI
  silently skips gitleaks. Relevant to Requirement 10 scan evidence for any upstream PR.

mentat has no `ops-monitor` issues. Two `needs-human-review` items (#1085, #1069) remain open for
the operator.

## Next steps (round 2)

- Post this round's summary on mentat#434 (Requirement 20).
- Design v3 applies every resolution above. The operator decides OD 10–14. OD 8 is closed as
  superseded.
- Layer 1 for Phase 2a is **complete at round 2** once v3 is reviewed. No Critical or High is left
  without a design resolution.
- Implementation stays blocked by: mentat#438 (the schema gate), U13 (A0), OD 7 (before the Core PR),
  and the order mentat 2a then Core#1088.
