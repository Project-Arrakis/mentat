# Privacy Policy

**This document has moved.** The operative, current Privacy Policy for Sahir Venn (Dune: Awakening Docker's hosted Discord bot, formerly "Mentat"/"Sentinel"/"Arrakis Control Panel"/"ACP") is published at:

**<https://mentat-link.darkdante.org/privacy>**

## Why this file still exists

This repository previously carried its own, independent copy of the Privacy Policy (last content update: July 18, 2026), written when this bot was self-hosted-only and described an architecture ("you are the data controller, we do not operate a central database") that no longer matches reality — the bot has since moved to a shared, centrally-hosted, multi-tenant architecture, and `mentat`'s own `guilds` table stores real connection data (adapter tokens, console URLs, role mappings) centrally.

That old copy went stale relative to the site's own, independently-maintained `privacy.html` (mentat-link#334, found during a 2026-09-10 comprehensive security/GRC/legal audit) — the two documents disagreed on the exact question a real GDPR/CCPA-oriented reader would care most about, who the data controller is and where data actually lives.

## Going forward

Maintaining two full copies of a legal document, in two different repos and formats, is itself the drift risk that caused this — not something to re-fix once and repeat. This file is deliberately kept as a thin pointer, not a duplicate, so there is exactly one place this policy can go stale: <https://mentat-link.darkdante.org/privacy>. If you're looking for what data this bot processes, where it's stored, or your rights regarding it, that page is the current, authoritative source — not this file.

**Not legal advice.** This project is a volunteer-maintained, non-commercial open-source tool; the linked policy is a good-faith description of its actual data handling, not a substitute for counsel if you need one.
