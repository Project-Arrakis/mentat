# Command Surface Split — Layer 1 Audit Findings Register

**Target:** `docs/superpowers/specs/2026-09-30-command-surface-split-design.md`
- **Audited version:** v1, commit `2218f31` (base `f8709f0`).
- **Dispositions refer to:** v2 of the same file. `§n` is a v2 section, `OD n` is an item of v2 §14,
  and `R-A` … `R-H` are the consolidation rulings recorded in v2 §0.

**Layer:** Requirement 20, Layer 1 (design). There were eight independent hat dispatches:
Architect, Security, GRC, Network, Cloud Security, UI/UX, DBA and QA. The consolidation was a
separate pass that read all eight reports and re-verified every finding a ruling depends on.

**Evidence base:**
- mentat: worktree `command-split-design`; `origin/main` `db3db83` (PR #435 merged after the
  audited base `f8709f0`); PR #436 head `6d2275b`; PR #384 head `923922d` (fetched read-only).
- Core: `origin/main` `ace31877`, read through `git grep`/`git show` only (Requirement 18).
- Budgets: `discordCommandCharBudget()` from `test/commands.test.js`, run on real
  `commandDefinitions({ includeWriteGroup: true })` JSON.

**Tracking issues filed from this audit (Requirement 13/15, filed before the design edit):**
- mentat#439: single-tenant `DISCORD_*_ROLE_IDS` overrides never apply (from GRC-7a).
- mentat#440: deploy hook re-registration misses tree inputs and reports a failed register as
  success (from GRC-7c, CLOUD-1, ARCH-5, SEC-3, QA-8, CONS-1).
- dune-awakening-selfhost-docker#1087: Core user-visible text names Mentat command paths;
  `/dune data verify` is wrong today (from GRC-6, UX-17; Requirement 18 hand-off).
- #384 budget: comment on its tracking issue mentat#372 (from GRC-7d, ARCH-3).
- All three new issues were added to the project board with
  `gh project item-add 1 --owner yacketrj`. `Priority`/`Workstream` fields were **not** set
  (not settable with that command); to do by hand.

## Counts

### Raw, per hat (as reported, corrected where a hat mis-summed)

| Hat | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Architect (ARCH) | 0 | 3 | 6 | 4 | 13 |
| Security (SEC) | 0 | 0 | 3 | 7 | 10 |
| GRC | 0 | 4 | 7 | 4 | 15 |
| Network (NET) | 0 | 1 | 3 | 3 | 7 |
| Cloud Security (CLOUD) | 0 | 1 | 4 | 3 | 8 |
| UI/UX (UX) | 0 | 6 | 8 | 3 | 17 |
| DBA | 0 | 0 | 0 | 2 | 2 |
| QA | 2 | 6 | 6 | 2 | 16 |
| **Hat total** | **2** | **21** | **37** | **28** | **88** |
| Consolidator (CONS) | 0 | 0 | 1 | 0 | 1 |

QA's own summary line said "Medium 5"; its report lists six Medium findings (QA-9 … QA-14). NET-5
is recorded at the hat's own count (Low), although its text says "Medium in multi-guild".

### Consolidated (overlaps merged, rated at the highest member severity)

| Severity | Clusters | Resolved in design (v2) | Resolved, pending an Open Decision | Resolved by a filed issue / prerequisite | Rejected |
|---|---:|---:|---:|---:|---:|
| Critical | 1 | 1 | 0 | 0 | 0 |
| High | 10 | 8 | 2 (K14 → OD3/OD9; K3 part → OD7) | 0 | 0 |
| Medium | 8 | 4 | 3 (K16 → OD1; K17 → OD5; K19 → OD6) | 1 (K11 → #439, #1087) | 0 |
| **Total** | **19** | **13** | **5** | **1** | **0** |

No finding is rejected outright. Four **sub-claims** are corrected with evidence (see
"Cross-hat conflicts and corrections").

## Consolidated clusters

| Cluster | Max sev | Member findings | Ruling | Where resolved in v2 |
|---|---|---|---|---|
| K1 Dispatch model: layout-dependent dispatch, pointer to unregistered commands, shims that execute | High | ARCH-1, ARCH-2, SEC-1, NET-5, QA-14 | R-A | §5.2, §5.3, §7.3, §7.4 |
| K2 Registration trigger, failure handling and drift | High | CLOUD-1, QA-8, ARCH-5, SEC-3, CLOUD-3, ARCH-13, SEC-8, NET-6, CLOUD-8, CONS-1 | R-B | §5.7, §7.2; prerequisite mentat#440 |
| K3 Rollout order, public feed and consumers | High | NET-1, UX-7, ARCH-4, UX-12, NET-2, NET-3, NET-7 | R-C (+ OD7) | §5.1, §6.5, §7.7, §14 OD7 |
| K4 Legacy tree budget and maintenance | High | ARCH-3 | R-D | §5.8, §4.4, §10 |
| K5 Test oracle and before-record integrity | Critical | QA-1, QA-2, GRC-2, QA-3, QA-4, QA-7, QA-10, QA-11, QA-12, SEC-9, QA-16 | R-E | §9.1–§9.4 |
| K6 Test infrastructure and existing tests | High | QA-5, QA-6, QA-9, ARCH-9, QA-15, ARCH-11, ARCH-12 | R-E | §5.5, §9.5–§9.8, §5.10 |
| K7 Discord-level permissions, contexts and registration scope | Medium | SEC-2, CLOUD-4, CLOUD-2, CLOUD-5, NET-4, QA-13, SEC-10, CLOUD-6, CLOUD-7 | R-F | §6.3, §6.4, §7.6, §7.7, §9.9 |
| K8 Key resolution and routing hardening | Medium | ARCH-6, ARCH-7, SEC-4, SEC-5, SEC-6, SEC-7, DBA-1, DBA-2 | R-G | §5.2, §5.4, §5.6 |
| K9 Audit evidence and versioning | High | GRC-1, GRC-3 | R-H | §8, §13 |
| K10 Documentation impact | High | GRC-4, GRC-5, GRC-11, GRC-12, GRC-15 | R-H | §12 |
| K11 Pre-existing defects not tracked | Medium | GRC-6, GRC-7, UX-17 | R-H | Filed: mentat#439, mentat#440, Core#1087, comment on #372; §16 |
| K12 Sequencing, rollback, freshness | Medium | ARCH-8, GRC-9, GRC-10, GRC-8, GRC-13, GRC-14, ARCH-10 | R-H | §7.8, §10, §13, header |
| K13 Pointer copy and clickable mentions | High | UX-1, UX-2, UX-5, UX-16 | R-A (UX) | §7.4 |
| K14 Shim presentation and group naming | High | UX-3, UX-4, UX-15 | OD3, OD9 | §7.3, §14 |
| K15 In-Discord announcement | High | UX-6 | R-H | §7.9 |
| K16 Top-level name collision | Medium | UX-8 | OD1 (R7 raised to Medium) | §11, §14 |
| K17 Descriptions and "order" discoverability | Medium | UX-9, UX-10 | OD5, OD8 | §4.4, §14 |
| K18 Help layout and `/dune` as the staff surface | Medium | UX-11, UX-14 | Design | §7.5, §5.1 |
| K19 Calculator placement | Medium | UX-13 | OD6 | §14 |

## Findings

STRIDE is the category the hat assigned, adjusted where noted. "N/A" means a correctness, UX or
governance defect with no STRIDE mapping. "Cluster" is the merge key above.

### Architect (ARCH)

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| ARCH-1 | High | N/A | K1 | Layout flag's dispatch semantics contradict themselves; `/dune goal` autocomplete returns `[]` in the default layout | Resolved §5.2/§5.3 (R-A): one `resolveInvocation()`, dispatch and autocomplete independent of layout; flag controls registration and display strings only. §5.5 routes autocomplete on the resolved logical group. |
| ARCH-2 | High | DoS | K1 | Pointer can name an unregistered command, taking down 17 player/goal paths | Resolved §5.3 (legacy paths alias-execute; pointers only for the registered `moved` shims and non-executable cases), §7.2 (startup drift check in scope, pointer text driven by the registered layout) |
| ARCH-3 | High | N/A | K4 | "Two trees cost nothing in the budget" is false; legacy keeps the 7500 ceiling | Resolved §5.8 (R-D): legacy frozen by a snapshot test, shared adders, 7500 target per layout; §4.4 legacy + Phase 2 = 7493; OD8 and #384 after legacy removal (§10). Re-verified: #384 `service-setup` = 360 chars, 7473 + 360 = 7833. |
| ARCH-4 | Med | N/A | K3 | Surface map, help, strings and feed are not layout-aware | Resolved §5.1 (`invocationFor(key, layout)`, layout = the **registered** layout, R-C), §9.6 test that every produced string resolves in that layout; Phase 2 strings added to §10 |
| ARCH-5 | Med | DoS | K2 | Registration trigger is a hand-kept file list | Resolved §7.2 (R-B hash of rendered JSON); prerequisite mentat#440 |
| ARCH-6 | Med | N/A | K8 | Key derivation for moved writes on legacy paths is underspecified | Resolved §5.2 (R-G): `resolveInvocation` keyed on (command, rawGroup, sub), the only place a key is computed; totality test §9.4 |
| ARCH-7 | Med | Info. Disclosure | K8 | Bare-subcommand branches become routing traps | Resolved §5.6: ops branch requires `group === "ops"`; embed selection via a key-indexed `FORMATTERS` map; one-branch-per-key structure test |
| ARCH-8 | Med | Tampering | K12 | Work not sliced; "same registered tree" untested | Resolved §9.2 (JSON snapshot of today's tree, legacy deep-equals it), §10 PR sequencing table (seven PRs) |
| ARCH-9 | Med | N/A | K6 | Test/doc-gate inventory misses user-guide drift test and fixtures | Resolved §5.10 list, §9.7 (drift test parses every top-level command, mapping table exempted by marker) |
| ARCH-10 | Low | N/A | K12 | Open-PR section stale (#436 already fixed `write cache`; #435 merged); #436 override test will silently stop testing | Resolved §3.3 item 8 (resolved by #436 `6d2275b`), §10, §5.10 (rename `player:kick` override to `moderation:kick`). Re-verified: #436 head `6d2275b` commit "Derive legacy write:* help entries from LEGACY_WRITE_STUBS…". |
| ARCH-11 | Low | EoP | K6 | Key-uniqueness test must cover both layouts, shims and `confirm-connection` | Resolved §9.4 (alias set over {legacy, split} × {writes on, off} ∪ shims equals the literal move list) |
| ARCH-12 | Low | N/A | K6 | `confirm-connection` outside the surface map | Resolved §5.1 (listed, handler "external") |
| ARCH-13 | Low | N/A | K2 | Flag read from env in two processes; builder API unspecified | Resolved §5.7 (layout passed as a parameter, strict parse through `loadConfig`, logged) |

### Security (SEC)

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| SEC-1 | Med | Tampering | K1 | Option-less shims named like real subcommands execute when dispatch and registration disagree (`/dune player unlink` with no option unlinks) | Resolved §5.3/§7.3 (R-A): shims are named `moved`, which is never a real subcommand; legacy paths alias-execute under the new key through the same gates; restart-before-register (§7.7). Re-verified: `unlink`'s `character` option is optional (`src/commands.js:180-181`). |
| SEC-2 | Med | EoP, Info. Disclosure | K7 | Guilds that restricted `/dune` via Integrations lose the restriction on `/player`/`/goal`; reading overrides is possible with the bot token | Resolved §6.4/§7.6 (R-F): release blocker for hosted guilds; enumerate before flip, notify owners. **Bot-token read is UNVERIFIED** (conflicts with CLOUD-4); confirm on dune-dev as precondition P3. |
| SEC-3 | Med | DoS | K2 | Flipping the default in `config.js` does not re-register | Resolved §7.2 (hash decision), §7.7 |
| SEC-4 | Low | EoP (latent), Repudiation | K8 | Translation point for legacy writes unspecified | Resolved §5.2 (one resolver before every gate), spy test §9.4 |
| SEC-5 | Low | Tampering | K8 | Entry guard and caller-keyed lookups underspecified | Resolved §5.6 (`isChatInputCommand` kept, `Map`/`Object.hasOwn`), §9.5 |
| SEC-6 | Low | Tampering | K8 | Group-agnostic branches riskier with three roots | Resolved §5.6 (same fix as ARCH-7). The `server-control` name suggestion goes to OD9. |
| SEC-7 | Low | Info. Disclosure | K8 | Pointer path must be proven pure; write shims must follow the write flag | Resolved §5.3 (pointer text only from the literal move table; no per-write shims exist in v2), §9.5 spy test |
| SEC-8 | Low | Tampering | K2 | `DUNE_COMMAND_LAYOUT` strict parse, one source, visible | Resolved §5.7 |
| SEC-9 | Low | EoP | K5 | Matrix lacks DM and guild-status axes; golden can be regenerated | Resolved §9.1–§9.3 |
| SEC-10 | Low | N/A | K7 | §6.4 user-token claim wrong; §5.5 cites a #435 call absent on the base; §6.2 line refs | Resolved §6.4 (claim withdrawn, marked UNVERIFIED), §5.5 (#435 now on `main`, `src/commands.js:1788` at `db3db83`), line refs refreshed |

### GRC

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| GRC-1 | High | Repudiation | K9 | No audit-evidence plan | Resolved §13 (per layer: issue, comment, STRIDE table) |
| GRC-2 | High | Repudiation, Tampering | K5 | Before-record not durable; could be regenerated | Resolved §9.1 (generated once at `f8709f0` by a committed script, own PR, CI forbids regeneration, summary posted on #423) |
| GRC-3 | High | N/A | K9 | Versioning and release classification missing | Resolved §8 (rc.6 / rc.7 / removal release mapping, dated window, audit gateway per release) |
| GRC-4 | High | N/A | K10 | Documentation-impact table incomplete, no owners | Resolved §12 (owner column, every grep-hit file with a decision, GitBook, `docs/architecture.md` gate order) |
| GRC-5 | Med | N/A | K10 | "Historical docs not rewritten" risks drift | Resolved §12 (superseded-paths banner on still-linked docs) |
| GRC-6 | Med | N/A | K11 | Requirement 18 Core issue not filed; cross-repo grep missing | Resolved: filed **Core#1087** with file:line and an implementation prompt; addon/docs-site grep listed in §12 |
| GRC-7 | Med | EoP (a) | K11 | Discovered defects left as prose | Resolved: (a) **#439**, (b) resolved in #436 `6d2275b`, (c) **#440**, (d) comment on **#372**, (e) #433 exists |
| GRC-8 | Med | N/A | K12 | Requirement 28 check not recorded | Resolved §13: run 2026-09-29, 0 open `ops-monitor`, 0 `remediation-ready`, 0 `needs-human-review` on mentat |
| GRC-9 | Med | N/A | K12 | Sequencing not enforced; branch names missing | Resolved §10 PR table (issue, branch, depends-on) |
| GRC-10 | Med | DoS | K12 | Rollback has no verify step, owner or trigger; no in-Discord comms | Resolved §7.8 (rollback), §7.9 (announcement), §7.6 (scope precondition) |
| GRC-11 | Med | Spoofing (as assigned; N/A is defensible) | K10 | Gate-order doc in `docs/architecture.md` becomes false | Resolved §12 row; v2 no longer puts a pointer before the gates for legacy paths (only the pure `moved` shim) |
| GRC-12 | Low | N/A | K10 | `.env.example` and deploy templates not listed | Resolved §12 |
| GRC-13 | Low | N/A | K12 | Point-in-time counts | Resolved: counts marked "as of `f8709f0`/`db3db83`", grep command in §15 |
| GRC-14 | Low | N/A | K12 | Requirement 29 freshness not recorded | Resolved header and §13 (base re-checked 2026-09-29: `origin/main` = `db3db83`, one commit after `f8709f0`, budget unchanged at 7473) |
| GRC-15 | Low | N/A | K10 | `compliance/` not fully grepped | Resolved §12 (grep over `compliance/` recorded) |

### Network (NET)

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| NET-1 | High | N/A | K3 | Old accordion + new feed window unhandled; "merged" is not "deployed" | Resolved §7.7 (R-C): mentat-link deploys first and is verified live on Pages; feed prefix/groups derive from the registered layout |
| NET-2 | Med | Tampering (low) | K3 | Malformed `prefix` unspecified in consumer | Resolved §6.5 (type and pattern check with fallback, contract test) |
| NET-3 | Med | N/A | K3 | Feed cache window unanalysed | Resolved §6.5 (`Cache-Control: no-cache` on `/api/commands`, test) |
| NET-4 | Med | N/A | K7 | Registration scope is the crux; left unverified | Resolved §7.6 precondition P1 (operator-only read-only checks, exact commands) |
| NET-5 | Low | N/A | K1 | Runbook registers before restart | Resolved §7.7 (restart first, then register) |
| NET-6 | Low | DoS (low) | K2 | Hook failure only a WARNING; drift check should be prerequisite | Resolved §7.2 |
| NET-7 | Low | N/A | K3 | Multi-guild timing implicit; feed is hosted-only | Resolved §6.5 (feed describes the hosted bot), §7.7 (non-dev guild verified) |

### Cloud Security (CLOUD)

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| CLOUD-1 | High | DoS, Tampering | K2 | Allowlist rots; failed register only a WARNING | Resolved §7.2 (R-B); prerequisite mentat#440 |
| CLOUD-2 | Med | EoP, Info. Disclosure | K7 | Contexts unset is status quo, not deliberate; DM exposure | Resolved §6.4 (`contexts: [Guild]` on `/player` and `/goal`, DM tests), subject to the DM rows of the before-record |
| CLOUD-3 | Med | Tampering | K2 | Bot, register process and `.env` can disagree on layout | Resolved §5.7, §7.2 (logged at register and startup; drift check compares with the bot's own layout) |
| CLOUD-4 | Med | EoP | K7 | Integrations overrides do not carry over; says reading needs a user token | Resolved §6.4/§7.6 (R-F). Its user-token claim conflicts with SEC-2; UNVERIFIED, precondition P3. |
| CLOUD-5 | Med | Tampering | K7 | UAT's guild-scope registration leaves a stale set | Resolved §7.7 step 8 (explicit empty PUT to guild scope, both scopes verified on rollout and rollback) |
| CLOUD-6 | Low | N/A | K7 | No statement that no scope/permission/token change is needed | Resolved §6.4 |
| CLOUD-7 | Low | Repudiation | K7 | Registration rate limits during UAT iterations | Resolved §7.7 (guild scope for iteration, one global PUT; expected count ≤ 4). The "200 creates/day" figure is UNVERIFIED. |
| CLOUD-8 | Low | DoS | K2 | Register without writes env silently drops write groups | Resolved §7.2 (register logs writes state and groups; step 9 asserts `moderation` present) |

### UI/UX (UX)

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| UX-1 | High | N/A | K13 | Pointer copy unspecified; drops typed options | Resolved §7.4 (per-case copy, typed options echoed as a copy-pasteable line, "nothing was executed"). Under R-A a stale client with options now executes, so the pointer only appears on the option-less `moved` shim. |
| UX-2 | High | N/A | K13 | Clickable command mentions deferred | Resolved §7.4: mentions in the same PR, fallback to code text |
| UX-3 | High | N/A | K14 | `moderation`/`operations` names not guessable | **OD9** (group naming) with recommendation; audience note in pointer and help |
| UX-4 | High | N/A | K14 | Picker shows a wall of 19 "Moved" entries | Resolved §7.3: one `moved` entry per legacy group with a "DEPRECATED" header (178 chars total); the picker content is stated in the release note |
| UX-5 | Med | N/A | K13 | Client-cache remedy never told to users | Resolved §7.4 (pointer and announcement say to reload Discord); stale-client behaviour verified in UAT §9.9 |
| UX-6 | High | N/A | K15 | No in-Discord announcement | Resolved §7.9 (one announcement per guild at flip, help banner during the window, "What moved" on mentat-link) |
| UX-7 | High | N/A | K3 | Legacy/split feed and docs diverge for self-hosters | Resolved §5.1/§6.5 (layout-aware strings and feed from the registered layout); keep-or-drop legacy default is **OD7** |
| UX-8 | Med | N/A (Spoofing-adjacent) | K16 | `/player`/`/goal` collision risk rated Low without evidence | R7 raised to Medium (§11); **OD1** |
| UX-9 | Med | N/A | K17 | Header descriptions unclear; OD8 texts not written | Resolved §4.3 (texts written, `/dune` header specified); OD8 sequenced after legacy removal (R-D) |
| UX-10 | Med | N/A | K17 | "order" finds nothing | Resolved §4.4 ("order" in `/goal create` and `/goal` descriptions); `/goal order` is **OD5** |
| UX-11 | Med | N/A | K18 | Help layout after the split undefined | Resolved §7.5 (help layout by audience, "Moved recently" block) |
| UX-12 | Med | N/A | K3 | Accordion needs more than `prefix` | Resolved §6.5 (`formerly` field during the window), §7.7 ordering |
| UX-13 | Med | N/A | K19 | Calculator in `/dune data` is a player tool in a staff command | **OD6**, recommendation changed to `/goal calculate` (§14) |
| UX-14 | Med | Info. Disclosure (low) | K18 | `/dune` still a wall for players | Resolved §4.3 (`/dune` header says staff/server tools); moving `admin roles` is a follow-up (§16) |
| UX-15 | Low | N/A | K14 | `operations` vs `ops` | **OD9** |
| UX-16 | Low | N/A | K13 | "Moved." terse variant; pointer format | Resolved §7.4 (full sentences, ephemeral plain text); the 6610 "Moved." variant is dropped |
| UX-17 | Low | N/A | K11 | Steam-link flow and Core strings | Resolved: Core#1087 (Medium for the `verify` strings, which are wrong today); §7.4 link/verify copy |

### DBA

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| DBA-1 | Low | N/A | K8 | State that the split must not bump `SCHEMA_VERSION` (mentat#438) | Resolved §5.4 |
| DBA-2 | Low | N/A | K8 | Pending confirmations are in memory | Resolved §5.4 (`writeConfirmation.js:31`) |

### QA

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| QA-1 | Critical | Tampering, EoP | K5 | Golden oracle is the code under test; generator unspecified | Resolved §9.1 (R-E): script at `f8709f0` (autocomplete rows at `db3db83`, see correction 10), header records SHAs and script, own PR, CI forbids regeneration, hand-written 101-row audience table cross-checked |
| QA-2 | Critical | EoP | K5 | `LEGACY_MOVES` tested by construction | Resolved §9.2 (inline literal of 17 + 11 pairs; tier and Core action id pinned for the 11 moved writes) |
| QA-3 | High | EoP, Info. Disclosure | K5 | Caller/mode space incomplete | Resolved §9.3 (pinned axes including DM, unregistered guild, goal scope, cooldown-hit, `commandRoleIds`; row count asserted) |
| QA-4 | High | N/A | K5 | 101 paths not pinned | Resolved §9.2 (path inventory, bijection, option parity) |
| QA-5 | High | Info. Disclosure | K6 | Autocomplete routing untestable in `index.js` | Resolved §5.5 (exported `routeAutocomplete()`), §9.5. Sub-claim corrected: `getSubcommandGroup()` with the default `required=false` returns `null`, it does not throw (`discord.js` `CommandInteractionOptionResolver.js:123-127`). |
| QA-6 | High | N/A | K6 | Five mock copies cannot represent `/player`/`/goal` | Resolved §9.6 (shared `interactionFor()` factory from the registered tree) |
| QA-7 | High | EoP | K5 | Both-layout coverage asserted for golden only | Resolved §9.4 (tests per layout, flag parse, CI job per layout) |
| QA-8 | High | N/A | K2 | Deploy-hook test insufficient | Resolved §7.2, §9.8 (import-graph test that the hash inputs cover `commandDefinitions()`), prerequisite #440 |
| QA-9 | Med | N/A | K6 | Existing tests that will break | Resolved §5.10 (list carried into the plan; no assertion edit without a golden-row justification) |
| QA-10 | Med | Repudiation | K5 | Help tier derived, not behaviourally checked | Resolved §9.4 (help tier equals the behavioural write tier) |
| QA-11 | Med | DoS | K5 | Cooldown claims untested | Resolved §9.3/§9.5 (cooldown key recorded per row; `moved` shim consumes no cooldown) |
| QA-12 | Med | Repudiation, Spoofing | K5 | Moved-write confirmation round trip untested | Resolved §9.4 |
| QA-13 | Med | N/A | K7 | Live UAT not executable | Resolved §9.9 (scripted checklist, `verify-registered-commands.js`, named roles, preview-only writes, rollback rehearsal, evidence location) |
| QA-14 | Med | N/A | K1 | Pointer and edge shapes untested | Resolved §9.5 |
| QA-15 | Low | N/A | K6 | Tests calling `invocationFor` become tautologies | Resolved §9.6 (literal expectations per string family, grep guard) |
| QA-16 | Low | N/A | K5 | Matrix determinism | Resolved §9.3 (fresh state per row, sorted keys, run-twice test) |

### Consolidator (CONS)

| ID | Sev | STRIDE | Cluster | Summary | Disposition |
|---|---|---|---|---|---|
| CONS-1 | Med | DoS, Tampering | K2 | **New, verified:** `scripts/deploy-post-receive.sh:132` pipes `npm run register 2>&1 \| tail -5` inside `if ( … )` with only `set -u` (`:54`) and no `pipefail`, so the status is `tail`'s. A failed registration prints "Slash commands re-registered on deploy." and the WARNING branch (`:135-139`) is unreachable. Every hat assumed the WARNING fires. | Filed in **mentat#440**; §7.2 requires `pipefail` or an explicit status check |

## Cross-hat conflicts and corrections

1. **Reading Integrations overrides: bot token (SEC-2) vs user token (CLOUD-4, v1 §6.4).** Not
   resolvable from here without calling Discord. Discord's permissions-v2 documentation is
   understood to allow `GET …/guilds/{guild}/commands/permissions` with the bot token and to require
   a Bearer token only for edits, but this was **not verified**. v2 withdraws v1's flat "cannot be
   checked" claim, marks it UNVERIFIED and makes it precondition P3 (confirm on dune-dev).
2. **Pointer before the gates (v1 `[D7]`) vs alias-execute (ARCH-1/2, SEC-1).** Adjudicated for
   alias-execute (R-A). The pointer survives only on the option-less `moved` shims, whose name
   never collides with a real subcommand.
3. **Deploy-hook "WARNING" (v1 §7.1, SEC-3, CLOUD-1, NET-6).** All assumed the WARNING prints on
   failure. CONS-1 shows it never does. The hash and alerting fix (R-B) covers both.
4. **QA-5 sub-claim** (`getSubcommandGroup()` throws on `/goal`): corrected, see its row. The
   routing gap itself stands.
5. **SEC-10 sub-claim** (`isCommandAllowed("goal:progress")` absent): true on `f8709f0`, but #435
   merged to `main` at `db3db83` (`src/commands.js:1788`), so it is present on the implementation
   base.
6. **v1 §3.3 item 8** (`write cache` help tier mismatch in #436): already fixed at #436 head
   `6d2275b` (ARCH-10). v2 records it as resolved, not as a follow-up.
7. **UX-3 count question** (whether T1's "player 724" includes the 7 write shims): it did; the v1
   player group had 19 subcommands, 7 of them writes. Moot in v2 (no per-subcommand shims).
8. **Severity of the dispatch-model problem.** Security rated it Medium (SEC-1: an unintended
   self-action, no tier bypass); Architect rated it High (ARCH-2: availability outage). Both are
   right for different consequences; resolved at the High bar by R-A.
9. **Dormant `commandRoleIds` effect (GRC-7a labelled it Elevation of Privilege).** Re-traced:
   every override value is `mergeRoleIds(observer, admin, extra)`, so the overrides could only ever
   add roles. The real effect is fail-closed (intended grants dropped, and a restricted config with
   only per-command ids passes startup validation but denies everyone). Filed as #439 with
   STRIDE Denial of Service, not EoP.
10. **Ruling R-E's pinned SHA (`f8709f0`) vs code evidence.** PR #435 (`db3db83`) changed goal
    autocomplete scoping after `f8709f0` (the `isCommandAllowed(…, "goal:progress", …)` call at
    `src/commands.js:1788` exists only from `db3db83`). A before-record taken entirely at `f8709f0`
    would encode the pre-#435 autocomplete behaviour as correct and fail against `main`. v2 §9.1
    therefore keeps `f8709f0` for the dispatch rows, as ruled, and generates the autocomplete rows
    at `db3db83` (or PR-1's later merge base); the header records both SHAs.

## Layer 1 STRIDE report

| STRIDE category | Findings | Max severity | Resolution status |
|---|---|---|---|
| **Spoofing** | GRC-11 (as assigned), QA-12 | Medium | Resolved in design (§12 gate-order row; §9.4 requester-only button round trip) |
| **Tampering** | QA-1, GRC-2, SEC-1, ARCH-8, CLOUD-1, CLOUD-3, CLOUD-5, SEC-5, SEC-6, SEC-8, NET-2, CONS-1 | Critical (QA-1) | Resolved in design; CONS-1/CLOUD-1 also tracked in #440 |
| **Repudiation** | GRC-1, GRC-2, SEC-4, QA-10, QA-12, CLOUD-7 | High | Resolved in design (§13 evidence plan, §9.1 durable before-record) |
| **Information Disclosure** | SEC-2, SEC-7, CLOUD-2, ARCH-7, QA-3, QA-5, UX-14 | High (QA-3, QA-5) | Resolved in design; SEC-2's detection method is UNVERIFIED (precondition P3) |
| **Denial of Service** | ARCH-2, ARCH-5, SEC-3, CLOUD-1, CLOUD-8, NET-6, QA-11, GRC-10, CONS-1 | High | Resolved in design; prerequisite #440 |
| **Elevation of Privilege** | QA-1, QA-2, QA-3, QA-7, SEC-2, SEC-4, SEC-9, CLOUD-2, CLOUD-4, ARCH-11 | Critical (QA-1) | Resolved in design; SEC-2/CLOUD-4 become a release blocker for hosted guilds (§7.6) |

These findings map to no STRIDE category and are listed so their absence above is not mistaken for
an omission: ARCH-1, 3, 4, 6, 9, 10, 12, 13; SEC-10; GRC-3–9, 12–15 (GRC-7a re-mapped to #439);
NET-1, 3, 4, 5, 7; CLOUD-6; UX-1–13, 15–17 (UX-8 is Spoofing-adjacent); DBA-1, 2; QA-4, 6, 8, 9,
13–16.

Every STRIDE category has at least one finding in this layer. None is N/A.

## Next steps required by Requirement 20
- This register and its STRIDE table are posted as a comment on mentat#423, with a pointer on
  mentat#422.
- Operator decisions open: OD1, OD3, OD5, OD6, OD7, OD9 (v2 §14). OD2, OD4 and OD8 carry a
  recommendation that v2 now applies by default unless the operator overrides it.
- Operator-only preconditions P1–P3 (v2 §7.6) must be run and recorded on #423 before the flip PR
  (PR-6 in v2 §10) is opened. P3 decides how SEC-2/CLOUD-4 are closed.
- Prerequisites before implementation: #440 (registration hash and failure alerting), PR #436.
- Layer 2 per implementation PR and Layer 3 (`/code-review high`) per PR, posted to #423 (v2 §13).
