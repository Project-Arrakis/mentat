import { test } from "node:test";
import assert from "node:assert/strict";
import { AdapterHttpError } from "../src/adapterClient.js";
import { mapWriteError } from "../src/writeErrorMapping.js";

function coreError(status, code, message) {
  return new AdapterHttpError(`Adapter write-execute returned HTTP ${status}.`, { status, route: "write-execute", body: { ok: false, code, error: message } });
}

test("mapWriteError: maps every one of the 12 real Core write-bridge error codes to a specific message", () => {
  // [Audit fix: QA, MEDIUM] Revision 1 only tested 8 of 10 documented
  // codes, contradicting the design's own "one dedicated test per row"
  // promise -- unknown_write_action/invalid_parameters and
  // nonce_action_mismatch/invalid_actor_signature are added here. The
  // design doc's table itself was later corrected from "10" to the real
  // 12 distinct codes (one row bundles stale_actor_signature/
  // invalid_actor_signature) -- this test's case list already covers all
  // 12; only the surrounding prose's stale "10" count needed fixing.
  //
  // [Audit fix: QA, MEDIUM round 3] Several rows' MOCK Core message text
  // happened to already satisfy that row's own expectedPattern
  // (nonce_not_found's mock literally said "expired"; second_confirmation_
  // required's mock literally said "second"; etc.) -- meaning the
  // assertion would still pass even if the corresponding MESSAGES table
  // entry in writeErrorMapping.js were deleted entirely and the code fell
  // through to the generic fallback (which just echoes Core's raw
  // message). That doesn't prove the MESSAGES lookup is what produced the
  // match. Every mock message below for a row with a real (non-null)
  // MESSAGES entry is now deliberately generic/unrelated wording, so a
  // pass can only happen if the real MESSAGES[code] text is what's
  // actually returned. `invalid_parameters` is the one deliberate
  // exception -- its MESSAGES entry is `null` (pass-through by design),
  // so its mock message intentionally *is* what's expected back verbatim.
  const cases = [
    ["writes_disabled", "core says nope", 403, /disabled/i],
    ["not_authorized", "core says denied", 403, /permission/i],
    // [Audit fix: QA round 3, found by actually RUNNING this test against
    // the real code, not just reading it] The real MESSAGES text says
    // "isn't available", not "not available" -- the original pattern
    // never matched it and this row was silently broken from the start,
    // regardless of any tautology question. Caught only by execution.
    ["unknown_write_action", "core says huh", 400, /isn't available/i],
    ["invalid_parameters", "bad params", 400, /bad params/i],
    ["nonce_not_found", "core says gone", 410, /expired/i],
    ["nonce_actor_mismatch", "core says nope-2", 403, /wasn't issued to you|not issued to you/i],
    ["nonce_action_mismatch", "core says wrong-action", 409, /internal error|action does not match|mismatch/i],
    ["second_confirmation_required", "core says wait", 202, /second/i],
    ["second_confirmation_same_actor", "core says no-same-actor", 403, /different administrator/i],
    ["stale_actor_signature", "core says old", 403, /role info expired|run the command again/i],
    ["invalid_actor_signature", "core says bad-sig", 403, /could not be verified|run the command again/i],
    ["write_backend_unavailable", "core says down", 503, /temporarily unavailable/i]
  ];
  for (const [code, message, status, expectedPattern] of cases) {
    const result = mapWriteError(coreError(status, code, message));
    assert.match(result.description, expectedPattern, `code ${code} produced: ${result.description}`);
  }
});

test("mapWriteError: an unrecognized error code falls back to a generic-but-real message, never throws", () => {
  const result = mapWriteError(coreError(400, "totally_unknown_code", "something"));
  assert.ok(result.title);
  assert.ok(result.description);
});

test("mapWriteError: a non-AdapterHttpError (e.g. network failure) is handled without throwing", () => {
  const result = mapWriteError(new Error("fetch failed"));
  assert.ok(result.title);
  assert.ok(result.description);
});
