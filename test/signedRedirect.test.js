// signedRedirect.test.js -- mentat#343+ Phase 3. Two tests explicitly
// required by the design doc's §11 (round-3 additions, issues #862/#863).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac } from "node:crypto";
import { signAutoInviteRedirect } from "../src/signedRedirect.js";

const SHARED_SECRET = "test-shared-secret-value";

// ─── issue #862: canonical JSON eliminates the delimiter-collision class a
// `|`-joined string construction would have had ─────────────────────────

test("canonicalization: inputs that would collide under a naive |-joined construction produce genuinely DIFFERENT signatures", () => {
  // Under a `${consoleUrl}|${guildName}` construction, these two field sets
  // serialize to the identical string ("a|b|c|d") despite having different
  // real field boundaries -- the exact collision class #862 exists to close.
  const a = signAutoInviteRedirect({ consoleUrl: "a", state: "s", ok: true, guildName: "b|c|d" }, { sharedSecret: SHARED_SECRET });
  const b = signAutoInviteRedirect({ consoleUrl: "a|b", state: "s", ok: true, guildName: "c|d" }, { sharedSecret: SHARED_SECRET });
  assert.notEqual(a.sig, b.sig, "canonical JSON must not collide the way a delimiter-joined string would");
});

test("canonicalization: identical field values (down to exp) produce identical signatures -- the construction is deterministic, not just non-colliding", () => {
  const fixedNow = 1_000_000;
  const original = Date.now;
  Date.now = () => fixedNow;
  try {
    const a = signAutoInviteRedirect({ consoleUrl: "https://console.test", state: "s1", ok: true, guildName: "Real Guild" }, { sharedSecret: SHARED_SECRET });
    const b = signAutoInviteRedirect({ consoleUrl: "https://console.test", state: "s1", ok: true, guildName: "Real Guild" }, { sharedSecret: SHARED_SECRET });
    assert.equal(a.sig, b.sig);
    assert.equal(a.exp, b.exp);
  } finally {
    Date.now = original;
  }
});

// ─── issue #863: the signing key is a derived digest, not the raw shared
// secret reused directly ──────────────────────────────────────────────────

test("key derivation: the signature is NOT computable from the raw shared secret used directly as the HMAC key -- the derivation step is real, not a no-op", () => {
  const signed = signAutoInviteRedirect({ consoleUrl: "https://console.test", state: "s1", ok: true, guildName: "Real Guild" }, { sharedSecret: SHARED_SECRET });

  const naivePayload = JSON.stringify({
    consoleUrl: signed.consoleUrl,
    state: signed.state,
    ok: signed.ok,
    guildName: signed.guildName,
    reason: signed.reason,
    reclaimed: signed.reclaimed,
    exp: signed.exp
  });
  const naiveSig = createHmac("sha256", SHARED_SECRET).update(naivePayload).digest("hex");
  assert.notEqual(signed.sig, naiveSig, "the raw shared secret must not be usable directly as the HMAC key");
});

test("key derivation: the derived key is a fixed function of the shared secret + a distinct context string, matching the same pattern already shipped for mentat-link's Atrium tool", () => {
  const expectedKey = createHash("sha256").update(`${SHARED_SECRET}:auto-invite-redirect-signing-v1`).digest();
  const signed = signAutoInviteRedirect({ consoleUrl: "https://console.test", state: "s1", ok: true, guildName: "Real Guild" }, { sharedSecret: SHARED_SECRET });
  const payload = JSON.stringify({
    consoleUrl: signed.consoleUrl,
    state: signed.state,
    ok: signed.ok,
    guildName: signed.guildName,
    reason: signed.reason,
    reclaimed: signed.reclaimed,
    exp: signed.exp
  });
  const recomputed = createHmac("sha256", expectedKey).update(payload).digest("hex");
  assert.equal(signed.sig, recomputed, "the exact derivation formula must be SHA-256(sharedSecret + context), reproducible independently");
});

// ─── Field defaults/coercion ───────────────────────────────────────────────

test("ok/reclaimed are always real booleans in the signed payload, reason/guildName default to empty string rather than undefined", () => {
  const signed = signAutoInviteRedirect({ state: "s1", ok: false, reason: "expired" }, { sharedSecret: SHARED_SECRET });
  assert.equal(signed.ok, false);
  assert.equal(signed.reclaimed, false);
  assert.equal(signed.guildName, "");
  assert.equal(signed.reason, "expired");
  assert.equal(typeof signed.exp, "number");
});

test("exp is set roughly 2 minutes in the future", () => {
  const before = Date.now();
  const signed = signAutoInviteRedirect({ state: "s1", ok: true }, { sharedSecret: SHARED_SECRET });
  const after = Date.now();
  assert.ok(signed.exp >= before + 119_000 && signed.exp <= after + 121_000, "exp must be ~2 minutes out");
});

// ─── Layer 2 audit finding, CRITICAL: refuses to sign at all when the
// shared secret is unconfigured -- an empty secret is otherwise a
// publicly-computable key on both ends of this signature ─────────────────

test("throws rather than signing with a predictable key when sharedSecret is empty", () => {
  assert.throws(() => signAutoInviteRedirect({ state: "s1", ok: true }, { sharedSecret: "" }), /MENTAT_PROXY_SHARED_SECRET is not configured/);
});

test("throws when sharedSecret is not passed at all and proxySharedSecret() itself resolves empty", () => {
  const original = process.env.MENTAT_PROXY_SHARED_SECRET;
  delete process.env.MENTAT_PROXY_SHARED_SECRET;
  delete process.env.MENTAT_PROXY_SHARED_SECRET_FILE;
  try {
    assert.throws(() => signAutoInviteRedirect({ state: "s1", ok: true }), /MENTAT_PROXY_SHARED_SECRET is not configured/);
  } finally {
    if (original !== undefined) process.env.MENTAT_PROXY_SHARED_SECRET = original;
  }
});
