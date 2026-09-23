#!/usr/bin/env bats

setup() {
  export WORK_DIR="$(mktemp -d)"
  cd "$WORK_DIR"
  git init -q
  git config user.email test@test.com
  git config user.name test
  echo '{"scripts":{"test":"exit 0"}}' > package.json
  git add package.json
  git commit -qm init
  mkdir -p src
  touch src/index.js src/statsPusher.js
  git add src
  git commit -qm "add required files"
  export SERVICE_NAME="fake-test-service.service"

  # [Audit fix: QA, CRITICAL] Revision 1's tests both passed
  # --skip-restart, meaning the restart branch was never reached in
  # EITHER test -- the "never restart on test-gate failure" property was
  # entirely unobserved. Fixed by putting fake sudo/systemctl scripts on
  # PATH ahead of the real ones and counting real invocations, instead of
  # skipping the branch.
  export FAKE_BIN="$(mktemp -d)"
  cat > "$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >> "$FAKE_BIN_LOG"
exit 0
EOF
  chmod +x "$FAKE_BIN/sudo"
  cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_BIN_LOG"
if [ "$1" = "is-active" ]; then echo "active"; fi
exit 0
EOF
  chmod +x "$FAKE_BIN/systemctl"
  export FAKE_BIN_LOG="$WORK_DIR/fake-bin.log"
  export PATH="$FAKE_BIN:$PATH"

  source "${BATS_TEST_DIRNAME}/../scripts/lib/deploy-core.sh"
}

teardown() {
  rm -rf "$WORK_DIR" "$FAKE_BIN"
}

@test "deploy_core::sync_test_install_restart returns 0 and DOES restart when tests pass" {
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -eq 0 ]
  [ -f "$FAKE_BIN_LOG" ]
  grep -q "systemctl restart $SERVICE_NAME" "$FAKE_BIN_LOG"
}

@test "deploy_core::sync_test_install_restart returns non-zero and NEVER restarts when the test gate fails" {
  echo '{"scripts":{"test":"exit 1"}}' > package.json
  git add package.json
  git commit -qm "break tests"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -ne 0 ]
  [[ "$output" == *"aborting"* ]]
  if [ -f "$FAKE_BIN_LOG" ]; then
    ! grep -q "systemctl restart" "$FAKE_BIN_LOG"
  fi
}

@test "deploy_core::sync_test_install_restart refuses to run when the real lock directory is already held" {
  # [Audit fix: Security/DBA/QA, CRITICAL round 2 -- corroborated
  # independently by all three hats] The original version of this test
  # flocked an unrelated path ($WORK_DIR/../deploy.lock, a plain file) that
  # has nothing to do with the real lock primitive
  # (`mkdir "${work_dir}/runtime/deploy.lock"`, a directory, checked
  # directly against $work_dir/runtime), and wrapped the entire assertion
  # body in `( ... ) || true`, which silently converts any assertion
  # failure inside the subshell into a passing test. This version
  # pre-creates the REAL lock directory the function itself checks, and
  # has no swallow -- it can actually fail.
  mkdir -p "$WORK_DIR/runtime/deploy.lock"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already in progress"* ]]
  if [ -f "$FAKE_BIN_LOG" ]; then
    ! grep -q "systemctl restart" "$FAKE_BIN_LOG"
  fi
  rmdir "$WORK_DIR/runtime/deploy.lock"
}

@test "deploy_core::sync_test_install_restart returns non-zero when the post-restart health check fails" {
  # [Audit fix: UI/UX, CRITICAL round 2] The function previously returned 0
  # unconditionally after attempting a restart, regardless of whether the
  # NEW process actually came up -- a crashed/failed-to-start process would
  # still produce a false-positive "success" result, which self-update.sh
  # (Step 8) would have reported to Discord as "✅ Self-update complete."
  cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_BIN_LOG"
if [ "$1" = "is-active" ]; then echo "failed"; exit 3; fi
exit 0
EOF
  chmod +x "$FAKE_BIN/systemctl"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -ne 0 ]
}

@test "deploy_core::webhook_report keeps the webhook URL out of curl's argv entirely, using a -K config file instead" {
  # [Audit fix: QA, MEDIUM round 3] Round 3 found the curl-argv-leak fix
  # (Round 2) had zero test coverage anywhere -- neither self-update.sh
  # (no sourceable structure to test) nor this file exercised it. Extracting
  # the function into deploy-core.sh (Step 3) makes this test possible.
  cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$FAKE_BIN_LOG"
prev=""
for arg in "$@"; do
  if [ "$prev" = "-K" ]; then
    cp "$arg" "$FAKE_CURL_CONFIG_CAPTURE"
  fi
  prev="$arg"
done
exit 0
EOF
  chmod +x "$FAKE_BIN/curl"
  export FAKE_CURL_CONFIG_CAPTURE="$WORK_DIR/captured-curl-config"
  export DISCORD_WEBHOOK_URL="https://discord.com/api/v10/webhooks/app123/super-secret-token-456"

  run deploy_core::webhook_report "test message"
  [ "$status" -eq 0 ]

  # The secret URL must never appear in curl's own argv (what ps/proc would show).
  run grep -c "super-secret-token-456" "$FAKE_BIN_LOG"
  [ "$output" -eq 0 ]
  # But it must genuinely have reached curl -- via the -K config file's content.
  [ -f "$FAKE_CURL_CONFIG_CAPTURE" ]
  run grep -c "super-secret-token-456" "$FAKE_CURL_CONFIG_CAPTURE"
  [ "$output" -eq 1 ]
}
