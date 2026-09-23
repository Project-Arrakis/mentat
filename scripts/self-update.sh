#!/usr/bin/env bash
# Discord-triggered replay of the deploy pipeline (see
# docs/design/write-command-reconciliation-l1-design-2026-09-22.md section
# 4a). Invoked by src/writeSelfUpdate.js's runSelfUpdate() via
# `systemd-run --scope`, so this process (and anything it forks) is NOT a
# member of acp-bot.service's own cgroup -- KillMode=control-group on that
# unit would otherwise kill this script in the same signal that kills the
# process it's restarting, silently breaking the report-back mechanism on
# the fast, successful path (Layer 1 Network hat finding).
#
# Does NOT fetch/reset from the deploy remote -- operates on whatever is
# already checked out at WORK_DIR (see design doc section 4a for why).
set -u

WORK_DIR="${WORK_DIR:-/home/bot/arrakis-control-panel}"
SERVICE_NAME="${SERVICE_NAME:-acp-bot.service}"
# [Audit fix: Security, HIGH round 3] The webhook URL is read from a
# short-lived 0600 temp file, not directly from the environment. `systemd-run`
# (writeSelfUpdate.js's primary, non-fallback path) submits the unit to the
# systemd MANAGER over D-Bus -- an env var set on the systemd-run CLIENT
# process (Node's own `spawn(..., { env })`) never actually reaches the
# scope it creates; only `--setenv=KEY=VALUE` on systemd-run's own argv
# does, and putting the secret itself there would leak it via
# `ps auxww`/`/proc/<pid>/cmdline` for systemd-run's own (client) process
# lifetime -- the exact leak this design already closed for curl (see
# deploy_core::webhook_report() in lib/deploy-core.sh). Passing only a
# temp file PATH via --setenv/env is safe
# (a path isn't sensitive) and matches this codebase's own established
# `_FILE` secret-handling convention (Requirement 24).
DISCORD_WEBHOOK_URL_FILE="${DISCORD_WEBHOOK_URL_FILE:-}"
DISCORD_WEBHOOK_URL=""
if [ -n "$DISCORD_WEBHOOK_URL_FILE" ]; then
  # [Audit fix: Security, MEDIUM round 4] A trap, not just an inline rm/rmdir
  # right after reading -- if this script exits/is killed at ANY point
  # before reaching the explicit cleanup below (a bug in an earlier line,
  # a signal), the 0600 secret file would otherwise be orphaned on disk
  # indefinitely with no reaper. Registered before the file is even read,
  # so it covers the read step itself failing too.
  trap 'rm -f "$DISCORD_WEBHOOK_URL_FILE" 2>/dev/null; rmdir "$(dirname "$DISCORD_WEBHOOK_URL_FILE")" 2>/dev/null || true' EXIT
  if [ -f "$DISCORD_WEBHOOK_URL_FILE" ]; then
    DISCORD_WEBHOOK_URL="$(cat "$DISCORD_WEBHOOK_URL_FILE")"
  fi
  rm -f "$DISCORD_WEBHOOK_URL_FILE"
  rmdir "$(dirname "$DISCORD_WEBHOOK_URL_FILE")" 2>/dev/null || true
  trap - EXIT
fi
MARKER_FILE="$WORK_DIR/runtime/self-update-pending.json"

source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-core.sh"

# report()'s implementation moved to deploy_core::webhook_report()
# (scripts/lib/deploy-core.sh, Step 3) so it can be sourced and tested
# directly by test/self-update.bats -- this script has no
# sourceable-without-executing structure of its own.

# Written BEFORE the restart, so the NEW process (started by
# deploy_core's own systemctl restart) can find it on its own startup and
# report success itself -- a second, independent reporting layer that
# survives even if THIS script's own webhook post (below) is killed
# alongside the old process despite the systemd-run escape (belt and
# braces, not a single point of failure).
mkdir -p "$(dirname "$MARKER_FILE")"
DISCORD_WEBHOOK_URL="$DISCORD_WEBHOOK_URL" node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ webhookUrl: process.env.DISCORD_WEBHOOK_URL || '', triggeredAt: Date.now() }))" "$MARKER_FILE"

if deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"; then
  deploy_core::webhook_report "✅ Self-update complete. \`$(cd "$WORK_DIR" && git log --oneline -1)\` is now live."
else
  rm -f "$MARKER_FILE" # deploy_core already returns non-zero for either a failed test gate OR a failed post-restart health check -- either way, no confirmed-good new process exists for the marker to describe
  # [Final-review fix, IMPORTANT 5] The failure counterpart of src/index.js's
  # "self-update-completed" audit event. On this branch the marker file has
  # just been removed and the OLD bot process is still running -- it has no
  # other way to ever learn that the self-update it triggered failed, so
  # nothing downstream would emit an audit line for this outcome at all.
  # Emitted here, in the same inline-`node -e` style this script already
  # uses for the marker file above, so both outcomes land in the same
  # audit stream with the same writeAuditEvent() shape.
  node -e "
  import(process.argv[1]).then(({ writeAuditEvent }) => {
    console.log(JSON.stringify(writeAuditEvent({ actor: {}, action: 'bot.self-update', capability: 'bot.self-update', idempotencyKey: 'n/a', result: process.argv[2] })));
  });
  " "$WORK_DIR/src/writes.js" "self-update-aborted" || true
  deploy_core::webhook_report "🛑 Self-update aborted or failed -- either the test gate failed (previous code is still running) or the restarted process did not come up healthy. Check the self-update log on the host for details."
  exit 1
fi
