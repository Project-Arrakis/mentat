# Vendor / Third-Party Risk Register

**Version**: 1.0
**Date**: 2026-09-10
**Review Cycle**: Annually, or whenever a new vendor dependency becomes security- (not just availability-) critical

---

## Why this document exists

Found missing during a 2026-09-10 comprehensive security/GRC/legal audit (`mentat#337`): this org has had supply-chain (software dependency) risk tracking for a while (Dependabot, `npm audit`, gitleaks/semgrep/trivy), but no equivalent register for the infrastructure/API *vendors* this project depends on. The hosted-bot auto-invite design (`dune-awakening-selfhost-docker`'s `docs/design/hosted-bot-auto-invite-and-role-picker-l1-design-2026-09-10.md`) was the first place in this workstream to make a vendor's correct behavior load-bearing for *security*, not just availability — Discord's interaction-signing must genuinely be unforgeable for the owner-confirmation gate to hold, and Cloudflare Pages Functions must correctly execute the HMAC-verification code for the signed-redirect fix to hold. That's a new class of dependency this org hadn't previously tracked as a vendor risk.

## Register

| Vendor | What we depend on | Failure mode if compromised/wrong | Mitigations | Contractual/SLA basis |
|---|---|---|---|---|
| **Discord** | OAuth2 identity/guild-ownership verification; interaction signing (button clicks, slash commands); bot Gateway connection; rate limits | Forged interaction signatures would break the owner-confirmation gate's core unforgeability claim; a Discord-side outage takes the bot fully offline | No code-level mitigation possible (this is the trust root the whole bot design rests on) — Discord's own security posture is out of this project's control. Bot token rotation procedure exists (Requirement 27) for *our* credential, not Discord's own infrastructure. | Discord's standard Developer ToS; no paid SLA (free-tier API usage) |
| **Cloudflare** (Pages Functions, Workers, Tunnel) | Correct execution of `mentat-link`'s proxy/signing-verification code; DNS; Tunnel connectivity between the Proxmox host and the bot VM | A Cloudflare-side bug or outage in Pages Functions execution could silently break the redirect-signature verification (fail open or fail closed depending on the bug); a Tunnel outage takes down console/grafana/bot-backend ingress simultaneously (documented in the org's own README Live Systems section) | Existing: `TRUSTED_CROSS_ORIGIN_REDIRECTS` allowlist, `noTLSVerify`/cert practices for the Tunnel's LAN hop (tracked separately, `meta#62`). No formal Cloudflare incident-monitoring/status-page subscription currently in place — a gap. | Cloudflare's standard ToS; Pages Functions used on the free tier as of this writing (verify current plan before relying on any paid-tier SLA assumption) |
| **npm registry / open-source dependencies** | `discord.js`, `express`, and the rest of `package.json` | Already covered under existing supply-chain tooling (Dependabot, `npm audit`, gitleaks/semgrep/trivy) — not a gap this document needs to newly address | Existing CI gates | N/A — covered by existing DevSecOps model |

## What this register does NOT yet cover

- No formal process exists for being notified of a Discord or Cloudflare security advisory/incident in a timely way (currently reactive — discovered only if something visibly breaks). A future session could subscribe to Discord's developer changelog and Cloudflare's status page as a lightweight first step.
- No documented fallback/degraded-mode behavior if either vendor is unavailable, beyond "the bot doesn't work" — reasonable for a volunteer project of this scale, but worth stating explicitly rather than leaving implicit.

Both are acceptable, explicitly-accepted gaps for a project of this size and nature (non-commercial, volunteer-maintained) — not silently missing, now on record.
