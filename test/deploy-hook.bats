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