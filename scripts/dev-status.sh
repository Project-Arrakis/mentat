#!/usr/bin/env bash
# Post a developer status update to Discord via webhook.
# Usage: bash scripts/dev-status.sh <event> [branch] [pr-number] [details]
set -euo pipefail

# BUG FIX (2026-07-25): this used to default to
# ~/dune-docker-addon/e2e-integration/secrets/dev-webhook-url.txt --
# deleted along with the 15GB scratch directory it lived in during a
# home-directory cleanup audit. Moved to the same stable, non-project
# location used by acp-ops-monitor's notify-discord.sh.
WEBHOOK_URL_FILE="${DUNE_DEV_WEBHOOK_FILE:-${HOME}/.config/acp-ops-monitor/dev-webhook-url.txt}"
WEBHOOK_URL="$(cat "$WEBHOOK_URL_FILE" 2>/dev/null || echo "")"

if [ -z "$WEBHOOK_URL" ]; then
  echo "Webhook URL not found at $WEBHOOK_URL_FILE"
  exit 1
fi

EVENT="${1:-unknown}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')}"
PR="${3:-}"
DETAILS="${4:-}"

timestamp=$(date -u +"%Y-%m-%d %H:%M UTC")
who="${GIT_AUTHOR_NAME:-${USER:-unknown}}"

case "$EVENT" in
  branch-cut)
    ICON="🌿"
    TITLE="Branch Created"
    BODY="**${BRANCH}** by ${who}"
    DETAILS="${DETAILS:-New working branch}"
    COLOR=5793266  # green
    ;;
  pr-created)
    ICON="📬"
    TITLE="PR Created"
    BODY="**${BRANCH}** → main"
    DETAILS="[PR #${PR}](https://github.com/darkdante/Arrakis-Control-Panel/pull/${PR})"
    COLOR=15105570  # orange
    ;;
  pr-merged)
    ICON="✅"
    TITLE="PR Merged"
    BODY="**${BRANCH}** → main"
    DETAILS="[PR #${PR}](https://github.com/darkdante/Arrakis-Control-Panel/pull/${PR}) merged by ${who}"
    COLOR=3066993  # green
    ;;
  deploy)
    ICON="🚀"
    TITLE="Deploy"
    BODY="**${BRANCH}**"
    DETAILS="${DETAILS:-Deployed to e2e integration environment}"
    COLOR=3447003  # blue
    ;;
  test-pass)
    ICON="🧪"
    TITLE="Tests Pass"
    BODY="**${BRANCH}**"
    DETAILS="${DETAILS:-All gates pass}"
    COLOR=3066993  # green
    ;;
  test-fail)
    ICON="❌"
    TITLE="Tests Failed"
    BODY="**${BRANCH}**"
    DETAILS="${DETAILS:-Check CI for details}"
    COLOR=15158332  # red
    ;;
  security-pass)
    ICON="🔒"
    TITLE="Security Gates Passed"
    BODY="**${BRANCH}**"
    DETAILS="${DETAILS:-All security checks pass}"
    COLOR=3066993  # green
    ;;
  security-fail)
    ICON="🚨"
    TITLE="Security Gates Failed"
    BODY="**${BRANCH}**"
    DETAILS="${DETAILS:-Security check failures — review required}"
    COLOR=15158332  # red
    ;;
  *)
    ICON="📢"
    TITLE="Dev Update"
    BODY="${EVENT}"
    DETAILS="${DETAILS:-}"
    COLOR=9807270  # grey
    ;;
esac

PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'embeds': [{
    'title': '$ICON $TITLE',
    'description': '$BODY',
    'color': $COLOR,
    'footer': {'text': '$timestamp · $DETAILS'[:2048]}
  }]
}))
")

curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK_URL" > /dev/null
echo "Posted: $ICON $TITLE — $BODY · $DETAILS"
