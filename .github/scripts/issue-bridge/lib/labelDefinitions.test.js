import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, HARD_CODED_FORBIDDEN_PUBLIC_LABELS } from "./config.mjs";
import { PRIVATE_LABELS, PUBLIC_LABELS } from "./labelDefinitions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "..", "..", ".github", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);

const REQUIRED_PUBLIC = [
  "type:bug", "type:feature", "type:documentation", "type:support", "type:compatibility", "type:performance",
  "status:needs-triage", "status:confirmed", "status:planned", "status:in-progress", "status:blocked",
  "status:testing", "status:ready-for-release", "status:released",
  "priority:p0", "priority:p1", "priority:p2", "priority:p3",
  "area:discord", "area:commands", "area:readiness", "area:metrics", "area:notifications", "area:deployment",
  "area:documentation", "area:authentication", "area:permissions", "area:observability", "area:webui", "area:api"
];

const REQUIRED_PRIVATE = [
  "source:public", "source:internal",
  "visibility:internal", "visibility:security-sensitive",
  "sync:enabled", "sync:paused", "sync:error",
  "status:triaged", "status:confirmed", "status:planned", "status:in-progress", "status:blocked",
  "status:testing", "status:ready-for-release", "status:released", "status:public-closed",
  "priority:p0", "priority:p1", "priority:p2", "priority:p3"
];

test("public label taxonomy matches spec section 12 exactly", () => {
  const names = PUBLIC_LABELS.map((l) => l.name).sort();
  assert.deepEqual(names, [...REQUIRED_PUBLIC].sort());
});

test("private label taxonomy is a superset of spec section 13", () => {
  const names = new Set(PRIVATE_LABELS.map((l) => l.name));
  for (const required of REQUIRED_PRIVATE) {
    assert.ok(names.has(required), `missing private label: ${required}`);
  }
});

test("every label has a valid 6-hex-digit color and a non-empty description", () => {
  for (const label of [...PUBLIC_LABELS, ...PRIVATE_LABELS]) {
    assert.match(label.color, /^[0-9a-f]{6}$/, `${label.name} color`);
    assert.ok(label.description && label.description.length > 0, `${label.name} description`);
  }
});

test("no label name is duplicated within a taxonomy", () => {
  for (const [name, labels] of [["public", PUBLIC_LABELS], ["private", PRIVATE_LABELS]]) {
    const names = labels.map((l) => l.name);
    assert.equal(new Set(names).size, names.length, `${name} taxonomy has a duplicate`);
  }
});

test("SEC: none of the hard-coded forbidden control labels appear in the PUBLIC taxonomy", () => {
  const publicNames = new Set(PUBLIC_LABELS.map((l) => l.name));
  for (const forbidden of HARD_CODED_FORBIDDEN_PUBLIC_LABELS) {
    assert.equal(publicNames.has(forbidden), false, `${forbidden} must not be a public label`);
  }
});

test("every config.label_mapping value exists in the private taxonomy", () => {
  const privateNames = new Set(PRIVATE_LABELS.map((l) => l.name));
  for (const priv of Object.values(config.label_mapping)) {
    assert.ok(privateNames.has(priv), `label_mapping target "${priv}" is not defined in PRIVATE_LABELS`);
  }
});

test("every config.label_mapping key exists in the public taxonomy", () => {
  const publicNames = new Set(PUBLIC_LABELS.map((l) => l.name));
  for (const pub of Object.keys(config.label_mapping)) {
    assert.ok(publicNames.has(pub), `label_mapping source "${pub}" is not defined in PUBLIC_LABELS`);
  }
});
