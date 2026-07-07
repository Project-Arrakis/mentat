# Developer Status Updates

The bot posts development lifecycle notifications to #acp-updates via Discord webhook.

## Events

| Event | Trigger | Message |
|-------|---------|---------|
| **Branch Created** | `git checkout -b <branch>` | 🌿 Branch Created |
| **PR Created** | Manual via `dev-status.sh` | 📬 PR Created with link |
| **PR Merged** | After `gh pr merge` | ✅ PR Merged with link |
| **Deploy** | After `docker build + restart` | 🚀 Deploy to e2e |
| **Tests Pass** | After `npm run check` | 🧪 Tests Pass |
| **Tests Failed** | After CI or manual check | ❌ Tests Failed |

## Manual Usage

```bash
# When creating a PR
bash scripts/dev-status.sh pr-created "feature/branch-name" "63" "Write-safety foundation"

# When a PR merges
bash scripts/dev-status.sh pr-merged "feature/branch-name" "63" "Merged by darkdante"

# After deploying
bash scripts/dev-status.sh deploy "$(git branch --show-current)" "" "Rebuilt bot with new embed formatting"

# After tests pass
bash scripts/dev-status.sh test-pass "$(git branch --show-current)" "" "135/135 tests, 0 findings"
```

## Automatic Hook

The `post-checkout` hook automatically posts when you run `git checkout -b <new-branch>`:

```
🌿 Branch Created — **feature/my-feature** by darkdante
```

## Integration with cut-pr.sh

The `scripts/cut-pr.sh` script now posts a dev-status notification when creating PRs.
