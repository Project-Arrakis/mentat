#!/usr/bin/env bash
# Shared deploy logic used by BOTH scripts/deploy-post-receive.sh (the real
# git-push-triggered hook) and scripts/self-update.sh (Discord-triggered,
# see src/writeSelfUpdate.js). Extracted so there is exactly one copy of
# the test-gated safety logic. Acquires a lock so a concurrent git-push
# deploy and a Discord-triggered self-update (or two self-update triggers)
# can never interleave against the same working directory.
deploy_core::sync_test_install_restart() {
  local work_dir="$1"
  local service_name="$2"
  local lock_file="${work_dir}/runtime/deploy.lock"

  mkdir -p "$(dirname "$lock_file")"
  if ! mkdir "$lock_file" 2>/dev/null; then
    echo "ERROR: a deploy is already in progress (lock held at $lock_file) -- refusing to run concurrently."
    return 1
  fi
  trap 'rmdir "'"$lock_file"'" 2>/dev/null' EXIT

  cd "$work_dir" || { echo "ERROR: cannot cd to $work_dir"; return 1; }

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: working tree at $work_dir is dirty -- refusing to deploy."
    return 1
  fi

  echo "Running test suite..."
  local test_log
  test_log="$(mktemp)"
  npm test > "$test_log" 2>&1
  local test_exit=$?
  tail -10 "$test_log"
  if [ "$test_exit" -ne 0 ]; then
    echo "ERROR: tests failed (exit code $test_exit) -- aborting deployment."
    rm -f "$test_log"
    return 1
  fi
  if grep -qE "^not ok " "$test_log"; then
    echo "ERROR: tests had failures -- aborting deployment."
    rm -f "$test_log"
    return 1
  fi
  rm -f "$test_log"
  echo "Tests passed."

  for f in src/index.js src/statsPusher.js package.json; do
    if [ ! -f "$work_dir/$f" ]; then
      echo "ERROR: missing required file: $f -- aborting deployment."
      return 1
    fi
  done

  npm install --omit=dev 2>&1 | tail -3

  echo "Restarting $service_name..."
  sudo systemctl restart "$service_name" 2>/dev/null || systemctl --user restart "$service_name" 2>/dev/null || true
  sleep 3
  # [Audit fix: UI/UX, CRITICAL round 2] This used to log a warning on a
  # failed health check but return 0 (success) unconditionally regardless
  # -- meaning a crashed/failed-to-start new process still reported as a
  # successful deploy to every caller (deploy-post-receive.sh's exit code,
  # and self-update.sh's Discord webhook message). Now fails closed.
  if systemctl is-active "$service_name" 2>/dev/null | grep -q active; then
    echo "Deployment complete -- service is active."
  else
    echo "ERROR: service failed to become active after restart -- treating as a failed deploy."
    return 1
  fi

  return 0
}

# [Audit fix: QA, MEDIUM round 3] Extracted here (rather than left as a
# private function inside scripts/self-update.sh) specifically so it can
# be sourced and tested directly by test/self-update.bats -- self-update.sh
# itself has no sourceable-without-executing structure (it runs the real
# deploy pipeline at its own top level), so a function defined only there
# had no test coverage at all for the curl-argv-leak fix (see report()'s
# own history: [Audit fix: Security/Cloud-Security, HIGH round 2]). Reads
# DISCORD_WEBHOOK_URL from the CALLER's environment (bash functions see
# the caller's global variables dynamically, not lexically) -- self-update.sh
# sets it before sourcing this file and calling this function.
deploy_core::webhook_report() {
  local message="$1"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    # The webhook URL embeds a bearer-style interaction token -- passing it
    # as a curl argv element would put it in `ps auxww`/`/proc/<pid>/cmdline`
    # for the life of the curl child process. Kept out of argv entirely via
    # a curl config file (`-K`), which curl reads directly.
    local curl_config
    curl_config="$(mktemp)"
    chmod 600 "$curl_config"
    {
      printf 'url = "%s"\n' "$DISCORD_WEBHOOK_URL"
      printf 'silent\n'
      printf 'show-error\n'
      printf 'max-time = 10\n'
      printf 'request = "POST"\n'
      printf 'header = "Content-Type: application/json"\n'
    } > "$curl_config"
    curl -K "$curl_config" \
      -d "$(printf '{"content":%s}' "$(printf '%s' "$message" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')")" \
      >/dev/null 2>&1 || true
    rm -f "$curl_config"
  fi
}
