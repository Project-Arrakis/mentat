#!/usr/bin/env bash
#
# deploy-post-receive.sh -- Canonical version of the post-receive hook
# for the ACP Discord bot's deploy remote.
#
# STATUS (corrected 2026-08-13): the bot currently runs on its existing
# OCI VPS (`acp-bot-vnic`) -- this is a live, currently-running production
# service. A planned future migration to the Dell R740's `dune-prod` VM
# is documented but has NOT happened yet (confirmed: zero VMs exist on
# the R740 as of this writing). Do not treat any R740-specific path/IP
# below as the current live deploy target until that migration actually
# occurs -- update this comment block and the real, live copy's path
# when it does. `OCI_BOT_IP`/`R740_DUNE_PROD_IP` below are placeholders --
# see the personal-identifier guard this repo added alongside this fix.
#
# The real, live copy lives at the deploy target's own
# ~/acp-deploy.git/hooks/post-receive (currently the OCI VPS; will move
# to the R740 dune-prod VM once that migration is executed).
# This file is the reviewed, versioned source of truth. When this file
# changes, the live copy on the actual deploy target must be updated to
# match (see compliance/runbooks/backup-recovery.md's deployment section)
# -- a deployed bot that doesn't match this file is a drift bug waiting
# to surface.
#
# What it does, in order:
#   1. On a push to the `deploy` branch, refuses to proceed if the deploy
#      target's working tree has uncommitted local changes (protects
#      against silently discarding in-progress debugging work -- see
#      the dirty-tree guard added 2026-08-13, issue #2), then resets the
#      working tree to the pushed code, runs the real test suite as a
#      guardrail, and aborts the deploy on any test failure (never ships
#      a red tree to a live bot).
#   2. If the pushed range changed Discord slash command definitions
#      (src/commands.js, src/opsCommands.js), re-registers them with
#      Discord via `npm run register` -- closing the silent gap where a
#      restart deployed new command code but Discord kept offering the
#      old, now-nonexistent command structure (issue #92).
#   3. Restarts acp-bot.service and reports the health state.
#
# Previous/current host: OCI VPS at OCI_BOT_IP (placeholder -- this is a
# live production service, NOT decommissioned; see status note above).

DEPLOY_BRANCH="deploy"
WORK_DIR="/home/dune/arrakis-control-panel"
SERVICE_NAME="acp-bot.service"
# Bash strict mode without `-e`: each step below handles its own errors
# so it can report *which* guardrail failed instead of dying silently.
set -u

require_register() {
  oldrev="$1"
  newrev="$2"
  if bash "$WORK_DIR/scripts/command-defs-changed.sh" "$oldrev" "$newrev" "$WORK_DIR" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

while read -r oldrev newrev refname; do
  branch="${refname#refs/heads/}"

  if [ "$branch" != "$DEPLOY_BRANCH" ]; then
    echo "Skipping push to '$branch' -- only '$DEPLOY_BRANCH' triggers deployment."
    continue
  fi

  echo "Deploy trigger detected on '$DEPLOY_BRANCH' branch."

  # Unset git env vars that bare repo hooks set
  unset GIT_DIR
  unset GIT_WORK_TREE
  unset GIT_NAMESPACE

  cd "$WORK_DIR" || { echo "ERROR: cannot cd to $WORK_DIR"; exit 1; }

  # Guardrail: refuse to deploy if the working tree has local modifications.
  # Without this, a debugging session SSH'd into the deploy target has its
  # in-progress work silently discarded by the next `git reset --hard`
  # below -- issue #2, filed after this gap was found during an unrelated
  # eight-hats review of the R740 migration's planned deploy hook.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: working tree at $WORK_DIR is dirty -- refusing to deploy."
    echo "Someone may be actively debugging on this host. Investigate"
    echo "('git status' on $WORK_DIR) before forcing a deploy."
    exit 1
  fi

  # Reset to latest from deploy remote
  echo "Syncing to latest deploy code..."
  git fetch deploy "$DEPLOY_BRANCH" 2>&1 || { echo "ERROR: git fetch failed"; exit 1; }
  git reset --hard deploy/"$DEPLOY_BRANCH" 2>&1 || { echo "ERROR: git reset failed"; exit 1; }
  echo "Current: $(git log --oneline -1)"

  # Guardrail: run tests on the NEW code
  echo "Running test suite..."
  npm test 2>&1 | tee /tmp/deploy-test.log | tail -10
  TEST_EXIT=${PIPESTATUS[0]}
  if [ "$TEST_EXIT" -ne 0 ]; then
    echo "ERROR: tests failed (exit code $TEST_EXIT) -- aborting deployment."
    exit 1
  fi

  if grep -qE "^not ok " /tmp/deploy-test.log; then
    echo "ERROR: tests had failures -- aborting deployment."
    exit 1
  fi
  echo "Tests passed."

  # Guardrail: check for required files
  for f in src/index.js src/statsPusher.js package.json; do
    if [ ! -f "$WORK_DIR/$f" ]; then
      echo "ERROR: missing required file: $f -- aborting deployment."
      exit 1
    fi
  done

  # Install dependencies if needed
  npm install --omit=dev 2>&1 | tail -3

  # Re-register slash commands if command definitions changed in range.
  # Discord's command registry is separate from the bot process; a
  # restart alone never updates what users see (issue #92). Registering
  # on every deploy unconditionally would add a Discord API call (with
  # its own rate-limit/transient failure modes) to deploys that changed
  # nothing command-related, so only register when the actual definition
  # files changed.
  if require_register "$oldrev" "$newrev"; then
    echo "Slash command definitions changed -- re-registering with Discord..."
    if (cd "$WORK_DIR" && set -a && . "$WORK_DIR/.env" && set +a && npm run register 2>&1 | tail -5); then
      echo "Slash commands re-registered on deploy."
    else
      echo "WARNING: npm run register failed. Command definitions may not"
      echo "reflect this deploy. Run manually if needed, on the deploy"
      echo "target itself:"
      echo "  cd ~/arrakis-control-panel && set -a && . ./.env && set +a && npm run register"
    fi
  else
    echo "No command-definition changes -- skipping slash-command registration."
  fi

  # Restart service
  echo "Restarting $SERVICE_NAME..."
  sudo systemctl restart "$SERVICE_NAME" 2>/dev/null || systemctl --user restart "$SERVICE_NAME" 2>/dev/null || true

  # Health check
  sleep 3
  if systemctl is-active "$SERVICE_NAME" 2>/dev/null | grep -q active; then
    echo "Deployment complete -- service is active."
  else
    echo "WARNING: service status unclear -- check manually."
  fi

  echo "Deploy complete."
done