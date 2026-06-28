# Change Note: Package Zero-Permission Addon Releases

## Summary

PR #17 adds a repeatable package command and release-artifact workflow for the
optional zero-permission addon panel.

## User Impact

Operators and maintainers can build a release artifact with
`npm run package:addon`. The command writes a tarball and a matching SHA-256
checksum under `dist/`.

## Security Impact

- The Discord command surface does not change.
- RBAC does not change.
- Secrets handling does not change.
- No new data crosses Discord, the bot, the WebUI adapter, or upstream console.
- Network exposure does not change.
- The package command refuses addon manifests with non-empty permissions and
  rejects unsafe entry paths before writing an artifact.

## Least Privilege

- Discord permissions: unchanged; no message content intent and no extra bot
  scopes.
- WebUI adapter access: unchanged; no adapter calls from the addon package
  command.
- Container privileges: unchanged; the release command runs in CI or a local
  checkout and does not need Docker socket access.
- Addon permissions: must remain `[]` in `addon/addon.json`.

## Tests

- Added unit coverage for addon artifact creation, checksum generation, and
  archive entry names.
- Added unit coverage that rejects non-zero addon permissions.
- Added unit coverage that rejects traversal in the addon entry path.

## Known Limitations

The package command prepares the optional addon panel artifact only. It does not
publish a GitHub release, submit an upstream addon index PR, or change the bot
runtime image.

## Sources

- `docs/pr-transparency-template.md`
- `addon/addon.json`
- `docs/upstream-integration.md`
