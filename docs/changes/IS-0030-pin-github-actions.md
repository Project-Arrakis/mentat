# IS-0030: Pin GitHub Actions to Immutable Commit SHAs

## Summary

The manual Security Gates run on `main` found blocking Semgrep findings for
GitHub Actions workflow steps that used mutable release tags.

## Finding

Rule: `yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag`

Evidence run: https://github.com/yacketrj/Arrakis-Control-Panel/actions/runs/28610395001

Affected files:

- `.github/workflows/ci.yml`
- `.github/workflows/release-artifacts.yml`
- `.github/workflows/security-gates.yml`

## Security Impact

Mutable action tags can be repointed by an action owner. That creates a
workflow supply-chain risk because future runs may execute different action
code without a repository change.

## Resolution Plan

Pin each workflow `uses:` reference to the full 40-character commit SHA that
currently backs the reviewed release tag. Keep the release tag as a comment for
reviewability.

## Verification

- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub Security Gates

## Status

Open until the resolving PR is merged and the Security Gates pass with no
Semgrep mutable-action findings.
