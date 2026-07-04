#!/usr/bin/env bash
set -euo pipefail
gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v3.0.0 \
  --title "Release v3.0.0: Operational writes (R3.0.0, planning)" \
  --body-file releases/R3.0.0/pr-body.md
