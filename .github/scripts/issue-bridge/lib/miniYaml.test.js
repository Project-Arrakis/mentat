import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigParseError, parseSimpleYaml } from "./miniYaml.mjs";

test("parses nested block mappings with scalars", () => {
  const doc = parseSimpleYaml(`
version: 1

repositories:
  public: yacketrj/acp-discordbot
  private: yacketrj/arrakis-control-panel

sync:
  public_issue_create: true
  private_default_publish: false
  max_retries: 4
`);

  assert.deepEqual(doc, {
    version: 1,
    repositories: {
      public: "yacketrj/acp-discordbot",
      private: "yacketrj/arrakis-control-panel"
    },
    sync: {
      public_issue_create: true,
      private_default_publish: false,
      max_retries: 4
    }
  });
});

test("supports quoted keys and values containing colons", () => {
  const doc = parseSimpleYaml(`
label_mapping:
  "type:bug": "type:bug"
  "priority:p0": "priority:p0"

labels:
  sync_enabled: sync:enabled
`);

  assert.deepEqual(doc, {
    label_mapping: {
      "type:bug": "type:bug",
      "priority:p0": "priority:p0"
    },
    labels: {
      sync_enabled: "sync:enabled"
    }
  });
});

test("ignores comments and blank lines", () => {
  const doc = parseSimpleYaml(`
# top comment
version: 1  # inline note

# section
sync:
  # nested comment
  public_issue_create: true
`);
  assert.deepEqual(doc, { version: 1, sync: { public_issue_create: true } });
});

test("rejects tabs", () => {
  assert.throws(() => parseSimpleYaml("a:\n\tb: 1\n"), ConfigParseError);
});

test("rejects sequences", () => {
  assert.throws(() => parseSimpleYaml("a:\n  - one\n  - two\n"), ConfigParseError);
});

test("rejects flow-style mappings", () => {
  assert.throws(() => parseSimpleYaml("a: {b: 1}\n"), ConfigParseError);
});

test("rejects duplicate keys at the same level", () => {
  assert.throws(() => parseSimpleYaml("a: 1\na: 2\n"), ConfigParseError);
});

test("rejects unparseable lines", () => {
  assert.throws(() => parseSimpleYaml("this is not a mapping line\n"), ConfigParseError);
});

test("preserves quoted string values verbatim (no boolean/number coercion)", () => {
  const doc = parseSimpleYaml('flag: "true"\nnum: "42"\n');
  assert.deepEqual(doc, { flag: "true", num: "42" });
});

test("coerces unquoted booleans, null, and integers", () => {
  const doc = parseSimpleYaml("a: true\nb: false\nc: null\nd: ~\ne: 42\nf: -3\n");
  assert.deepEqual(doc, { a: true, b: false, c: null, d: null, e: 42, f: -3 });
});

test("empty document parses to empty object", () => {
  assert.deepEqual(parseSimpleYaml(""), {});
  assert.deepEqual(parseSimpleYaml("\n\n# only comments\n"), {});
});
