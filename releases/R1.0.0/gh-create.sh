#!/usr/bin/env bash
# Example gh command to open PR-0043 when the train is validated.
# Run from repo root after filling in test evidence in pr-body.md.
set -euo pipefail
gh pr create \
  --repo yacketrj/dune-awakening-selfhost-discordbot \
  --base main \
  --head release/v1.0.0 \
  --title "Release v1.0.0: Promote release candidate to stable" \
  --body-file releases/R1.0.0/pr-body.md
