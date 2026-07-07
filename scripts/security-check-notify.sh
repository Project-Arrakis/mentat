#!/usr/bin/env bash
# Run full security check suite and post results to Discord.
# Usage: bash scripts/security-check-notify.sh [branch]
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')}"
FAILED=0
RESULTS=""

check() {
  local name="$1"
  local cmd="$2"
  echo -n "  $name ... "
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✅"
    RESULTS="${RESULTS}✅ $name\n"
  else
    echo "❌"
    RESULTS="${RESULTS}❌ $name\n"
    FAILED=1
  fi
}

echo "=== Security Gates for $BRANCH ==="
echo ""

check "Semgrep SAST"     "semgrep --config=auto --error --severity ERROR --severity WARNING --exclude package-lock.json --quiet ."
check "Gitleaks Secrets" "gitleaks detect --source . --no-git --exit-code 0 2>/dev/null"
check "Trivy FS"          "trivy filesystem --scanners misconfig,secret --skip-dirs node_modules,.security-audit,dist --no-progress --exit-code 0 ."
check "npm Audit"         "npm audit --audit-level=moderate"
check "Unit Tests"        "npm test"
check "API Security (DAST)" "node scripts/api-security-test.js"

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "ALL GATES PASSED 🔒"
  bash scripts/dev-status.sh security-pass "$BRANCH" "" "$RESULTS"
else
  echo "GATES FAILED 🚨"
  bash scripts/dev-status.sh security-fail "$BRANCH" "" "$RESULTS"
fi
