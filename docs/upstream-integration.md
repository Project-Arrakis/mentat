# Upstream Integration Plan

## Purpose

Keep upstream impact small by treating the Discord bot as an external addon
package, not a console subsystem.

## Recommended Path

1. Wait for the upstream release containing the disabled-by-default Discord
   adapter API.
2. Configure this bot's `DUNE_CONSOLE_API_URL`,
   `DUNE_DISCORD_ADAPTER_TOKEN`, endpoint paths, and endpoint methods to match
   that release.
3. Run unit tests and a local smoke test against the released adapter.
4. Publish this repository separately.
5. Optionally submit a very small upstream PR later that only documents the
   external bot or adds the zero-permission addon panel to a community addon
   index.

## Keep Out of Upstream

- Discord bot runtime process.
- Discord tokens or setup workflow.
- Docker socket access.
- Database access.
- Raw console command execution.
- Write commands.

## Optional Upstream PRs Later

Keep any upstream PR tiny:

- Documentation link to this external repository.
- Community addon index entry after release artifact checksums are available.
- Adapter contract clarifications if the released API differs from the defaults.

The bot should not require upstream to merge a full Discord scaffold into the
console repository.

## Addon Release Package

The optional addon panel can be packaged without adding console permissions:

```bash
npm run package:addon
```

The package command validates that `addon/addon.json` keeps an empty
`permissions` array, rejects unsafe entry paths, writes
`dist/discord-readonly-bot-v<version>.tar.gz`, and writes a matching SHA-256
checksum file. The release artifact workflow runs the same command for tag
pushes and manual release preparation.
