# Change Note: CI Security Scan Gates

## Summary

PR #1 added the CI and security scanner foundation for pull requests and pushes.

## Security Impact

- Added unit-test CI.
- Added npm audit.
- Added Semgrep SAST and secrets rules.
- Added Gitleaks secret scanning.
- Added Trivy filesystem and image scanning.
- Added Docker image build verification.

## Evidence

- Pull request: #1
- Merge commit: `a2ba8a5`
- Primary files: `.github/workflows/ci.yml`,
  `.github/workflows/security-gates.yml`, `docs/security-gates.md`

## Notes

This retrospective note was added after the durable change-note convention was
standardized.
