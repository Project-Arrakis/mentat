#!/usr/bin/env bash
# cut-pr.sh — Create a staged upstream PR from the releases/ folder.
# Usage: bash scripts/cut-pr.sh <train-name>
# Example: bash scripts/cut-pr.sh R2-foundation
set -euo pipefail

TRAIN="${1:-}"
if [ -z "$TRAIN" ]; then
  echo "Usage: bash scripts/cut-pr.sh <train-name>"
  echo ""
  echo "Available trains:"
  ls -1d releases/*/ 2>/dev/null | sed 's|releases/|  |' | sed 's|/||' | grep -v index.md
  exit 1
fi

BODY_FILE="releases/${TRAIN}/pr-body.md"
if [ ! -f "$BODY_FILE" ]; then
  echo "Error: pr-body.md not found at $BODY_FILE"
  echo "Create it first with the PR transparency template."
  exit 1
fi

# Determine branch from pr-body.md or git branch
HEAD_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if ! git rev-parse --verify "$HEAD_BRANCH" >/dev/null 2>&1; then
  echo "Error: not on a valid git branch"
  exit 1
fi

# Extract title from pr-body.md (first # heading)
TITLE=$(head -5 "$BODY_FILE" | grep "^#" | head -1 | sed 's/^#* *//')
if [ -z "$TITLE" ]; then
  echo "Error: could not extract title from $BODY_FILE (looking for # heading)"
  exit 1
fi

echo "=== PR Summary ==="
echo "Train:   $TRAIN"
echo "Branch:  $HEAD_BRANCH"
echo "Body:    $BODY_FILE"
echo "Title:   $TITLE"
echo "Repo:    yacketrj/dune-awakening-selfhost-discordbot"
echo "Base:    main"
echo ""
echo "=== Pre-flight checks ==="

# Check CI status
echo "Checking GitHub Actions status..."
if bash scripts/ci-check.sh "$HEAD_BRANCH" 2>&1; then
  echo ""
else
  echo ""
  echo "CI checks failed. Push the branch and resolve failures first."
  echo "  gh run list --branch $HEAD_BRANCH --json name,conclusion,status"
  exit 1
fi

# Run pre-commit checks
echo "Running pre-commit hooks..."
pre-commit run --all-files 2>&1 | tail -5
echo ""

# Run unit tests
echo "Running unit tests..."
npm test 2>&1 | grep -E "^# tests|^# pass|^# fail"
echo ""

# Confirm
read -p "Create upstream PR? [y/N] " -r
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Creating PR..."

PR_URL=$(gh pr create \
  --repo yacketrj/dune-awakening-selfhost-discordbot \
  --base main \
  --head "$HEAD_BRANCH" \
  --title "$TITLE" \
  --body-file "$BODY_FILE")

PR_NUM=$(echo "$PR_URL" | grep -oP '\d+$' || echo "")

# Post dev status
if [ -f scripts/dev-status.sh ]; then
  bash scripts/dev-status.sh pr-created "$HEAD_BRANCH" "$PR_NUM" "$TITLE"
fi

echo ""
echo "$PR_URL"
echo "Done. Don't forget to create the matching docs/changes/PR-#### change note."
