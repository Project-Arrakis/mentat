# ACP Issue Bridge — STRIDE Threat Model

Format per spec section 69 and this account's Requirement 20: Threat /
Likelihood / Impact / Existing Control / Required Mitigation / Residual
Risk. This is the Layer 1 (design) STRIDE pass; Layer 2/3 findings (if
any emerge from an independent implementation/integration audit) should
be appended here, not replace this table.

## Spoofing

| Threat | Likelihood | Impact | Existing Control | Required Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Public user forges a `<!-- ACP-ISSUE-BRIDGE origin: bridge -->` comment to be treated as bridge-authored (SEC-011) | Medium (trivial to attempt) | Low — worst case, a forged block is parsed as *data*, never as authorization | `loopProtection.isBridgeActor()` checks actor identity, not text (metadata.mjs's parser is explicitly documented as untrusted) | None required — already mitigated by design | Low |
| Public user impersonates a maintainer's command by commenting on the **public** issue | Low | Low | Commands are only ever recognized in `issue_comment.created` on the **private** repo (`private-comment-created.mjs`); public comments are only ever mirrored, never parsed for commands | None required | Low |
| Compromised low-privilege private collaborator account attempts `/public` | Low-Medium | Medium | `auth.mjs` permission matrix (SEC-007) | Standard GitHub account security (2FA) — outside this bridge's control | Medium (depends on org-wide account security posture) |

## Tampering

| Threat | Likelihood | Impact | Existing Control | Required Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Sync ID / correlation metadata edited or stripped from a private issue body after creation | Low | Medium (could break correlation for future events) | Second correlation mechanism (bridge sync comment) survives body edits; ambiguous/none results fail closed rather than mis-correlating | Consider periodic reconciliation audit (see Follow-Up Recommendations) | Low-Medium |
| `acp-issue-bridge.yml` edited to weaken policy (e.g. lower a permission requirement, add a forbidden label to the mapping) | Low (requires write access to the repo itself) | High if it succeeds | `config.mjs` schema validation rejects invalid permission levels, `status:*` in `label_mapping`, and any shrinking of the forbidden-label floor; branch-protection/PR review on `main` (existing repo convention, Requirement 21) | None beyond existing PR review requirement | Low |
| The two repos' config files drift apart (e.g. one updated, the other forgotten) | Medium (manual process without the checksum check) | Medium (inconsistent policy enforcement between directions) | `issue-bridge-maintenance.yml`'s checksum-exchange drift check (`configChecksum.mjs`) | Ensure the maintenance workflow's schedule/dispatch is actually run after every config change (documented in `administration.md`) | Low, once the maintenance workflow is confirmed running |
| Label-based state (`sync:*`, `visibility:security-sensitive`) manually edited by a private collaborator outside the command flow | Medium (labels are directly editable by anyone with write+) | Medium — could bypass `/security`'s pause or fake a cleared security state | None currently — the bridge trusts current label state as read from the webhook payload / API at the moment of each command | **Not implemented**: no drift/consistency check between "label state" and "command history" | Medium — see Known Limitations |

## Repudiation

| Threat | Likelihood | Impact | Existing Control | Required Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| No record of who authorized a publication | Low | High (undermines the entire audit trail) | `audit.emitAuditEvent()` on every decision point, `actor` field populated from the GitHub comment author on every authorization-gated branch | None required | Low |
| Audit events themselves are only in ephemeral Actions logs (retention-limited) | Medium | Medium (long-term forensic capability) | GitHub Actions log retention (repo-configurable); structured JSON-per-line format is grep/parse-friendly for export | Consider exporting audit events to a persistent sink if long-term retention is required (Follow-Up Recommendation) | Medium |
| A maintainer disputes having run a command | Low | Low-Medium | GitHub's own audit log + the comment itself (immutable edit history) independently corroborate `event.comment.user.login` | None required | Low |

## Information Disclosure (primary threat class for this system)

| Threat | Likelihood | Impact | Existing Control | Required Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Plain private comment (no command) accidentally published | Medium (most common failure mode: forgetting to type `/public`) | High | Default is `null` command → `noop`, no comment created at all (SEC-001, tested) | None required — this is the core invariant | Low |
| Secret pasted into a `/public` comment | Medium | Critical | `secretScan.scanForSensitiveContent()` blocks publication (SEC-004), never echoes the match, audits `SECRET_DETECTED` | None required for the 11 mandatory categories; configurable categories should be periodically reviewed for new patterns (Follow-Up Recommendation) | Medium (regex-based scanning cannot catch every secret shape — see Known Limitations) |
| Private repository URL/attachment leaked via `/public` | Medium | High | `privateRepoSlugs` check in the same scanner (SEC-016) | None required | Low |
| Security-sensitive issue published via `/public-status`/`/public-resolution` before proper clearance | Low (requires an authorized maintain+/admin actor to attempt it) | Critical | `canPublishOutbound()` checked before every publication path, independent of which specific command (SEC-006) | None required | Low |
| `/security-clear` immediately followed by unintended re-publication | Low | Critical if it happened | Two-step recovery: `/security-clear` never touches `sync:paused`; a separate `/sync-resume` is required (SEC-010) | None required | Low |
| GitHub App token leaked via workflow logs | Low | Critical | Token is never logged (`ghApi.mjs` redacts Authorization headers in any thrown error; GitHub Actions itself masks registered secret values); token is minted just-in-time and revoked post-job by `create-github-app-token` | None required | Low |
| Regex-based secret scanner misses a genuinely novel secret format | Medium | High | Aggressive/over-matching bias (see security-model.md) | Expand `MANDATORY_PATTERNS`/`CONFIGURABLE_PATTERNS` as new secret formats are identified; this is an inherent limitation of pattern-based scanning, not a gap specific to this implementation | **Medium — accepted residual risk**, mitigated by defaulting to blocking anything remotely secret-shaped |

## Denial of Service

| Threat | Likelihood | Impact | Existing Control | Required Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Public issue/comment spam floods the private repo with mirrors | Medium (public repos attract spam) | Medium (noise, not a security breach) | None implemented beyond GitHub's own abuse-detection rate limiting | Consider a rate-limit/allowlist check before mirroring (Follow-Up Recommendation — **not implemented**) | Medium |
| Oversized issue/comment body | Medium | Low | `sanitizeInboundContent()` caps body size (`security.max_body_bytes`/`max_comment_bytes` from config) with a visible truncation notice | None required | Low |
| GitHub API rate limiting during a burst of events | Medium | Medium (delayed sync, not data loss) | Bounded retry with exponential backoff, honors `Retry-After` (`ghApi.mjs`, section 62) | None required | Low |
| Webhook redelivery storm | Low | Low | Idempotent search-before-write on every mutation path | None required | Low |

## Elevation of Privilege

| Threat | Likelihood | Impact | Existing Control | Required Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Over-scoped GitHub App used to escalate beyond issue read/write | Low | Critical | App requests only `Metadata: Read` + `Issues: Read/Write`; explicit `permission-issues`/`permission-metadata` narrowing on every token-mint step (belt-and-suspenders on top of the App's own grant) | None required | Low |
| `write`-level actor bypasses the `maintain` gate for `/public` | Low | High | `auth.mjs` full permission matrix, tested against every command/role combination (SEC-007, SEC-009) | None required | Low |
| Workflow YAML injection via untrusted event data (e.g. issue title used unsafely in a `run:` shell interpolation) | Low (this implementation never interpolates event data directly into `run:` shell commands — it reads `GITHUB_EVENT_PATH` as JSON inside Node) | Critical if it existed | All event data is consumed via `JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))` in Node, never via `${{ github.event.issue.title }}`-style direct workflow-YAML interpolation into a shell command | None required — verify this remains true for any future workflow edits (this is exactly the class of bug GitHub's own security guidance for Actions warns about) | Low |
| Compromised third-party Action (`actions/checkout`, `actions/setup-node`, `actions/create-github-app-token`, `gitleaks-action`) | Low | Critical if it happened | All pinned to immutable commit SHAs (section 85), not floating tags; SHAs verified against the real upstream repository's tag refs at implementation time | Periodically re-verify pinned SHAs still correspond to their claimed version tags when bumping (Follow-Up Recommendation) | Low |

## Summary of accepted / open residual risks

1. **Label-state tampering outside the command flow** (Tampering) — no
   drift check between label state and command history. Not implemented
   this session; recommended follow-up.
2. **Regex-based secret scanning cannot catch every secret shape**
   (Information Disclosure) — inherent to pattern-based detection,
   mitigated by an aggressive over-matching bias, not eliminable.
3. **Spam/rate-limiting on public issue mirroring** (Denial of Service) —
   not implemented this session; recommended follow-up.
4. **GitHub App collaborator-permission-endpoint scope** — unverified
   against a real App installation (see `github-app.md`'s verification
   checklist); flagged, not silently assumed safe.
