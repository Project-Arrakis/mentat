#!/usr/bin/env bash
set -euo pipefail

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v2.1.0 \
  --title "Release v2.1.0: Maintenance metadata writes (R2.1, planning)" --body-file releases/R2.1-R2.4/pr-body-v2.1.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v2.2.0 \
  --title "Release v2.2.0: Notification configuration writes (R2.2, planning)" --body-file releases/R2.1-R2.4/pr-body-v2.2.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v2.3.0 \
  --title "Release v2.3.0: Scheduled-post configuration writes (R2.3, planning)" --body-file releases/R2.1-R2.4/pr-body-v2.3.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v2.4.0 \
  --title "Release v2.4.0: R3 readiness review (R2.4, planning)" --body-file releases/R2.1-R2.4/pr-body-v2.4.0.md
