import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, HARD_CODED_FORBIDDEN_PUBLIC_LABELS } from "./config.mjs";
import {
  defaultPrivateMirrorLabels,
  isForbiddenPublicLabel,
  mapPublicLabelToPrivate,
  translateAllowlistedLabels
} from "./labelMap.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "..", "..", ".github", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);

test("maps an allowlisted public label to its private equivalent", () => {
  assert.equal(mapPublicLabelToPrivate(config, "type:bug"), "type:bug");
  assert.equal(mapPublicLabelToPrivate(config, "priority:p0"), "priority:p0");
  assert.equal(mapPublicLabelToPrivate(config, "area:webui"), "area:webui");
});

test("returns null (ignore) for a label that is not on the allowlist", () => {
  assert.equal(mapPublicLabelToPrivate(config, "good first issue"), null);
  assert.equal(mapPublicLabelToPrivate(config, "wontfix"), null);
  assert.equal(mapPublicLabelToPrivate(config, "status:confirmed"), null);
});

test("every hard-coded forbidden label is recognized as forbidden", () => {
  for (const label of HARD_CODED_FORBIDDEN_PUBLIC_LABELS) {
    assert.equal(isForbiddenPublicLabel(config, label), true, label);
  }
});

test("default private mirror labels are exactly source:public, visibility:internal, sync:enabled", () => {
  assert.deepEqual(defaultPrivateMirrorLabels(config), [
    "source:public",
    "visibility:internal",
    "sync:enabled"
  ]);
});

test("translateAllowlistedLabels ignores non-allowlisted labels and maps the rest", () => {
  const result = translateAllowlistedLabels(config, ["type:bug", "good first issue", "priority:p1", "duplicate"]);
  assert.deepEqual(result.sort(), ["priority:p1", "type:bug"].sort());
});

// Negative tests required by spec section 15: "Write automated negative
// tests for each one" for every label that must never be exposed publicly.
for (const label of [
  "visibility:internal",
  "visibility:security-sensitive",
  "sync:enabled",
  "sync:paused",
  "sync:error",
  "source:internal",
  "source:public"
]) {
  test(`SEC: "${label}" is never mappable from a public label and is always forbidden`, () => {
    assert.equal(isForbiddenPublicLabel(config, label), true);
    // No public label in the allowlist maps TO this private label.
    for (const priv of Object.values(config.label_mapping)) {
      assert.notEqual(priv, label);
    }
    // This label itself is never a valid public-side key either.
    assert.equal(Object.prototype.hasOwnProperty.call(config.label_mapping, label), false);
  });
}

test("translateAllowlistedLabels never returns a forbidden label even under a hostile/misconfigured mapping", () => {
  // Defense in depth: even if a future edit to label_mapping tried to sneak
  // a forbidden label through (config.mjs's validator would already reject
  // this at load time — this test exercises the second, independent guard
  // in labelMap.mjs itself).
  const hostileConfig = {
    ...config,
    label_mapping: { ...config.label_mapping, "type:bug": "sync:enabled" }
  };
  const result = translateAllowlistedLabels(config, ["type:bug"]);
  assert.deepEqual(result, ["type:bug"]); // untouched: real config maps type:bug -> type:bug
  const result2 = translateAllowlistedLabels(hostileConfig, ["type:bug"]);
  assert.deepEqual(result2, []); // hostile mapping is filtered out, not passed through
});
