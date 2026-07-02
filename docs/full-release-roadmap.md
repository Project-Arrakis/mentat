# Full Release Roadmap

## Purpose

This roadmap extends the read-only `R1.0.0` production plan into the later
release trains needed for a full-featured Discord bot. It does not change the
current product boundary: `R1.0.0` is the production-ready read-only bot,
published as `v1.0.0`.

The full-featured bot is a later major-release objective. It must be reached
incrementally, with every write-capable step gated by upstream adapter support,
explicit authorization, confirmation, idempotency, audit evidence, privacy
review, and release candidates.

## Release Train Model

| Train | Scope | Stability target |
| --- | --- | --- |
| `R0.x` | Pre-production hardening for the read-only bot. | Evidence-building releases before `R1.0.0`. |
| `R1.0.0` | Read-only production GA. | Stable, supportable, security-gated read-only bot. |
| `R1.x` | Read-only maturity. | Backward-compatible read-only features and operational polish. |
| `R2.0.0` | Write-safety foundation and first low-risk write candidate. | Write paths disabled by default; no high-risk operations. |
| `R2.x` | Low-risk administrative writes. | Metadata and notification writes with explicit confirmation and audit. |
| `R3.0.0` | Operational write train. | Service and backup operations behind stronger gates. |
| `R3.x` | Operational write maturity. | Cooldowns, rollback drills, and operator validation. |
| `R4.0.0` or later | Player, game-state, restore, or database-adjacent operations. | Highest-scrutiny releases only after prior trains are proven. |

Do not reserve a final version number for "all features complete" until the
earlier trains have passed their gates. Feature completeness must never outrank
security, privacy, or upstream contract clarity.

## Universal Gates

Every substantive PR, release candidate, and stable release must satisfy these
controls:

- current branch based on refreshed `main`
- upstream reference clone refreshed when behavior depends on upstream
- PR body uses the transparency sections
- durable `docs/changes/PR-####` note
- unit tests for code or policy changes
- documentation updated with source-bound evidence
- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub CI
- GitHub Security Gates: dependency audit, dependency review when applicable,
  secret scan, Semgrep, Trivy filesystem, Docker build, and Trivy image
- no unresolved medium, high, or critical security findings
- GitHub issue created for every finding not fixed in the discovering PR
- PII and secrets redacted from PRs, issues, logs, screenshots, release notes,
  and artifacts

Release candidates and stable releases additionally require:

- release-preparation PR
- matching `CHANGELOG.md` entry
- matching `docs/releases/vMAJOR.MINOR.PATCH*.md`
- version alignment across `package.json`, `package-lock.json`, and
  `addon/addon.json`
- annotated tag from clean `main`
- GitHub Release asset publication
- addon package and SBOM checksum verification
- rollback or revocation path documented

## R0.x: Read-Only Production Preparation

Goal: finish the evidence needed to call the read-only bot production-ready.

Required outcomes:

- operator documentation freeze
- runtime smoke-test checklist
- upstream compatibility checklist
- supply-chain release hardening
- comprehensive read-only security review
- controlled operator validation
- production evidence closure
- `v1.0.0-rc.1` prerelease
- `v1.0.0` stable promotion

Release gates:

- all read-only commands covered by unit tests
- all read-only command smoke tests documented
- no stale upstream compatibility evidence
- release artifacts and SBOM reproducible from committed metadata
- no open medium, high, or critical security finding

## R1.0.0: Read-Only Production GA

Goal: ship a stable, supportable read-only Discord bot.

Included:

- `/dune about`
- `/dune ping`
- `/dune health`
- `/dune status`
- `/dune status-summary`
- `/dune readiness`
- `/dune services`
- restricted-by-default RBAC
- adapter bearer-token boundary
- zero-permission addon artifact
- SBOM and checksums
- source-bound upstream compatibility evidence

Excluded:

- write-capable commands
- service restarts
- player moderation
- database mutations
- backup or restore execution
- direct Docker socket, database, file, shell, or console-internal access

Promotion gates:

- final `v1.0.0-rc.N` passed candidate gates
- production docs current
- owner approval recorded in the release-preparation PR
- no unresolved medium, high, or critical security finding

## R1.x: Read-Only Maturity

Goal: improve operator value without changing server state.

Candidate features:

- richer service detail if upstream exposes safe read-only data
- grouped readiness detail
- aggregate player summary only if upstream exposes safe aggregate data
- read-only maintenance window metadata
- scheduled status posts to allow-listed channels
- readiness or service alert subscriptions
- incident digest summaries

Release gates:

- every feature remains read-only by contract and test
- scheduled or recurring output has channel allow-lists and rate limits
- player-related output is aggregate-only unless a privacy review explicitly
  approves a narrower safe shape
- Discord output remains bounded and redacted
- route compatibility tests cover new adapter assumptions

## R2.0.0: Write-Safety Foundation

Goal: introduce write readiness without normalizing risky writes.

Required upstream condition:

- upstream publishes and approves a write-capable adapter contract.

Required foundation:

- write routes disabled by default
- write-specific feature flag
- write-specific RBAC that observer roles do not inherit
- capability discovery before command rendering
- confirmation primitives
- idempotency key generation
- audit event schema
- write adapter timeout and retry rules
- redaction tests for previews, failures, and audit output
- STRIDE and abuse-case review

R2.0.0 should be a release candidate before stable promotion. It may ship with
no executable write command if the foundation is useful by itself.

Release gates:

- upstream write contract evidence recorded
- every write path defaults disabled
- no observer role can execute writes
- confirmation cannot be bypassed
- idempotency is tested
- audit output is structured and redacted
- release notes clearly state disabled-by-default behavior

## R2.x: Low-Risk Administrative Writes

Goal: support low-impact metadata or notification writes first.

Candidate command families:

- maintenance note set
- maintenance window set
- Discord notification configuration set
- bot-owned scheduled post configuration

Required controls:

- one command family per PR
- matching GitHub issue before implementation
- dry-run or preview when upstream supports it
- explicit confirmation with action, target, and risk
- idempotency key on execute
- audit correlation ID
- ephemeral Discord responses by default
- rollback or disable instructions

Go/no-go gates:

- command cannot restart services, mutate game data, or affect player state
- adapter route cannot perform broader side effects than the command label
- no sensitive data appears in preview, failure, audit, or Discord output
- failed or retried writes cannot duplicate side effects

## R3.0.0: Operational Writes

Goal: support higher-impact operator actions with stronger guardrails.

Candidate command families:

- backup creation
- service restart
- update trigger
- cache clear or safe maintenance operation

Required controls:

- write-admin or owner role only
- explicit per-command allow-list support
- maintenance-window awareness where applicable
- cooldowns and concurrency limits
- dry-run or impact preview when possible
- stronger confirmation wording
- rollback or recovery runbook
- audit evidence before and after side effects
- operator smoke test before stable promotion

Release gates:

- release candidate required
- no stable promotion without documented operator validation
- failure modes tested for timeout, denied authorization, adapter error,
  duplicate retry, and redaction
- backup-related work includes storage, quota, and retention review
- restart or update work includes availability impact notes

## R4.0.0 Or Later: Highest-Risk Operations

Goal: evaluate player, game-state, restore, or database-adjacent operations only
after lower-risk trains are proven.

Candidate areas:

- player moderation
- player messaging
- gameplay-affecting configuration changes
- restore execution
- database-backed operations

Default stance:

- do not implement unless upstream exposes a narrow, audited, purpose-built
  adapter action
- do not expose raw database execution through Discord
- do not start with player or restore operations

Required controls:

- owner-level authorization or equivalent
- out-of-band approval where practical
- enhanced privacy review
- abuse-case review
- audit retention expectation
- rollback or recovery proof
- incident response notes
- operator training or runbook update

Go/no-go gates:

- any uncertain privacy, abuse, restore, or data-integrity risk blocks merge
- any ambiguous upstream side effect blocks merge
- any unresolved medium, high, or critical finding blocks merge
- no stable release without at least one release candidate and owner approval

## Full-Featured Definition

The bot can be called full-featured only when every shipped feature family has:

- upstream adapter support
- documented command behavior
- RBAC matrix
- STRIDE review
- privacy review
- unit tests
- smoke-test instructions
- release notes
- rollback or disable path
- security gate evidence
- no unresolved medium, high, or critical findings

Full-featured does not mean unlimited control. It means all approved read-only
and write-capable capabilities are safely implemented within the adapter
boundary.

## Finding Handling

Security findings discovered during roadmap work must be handled before merge:

- fix in the same PR, or
- create a GitHub issue with severity, affected component, evidence, owner, and
  planned resolution, or
- document a false-positive rationale with scanner evidence.

Private findings must not expose secrets, exploit details, private deployment
details, user-identifying data, SteamIDs, FuncomIDs, emails, real names, keys,
tokens, passwords, or private server addresses in public notes.

## Sources

- Production release plan: `docs/production-release-plan.md`
- Non-read-only roadmap: `docs/non-readonly-roadmap.md`
- Upstream write adapter RFC: `docs/upstream-write-adapter-rfc.md`
- Release process: `docs/release-process.md`
- Semantic Versioning: https://semver.org/
- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- GitHub Releases documentation:
  https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- NIST Secure Software Development Framework SP 800-218:
  https://csrc.nist.gov/pubs/sp/800/218/final
- SLSA build provenance:
  https://slsa.dev/spec/draft/build-provenance
- OWASP Software Component Verification Standard:
  https://owasp.org/www-project-software-component-verification-standard/
