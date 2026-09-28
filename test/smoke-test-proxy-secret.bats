#!/usr/bin/env bats
#
# Tests for scripts/smoke-test-proxy-secret.sh (mentat#326). Uses a real
# local HTTP server (a tiny inline `node -e` responder, matching this
# project's own stack rather than introducing a python dependency) so
# each test exercises the script's real curl call and status-code parsing
# against a real response, not a mocked one.

FAKE_SERVER_PID=""

start_fake_server() {
  local response_status="$1"
  local port_file="$BATS_TMPDIR/smoke-test-fake-port.$$"
  FAKE_SERVER_STATUS="$response_status" node -e '
    const http = require("http");
    const status = Number(process.env.FAKE_SERVER_STATUS);
    const server = http.createServer((req, res) => {
      res.writeHead(status);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
    });
  ' > "$port_file" &
  FAKE_SERVER_PID=$!
  for _ in $(seq 1 50); do
    [ -s "$port_file" ] && break
    sleep 0.1
  done
  FAKE_PORT="$(cat "$port_file")"
  rm -f "$port_file"
}

teardown() {
  if [ -n "$FAKE_SERVER_PID" ]; then
    kill "$FAKE_SERVER_PID" 2>/dev/null || true
    wait "$FAKE_SERVER_PID" 2>/dev/null || true
  fi
}

@test "exits 0 when the route returns 403" {
  start_fake_server 403
  run bash scripts/smoke-test-proxy-secret.sh "http://127.0.0.1:$FAKE_PORT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

@test "exits 1 when the route returns 200 (the exact misconfiguration this exists to catch)" {
  start_fake_server 200
  run bash scripts/smoke-test-proxy-secret.sh "http://127.0.0.1:$FAKE_PORT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SECURITY GAP"* ]]
  [[ "$output" == *"200"* ]]
}

@test "exits 1 when the route returns an unrelated 5xx" {
  start_fake_server 500
  run bash scripts/smoke-test-proxy-secret.sh "http://127.0.0.1:$FAKE_PORT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SECURITY GAP"* ]]
}

@test "exits 1 with a clear message when the instance is unreachable" {
  # A port nothing is listening on -- FAKE_SERVER_PID stays empty so
  # teardown has nothing to kill.
  run bash scripts/smoke-test-proxy-secret.sh "http://127.0.0.1:1"
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not reach"* ]]
}

@test "requires a base-url argument" {
  run bash scripts/smoke-test-proxy-secret.sh
  [ "$status" -ne 0 ]
}
