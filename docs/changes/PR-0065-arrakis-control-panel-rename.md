# PR #65 — Rename Project to Arrakis Control Panel

## Summary

Rename the current project and user-facing documentation to **Arrakis Control
Panel**. Update repository links, clone paths, addon labels, deployment examples,
release helpers, future SBOM filenames, and active roadmap references.

## User-Facing Changes

- README title and project summary use **Arrakis Control Panel**.
- Setup, usage, FAQ, troubleshooting, configuration, security, verification,
  architecture, and release documentation use the new product name.
- Discord application examples and the zero-permission addon panel use the new
  product name.
- Current repository links point to `yacketrj/Arrakis-Control-Panel`.
- Future SBOM artifacts use `arrakis-control-panel.cdx.json`.

## Compatibility

The following identifiers remain unchanged because they are compatibility
contracts rather than product branding:

- `/dune` slash commands
- `DUNE_*` environment variables
- adapter API paths
- addon ID and archive prefix `discord-readonly-bot`
- private npm package identifier `dune-awakening-selfhost-discordbot`
- historical release notes, publication evidence, checksums, and dated audits

Historical records are intentionally not rewritten because they document the
artifact names and repository URLs that existed when those releases and reviews
were produced.

## Security and Privacy

This change does not expand permissions, data access, Discord intents, adapter
capabilities, or write behavior. The zero-permission addon remains
zero-permission. No secrets, personal data, deployment addresses, or credentials
were added.

## Validation

- Reviewed the complete PR file list and repository compare output.
- Verified current release documentation matches the release workflow: the addon
  archive retains its compatibility name while the SBOM uses the ACP filename.
- Preserved the newer README wording that identifies **ACP** as the watcher.
- GitHub Actions did not start for connector-authored commits, so automated test,
  documentation, and security-gate results are not claimed in this change note.

## Rollback

Revert PR #65. No runtime data migration or configuration migration is required.
