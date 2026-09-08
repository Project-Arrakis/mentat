#!/usr/bin/env bash
# Regenerates assets/qr/invite-hosted.svg -- the QR code for the hosted
# bot's Discord invite URL, embedded in docs/installation-guide.md and
# (as an identical copy, same convention as public/js/sand.js) mentat-link's
# homepage. This URL is static (fixed client_id, scope, and permissions --
# see src/commands.js's setupPayload() for the source of truth), so a
# generated-once static asset is correct here, not a runtime-rendered one.
#
# Re-run this ONLY if the invite URL's client_id, scope, or permissions
# ever change (e.g. a future Discord Application ID rotation, or another
# permissions=N fix like issue #281's). Verifies its own output by decoding
# the generated SVG back to plaintext and diffing against the intended URL
# -- never trust a generated QR code without decoding it back, since a
# subtly wrong encoding (wrong error-correction level, truncated input)
# can still *look* like a valid QR code to the eye.
set -euo pipefail

cd "$(dirname "$0")/.."

INVITE_URL="https://discord.com/oauth2/authorize?client_id=1546203607807041697&scope=bot%20applications.commands&permissions=128"
OUT_SVG="assets/qr/invite-hosted.svg"

command -v npx >/dev/null || { echo "npx not found" >&2; exit 1; }
command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found (apt-get install librsvg2-bin)" >&2; exit 1; }
command -v zbarimg >/dev/null || { echo "zbarimg not found (apt-get install zbar-tools)" >&2; exit 1; }

mkdir -p assets/qr
npx --yes qrcode "$INVITE_URL" -t svg -w 300 -e M -o "$OUT_SVG"

TMP_PNG="$(mktemp --suffix=.png)"
trap 'rm -f "$TMP_PNG"' EXIT
rsvg-convert -w 600 -h 600 "$OUT_SVG" -o "$TMP_PNG"
DECODED="$(zbarimg --raw "$TMP_PNG")"

if [ "$DECODED" != "$INVITE_URL" ]; then
  echo "FAILED: decoded QR content does not match the intended invite URL" >&2
  echo "  expected: $INVITE_URL" >&2
  echo "  decoded:  $DECODED" >&2
  exit 1
fi

echo "OK: $OUT_SVG verified -- decodes back to the exact invite URL"
