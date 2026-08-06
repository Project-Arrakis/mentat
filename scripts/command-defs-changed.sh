#!/usr/bin/env bash
#
# command-defs-changed.sh -- Decide whether a pushed deploy range changed
# Discord slash command definitions.
#
# The deploy hook (~/acp-deploy.git/hooks/post-receive) must re-register
# slash commands with Discord whenever the command structure changes,
# because Discord's command registry is SEPARATE from the running bot
# process (issue #92 -- hit twice in one session by real deploys). This
# helper exists so that decision is unit-testable (see
# test/deploy-hook.bats) instead of living inline in a hook nobody can
# run any test against.
#
# Usage:
#   command-defs-changed.sh <oldrev> <newrev> [repo-dir]
#
# Exit codes:
#   0  -- command definitions did NOT change in the range
#   1  -- command definitions DID change (or the range can't be proven
#         unchanged -- fail-safe: registering unnecessarily is harmless,
#         skipping when needed is the exact bug this exists to prevent)
#
# The files that define Discord slash command structure:
COMMAND_DEF_FILES=("src/commands.js" "src/opsCommands.js")

set -u

oldrev="${1:?oldrev required}"
newrev="${2:?newrev required}"
repo_dir="${3:-.}"

if [ "$oldrev" = "0000000000000000000000000000000000000000" ]; then
  # First-ever push to the branch: the whole command set is new. Register.
  exit 1
fi

changed="$(git -C "$repo_dir" diff --name-only "$oldrev" "$newrev" 2>&1)" || {
  # Range can't be resolved (e.g. force-push rewrote history so oldrev
  # objects are gone). Fail safe: register.
  echo "warn: could not diff $oldrev..$newrev: $changed" >&2
  exit 1
}

for f in "${COMMAND_DEF_FILES[@]}"; do
  if printf '%s\n' "$changed" | grep -qx "$f"; then
    exit 1
  fi
done

exit 0