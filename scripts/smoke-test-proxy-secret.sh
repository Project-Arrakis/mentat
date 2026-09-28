#!/usr/bin/env bash
#
# smoke-test-proxy-secret.sh -- mentat#326 (L2 phase 8, release-readiness
# gate for dune-awakening-selfhost-docker#853's auto-invite flow).
#
# requireProxySecretFailClosed() (src/proxyAuth.js) already rejects an
# unauthenticated call to /api/consoles/auto-invite/start with 403 whether
# the shared secret is merely mismatched OR entirely unconfigured -- this
# script exists as a deploy-time REGRESSION check on that specific
# behavior (has a bad deploy silently removed/bypassed the fail-closed
# gate on this exact route?), run against a real, already-running instance,
# not a unit test against the source.
#
# KNOWN LIMITATION, deliberately not solved here: a 403 from this check
# looks identical whether caused by (a) the gate correctly firing on an
# unset/mismatched secret, or (b) the gate correctly firing on a genuinely
# CORRECT, matching secret it just wasn't given. This script proves the
# gate is present and active; it does NOT prove MENTAT_PROXY_SHARED_SECRET
# is actually set-and-matching between this instance and the mentat-link
# Pages project, which is what the issue's own title asks for and would
# require a real round trip through mentat-link's live proxy (a
# legitimately-headered request that must NOT 403) to verify -- flagged,
# not silently assumed solved.
#
# Usage: smoke-test-proxy-secret.sh <base-url>
#   e.g. smoke-test-proxy-secret.sh http://127.0.0.1:3100
#
# Exit 0: the route correctly rejected the unauthenticated request with 403.
# Exit 1: it did not (misconfigured, or the fail-closed gate regressed) --
#         or the instance could not be reached at all.
set -u

BASE_URL="${1:?Usage: smoke-test-proxy-secret.sh <base-url>}"

status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$BASE_URL/api/consoles/auto-invite/start" \
  -H "content-type: application/json" \
  -d '{"consoleUrl":"https://smoke-test.invalid"}')"
curl_exit=$?

if [ "$curl_exit" -ne 0 ]; then
  echo "smoke-test-proxy-secret: could not reach $BASE_URL/api/consoles/auto-invite/start (curl exit $curl_exit) -- is the instance up?"
  exit 1
fi

if [ "$status" = "403" ]; then
  echo "smoke-test-proxy-secret: OK -- unauthenticated request to /api/consoles/auto-invite/start correctly rejected with 403."
  exit 0
fi

echo "smoke-test-proxy-secret: SECURITY GAP -- unauthenticated request to /api/consoles/auto-invite/start returned $status, expected 403."
echo "The fail-closed gate (requireProxySecretFailClosed) may have regressed on this route. Investigate before treating this deploy as safe."
exit 1
