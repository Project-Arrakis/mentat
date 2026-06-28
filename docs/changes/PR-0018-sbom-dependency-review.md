# Change Note: Add SBOM and Dependency Review Gates

## Summary

PR #18 adds CycloneDX SBOM generation, a PR-only dependency review gate, release
artifact publishing for SBOM files, and refreshed operator/security
documentation.

## User Impact

Operators get clearer install and usage docs. Maintainers get repeatable SBOM
artifacts and dependency-review evidence for pull requests.

## Security Impact

- The Discord command surface does not change.
- RBAC does not change.
- Secrets handling does not change.
- No new runtime data crosses Discord, the bot, or the WebUI adapter.
- Network exposure does not change.
- Dependency review blocks newly introduced vulnerable dependencies at
  `moderate` severity or higher.
- SBOM generation produces CycloneDX JSON from `package-lock.json` with a
  SHA-256 checksum for release evidence.

## Least Privilege

- Discord scopes, bot permissions, and gateway intents are unchanged.
- WebUI adapter access is unchanged.
- Container privileges are unchanged.
- CI permissions remain read-only for release artifacts and security gates.

## Tests

- Added unit coverage for CycloneDX SBOM metadata, npm component extraction,
  checksum generation, and validation failure behavior.

## Known Limitations

The SBOM generator covers npm packages described by `package-lock.json`. It does
not replace Docker image vulnerability scanning, release signing, provenance
attestations, or organization-level vendor risk management.

## Sources

- GitHub `actions/dependency-review-action@v5.0.0` action metadata.
- `package-lock.json`
- `docs/pr-transparency-template.md`
