#!/usr/bin/env bash
# Post-checkout hook: detect new branch creation and post to Discord.
# Install: ln -s ../../scripts/git-post-checkout.sh .git/hooks/post-checkout
set -euo pipefail

PREV_HEAD="$1"
NEW_HEAD="$2"
BRANCH_CHECKOUT="$3"

# Only fire on branch checkout (type 1), not file checkout (type 0)
if [ "$BRANCH_CHECKOUT" != "1" ]; then
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"

# Skip if not a working branch (main, detached HEAD, etc.)
case "$BRANCH" in
  main|HEAD|"") exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)/../scripts"
if [ -f "$SCRIPT_DIR/dev-status.sh" ]; then
  bash "$SCRIPT_DIR/dev-status.sh" branch-cut "$BRANCH" "" "Checkout complete"
fi
