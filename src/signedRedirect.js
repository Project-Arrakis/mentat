// signedRedirect.js -- signs the redirect mentat's /api/consoles/auto-invite/
// callback issues toward mentat-link's bounce page (mentat#343+, Phase 3 of
// dune-awakening-selfhost-docker#832's design, §4.1/§4.4/§4.5).
//
// Construction matches the design doc's round-3 revision EXACTLY (issues
// #862/#863/#864) -- this mechanism has been wrong three separate times
// across three audit rounds before landing here, per that doc's own §12
// closing note. Do not "simplify" this back toward a delimiter-joined
// string or a directly-reused shared secret; both were tried and rejected
// for concrete, documented reasons:
//   - #862: a `|`-joined string is delimiter-ambiguous when consoleUrl/
//     guildName can themselves contain `|` (both are attacker-influenceable
//     in the self-driving-attacker case this design's threat model
//     considers). Canonical JSON with a FIXED key order eliminates the
//     collision class entirely rather than trying to escape `|` within it.
//   - #863: reusing MENTAT_PROXY_SHARED_SECRET directly as the HMAC key
//     means a leak via the more exposure-prone hop-auth-header channel
//     (sent on every proxied request) would let an attacker forge a valid
//     signed redirect to ANY destination through the trusted
//     mentat-link.darkdante.org domain. A distinct derived key closes that.
// The verifier lives in mentat-link's functions/_lib/atriumAuth.js sibling
// (functions/_lib/autoInviteSignature.js) -- BOTH sides must derive the
// identical key and construct the identical canonical JSON, or every
// signature will simply fail to verify. Mirrors mentat-link#163's
// deriveSigningKey() pattern intentionally, not by coincidence.
import { createHash, createHmac } from "node:crypto";
import { proxySharedSecret } from "./proxyAuth.js";

const SIGNING_KEY_CONTEXT = ":auto-invite-redirect-signing-v1";
// #864: 2 minutes, plus a separate 30s clock-skew tolerance applied by the
// VERIFIER (mentat and the Cloudflare Pages Function run on independent
// clocks) -- this redirect is consumed within milliseconds by the browser
// executing the bounce page's own script, so a short window bounds replay
// without being tight enough to cause real-world clock-drift false
// rejections.
const EXP_WINDOW_MS = 2 * 60 * 1000;

function deriveSigningKey(sharedSecret) {
  return createHash("sha256").update(`${sharedSecret}${SIGNING_KEY_CONTEXT}`).digest();
}

// Fixed key order -- JSON.stringify on a plain object literal with string
// keys preserves insertion order deterministically in both V8 (mentat) and
// the Workers runtime (mentat-link), so as long as both sides build this
// EXACT object literal (not a dynamically-assembled one), the two
// canonicalizations are guaranteed byte-identical for the same field values.
// Phase 2b (dune-awakening-selfhost-docker#876, design doc §13, issue #885):
// `confirmationId` added as an 8th field. Same fixed-key-order object
// literal discipline as every other field -- do not reorder or make this
// dynamically assembled. Rollout order matters: mentat-link's verifier
// must be updated to include this key (tolerant of it being empty) BEFORE
// this signer starts sending real, non-empty values, or every signed
// redirect fails verification during the gap between an uncoordinated
// deploy on either side.
function canonicalPayload({ consoleUrl, state, ok, guildName, reason, reclaimed, exp, confirmationId }) {
  return JSON.stringify({ consoleUrl, state, ok, guildName, reason, reclaimed, exp, confirmationId });
}

// signAutoInviteRedirect: returns the full field set (including the freshly
// minted `exp`) plus `sig`, ready to be serialized as query-string
// parameters on the redirect to mentat-link's /api/consoles/auto-invite/
// return. `ok`/`reclaimed` are coerced to real booleans and `reason`/
// `guildName` default to empty string (never `undefined`, which
// JSON.stringify would silently drop from the object, changing which keys
// exist between a success and failure payload and reopening a form of the
// #862 canonicalization problem).
export function signAutoInviteRedirect(fields, { sharedSecret = proxySharedSecret() } = {}) {
  // Layer 2 audit finding, CRITICAL: MENTAT_PROXY_SHARED_SECRET is
  // DOCUMENTED as safe to leave unset (proxyAuth.js's own comment:
  // "deliberately a no-op... so this ships and deploys safely before the
  // secret exists on either side") for its OTHER, lower-stakes uses (hop-
  // auth headers on routes like /health, /api/alerts/relay). For THIS
  // mechanism specifically, that same "unset is safe" default is
  // catastrophic: an empty sharedSecret makes deriveSigningKey() compute
  // SHA-256(":auto-invite-redirect-signing-v1") -- a value anyone who has
  // read this open-source code can compute themselves, with zero secret
  // knowledge, since the context string is public. Independently
  // reproduced: sha256("" + ":auto-invite-redirect-signing-v1") is fully
  // public/predictable, and mentat-link's verifier would derive the
  // IDENTICAL key from the SAME unset default -- letting anyone forge a
  // validly-"signed" redirect to an arbitrary consoleUrl, fully defeating
  // the open-redirect fix (issue #845) this entire mechanism exists to
  // close. Refusing to sign at all when the secret is unconfigured is the
  // only safe behavior -- this feature must not function during the
  // "secret not yet provisioned" rollout window design doc §8 phase 8
  // already requires verifying before real exposure; failing loudly here
  // makes that requirement self-enforcing rather than relying solely on
  // an operator remembering to check.
  if (!sharedSecret) {
    throw new Error("signAutoInviteRedirect: MENTAT_PROXY_SHARED_SECRET is not configured -- refusing to sign with a predictable, publicly-derivable key.");
  }
  const exp = Date.now() + EXP_WINDOW_MS;
  const payload = {
    consoleUrl: fields.consoleUrl || "",
    state: fields.state || "",
    ok: Boolean(fields.ok),
    guildName: fields.guildName || "",
    reason: fields.reason || "",
    reclaimed: Boolean(fields.reclaimed),
    exp,
    confirmationId: fields.confirmationId || ""
  };
  const canonical = canonicalPayload(payload);
  const key = deriveSigningKey(sharedSecret);
  const sig = createHmac("sha256", key).update(canonical).digest("hex");
  return { ...payload, sig };
}
