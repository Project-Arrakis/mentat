#!/usr/bin/env bash
# Release Gates — run before cutting a release tag.
# Called by CI on tag push; also usable locally with npm run release:gates.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Release Gates ==="
echo ""

# 1. Unit tests + release metadata + addon package + SBOM
echo "[1/6] npm run check"
npm run check
echo ""

# 2. Dependency audit
echo "[2/6] npm audit (moderate+)"
npm audit --audit-level=moderate
echo ""

# 3. SAST
echo "[3/6] Semgrep SAST"
semgrep --config=auto --error --severity ERROR --severity WARNING --exclude package-lock.json .
echo ""

# 4. Secret scan
echo "[4/6] Gitleaks secret scan"
gitleaks detect --source . --redact --no-git
echo ""

# 5. Container + config scan
echo "[5/6] Trivy filesystem"
trivy filesystem --scanners vuln,secret,misconfig --skip-dirs node_modules,.security-audit,dist . --no-progress
echo ""

# 6. API security tests (DAST)
echo "[6/6] API endpoint security tests"
node scripts/api-security-test.js
echo ""

# 6.5 Documentation validation
echo "[6.5/8] Documentation validation"
node scripts/validate-docs.js
echo ""

# 7. Docker build + image scan
echo "[7/7] Docker build + Trivy image scan"
docker build -t dune-discord-bot:release-gate .
trivy image --scanners vuln,secret,misconfig --no-progress dune-discord-bot:release-gate
echo ""

echo "=== ALL GATES PASSED ==="
