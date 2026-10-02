#!/usr/bin/env bash
#
# command-register-decision.sh -- Decide whether the slash commands need
# re-registering, from the content hash of the tree about to be registered
# (scripts/command-defs-hash.js) versus the hash stored after the last
# SUCCESSFUL registration (scripts/register-commands.js). mentat#440.
#
# Usage: command-register-decision.sh <state-file> <current-hash>
#
# Exit 0 -- hashes match: nothing to register.
# Exit 1 -- register: the hash differs, no hash was stored yet, or the
#           current hash could not be computed (empty). Fail safe:
#           registering unnecessarily is harmless, skipping when needed is
#           the bug this exists to prevent.
set -u
state_file="${1:?state file required}"
current="${2-}"
[ -n "$current" ] || exit 1
[ -f "$state_file" ] || exit 1
stored="$(tr -d '[:space:]' < "$state_file")"
[ "$stored" = "$current" ] && exit 0
exit 1
