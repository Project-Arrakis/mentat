# Comprehensive Security Audit — Dune Discord Bot & Core Adapter

**Date:** 2026-07-04
**Auditor:** OpenCode agent
**Scope:**
- `yacketrj/dune-awakening-selfhost-discordbot` (Discord companion bot)
- `yacketrj/dune-awakening-selfhost-docker-WSL` / upstream core adapter code
- Current read-only state and future read/write state risks

## Executive Summary

The read-only Discord bot and the core Discord adapter both follow a security-first design: bearer-token authentication, capability-based RBAC, output redaction, audit logging, and a zero-permission addon. All local tests pass and container scans are clean for the bot image.

The most significant finding is a **hardcoded fallback command-auth token** in the upstream core (`console/api/src/rmq.js` and `runtime/scripts/admin-tools.sh`). This is a real secret embedded in source code and git history. Other findings are lower severity: Dockerfile hardening gaps in the core, scanner false positives from documentation examples, and Dependabot cooldown configuration.

All findings are tracked below with severity, owner, and recommended remediation.

## Methodology

1. **Dependency scanning:** `npm audit --audit-level=low`
2. **Static application security testing (SAST):** Semgrep with `auto` rules
3. **Secret scanning:** Gitleaks (`--no-git` and full git history)
4. **Container/config scanning:** Trivy filesystem and image scans
5. **Manual code review:** commands, adapter client, config, RBAC, Dockerfile, addon, core adapter modules
6. **Test execution:** `npm run check` (bot), `npm test` (core `console/api`)

## Discord Bot Current-State Findings

### Strengths

| Control | Evidence |
|---------|----------|
| Read-only command surface | `src/commands.js` only exposes about/ping/health/status/status-summary/readiness/services |
| Restricted-by-default RBAC | `src/config.js` defaults to `restricted` mode; no principals = fails closed |
| Bearer-token adapter auth | `src/adapterClient.js` sends `Authorization: Bearer ...` |
| Secret file support | `readSecret()` supports `*_FILE` env vars |
| Output redaction | `src/format.js` redacts credentials, emails, Steam/Funcom IDs, internal IPs, connection strings |
| Log redaction | `src/logger.js` applies `redactSecrets()` to all log entries and errors |
| Non-root container | `Dockerfile` uses `USER node` and removes npm/corepack/yarn from runtime |
| No shell/package manager in runtime image | `Dockerfile` removes `/usr/local/bin/npm`, etc. |
| HEALTHCHECK defined | `Dockerfile` includes `HEALTHCHECK` |
| Zero-permission addon | `addon/addon.json` has `"permissions": []`, static HTML only |
| Limited gateway intents | `src/index.js` uses only `GatewayIntentBits.Guilds` |
| Test-time redaction assertion | `scripts/operator-smoke.js` fails if adapter output would be redacted |
| Supply chain | Dependabot configured, GitHub Actions pinned |

### Scanner Results

| Tool | Findings | Status |
|------|----------|--------|
| `npm audit --audit-level=low` | 0 vulnerabilities | Clean |
| Semgrep | 2 medium (Dependabot missing cooldown) | See FINDING-BOT-1 |
| Gitleaks (working tree + git history) | 1 false positive in test fixture | See FINDING-BOT-2 |
| Trivy filesystem | 0 findings | Clean |
| Trivy image (`dune-discord-bot:audit`) | 0 findings | Clean |
| `npm run check` | 88/88 tests pass, release metadata OK | Clean |

### Detailed Findings

#### FINDING-BOT-1: Dependabot lacks cooldown periods (MEDIUM)

- **Location:** `.github/dependabot.yml`
- **Scanner:** Semgrep `package_managers.dependabot.dependabot-missing-cooldown`
- **Risk:** Newly published malicious or unstable packages could be auto-merged before the community identifies issues.
- **Recommendation:** Add `groups` and `open-pull-requests-limit`/`schedule` cadence; consider `update-types` restrictions and a manual review window for major versions.
- **Remediation branch:** `security/bot-dependabot-cooldown`

#### FINDING-BOT-2: Gitleaks false positive on RFC test fixture (LOW / FALSE POSITIVE)

- **Location:** `test/fixtures/write-adapter/requests/execute-maintenance-note.json`
- **Match:** `clientRequestId": "[REDACTED-TEST-ID]"`
- **Risk:** None — this is a deterministic test identifier, not a credential.
- **Recommendation:** Add `.gitleaksignore` entry or a `gitleaks.toml` allowlist for RFC fixtures so CI does not repeatedly flag it.
- **Remediation branch:** `security/bot-gitleaks-allowlist`

#### FINDING-BOT-3: Health state file written to world-readable `/tmp` path (LOW)

- **Location:** `src/healthState.js` (`DEFAULT_HEALTH_STATE_FILE = "/tmp/dune-discord-bot/health.json"`)
- **Risk:** In a shared container/host, another process could read bot health metadata (PID, ready state). No secrets are written.
- **Recommendation:**
  - Write health state to a directory owned by the `node` user with `0o700` permissions, e.g. `/run/dune-discord-bot` or `/app/.health`.
  - Use `fs.mkdirSync(path, { recursive: true, mode: 0o700 })` and `writeFileSync(path, ..., { mode: 0o600 })`.
- **Remediation branch:** `security/bot-health-state-permissions`

#### FINDING-BOT-4: No per-user/per-command rate limiting on Discord interactions (LOW)

- **Location:** `src/index.js` / `src/commands.js`
- **Risk:** A single Discord user or channel could flood the bot, causing adapter load or Discord API rate-limit side effects.
- **Recommendation:** Add an in-memory rate limiter keyed by `userId`+`commandName` or `channelId`; use ephemeral replies for rate-limit violations. This is especially important before any write commands are added.
- **Remediation branch:** `security/bot-discord-rate-limit`

#### FINDING-BOT-5: `about` command exposes version and RBAC mode (INFO)

- **Location:** `src/commands.js` `aboutPayload()`
- **Risk:** Fingerprinting aid for attackers; very low severity for a read-only bot.
- **Recommendation:** Keep version public (useful for support) but consider splitting a public `about` from an admin `diagnostic` command in future releases.
- **Remediation branch:** deferred to R1.x design

#### FINDING-BOT-6: Direct env var secret reading still supported (INFO)

- **Location:** `src/config.js` `readSecret()`
- **Risk:** `DISCORD_BOT_TOKEN` and `DUNE_DISCORD_ADAPTER_TOKEN` are accepted as direct env vars. This can lead to accidental logging in some orchestrators.
- **Recommendation:** Continue supporting `*_FILE` and document file-based secrets as the production standard. Consider deprecating direct env vars in a future release with a logged warning.
- **Remediation branch:** deferred

## Core Docker Adapter Current-State Findings

### Strengths

| Control | Evidence |
|---------|----------|
| Adapter disabled by default | `discordAdapterEnabled()` checks env/config flag |
| Writes disabled by default | `discordWritesEnabled()` always returns `false` |
| Bearer-token route auth | `routes.js` `requireDiscordBotToken()` |
| Capability-based RBAC | `policy.js` `DISCORD_CAPABILITIES` and `CAPABILITY_BY_TIER` |
| Audit events | `audit.js` emits redacted actor/action/capability/result records |
| Output sanitization | `sanitize.js` removes internal IPs, DB URLs, env paths, blocked keys |
| Adapter test coverage | `console/api/test/discordAdapter.test.js` validates auth, redaction, capability enforcement |

### Scanner Results

| Tool | Findings | Status |
|------|----------|--------|
| Trivy filesystem | 5 misconfigurations | See FINDING-CORE-2, -3, -4 |
| Semgrep | 12 results (Dockerfile root users, RegExp DoS, dynamic urllib) | See FINDING-CORE-2, -5, -6 |
| Gitleaks (working tree + git history) | 17 leaks | See FINDING-CORE-1 (real) + false positives |
| `npm test` (console/api) | 220/220 tests pass | Clean after adapter fix |

### Detailed Findings

#### FINDING-CORE-1: Hardcoded fallback command-auth token (HIGH)

- **Location:**
  - `console/api/src/rmq.js:7` — `const BUILTIN_COMMAND_AUTH_TOKEN = "[REDACTED-HARDCODED-TOKEN]";`
  - `runtime/scripts/admin-tools.sh:12` — `BUILTIN_COMMAND_AUTH_TOKEN="[REDACTED-HARDCODED-TOKEN]"`
  - Also present in upstream `admin-server/src/rmq.js` and git history
- **Risk:** Any party with source access knows the fallback token. If `DUNE_COMMAND_AUTH_TOKEN` is not explicitly set at runtime, the console falls back to a publicly known secret, bypassing the intended command authentication boundary.
- **Recommendation:**
  1. Remove the fallback constant entirely.
  2. Make `DUNE_COMMAND_AUTH_TOKEN` / `DUNE_COMMAND_AUTH_TOKEN_FILE` required at startup.
  3. If backward compatibility is mandatory, generate a unique token at first boot and persist it in the generated/secrets volume (not in git or image layer).
  4. Rotate any deployed instances that may have relied on the hardcoded value.
  5. Add `.gitleaksignore` is **not** appropriate here because this is a real secret in history; instead, treat it as a known-compromised credential and rotate.
- **Remediation branch:** `security/core-remove-hardcoded-command-token`
- **Upstream issue:** Open issue against `Red-Blink/dune-awakening-selfhost-docker` referencing this finding.

#### FINDING-CORE-2: Core Dockerfiles run as root (HIGH)

- **Location:** `console/api/Dockerfile`, `orchestrator/Dockerfile`
- **Scanner:** Trivy `DS002`, Semgrep `dockerfile.security.missing-user`
- **Risk:** Container escape or runtime compromise grants host root privileges.
- **Recommendation:** Add non-root `USER` directives, create app user with minimal UID, and ensure file ownership is correct. This is an upstream hardening change; coordinate with upstream maintainers.
- **Remediation branch:** `security/core-docker-non-root`

#### FINDING-CORE-3: No HEALTHCHECK in core Dockerfiles (LOW)

- **Location:** `console/api/Dockerfile`, `orchestrator/Dockerfile`
- **Scanner:** Trivy `DS026`
- **Recommendation:** Add `HEALTHCHECK` instructions or document that orchestrator-level health checks are used.
- **Remediation branch:** `security/core-docker-healthcheck`

#### FINDING-CORE-4: apt-get install missing `--no-install-recommends` (HIGH)

- **Location:** One of the Dockerfiles
- **Scanner:** Trivy `DS029`
- **Risk:** Larger attack surface from unnecessary packages in image.
- **Recommendation:** Add `--no-install-recommends` and clean apt cache in the same layer.
- **Remediation branch:** `security/core-docker-apt-hardening`

#### FINDING-CORE-5: Potential RegExp DoS in console/web (MEDIUM)

- **Location:** `console/web/src/features/server/ServerPanels.tsx` (6 instances)
- **Scanner:** Semgrep `javascript.lang.security.audit.detect-non-literal-regexp`
- **Risk:** User-controlled strings passed to `RegExp()` could cause ReDoS.
- **Recommendation:** Validate/sanitize inputs before constructing regexps; use anchored patterns with timeouts where possible.
- **Remediation branch:** `security/core-web-redos-guard`

#### FINDING-CORE-6: Dynamic urllib use in orchestrator (MEDIUM)

- **Location:** `orchestrator/dune_orchestrator.py:50,57`
- **Scanner:** Semgrep `python.lang.security.audit.dynamic-urllib-use-detected`
- **Risk:** `file://` scheme or unexpected URL handling could lead to local file disclosure.
- **Recommendation:** Validate URL scheme is `http`/`https`; reject `file://`; use allow-listed hostnames if possible.
- **Remediation branch:** `security/core-orchestrator-url-validation`

#### FINDING-CORE-7: Gitleaks false positives in adapter README examples (LOW / FALSE POSITIVE)

- **Location:** `docs/discord-control-bot/README.md`
- **Match:** `DISCORD_CLIENT_ID="[REDACTED-FAKE-ID]"`, `DISCORD_GUILD_ID`, `DISCORD_*_ROLE_IDS`
- **Risk:** None — these are example IDs.
- **Recommendation:** Add `.gitleaksignore` entries or wrap examples in code blocks with a comment noting they are examples.
- **Remediation branch:** `security/core-gitleaks-allowlist`

## Future-State Risk Assessment (R2+ Write-Capable Bot)

When the roadmap advances to write-capable commands, these risks must be gated before any PR opens:

| Risk | Control Required |
|------|------------------|
| Unauthorized writes | Write-specific RBAC not inherited by observer; capability discovery before command render |
| Confirmation bypass | Server-side confirmation primitive; action/target/risk displayed; cannot be skipped |
| Replay / duplicate side effects | Idempotency keys enforced on adapter and bot; adapter rejects duplicate keys |
| Audit gaps | Every write produces structured audit event with actor, capability, target, result |
| Secret leakage in previews | Redaction tests for previews, failures, and audit output |
| Abuse / spam | Per-user/per-command rate limits and cooldowns |
| Privilege escalation | No observer role can execute writes; owner approval for R3/R4 |
| Upstream contract mismatch | Upstream write-adapter contract approved and version-pinned |
| Confirmation UI spoofing | Ephemeral responses for write results; no editable confirmation messages |
| Recovery | Rollback/disable path documented and tested |

## Recommended Remediation Order

### Immediate (before any upstream PR reopens)

1. **FINDING-CORE-1:** Remove/replace hardcoded command-auth token.
2. **FINDING-BOT-1:** Add Dependabot cooldown configuration.
3. **FINDING-BOT-2 / CORE-7:** Add `.gitleaksignore` for false positives.
4. **FINDING-BOT-3:** Restrict health-state file permissions.

### Short term (before R2.0.0 planning closes)

5. **FINDING-BOT-4:** Add Discord interaction rate limiting.
6. **FINDING-CORE-2 / -4:** Harden core Dockerfiles (non-root, apt flags).
7. **FINDING-CORE-3:** Add HEALTHCHECK to core Dockerfiles.

### Medium term (coordinated with upstream)

8. **FINDING-CORE-5:** RegExp DoS guards in console/web.
9. **FINDING-CORE-6:** Orchestrator URL validation.
10. **Future-state:** Implement write-safety foundation controls per roadmap gates.

## Evidence Artifacts

Scanner outputs are stored in `.security-audit/` (gitignored) on each repo branch used for the audit:

- Discord bot `main`: `.security-audit/npm-audit.json`, `semgrep.json`, `gitleaks.json`, `trivy-fs.json`, `trivy-image.json`, `gitleaks-git.json`
- Core `release/discord-adapter-readonly`: `.security-audit/trivy-fs.json`, `semgrep.json`, `gitleaks.json`, `gitleaks-git.json`

## Remediation Status

| Finding | Status | Branch | Verification |
|---------|--------|--------|--------------|
| FINDING-BOT-1 Dependabot cooldown | Implemented | `security/bot-dependabot-cooldown` | Semgrep 0 findings; `npm run check` passes |
| FINDING-BOT-2 Gitleaks false positive | Implemented | `security/bot-gitleaks-allowlist` | Gitleaks 0 findings; `npm run check` passes |
| FINDING-BOT-3 Health-state permissions | Implemented | `security/bot-health-state-permissions` | `npm run check` passes |
| FINDING-CORE-1 Hardcoded command-auth token | Implemented | `security/core-remove-hardcoded-command-token` | Gitleaks 0 findings; `npm test` 220/220 pass |
| FINDING-CORE-7 Gitleaks false positives | Implemented | `security/core-gitleaks-allowlist` | Gitleaks 0 findings |

## Next Local Steps

1. Review the four bot security branches and merge into `main`.
2. Review the core token-removal branch and merge into `release/discord-adapter-readonly`.
3. Re-run the full scanner suite on `main` and `release/discord-adapter-readonly` after merges.
4. Begin short-term hardening: Discord interaction rate limiting and core Dockerfile non-root/HEALTHCHECK/apt fixes.
5. Update staged PR bodies in `releases/` to mention completed security hardening.
6. Open upstream tracking issue for the hardcoded command-auth token once the local branch is merged.
