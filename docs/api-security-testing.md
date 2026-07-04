# API Security Testing

## Industry Standard Approach

API security testing follows a layered model: SAST → SCA → DAST → Penetration Testing.

| Layer | Tool | When | What it catches |
|-------|------|------|----------------|
| **SAST** (Static) | Semgrep | pre-commit | Code-level vulnerabilities (ReDoS, injection, hardcoded secrets) |
| **SCA** (Composition) | npm audit, Trivy | pre-commit | Dependency vulnerabilities, container CVEs |
| **Secret Scanning** | Gitleaks | pre-commit | Leaked tokens, keys, credentials in source |
| **DAST** (Dynamic) | `npm run security:api` | pre-push, release | Runtime API behavior (auth, RBAC, sanitization, method validation) |
| **Container** | Trivy image | release | Image-layer vulnerabilities, misconfigurations |
| **Penetration** | Manual / OWASP ZAP | release candidate | Full attack surface testing |

## Our Implementation

### Pre-Commit (fast, runs on every `git commit`)
```
semgrep   → SAST (code-level vulnerabilities)
gitleaks  → Secret scanning (leaked tokens)
trivy     → Misconfig + secret filesystem scan
npm audit → Dependency vulnerabilities (moderate+)
```

### Pre-Push (heavier, runs on `git push`)
```
  (all pre-commit hooks)
+ npm test                → 125 unit tests
+ npm run security:api    → 11 DAST-style API endpoint tests
```

### Release Gates (runs before cutting a release tag)
```
npm run release:gates
  → npm run check (tests + release metadata + addon + SBOM)
  → npm audit
  → Semgrep SAST
  → Gitleaks
  → Trivy filesystem
  → API security tests (DAST)
  → Docker build + Trivy image scan
```

## DAST Tests (`npm run security:api`)

Runs 11 automated security checks against a live mock adapter:

| # | Test | Category |
|---|------|----------|
| 1 | Health returns 401 without token | Authentication |
| 2 | Health returns 401 with invalid token | Authentication |
| 3 | Health returns 200 with valid token | Authentication |
| 4 | Rejects token without Bearer prefix | Token format |
| 5 | Rejects empty authorization header | Token format |
| 6 | Status with missing actor handled | Input validation |
| 7 | Response does not leak internal IPs | Output sanitization |
| 8 | Response does not leak secret keys | Output sanitization |
| 9 | Health rejects POST method | Method validation |
| 10 | Status rejects GET method | Method validation |
| 11 | Unknown route returns 404 | Route validation |

## CI/CD Integration

The GitHub Actions `Security Gates` workflow runs the full release gates on every
push to `main` and on tag creation:

```yaml
security-gates:
  runs-on: ubuntu-latest
  steps:
    - semgrep SAST
    - gitleaks secret scan
    - npm audit
    - npm test
    - npm run security:api
    - docker build + trivy image scan
    - dependency review
```
