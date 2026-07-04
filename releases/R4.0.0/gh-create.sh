#!/usr/bin/env bash
set -euo pipefail
gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v4.0.0 \
  --title "Release v4.0.0: Highest-risk operations (R4.0.0+, planning)" \
  --body-file releases/R4.0.0/pr-body.md
