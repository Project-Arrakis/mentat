#!/usr/bin/env bash
# ci-check.sh — Verify GitHub Actions pass before cutting a PR.
# Usage: bash scripts/ci-check.sh [branch]
# Defaults to current branch if not specified.
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REPO="darkdante/Arrakis-Control-Panel"

echo "=== Checking CI status for $BRANCH ==="
echo ""

# Get latest CI and Security Gates runs
CI_RUN=$(gh run list --repo "$REPO" --branch "$BRANCH" --workflow CI --limit 1 --json databaseId,conclusion,status -q '.[0]')
SG_RUN=$(gh run list --repo "$REPO" --branch "$BRANCH" --workflow "Security Gates" --limit 1 --json databaseId,conclusion,status -q '.[0]')

FAILED=0

check_run() {
  local name="$1"
  local json="$2"
  if [ -z "$json" ] || [ "$json" = "null" ]; then
    echo "[-] $name: no run found — push the branch first"
    FAILED=1
    return
  fi
  local conclusion=$(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conclusion',''))")
  local status=$(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
  local id=$(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('databaseId',''))")

  if [ "$conclusion" = "success" ]; then
    echo "[+] $name: passed"
  elif [ "$status" = "in_progress" ] || [ "$status" = "queued" ]; then
    echo "[!] $name: still running — wait for https://github.com/$REPO/actions/runs/$id"
    FAILED=1
  else
    echo "[-] $name: $conclusion — review https://github.com/$REPO/actions/runs/$id"
    FAILED=1
  fi
}

check_run "CI" "$CI_RUN"
check_run "Security Gates" "$SG_RUN"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo "All CI checks pass. Ready to cut PR."
  exit 0
else
  echo "Resolve failures above before cutting a PR."
  exit 1
fi
