#!/usr/bin/env bash
#
# cut-release.sh — Cut a release for the Dune Discord bot.
#
# Usage:
#   bash scripts/cut-release.sh <version>          # e.g. v1.5.0
#   bash scripts/cut-release.sh <version> --dry-run # validate only, no tag push
#
# Preconditions:
#   - Running on clean main branch (git status clean, on main)
#   - npm run check passes
#   - All security gates pass
#
# Postconditions:
#   - Git tag created (annotated) and pushed
#   - GitHub Release workflow triggered
#   - Release artifacts published

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DRY_RUN=false
VERSION=""

usage() {
  cat <<EOF
Usage: bash scripts/cut-release.sh <version> [--dry-run]

Arguments:
  version    SemVer version tag (e.g. v1.5.0, v1.5.1-rc.1)
  --dry-run  Validate everything but do not create or push the tag

Preconditions:
  - On main branch with clean worktree
  - npm run check passes
  - All security gates pass
EOF
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      -*)
        echo -e "${RED}Unknown option: $1${NC}"
        usage
        ;;
      *)
        if [[ -z "$VERSION" ]]; then
          VERSION="$1"
        else
          echo -e "${RED}Unexpected argument: $1${NC}"
          usage
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$VERSION" ]]; then
    echo -e "${RED}Error: version argument is required.${NC}"
    usage
  fi

  if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo -e "${RED}Error: version must match vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-prerelease.${NC}"
    exit 1
  fi
}

check_branch() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    echo -e "${RED}Error: must be on main branch to cut a release. Current: $branch${NC}"
    exit 1
  fi
}

check_clean() {
  if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: worktree is dirty. Commit or stash changes before cutting a release.${NC}"
    exit 1
  fi
}

check_upstream() {
  echo -e "${YELLOW}[1/7] Fetching and verifying upstream...${NC}"
  git fetch origin main --quiet
  local local_sha remote_sha
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse origin/main)"
  if [[ "$local_sha" != "$remote_sha" ]]; then
    echo -e "${RED}Error: local main ($local_sha) is not in sync with origin/main ($remote_sha).${NC}"
    echo -e "${RED}Run: git pull --ff-only${NC}"
    exit 1
  fi
  echo -e "${GREEN}  Branch is in sync with origin/main.${NC}"
}

run_gates() {
  echo -e "${YELLOW}[2/7] Running npm run check...${NC}"
  npm run check
  echo -e "${GREEN}  npm run check passed.${NC}"

  echo -e "${YELLOW}[3/7] Running npm audit...${NC}"
  npm audit --audit-level=moderate
  echo -e "${GREEN}  npm audit passed.${NC}"

  echo -e "${YELLOW}[4/7] Running security gates...${NC}"
  npm run security:check
  echo -e "${GREEN}  Security gates passed.${NC}"

  echo -e "${YELLOW}[5/7] Running API security DAST...${NC}"
  npm run security:api
  echo -e "${GREEN}  API security DAST passed.${NC}"
}

verify_version_alignment() {
  echo -e "${YELLOW}[6/7] Verifying version alignment...${NC}"
  RELEASE_VERSION="${VERSION#v}" npm run release:check
  echo -e "${GREEN}  Version alignment OK.${NC}"
}

check_release_notes() {
  local notes_path="docs/releases/${VERSION}.md"
  if [[ ! -f "$notes_path" ]]; then
    echo -e "${RED}Error: release notes not found at $notes_path${NC}"
    exit 1
  fi
  echo -e "${GREEN}  Release notes found: $notes_path${NC}"
}

cut_release() {
  echo -e "${YELLOW}[7/7] Creating release tag...${NC}"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${GREEN}  [DRY RUN] Would create annotated tag: $VERSION${NC}"
    echo -e "${GREEN}  [DRY RUN] Would push: git push origin $VERSION${NC}"
    echo ""
    echo -e "${GREEN}=== Dry run complete. All gates passed. ===${NC}"
    exit 0
  fi

  echo "  Creating annotated tag $VERSION..."
  git tag -a "$VERSION" -m "Release $VERSION"

  echo "  Pushing tag to origin..."
  git push origin "$VERSION"

  echo ""
  echo -e "${GREEN}============================================${NC}"
  echo -e "${GREEN}  Release $VERSION cut and pushed.${NC}"
  echo -e "${GREEN}  GitHub Release workflow should trigger automatically.${NC}"
  echo -e "${GREEN}  Monitor: https://github.com/yacketrj/arrakis-control-panel/actions${NC}"
  echo -e "${GREEN}============================================${NC}"
}

main() {
  parse_args "$@"

  echo -e "${YELLOW}=== Cutting release $VERSION ===${NC}"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}=== DRY RUN MODE ===${NC}"
  fi
  echo ""

  check_branch
  check_clean
  check_upstream
  check_release_notes
  run_gates
  verify_version_alignment
  cut_release
}

main "$@"
