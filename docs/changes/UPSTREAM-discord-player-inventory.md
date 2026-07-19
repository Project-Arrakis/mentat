# UPSTREAM-discord-player-inventory: Discord adapter player inventory routes + linking + storage queries

## Summary

Adds player inventory, storage, and item search routes to the Discord adapter,
enabling the companion bot to query player data from the game database.

This PR is rebased onto latest `origin/main` (v1.3.60) with zero merge
conflicts and a single clean commit.

## User Impact

- Players can link their Discord account to their in-game character
- Linked players can view their inventory, storage, and search for items
- Server admins can configure player access through existing RBAC roles
- No breaking changes to existing commands or configuration

## Security Impact

- New routes require adapter token authentication (Bearer token, constant-time comparison)
- RBAC capability checks: `INVENTORY_READ`, `STORAGE_READ`, `GUILD_READ`
- Player linking required before inventory/storage access
- No user input passed to dune CLI; all queries are parameterized SQL
- Read-only — no write operations exposed
- Player data is isolated — each player can only see their own data

## Least Privilege

- Player features use existing observer/admin roles — no new roles required
- Capabilities are scoped: `inventory:read`, `storage:read`, `guild:read`
- Guild storage requires guild membership verification
- All routes fail closed if adapter is disabled or token is invalid

## Tests and Evidence

- [x] `npm test` — 489/489 pass, 0 skipped, 0 failed
- [x] Discord adapter tests — 10/10 pass
- [x] Bridge integration tests — 5/5 pass (previously skipped, now enabled)
- [x] Pre-commit hooks — all pass (Semgrep, Gitleaks, Trivy, ggshield)
- [x] CI workflows — all 9 checks pass (api-tests, security-checks, release gate, etc.)
- [x] Rebased onto `origin/main` (v1.3.60) — zero conflicts

## Known Limitations

- Player linking is one-to-one (one Discord account per character)
- Guild storage requires the player to be a guild member
- Inventory search uses `ilike` (case-insensitive) which may return broad results
- No pagination for large inventories (limited to 200 items per query)

## Sources

- `console/api/src/integrations/discord/linkProvider.js` — Player linking/unlinking
- `console/api/src/integrations/discord/inventoryProvider.js` — Inventory and storage providers
- `console/api/src/duneDb.js` — 9 new DB functions (linking, storage queries, item search)
- `console/api/src/integrations/discord/adapter.js` — Route constants
- `console/api/src/integrations/discord/routes.js` — Route handlers
- `console/api/src/integrations/discord/policy.js` — New capabilities
- `console/api/test/discordAdapter.test.js` — Updated test expectations
- `console/api/test/bridgeIntegration.test.js` — Enabled previously skipped integration tests
- `docker-compose.web.yml` — Discord adapter env vars + logging config
