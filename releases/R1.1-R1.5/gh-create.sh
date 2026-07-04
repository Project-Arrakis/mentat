#!/usr/bin/env bash
# Example gh commands for each R1.x release when validated.
set -euo pipefail

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v1.1.0 \
  --title "Release v1.1.0: Operator validation (R1.1)" --body-file releases/R1.1-R1.5/pr-body-v1.1.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v1.2.0 \
  --title "Release v1.2.0: Read-only detail expansion (R1.2)" --body-file releases/R1.1-R1.5/pr-body-v1.2.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v1.3.0 \
  --title "Release v1.3.0: Read-only notifications (R1.3)" --body-file releases/R1.1-R1.5/pr-body-v1.3.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v1.4.0 \
  --title "Release v1.4.0: Compatibility hardening (R1.4)" --body-file releases/R1.1-R1.5/pr-body-v1.4.0.md

gh pr create --repo yacketrj/dune-awakening-selfhost-discordbot --base main --head release/v1.5.0 \
  --title "Release v1.5.0: R2 readiness review (R1.5)" --body-file releases/R1.1-R1.5/pr-body-v1.5.0.md
