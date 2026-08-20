import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIssueMetadata } from "./metadata.mjs";
import { requireSinglePrivateMirror, resolvePrivateMirror } from "./correlation.mjs";

function issueWithMetadata(number, syncId, publicIssue = 52) {
  return {
    number,
    body: `# mirror\n\n${buildIssueMetadata({ syncId, publicRepository: "yacketrj/acp-discordbot", publicIssue })}`
  };
}

test("zero candidates -> status 'none' (caller should create a mirror)", () => {
  const result = resolvePrivateMirror([], "ACP-PUBLIC-52");
  assert.deepEqual(result, { status: "none", matches: [] });
});

test("exactly one confirmed candidate -> status 'single' (caller should reuse it)", () => {
  const candidates = [issueWithMetadata(300, "ACP-PUBLIC-52")];
  const result = resolvePrivateMirror(candidates, "ACP-PUBLIC-52");
  assert.deepEqual(result, { status: "single", matches: [300] });
});

test("SEC-014: two issues both claiming the same Sync ID -> status 'ambiguous', fail closed", () => {
  const candidates = [issueWithMetadata(300, "ACP-PUBLIC-52"), issueWithMetadata(301, "ACP-PUBLIC-52")];
  const result = resolvePrivateMirror(candidates, "ACP-PUBLIC-52");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.matches, [300, 301]);
});

test("ignores a search false-positive whose metadata doesn't actually match the expected sync id", () => {
  const candidates = [issueWithMetadata(300, "ACP-PUBLIC-999")];
  const result = resolvePrivateMirror(candidates, "ACP-PUBLIC-52");
  assert.deepEqual(result, { status: "none", matches: [] });
});

test("mechanism 2: confirms correlation via a bridge sync comment even if the body metadata is gone", () => {
  const candidates = [
    {
      number: 300,
      body: "body metadata was edited away by a maintainer and no longer contains a sync block",
      comments: [
        "just chatting",
        `### Public Comment\n\n<!-- ACP-ISSUE-BRIDGE\nschema_version: 1\nsync_id: ACP-PUBLIC-52\npublic_repository: yacketrj/acp-discordbot\npublic_issue: 52\n-->`
      ]
    }
  ];
  const result = resolvePrivateMirror(candidates, "ACP-PUBLIC-52");
  assert.deepEqual(result, { status: "single", matches: [300] });
});

test("ignores a candidate with no metadata at all", () => {
  const candidates = [{ number: 400, body: "unrelated issue, mentions ACP-PUBLIC-52 in passing prose" }];
  const result = resolvePrivateMirror(candidates, "ACP-PUBLIC-52");
  assert.deepEqual(result, { status: "none", matches: [] });
});

test("requireSinglePrivateMirror throws a CORRELATION error on ambiguity", () => {
  const candidates = [issueWithMetadata(300, "ACP-PUBLIC-52"), issueWithMetadata(301, "ACP-PUBLIC-52")];
  assert.throws(
    () => requireSinglePrivateMirror(candidates, "ACP-PUBLIC-52"),
    (err) => {
      assert.equal(err.errorClass, "CORRELATION");
      return true;
    }
  );
});

test("requireSinglePrivateMirror passes through 'none'/'single' without throwing", () => {
  assert.equal(requireSinglePrivateMirror([], "ACP-PUBLIC-52").status, "none");
  assert.equal(
    requireSinglePrivateMirror([issueWithMetadata(300, "ACP-PUBLIC-52")], "ACP-PUBLIC-52").status,
    "single"
  );
});
