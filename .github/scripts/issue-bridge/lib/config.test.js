import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ConfigValidationError,
  forbiddenPublicLabels,
  HARD_CODED_FORBIDDEN_PUBLIC_LABELS,
  loadConfig,
  loadConfigFromString
} from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const REAL_CONFIG_PATH = join(REPO_ROOT, ".github", "acp-issue-bridge.yml");

test("loads and validates the real repo config file", () => {
  const config = loadConfig(REAL_CONFIG_PATH);
  assert.equal(config.version, 1);
  assert.equal(config.repositories.public, "Project-Arrakis/acp-discordbot");
  assert.equal(config.repositories.private, "Project-Arrakis/sentinel");
  assert.equal(config.commands.security_clear, "/security-clear");
  assert.equal(config.permissions.security_clear, "admin");
});

test("real config's label_mapping never references forbidden control labels", () => {
  const config = loadConfig(REAL_CONFIG_PATH);
  const forbidden = forbiddenPublicLabels(config);
  for (const [pub, priv] of Object.entries(config.label_mapping)) {
    assert.equal(forbidden.has(pub), false, `public label "${pub}" must not be forbidden`);
    assert.equal(forbidden.has(priv), false, `mapped private label "${priv}" must not be forbidden`);
  }
});

test("real config's label_mapping excludes all status:* labels", () => {
  const config = loadConfig(REAL_CONFIG_PATH);
  for (const pub of Object.keys(config.label_mapping)) {
    assert.equal(pub.startsWith("status:"), false, `label_mapping must not include ${pub}`);
  }
});

test("forbiddenPublicLabels always includes the hard-coded minimum", () => {
  const config = loadConfig(REAL_CONFIG_PATH);
  const forbidden = forbiddenPublicLabels(config);
  for (const label of HARD_CODED_FORBIDDEN_PUBLIC_LABELS) {
    assert.equal(forbidden.has(label), true, `${label} must be forbidden`);
  }
});

const MINIMAL_VALID = `
version: 1
repositories:
  public: yacketrj/acp-discordbot
  private: yacketrj/arrakis-control-panel
sync:
  public_issue_create: true
  public_issue_edit: true
  public_comment_create: true
  public_close: true
  public_reopen: true
  public_labels: true
  private_default_publish: false
  private_close_closes_public: false
commands:
  internal: /internal
  public: /public
  public_status: /public-status
  resolution: /public-resolution
  security: /security
  security_clear: /security-clear
  pause: /sync-pause
  resume: /sync-resume
permissions:
  publish: maintain
  public_status: maintain
  resolution: maintain
  pause: maintain
  resume: maintain
  security: write
  security_clear: admin
security:
  fail_closed: true
  secret_detection: true
  block_private_urls: true
  suppress_mentions: true
labels:
  sync_enabled: sync:enabled
  sync_paused: sync:paused
  sync_error: sync:error
  security_sensitive: visibility:security-sensitive
  source_public: source:public
  source_internal: source:internal
  visibility_internal: visibility:internal
  public_closed: status:public-closed
status_labels:
  confirmed: status:confirmed
  planned: status:planned
  in-progress: status:in-progress
  blocked: status:blocked
  testing: status:testing
  ready-for-release: status:ready-for-release
  released: status:released
never_expose_publicly:
  l01: visibility:internal
  l02: visibility:security-sensitive
  l03: sync:enabled
  l04: sync:paused
  l05: sync:error
  l06: source:internal
  l07: source:public
label_mapping:
  "type:bug": "type:bug"
`;

test("minimal valid config loads without error", () => {
  const config = loadConfigFromString(MINIMAL_VALID);
  assert.equal(config.version, 1);
});

test("rejects unsupported schema version", () => {
  const bad = MINIMAL_VALID.replace("version: 1", "version: 2");
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects missing required string field", () => {
  const bad = MINIMAL_VALID.replace("  public: yacketrj/acp-discordbot\n", "");
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects malformed repository slug", () => {
  const bad = MINIMAL_VALID.replace("yacketrj/acp-discordbot", "not-a-slug");
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects command tokens that don't start with /", () => {
  const bad = MINIMAL_VALID.replace("internal: /internal", "internal: internal");
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects invalid permission levels", () => {
  const bad = MINIMAL_VALID.replace("security_clear: admin", "security_clear: superadmin");
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects arbitrary public-status states", () => {
  const bad = MINIMAL_VALID.replace(
    "status_labels:\n  confirmed: status:confirmed",
    "status_labels:\n  confirmed: status:confirmed\n  made-up-state: status:made-up"
  );
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects label_mapping entries that reference forbidden control labels", () => {
  const bad = MINIMAL_VALID.replace(
    'label_mapping:\n  "type:bug": "type:bug"',
    'label_mapping:\n  "type:bug": "sync:enabled"'
  );
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects label_mapping entries for status:* labels", () => {
  const bad = MINIMAL_VALID.replace(
    'label_mapping:\n  "type:bug": "type:bug"',
    'label_mapping:\n  "status:confirmed": "status:confirmed"'
  );
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("rejects a never_expose_publicly list that drops a hard-coded label", () => {
  const bad = MINIMAL_VALID.replace("  l07: source:public\n", "");
  assert.throws(() => loadConfigFromString(bad), ConfigValidationError);
});

test("loaded config is deeply frozen", () => {
  const config = loadConfigFromString(MINIMAL_VALID);
  assert.throws(() => { config.version = 2; }, TypeError);
  assert.throws(() => { config.repositories.public = "x/y"; }, TypeError);
});
