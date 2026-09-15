# Chronicles of Kanly: Discord role → Mentat tier mapping

Resolves mentat#359. Read this before implementing anything that needs to
know "what can a Naib/Fedaykin/Crysknife-Bearer/Off-worlder/Houseless
member actually do in Mentat" (mentat#361, #364, #367, #372) — do not
re-derive the mapping from the plan doc or guess at it independently.

## Authoritative tier vocabulary (verified against code, not docs)

Mentat runs exactly one permission tier system, unified across Mentat and
Core in issue #238 (`src/rbac.js`, module header):

```
player (DB value: "observer") < moderator < admin < owner
```

- **`TIERS`** (`src/rbac.js:36`): `["observer", "moderator", "admin", "owner"]`
- **`TIER_RANK`** (`src/rbac.js:37`): `{ observer: 0, moderator: 1, admin: 2, owner: 3 }`
- **User-facing labels** (`ROLE_TYPE_LABELS`, `src/rbac.js:41-46`): the DB
  value `observer` is always displayed to users as **"Player"** — the
  other three labels match their DB values verbatim.
- **`guild_roles.role_type`** CHECK constraint (`src/database.js:44`):
  `IN ('observer', 'admin', 'owner', 'moderator')`.

**This corrects a stale, incorrect restatement of the tier system** that
circulated earlier in this project ("public < observer < moderator <
admin") — that string does not appear anywhere in the codebase and does
not match `TIERS`/`TIER_RANK` above. Trust `src/rbac.js` and
`src/database.js`'s CHECK constraint as the single source of truth for
tier names; do not re-derive from a doc or a prior summary.

### The `owner` tier is structurally unreachable via any role mapping

Per `src/rbac.js`'s module header and issue #238: `owner` is derived
**exclusively** from real Discord guild ownership (`isGuildOwner`,
comparing the acting user's Discord ID against the guild's real owner
ID) — never from a `guild_roles` row, even if one exists with
`role_type = 'owner'` (legacy rows from pre-unification installs are
present in the schema for historical compatibility only and are never
consulted for authorization; see `resolveOwnerLabel`'s issue #238
comment in `src/commands.js`).

**Consequence for this mapping: no Discord role — including 🏛️ Naib —
can ever grant Mentat's `owner` tier.** This is architectural, not a
gap to fix. The highest tier any role-based mapping can reach is
`admin`.

## The mapping

| Chronicles of Kanly Discord role | Mentat tier (DB `role_type`) | Display label | Rationale |
|---|---|---|---|
| 🏛️ Naib | `admin` | Admin | Top staff/admin rank in the plan doc. Cannot reach `owner` — see above; the literal Discord server owner already gets `owner` automatically regardless of role, with or without this mapping. |
| 🗡️ Fedaykin | `moderator` | Moderator | Plan doc's "Moderator" tier — real Discord moderation permissions (Kick/Ban/ManageMessages/ModerateMembers) were confirmed already granted to this role during live guild cleanup; this mapping brings Mentat's own authorization in line with that same real-world responsibility level. |
| 🔪 Crysknife-Bearer | `observer` | Player | Verified full member — the tier every authenticated player should have: read-only Mentat commands (`/dune player inventory`, `/dune status`, etc.). |
| 🌫️ Off-worlder | *(none)* | *(unauthenticated)* | Unverified/pre-onboarding. No `guild_roles` row — `dbActorTier` returns `null` for a role with no configured mapping, which fails every `tierAtLeast` check closed (see `src/rbac.js:50-53`). |
| 🏳️ Houseless | *(none)* | *(unauthenticated)* | Same reasoning as Off-worlder — Houseless is an allegiance state (mentat#363), not a trust/verification state, and carries no Mentat tier of its own. A Houseless member reaches `observer` only via holding 🔪 Crysknife-Bearer too (both roles are independent axes: allegiance vs. verification), not via Houseless itself. |

House roles (🦅 House Atreides / 🐍 House Harkonnen), the notification
opt-ins (🏛️ Landsraad Crier / ⚔️ Kanly Crier), 🟢 On Duty, and the 14
service badges (Swordmaster, Sietch Guard, etc.) are **deliberately not
mapped to any tier** — they represent allegiance, notification
preference, activity status, or specific in-game trust roles
respectively, none of which are a Mentat command-authorization concern.
mentat#361 (gating Swordmaster/Sietch Guard *application approval* on
`cheater_tracking` flags) is a separate, narrower authorization check
scoped to that one Discord-side approval workflow — it does not need
and must not reuse the tier system above.

## How to wire this into a guild's real configuration

Mentat resolves tiers per-guild from the `guild_roles` table (`role_id`
→ `role_type`), populated through either surface documented for
operators — **this doc does not execute either of these against the
live Chronicles of Kanly guild**; wiring it there is a Discord
guild-configuration action for whoever owns that thread (see
`chronicles-of-kanly-discord-project-status` memory), not this
backlog's scope, since it requires the guild's real role IDs and staff
sign-off on timing:

1. **Setup portal** (`docs/admin-guide.md` "Step 3: Set Up Roles"):
   accepts one role ID per tier (`adminRoleId`, `moderatorRoleId`,
   `observerRoleId` — see `src/setupServer.js:477`). Sufficient here
   since Chronicles of Kanly has exactly one role per tier in this
   mapping.
2. **Roles API** (`/api/consoles/:guildId/roles`, mentat#325/#354):
   accepts arrays (`playerRoleIds`, `moderatorRoleIds`, `adminRoleIds`
   — see `src/setupServer.js:1062`) for guilds needing N roles per
   tier. Not needed for this mapping (1:1), but is the correct
   mechanism if a future Chronicles of Kanly change adds a second role
   at the same tier.

Either path writes to the same `guild_roles` table `src/rbac.js`'s
`dbActorTier`/`multiTenantActorTier` read from — there is no third,
parallel authorization mechanism to invent for this mapping, and none
should be built downstream of it (see mentat#359's own "How" step 3).

## Verification performed for this mapping

- Read `src/rbac.js` in full (`multiTenantActorTier`, `tierAtLeast`,
  `dbActorTier`, `resolveGuildOwnerId`, `isGuildOwner`) — the tier
  vocabulary and the `owner`-is-role-independent design above are taken
  directly from this file's own module header and function bodies, not
  inferred.
- Read `src/database.js`'s `guild_roles` schema (CHECK constraint,
  `getGuildRoles`/`addGuildRole`/`removeGuildRole`).
- Read `src/setupServer.js`'s two role-configuration surfaces (setup
  portal fields, `/api/consoles/:guildId/roles`) to confirm both exist
  and accept the tier names used above.
- Did **not** query the live Discord guild for real role IDs, and did
  **not** write to any `guild_roles` row — this is documentation/config
  guidance only, per mentat#359's own "RO — no game-state or
  Discord-state writes" scope note.
