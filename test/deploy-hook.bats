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
  chmod +x "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl"
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