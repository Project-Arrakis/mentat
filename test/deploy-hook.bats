#!/usr/bin/env bats
#
# Tests for scripts/command-defs-changed.sh -- the deploy hook's decision
# logic for whether a pushed range changed Discord slash command
# definitions (issue #92). Real object IDs from a scratch git repo; no
# mocks.
#
# shellcheck disable=SC2154 # $BATS_TMPDIR is defined by bats

setup() {
  repo="$BATS_TMPDIR/cmddefs-test.$$.$RANDOM"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "Test"
  echo placeholder >"$repo/placeholder.txt"
  git -C "$repo" add .
  git -C "$repo" commit -qm "base" --allow-empty
  base="$(git -C "$repo" rev-parse HEAD)"
  printf '%s' "$base" >"$BATS_TMPDIR/base.$$"
}

teardown() {
  rm -rf "$repo"
  rm -rf "${TESTROOT:-}"
  rm -rf "${FAKE_BIN:-}"
}

@test "exits 0 when no command definition files changed in the range" {
  base="$(cat "$BATS_TMPDIR/base.$$")"
  git -C "$repo" commit -qm "deps" --allow-empty >/dev/null
  head="$(git -C "$repo" rev-parse HEAD)"
  run bash scripts/command-defs-changed.sh "$base" "$head" "$repo"
  [ "$status" -eq 0 ]
}

@test "exits 1 when src/commands.js changed in the range" {
  base="$(cat "$BATS_TMPDIR/base.$$")"
  mkdir -p "$repo/src"
  echo 'export const x = 1;' >"$repo/src/commands.js"
  git -C "$repo" add src/commands.js
  git -C "$repo" commit -qm "commands" >/dev/null
  head="$(git -C "$repo" rev-parse HEAD)"
  run bash scripts/command-defs-changed.sh "$base" "$head" "$repo"
  [ "$status" -eq 1 ]
}

@test "exits 1 when src/opsCommands.js changed in the range" {
  base="$(cat "$BATS_TMPDIR/base.$$")"
  mkdir -p "$repo/src"
  echo 'export {};' >"$repo/src/opsCommands.js"
  git -C "$repo" add src/opsCommands.js
  git -C "$repo" commit -qm "opscommands" >/dev/null
  head="$(git -C "$repo" rev-parse HEAD)"
  run bash scripts/command-defs-changed.sh "$base" "$head" "$repo"
  [ "$status" -eq 1 ]
}

@test "exits 1 on first-ever push (zero oldrev), fail-safe" {
  head="$(cat "$BATS_TMPDIR/base.$$")"
  zeros="0000000000000000000000000000000000000000"
  run bash scripts/command-defs-changed.sh "$zeros" "$head" "$repo"
  [ "$status" -eq 1 ]
}

@test "exits 1 (fail-safe) when the range cannot be resolved" {
  base="$(cat "$BATS_TMPDIR/base.$$")"
  bogus="$(printf 'f%.0s' $(seq 1 40))"
  run bash scripts/command-defs-changed.sh "$base" "$bogus" "$repo"
  [ "$status" -eq 1 ]
}

# [Final-review fix, CRITICAL 2] scripts/deploy-post-receive.sh itself had
# NO test coverage at all -- this file only ever tested the helper it calls.
# The bug: the hook is DEPLOYED by being copied out of the repo into the
# bare deploy repo's own hooks/ directory (INSTALL.md:187, `cp
# ~/arrakis-control-panel/scripts/deploy-post-receive.sh hooks/post-receive`),
# so at runtime "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-core.sh" resolved
# to <bare-repo>/hooks/lib/deploy-core.sh -- a path that never exists. With
# `set -u` and no `-e` the failed source was non-fatal, so the hook then
# called deploy_core::sync_test_install_restart (now an undefined function)
# and died with "command not found", failing every real deploy.
#
# This test reproduces the real production shape exactly: the hook runs from
# a COPY in <bare>/hooks/post-receive, with its working tree somewhere else
# entirely, and asserts the shared library still loads. sudo/systemctl are
# faked on PATH (same technique as test/self-update.bats) so no real service
# is touched; everything else -- git, npm, the real deploy-core.sh, the real
# command-defs-changed.sh -- is genuine.
@test "deploy-post-receive.sh loads scripts/lib/deploy-core.sh when run as a COPY in the bare repo's hooks/ dir (real deployment shape)" {
  TESTROOT="$(mktemp -d)"
  WORK="$TESTROOT/worktree"
  BARE="$TESTROOT/acp-deploy.git"

  mkdir -p "$WORK/src" "$WORK/scripts/lib"
  cp "$BATS_TEST_DIRNAME/../scripts/lib/deploy-core.sh" "$WORK/scripts/lib/deploy-core.sh"
  cp "$BATS_TEST_DIRNAME/../scripts/command-defs-changed.sh" "$WORK/scripts/command-defs-changed.sh"
  cp "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$WORK/scripts/command-register-decision.sh"
  touch "$WORK/.env"
  # Stub only the live-HTTP smoke test (it would try to reach a running bot).
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/scripts/smoke-test-proxy-secret.sh"
  chmod +x "$WORK/scripts/smoke-test-proxy-secret.sh"
  echo '{"name":"t","version":"0.0.0","scripts":{"test":"exit 0"}}' > "$WORK/package.json"
  touch "$WORK/src/index.js" "$WORK/src/statsPusher.js"

  git -C "$WORK" init -q
  git -C "$WORK" config user.email test@test.com
  git -C "$WORK" config user.name test
  git -C "$WORK" add -A
  git -C "$WORK" commit -qm "deployable tree"
  git init -q --bare "$BARE"
  git -C "$WORK" remote add deploy "$BARE"
  git -C "$WORK" push -q deploy HEAD:deploy
  newrev="$(git -C "$WORK" rev-parse HEAD)"
  oldrev="$newrev"

  # The real deployment step: COPY the hook out of the repo into hooks/.
  # WORK_DIR is a hardcoded production path in the script, so the copy
  # retargets only that one constant -- the source-path resolution under
  # test is untouched.
  mkdir -p "$BARE/hooks"
  sed "s|^WORK_DIR=.*|WORK_DIR=\"$WORK\"|" \
    "$BATS_TEST_DIRNAME/../scripts/deploy-post-receive.sh" > "$BARE/hooks/post-receive"
  chmod +x "$BARE/hooks/post-receive"

  FAKE_BIN="$(mktemp -d)"
  export FAKE_BIN_LOG="$TESTROOT/fake-bin.log"
  cat > "$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >> "$FAKE_BIN_LOG"
exit 0
EOF
  cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_BIN_LOG"
if [ "$1" = "is-active" ]; then echo "active"; fi
exit 0
EOF
  # With no stored hash the hook (correctly, fail-safe) tries to register;
  # this test is about hook loading, so a register that succeeds is faked.
  cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "register" ]; then exit 0; fi
exec /usr/bin/env -i PATH="$ORIG_PATH" npm "$@"
EOF
  chmod +x "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl" "$FAKE_BIN/npm"
  export ORIG_PATH="$PATH"
  PATH="$FAKE_BIN:$PATH"

  run bash -c "echo '$oldrev $newrev refs/heads/deploy' | PATH='$FAKE_BIN:$PATH' bash '$BARE/hooks/post-receive'"

  # The specific failure mode this test exists for: a source that resolved
  # to a nonexistent path leaves every deploy_core::* call undefined.
  [[ "$output" != *"command not found"* ]]
  [[ "$output" != *"deploy-core.sh: No such file"* ]]
  # ...and the hook must actually complete, not just avoid that one string.
  [[ "$output" == *"Deploy complete."* ]]
  [ "$status" -eq 0 ]
}
# --- mentat#440: content-hash decision and honest failure reporting ---

@test "command-register-decision: exits 0 only when the stored hash equals the current hash" {
  state="$BATS_TMPDIR/state.$$"
  printf 'abc123\n' > "$state"
  run bash "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$state" "abc123"
  [ "$status" -eq 0 ]
  run bash "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$state" "different"
  [ "$status" -eq 1 ]
  rm -f "$state"
}

@test "command-register-decision: fail-safe register when no hash is stored or the current hash is empty" {
  run bash "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$BATS_TMPDIR/does-not-exist.$$" "abc123"
  [ "$status" -eq 1 ]
  state="$BATS_TMPDIR/state2.$$"
  printf 'abc123\n' > "$state"
  run bash "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$state" ""
  [ "$status" -eq 1 ]
  rm -f "$state"
}

# Builds the same COPY-in-hooks/ shape as the test above, with an `npm` fake
# that exits non-zero for `register`, and asserts the hook does NOT claim
# success, retries once, and exits non-zero after finishing the deploy.
@test "deploy hook reports a failed npm run register honestly: retries once, no false success, exits 1" {
  TESTROOT="$(mktemp -d)"
  WORK="$TESTROOT/worktree"
  BARE="$TESTROOT/acp-deploy.git"
  mkdir -p "$WORK/src" "$WORK/scripts/lib"
  cp "$BATS_TEST_DIRNAME/../scripts/lib/deploy-core.sh" "$WORK/scripts/lib/deploy-core.sh"
  cp "$BATS_TEST_DIRNAME/../scripts/command-defs-changed.sh" "$WORK/scripts/command-defs-changed.sh"
  cp "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$WORK/scripts/command-register-decision.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/scripts/smoke-test-proxy-secret.sh"
  chmod +x "$WORK/scripts/smoke-test-proxy-secret.sh"
  echo '{"name":"t","version":"0.0.0","scripts":{"test":"exit 0"}}' > "$WORK/package.json"
  touch "$WORK/src/index.js" "$WORK/src/statsPusher.js" "$WORK/.env"
  echo "// v1" > "$WORK/src/commands.js"
  git -C "$WORK" init -q
  git -C "$WORK" config user.email test@test.com
  git -C "$WORK" config user.name test
  git -C "$WORK" add -A -f
  git -C "$WORK" commit -qm one
  oldrev="$(git -C "$WORK" rev-parse HEAD)"
  echo "// v2" > "$WORK/src/commands.js"
  git -C "$WORK" commit -qam two
  newrev="$(git -C "$WORK" rev-parse HEAD)"
  git init -q --bare "$BARE"
  git -C "$WORK" remote add deploy "$BARE"
  git -C "$WORK" push -q deploy HEAD:deploy
  mkdir -p "$BARE/hooks"
  sed "s|^WORK_DIR=.*|WORK_DIR=\"$WORK\"|" "$BATS_TEST_DIRNAME/../scripts/deploy-post-receive.sh" > "$BARE/hooks/post-receive"
  chmod +x "$BARE/hooks/post-receive"

  FAKE_BIN="$(mktemp -d)"
  export FAKE_BIN_LOG="$TESTROOT/fake-bin.log"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/sudo"
  printf '#!/usr/bin/env bash\n[ "$1" = "is-active" ] && echo active\nexit 0\n' > "$FAKE_BIN/systemctl"
  # `npm run register` fails; every other npm call (install/test) succeeds.
  cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "register" ]; then echo "register attempt" >> "$FAKE_BIN_LOG"; echo "boom"; exit 1; fi
exec /usr/bin/env -i PATH="$ORIG_PATH" npm "$@"
EOF
  chmod +x "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl" "$FAKE_BIN/npm"
  export ORIG_PATH="$PATH"

  export DUNE_REGISTER_RETRY_DELAY=0
  run bash -c "echo '$oldrev $newrev refs/heads/deploy' | PATH='$FAKE_BIN:$PATH' bash '$BARE/hooks/post-receive'"

  [[ "$output" != *"Slash commands re-registered on deploy."* ]]
  [[ "$output" == *"WARNING: npm run register failed twice"* ]]
  [ "$(grep -c 'register attempt' "$FAKE_BIN_LOG")" -eq 2 ]
  [ "$status" -eq 1 ]
}

# Shared fixture for the hash-path tests: a worktree whose hash script is a
# stub printing $STUB_HASH (or failing when STUB_HASH_FAIL=1), a state file,
# and a fake npm whose `run register` attempts are logged and can be told to
# fail the first N times (FAIL_FIRST). commands.js changes in the pushed range
# so the old file-list signal would always say "register".
hook_fixture() {
  TESTROOT="$(mktemp -d)"
  WORK="$TESTROOT/worktree"; BARE="$TESTROOT/acp-deploy.git"
  mkdir -p "$WORK/src" "$WORK/scripts/lib" "$WORK/runtime"
  cp "$BATS_TEST_DIRNAME/../scripts/lib/deploy-core.sh" "$WORK/scripts/lib/"
  cp "$BATS_TEST_DIRNAME/../scripts/command-defs-changed.sh" "$BATS_TEST_DIRNAME/../scripts/command-register-decision.sh" "$WORK/scripts/"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/scripts/smoke-test-proxy-secret.sh"; chmod +x "$WORK/scripts/smoke-test-proxy-secret.sh"
  cat > "$WORK/scripts/command-defs-hash.js" <<'EOF'
if (process.env.STUB_HASH_FAIL === "1") { console.error("loadConfig: missing DISCORD_CLIENT_ID"); process.exit(1); }
console.log(process.env.STUB_HASH);
EOF
  echo '{"name":"t","version":"0.0.0","scripts":{"test":"exit 0"}}' > "$WORK/package.json"
  touch "$WORK/src/index.js" "$WORK/src/statsPusher.js" "$WORK/.env"
  echo "// v1" > "$WORK/src/commands.js"
  git -C "$WORK" init -q; git -C "$WORK" config user.email t@t.com; git -C "$WORK" config user.name t
  git -C "$WORK" add -A -f; git -C "$WORK" commit -qm one
  oldrev="$(git -C "$WORK" rev-parse HEAD)"
  echo "// v2" > "$WORK/src/commands.js"; git -C "$WORK" commit -qam two
  newrev="$(git -C "$WORK" rev-parse HEAD)"
  git init -q --bare "$BARE"; git -C "$WORK" remote add deploy "$BARE"; git -C "$WORK" push -q deploy HEAD:deploy
  mkdir -p "$BARE/hooks"
  sed "s|^WORK_DIR=.*|WORK_DIR=\"$WORK\"|" "$BATS_TEST_DIRNAME/../scripts/deploy-post-receive.sh" > "$BARE/hooks/post-receive"; chmod +x "$BARE/hooks/post-receive"
  FAKE_BIN="$(mktemp -d)"; export FAKE_BIN_LOG="$TESTROOT/fake-bin.log"; : > "$FAKE_BIN_LOG"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/sudo"
  printf '#!/usr/bin/env bash\n[ "$1" = "is-active" ] && echo active\nexit 0\n' > "$FAKE_BIN/systemctl"
  cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "register" ]; then
  echo "register attempt" >> "$FAKE_BIN_LOG"
  if [ "$(grep -c 'register attempt' "$FAKE_BIN_LOG")" -le "${FAIL_FIRST:-0}" ]; then echo "discord error: 429 rate limited"; exit 1; fi
  exit 0
fi
exec /usr/bin/env -i PATH="$ORIG_PATH" npm "$@"
EOF
  chmod +x "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl" "$FAKE_BIN/npm"
  export ORIG_PATH="$PATH" DUNE_REGISTER_RETRY_DELAY=0
}
run_hook() { run bash -c "echo '$oldrev $newrev refs/heads/deploy' | PATH='$FAKE_BIN:$PATH' bash '$BARE/hooks/post-receive'"; }

@test "hash equal to the stored hash SKIPS registration even though commands.js changed" {
  hook_fixture
  echo "H1" > "$WORK/runtime/registered-commands.sha256"; export STUB_HASH=H1
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"skipping slash-command registration"* ]]
  [ "$(grep -c 'register attempt' "$FAKE_BIN_LOG")" -eq 0 ]
}

@test "a different hash registers even when the changed-file list would say unchanged" {
  hook_fixture
  echo "H1" > "$WORK/runtime/registered-commands.sha256"; export STUB_HASH=H2
  oldrev="$newrev"   # empty range: file-list signal says unchanged
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"Slash commands re-registered on deploy."* ]]
  [ "$(grep -c 'register attempt' "$FAKE_BIN_LOG")" -eq 1 ]
}

@test "a transient register failure is retried once and then succeeds" {
  hook_fixture
  echo "H1" > "$WORK/runtime/registered-commands.sha256"; export STUB_HASH=H2 FAIL_FIRST=1
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"discord error: 429 rate limited"* ]]
  [[ "$output" == *"Slash commands re-registered on deploy."* ]]
  [ "$(grep -c 'register attempt' "$FAKE_BIN_LOG")" -eq 2 ]
}

@test "an uncomputable hash prints the reason and falls back to the file list (changed -> registers)" {
  hook_fixture
  export STUB_HASH_FAIL=1
  run_hook
  [[ "$output" == *"could not compute the command hash"* ]]
  [[ "$output" == *"missing DISCORD_CLIENT_ID"* ]]
  [ "$(grep -c 'register attempt' "$FAKE_BIN_LOG")" -eq 1 ]
}

@test "a failed register in one ref does not skip the remaining output and the hook still ends with the failure message" {
  hook_fixture
  echo "H1" > "$WORK/runtime/registered-commands.sha256"; export STUB_HASH=H2 FAIL_FIRST=9
  run_hook
  [ "$status" -eq 1 ]
  [[ "$output" == *"Deploy finished, but slash-command registration FAILED"* ]]
  [[ "$output" != *"Deploy complete."* ]]
}
