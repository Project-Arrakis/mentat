# Crafting Calculator — Security Review

**Date:** 2026-07-23
**Reviewer:** OpenCode agent (pre-implementation design review)
**Scope:** `/dune data calculator` — new `data:*` subcommand, `craftingData.js`,
`craftingCalculator.js`, `commands.js` autocomplete wiring, `embedFormat.js`
formatter. No changes to Core (`dune-awakening-selfhost-docker`) or
`acp-landing`.

## Executive Summary

This feature makes **zero external calls** — no Core adapter request, no
database query, no file I/O beyond the static recipe module bundled at build
time. The entire computation is pure integer arithmetic over a hardcoded
lookup table. This is the lowest-risk feature category this bot has shipped
to date, at or below `core:about`. No HIGH or MEDIUM findings were
identified. Two LOW findings and one INFO-level data-governance concern are
tracked below, all addressable in the initial implementation with no
follow-up remediation branch required.

## Methodology

This is a pre-implementation design-level review (the feature does not yet
exist in code), so no scanner run (Semgrep/Gitleaks/Trivy/npm audit) applies
yet. Findings below are derived from:

1. Manual threat-modeling of the proposed command surface (STRIDE, per
   [Security Gates](security-gates.md) usage policy).
2. Direct calculation of worst-case numeric bounds against `Number`'s safe
   integer range.
3. Review of existing bot conventions this feature must inherit
   (`cooldown.js`, `formatError()`, `embedFormat.js` truncation patterns).
4. Review of the third-party data source's own stated affiliation and
   accuracy posture.

The implementation must re-run the standard scanner suite
(`npm run check`, Semgrep, Gitleaks, Trivy, `npm audit`) per
[Security Gates](security-gates.md) before merge, same as any other PR.

## STRIDE Summary

| STRIDE Category | Applicability | Notes |
|---|---|---|
| Spoofing | Not applicable | No identity claims made or consumed by this feature beyond the existing Discord interaction context every command already receives. |
| Tampering | Not applicable | No request payload beyond Discord's own option validation; no data written anywhere. |
| Repudiation | Not applicable | Read-only, stateless; no audit trail required (matches other `data:*` read commands, none of which produce audit events). |
| Information disclosure | Not applicable | No PII, no secrets, no adapter/game data touched. Output is entirely derived from bundled static reference data. |
| Denial of service | **Applicable — see FINDING-CALC-1** | Unbounded `quantity` could produce oversized embed output. |
| Elevation of privilege | Not applicable | No new permission tier; reuses the existing generic per-user cooldown tier used by other `data:*` read commands. |

## Detailed Findings

### FINDING-CALC-1: Unbounded `quantity` could overflow Discord embed limits (LOW)

- **Location:** proposed `craftingCalculator.js::calculateCraftingPlan()`,
  proposed `commands.js` `quantity` option definition.
- **Risk:** At Tier 6, a naive unbounded multiply (e.g. `quantity: 2^31`)
  produces a Water requirement in the trillions, formatting into a string
  long enough to exceed Discord's 1024-character embed field-value limit or
  6000-character total-embed limit. This either silently truncates output
  (confusing to the user) or throws an unhandled-looking error at the
  Discord API call site.
- **Recommendation (required before merge, not deferred):**
  1. Hard `setMinValue(1)` / `setMaxValue(10000)` on the Discord slash
     command option itself — enforced client-side before the interaction
     reaches the bot.
  2. **Independently re-validate the same bound server-side** in
     `calculateCraftingPlan()`. Client-side option constraints are a UX
     nicety, not a security boundary — a modified client, a replayed
     interaction payload, or a future Discord API change could theoretically
     deliver an out-of-range value. Defense in depth costs three lines of
     code; there is no reason to skip it.
  3. Apply the existing embed field-value truncation convention
     (`embedFormat.js`'s `.slice(0, 1024)` / `.slice(0, 2000)` pattern) to
     every rendered line defensively, even though bound #1/#2 make this very
     unlikely to trigger in practice.
- **Verification:** All arithmetic runs in JS `Number` (safe integer range
  up to 2^53). Worst case at the cap —
  `10000 × 1250 (max per-craft water input) × depth-2 recursion` — is
  approximately `1.25×10^7`, many orders of magnitude below
  `Number.MAX_SAFE_INTEGER` (~9×10^15). No overflow risk once the 10,000 cap
  is enforced at both layers.
- **Remediation branch:** implemented directly in the feature branch, not a
  deferred follow-up (this is a same-PR requirement, not a tracked gap).

### FINDING-CALC-2: No injection surface, confirmed by design (INFORMATIONAL)

- **Location:** proposed `commands.js` `item` option.
- **Risk:** None identified. The only user input is a Discord-constrained
  `item` string, resolved against a fixed internal map, never interpolated
  into a query, shell command, or template, plus a range-clamped integer
  `quantity`. There is no SQL, shell, HTML template, or `eval`-adjacent code
  path anywhere in this feature.
- **Recommendation:** No action required. Recorded for audit-trail
  completeness — confirming the absence of a risk is itself evidence for a
  future reviewer, not an oversight to revisit.

### FINDING-CALC-3: Recipe data is transcribed from an unaffiliated third-party source (LOW)

- **Location:** proposed `craftingData.js`.
- **Risk:** Recipe values are manually transcribed from
  [dune.gaming.tools](https://dune.gaming.tools/crafting-calculator), which
  explicitly states on every page footer that it is not affiliated with
  Funcom or Legendary. This is a "trust but verify, and re-verify on drift"
  data source, not an authoritative one. Dune Awakening is a live-service
  game with regular balance patches; these ratios **will** drift over time.
- **Recommendation:**
  1. Every recipe entry must carry a structural `source: { url, verifiedAt }`
     field (not a comment, which is easy to omit or forget to update) citing
     the exact page and verification date, so a future maintainer can re-diff
     against the live site when the game patches.
  2. Add an internal-consistency check (`craftingData.test.js`, or a
     dedicated `scripts/check-recipe-data.js` following the existing
     `scripts/check-*.js` convention) that does **not** re-scrape the live
     site on every CI run (flaky, slow, and inconsiderate of a third party's
     servers) but does assert internal consistency: every input resolves to
     a known base resource or another known recipe (no dangling references),
     no zero/negative quantities, and no recursion beyond the documented
     depth-1 bound (see [Architecture](calculator-architecture.md)).
  3. See [GRC Review](calculator-grc.md) for the audit-trail and attribution
     requirements this finding feeds into.
- **Remediation branch:** implemented directly in the feature branch.

### FINDING-CALC-4: Cooldown reuse, not a new policy (INFORMATIONAL)

- **Location:** proposed `commands.js` dispatch for `data:calculator`.
- **Risk:** None. The calculator subcommand should use the **same default
  cooldown tier as other `data:*` read-only commands** via the existing
  `cooldown.js` (`checkCooldown`/`applyCooldown`), not a bespoke or stricter
  limit. There is no reason to rate-limit pure local arithmetic more
  strictly than `data:population`, which actually hits the network.
- **Recommendation:** Confirm at implementation time that no new cooldown
  namespace is introduced for this command. A bespoke per-command cooldown
  would be an unjustified deviation from this repo's one-shared-mechanism
  convention and should be flagged in code review if seen.

## Recommended Remediation Order

### Required before merge (same PR, not deferred)

1. **FINDING-CALC-1:** Client-side + server-side `quantity` bound
   enforcement (1–10,000), with embed truncation as defense-in-depth.
2. **FINDING-CALC-3:** Structural `source` field on every recipe entry, plus
   an internal-consistency test asserting no dangling references, no
   invalid quantities, and no unexpected recursion depth.

### Confirm at implementation time (no code change expected, verify only)

3. **FINDING-CALC-4:** Confirm the calculator reuses the existing shared
   cooldown mechanism rather than introducing a new one.

### No action required

4. **FINDING-CALC-2:** Recorded for completeness; no injection surface
   exists by design.

## Evidence Artifacts

None yet — this is a pre-implementation design review. Once implemented,
standard scanner output (Semgrep, Gitleaks, Trivy, `npm audit`) and
`npm run check` results should be attached to the implementation PR per
[Security Gates](security-gates.md), and this document's Remediation Order
section updated with a Status column (see the
[2026-07-04 comprehensive audit](security-audit/2026-07-04-comprehensive-security-audit.md)
for the expected format) once verified.

## Sources

- [Design](calculator-design.md)
- [Architecture](calculator-architecture.md)
- [GRC Review](calculator-grc.md)
- [Security Gates](security-gates.md) — STRIDE usage policy and CI gate definitions
- [2026-07-04 Comprehensive Security Audit](security-audit/2026-07-04-comprehensive-security-audit.md) — format precedent
</content>
