# Security Gates

## Overview

Security scanning runs in CI for every pull request. Local hooks are useful for
fast feedback, but GitHub Actions is the merge gate.

## Policy

Pull requests must pass:

- unit tests
- `npm audit --audit-level=moderate`
- Semgrep SAST with `p/default` and `p/secrets`
- Gitleaks secret scanning
- Trivy filesystem scan for dependency and Dockerfile/Compose misconfiguration
- Docker image build
- Trivy image scan for runtime vulnerabilities and misconfiguration

The gates fail on:

- any Gitleaks secret finding
- any Semgrep `ERROR` or `WARNING` finding from the configured rulesets
- any npm audit finding at `moderate` or higher
- any Trivy `HIGH` or `CRITICAL` finding with an available fix

Trivy uses `--ignore-unfixed` so a merge is not blocked by issues that cannot be
fixed yet. Review those during scheduled weekly runs.

## Local Developer Flow

Install pre-commit if you want local fast-fail checks:

```bash
python3 -m pip install --user pre-commit
pre-commit install
```

The local hook stack runs Semgrep and Gitleaks. Trivy image scanning is kept in
CI because it is slower and requires Docker.

Manual local checks:

```bash
npm test
npm audit --audit-level=moderate
semgrep scan --config p/default --config p/secrets --error --severity ERROR --severity WARNING --exclude node_modules --exclude .git --exclude package-lock.json .
trivy fs --scanners vuln,misconfig --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --skip-dirs node_modules --skip-dirs .git .
docker build -t dune-awakening-selfhost-discordbot:security .
trivy image --scanners vuln,misconfig --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 dune-awakening-selfhost-discordbot:security
```

## STRIDE Usage

STRIDE is a design-review tool for this project, not a per-commit scanner. Use
it when adding command families or adapter capabilities:

- Spoofing: verify Discord identity, adapter bearer token handling, and role
  checks.
- Tampering: verify request payload validation and no write paths in v1.
- Repudiation: plan audit evidence before write actions are ever introduced.
- Information disclosure: enforce redaction and channel/RBAC controls.
- Denial of service: rate-limit expensive or scheduled commands.
- Elevation of privilege: review least-privilege RBAC and container runtime
  privileges.

## SARIF and GitHub Code Scanning

SARIF upload is not a hard gate in this private-repo setup. GitHub Code Scanning
for private repositories depends on GitHub Code Security being enabled. Scanner
exit codes are the gate; SARIF upload can be added later for reporting.
