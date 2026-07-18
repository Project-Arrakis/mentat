# Contributing

## Repository Discipline

This is a read-only Discord companion bot for Dune: Awakening self-hosted servers.
The `main` branch is the release target.

### Where code lives

| Component | Directory | Language |
|-----------|-----------|----------|
| Commands | `src/commands.js` | discord.js SlashCommandBuilder |
| Embed formatting | `src/embedFormat.js` | discord.js EmbedBuilder |
| Adapter client | `src/adapterClient.js` | fetch-based HTTP client |
| Configuration | `src/config.js` | Environment-based |
| Tests | `test/` | Node.js `node:test` |

## Development Workflow

1. **Branch**: Create a feature branch from `main`
2. **Develop**: Follow existing patterns — subcommand groups, embed formatters
3. **Test**: `npm test` — 153 must pass
4. **Check**: `npm run check` — tests + metadata + packaging + SBOM
5. **Commit**: Pre-commit hooks run Semgrep, Gitleaks, ggshield, Trivy

## Commit Convention

```
type: brief description

feat: add player inventory commands
fix: persist links across bot restarts
docs: update user guide with inventory commands
security: verify all commands read-only and role-bound
test: add writeHandler disabled/auth/confirmation tests
```

## Testing

```bash
# All tests
npm test                         # 153 unit tests

# Specific tests
node --test test/commands.test.js
node --test test/writeHandler.test.js

# Security
npm run security:check           # Full security gate suite
npm run security:api             # API DAST (11 tests)
npm audit --audit-level=moderate
```

## Release

Releases follow a time-based cadence:
- **Patch**: weekly Monday (security/critical fixes)
- **Minor**: bi-weekly (new commands)
- **Major**: per release train (6-8 weeks, new capability families)

See `docs/release-cadence.md` and `docs/release-process.md`.

## Pull Request Checklist

- [ ] 153 tests pass
- [ ] `npm run check` passes
- [ ] Security gates: Semgrep, Gitleaks, Trivy, ggshield, npm audit
- [ ] API security DAST passes
- [ ] CHANGELOG updated
- [ ] Release notes at `docs/releases/v<VERSION>.md`
- [ ] Version aligned across `package.json`, `addon/addon.json`, `CHANGELOG.md`
