# Build order for the Discord command surface (approved by the operator 2026-10-01)

Approved by the operator on 2026-10-01 ("approved with that work list"). Phase 0 checks: `2026-10-01-phase0-bot-vm-checks.sh` (read-only, prints no secrets).

One page. It orders the work that the design (`2026-09-30-command-surface-split-design.md`) and the
coverage matrix (`2026-10-01-console-parity-coverage-matrix.md`) describe. Nothing here is built or
audited yet. "Blocked by" lists real dependencies found so far; "Decision" lists what the operator
still has to rule.

## Rules every phase follows

- Console IAM policy is the source of truth for permissions; only an owner changes IAM in Discord.
- Every write has a full audit trail; routine writes use the requester-only confirm, destructive
  writes a second distinct confirmation; nothing that clears audit history is offered.
- Guilds are isolated tenants; no cross-guild commands; state resolves from `interaction.guildId`.
- Each phase gets Layer 1 (design), Layer 2 (implementation) and Layer 3 (`/code-review high`)
  audits (Requirement 20); Core work is filed as Core issues, not edited from mentat (Requirement 18).
- No mentat schema migration lands until mentat#438 (schema v8 on `main` versus v9 on the deploy
  branch) is resolved.

## Phases

| # | Phase | What | Blocked by | Decision still needed |
|---|---|---|---|---|
| 0 | Unblock | Resolve mentat#438; run the operator-only checks (bot VM `.env`, `schema_version`, deployed commit); merge the dependency bump #453 | operator | none |
| 1 | Split | Authorization-record PR, then the refactor slices from #441: `/dune` split into `/dune`, `/player`, `/goal`, `/order` (shell only) | phase 0 | OD1 names, OD3 lifecycle writes, OD6 calculator, OD7 default layout, OD9 group names, OD21 `/player` names, OD25 guild command name |
| 2 | Core: policy-derived permissions | Core issue #1103: bridge authorizes by evaluating the console IAM policy, plus a signed effective-permissions read for mentat | Layer 1 audit of Core#1103 | confirm the Core approach |
| 3 | Core: per-guild signing (Phase 2a) | mentat PR first, then Core#1088 (per-guild actor signing secret) | #438, Phase 2 design OD2-4, 6, 7, 9-14 | the open Phase 2 decisions |
| 4 | `/player` own-character reads | `bases` first, then `vehicles`, `skills`, `journey`, `crafting`, `research`; `whoami` extended | phase 1, Core#1099 (read routes), phase 3 | OD22, OD23 |
| 5 | Staff reads | Players, Bases, Guilds, Vehicles, Exchange, Landsraad, Care Package, Admin Tools reads | phase 2, per-view Core read routes | none (accepted in the matrix) |
| 6 | Staff writes | By panel in value order: Players, Guilds, Bases, Maps instance control, Admin Tools, Care Package, Updates; second confirmation for destructive ones | phase 2 and the audit-record decision | audit record fields (proposed, not confirmed); Maps points: Overmap and Deep Desert tiers, moderator restart needs a policy grant |
| 7 | `/order` | Own command and table, overdue marking, owner notice in the guild's channel set at bot setup | phase 1, #438, setup-wizard step | channel storage (new column or reuse `schedule_channel`) |
| 8 | Guild leader self-service | `/guild` (name pending): promote, demote, invite, kick, disband, transfer, set guild base | Core#1100, Core#1099, phase 2 | OD25, OD26, OD27, OD28 |
| 9 | Guild base and `/order sync` | Guild-base designation in Core and `order:sync` | Core#1099, phases 3, 7, 8 | none beyond the above |
| 10 | Owner IAM in Discord | Guided commands: view, grant or revoke one action, test | phase 2 | confirm the POST/PUT mismatch on the policy-save route (unverified) |

## Core issues that carry the dependencies

#1099 (guild-base designation, `/player` read routes), #1100 (leader-scoped guild routes), #1101 (rename
and password restart cascade and missing warning), #1102 (`memory set` on an always-on map fails
silently), #1103 (permissions from the console policy, owner-only IAM), and #1088 (per-guild signing).

## What I recommend doing first

Phase 0 (it is pure unblocking and needs only you), then the Layer 1 design audit for phase 2 (it
decides how every later write is authorized) in parallel with the phase 1 split decisions. Phases 5 to
10 are large and independent enough to be scheduled panel by panel once phase 2 exists.

## Not yet verified

- Which audit fields the bridge records today.
- The Server Control panel, the Blueprints tab and the Discord Bot settings section.
- Production behavior for Sietch count changes above 2 or with players connected.
