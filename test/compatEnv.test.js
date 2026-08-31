import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCompatEnv } from "../src/compatEnv.js";

// Captures real console.warn calls so tests assert against what the code
// path would actually emit in production, not against the warning
// template's source. Per the Phase 3 design's QA-hat finding: a test that
// only inspects the template for a missing interpolation slot proves
// nothing about whether a real value can leak through some other path.
function captureWarnings(fn) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

test("compatEnv: MENTAT_* wins when both canonical and legacy are set", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv({ MENTAT_DB_PATH: "data/mentat.db", ACP_DB_PATH: "data/acp.db" }, "DB_PATH");
    assert.equal(value, "data/mentat.db");
  });
  assert.equal(calls.length, 1, "should warn once that the legacy alias is being ignored");
  assert.match(calls[0], /compat-env-ignored-legacy/);
  assert.match(calls[0], /ACP_DB_PATH/);
});

test("compatEnv: legacy alias works when MENTAT_* is absent", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv({ ACP_DB_PATH: "data/acp.db" }, "DB_PATH");
    assert.equal(value, "data/acp.db");
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /compat-env-deprecated/);
  assert.match(calls[0], /ACP_DB_PATH/);
});

test("compatEnv: nothing set resolves to undefined, no warning", () => {
  const calls = captureWarnings(() => {
    assert.equal(resolveCompatEnv({}, "DB_PATH"), undefined);
  });
  assert.equal(calls.length, 0);
});

test("compatEnv: a present-but-empty MENTAT_* is treated as not set (falls through to legacy)", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv({ MENTAT_DB_PATH: "", ACP_DB_PATH: "data/acp.db" }, "DB_PATH");
    assert.equal(value, "data/acp.db");
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /compat-env-deprecated/);
});

test("compatEnv: three-way conflict — SENTINEL_* wins over ACP_* when both set to different values", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv(
      { SENTINEL_DB_PATH: "data/sentinel.db", ACP_DB_PATH: "data/acp.db" },
      "DB_PATH"
    );
    assert.equal(value, "data/sentinel.db");
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /compat-env-conflict/);
  assert.match(calls[0], /SENTINEL_DB_PATH/);
  assert.match(calls[0], /ACP_DB_PATH/);
});

test("compatEnv: SENTINEL_* and ACP_* set to the SAME value is a plain deprecation, not a conflict", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv(
      { SENTINEL_DB_PATH: "data/shared.db", ACP_DB_PATH: "data/shared.db" },
      "DB_PATH"
    );
    assert.equal(value, "data/shared.db");
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /compat-env-deprecated/);
  assert.doesNotMatch(calls[0], /compat-env-conflict/);
});

test("compatEnv: urlShaped canonical value that's malformed falls back to a working legacy value", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv(
      { MENTAT_OAUTH_REDIRECT_URI: "not-a-url", ACP_OAUTH_REDIRECT_URI: "https://example.com/callback" },
      "OAUTH_REDIRECT_URI",
      { urlShaped: true }
    );
    assert.equal(value, "https://example.com/callback");
  });
  assert.equal(calls.length, 2, "should warn about the invalid canonical AND the legacy fallback it used");
  assert.ok(calls.some((c) => /compat-env-invalid-canonical/.test(c)));
  assert.ok(calls.some((c) => /compat-env-deprecated/.test(c)));
});

test("compatEnv: urlShaped canonical malformed with no legacy present resolves to undefined (fails closed)", () => {
  const value = resolveCompatEnv({ MENTAT_OAUTH_REDIRECT_URI: "not-a-url" }, "OAUTH_REDIRECT_URI", { urlShaped: true });
  assert.equal(value, undefined);
});

test("compatEnv: a valid urlShaped canonical value is used as-is", () => {
  const value = resolveCompatEnv({ MENTAT_BASE_URL: "https://mentat.example.com" }, "BASE_URL", { urlShaped: true });
  assert.equal(value, "https://mentat.example.com");
});

test("compatEnv: never logs the actual value — only variable names — even for a realistic secret-shaped value", () => {
  // A realistic 64-hex-char key, matching the real ACP_SECRETS_KEY format
  // this project uses elsewhere (secretsCrypto.js) — proves a genuine
  // value can't leak through captured output, not just that the template
  // has no interpolation slot for it.
  const REALISTIC_SECRET = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv(
      { ACP_SECRETS_KEY: REALISTIC_SECRET },
      "SECRETS_KEY"
    );
    assert.equal(value, REALISTIC_SECRET);
  });
  assert.equal(calls.length, 1);
  for (const call of calls) {
    assert.ok(!call.includes(REALISTIC_SECRET), "captured warning output must never contain the real secret value");
  }
});

// A future credential variable (e.g. ACP_SECRETS_KEY) would opt in with
// options.validate — there is no generic "credential shape" this module
// can check on its own. These tests exercise that fail-closed path
// directly, since a bare `credential: true` flag with no validator was
// found (Layer 2 audit) to silently accept any non-empty value.
const HEX_64 = (value) => /^[0-9a-f]{64}$/i.test(value);

test("compatEnv: validate() rejects a malformed canonical value and falls back to a working legacy value", () => {
  const REAL_KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv(
      { MENTAT_SECRETS_KEY: "not-a-valid-hex-key", ACP_SECRETS_KEY: REAL_KEY },
      "SECRETS_KEY",
      { validate: HEX_64 }
    );
    assert.equal(value, REAL_KEY);
  });
  assert.equal(calls.length, 2, "should warn about the invalid canonical AND the legacy fallback it used");
  assert.ok(calls.some((c) => /compat-env-invalid-canonical/.test(c)));
  assert.ok(calls.some((c) => /compat-env-deprecated/.test(c)));
  for (const call of calls) {
    assert.ok(!call.includes(REAL_KEY), "captured warning output must never contain the real secret value");
    assert.ok(!call.includes("not-a-valid-hex-key"), "captured warning output must never contain the invalid attempted value either");
  }
});

test("compatEnv: validate() rejects a malformed canonical value with no legacy present — resolves to undefined (fails closed)", () => {
  const value = resolveCompatEnv({ MENTAT_SECRETS_KEY: "not-a-valid-hex-key" }, "SECRETS_KEY", { validate: HEX_64 });
  assert.equal(value, undefined);
});

test("compatEnv: validate() accepts a well-formed canonical value as-is", () => {
  const REAL_KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const value = resolveCompatEnv({ MENTAT_SECRETS_KEY: REAL_KEY }, "SECRETS_KEY", { validate: HEX_64 });
  assert.equal(value, REAL_KEY);
});

test("compatEnv: canonical present and valid, BOTH legacy aliases set — both are named in the ignored-legacy warning", () => {
  const calls = captureWarnings(() => {
    const value = resolveCompatEnv(
      { MENTAT_DB_PATH: "data/mentat.db", SENTINEL_DB_PATH: "data/sentinel.db", ACP_DB_PATH: "data/acp.db" },
      "DB_PATH"
    );
    assert.equal(value, "data/mentat.db");
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /compat-env-ignored-legacy/);
  assert.match(calls[0], /SENTINEL_DB_PATH/);
  assert.match(calls[0], /ACP_DB_PATH/);
});

test("compatEnv: whitespace-only value is treated as not set", () => {
  const value = resolveCompatEnv({ MENTAT_DB_PATH: "   ", ACP_DB_PATH: "data/acp.db" }, "DB_PATH");
  assert.equal(value, "data/acp.db");
});
