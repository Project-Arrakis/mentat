#!/usr/bin/env bash
set -euo pipefail
gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v2.0.0 \
  --title "Release v2.0.0: Write-safety foundation (R2.0.0, planning)" \
  --body-file releases/R2.0.0/pr-body.md
