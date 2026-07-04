#!/usr/bin/env bash
set -euo pipefail
gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head feature/r2-write-foundation \
  --title "R2.0.0+: Write-safety foundation for Discord commands" \
  --body-file releases/R2-foundation/pr-body.md
