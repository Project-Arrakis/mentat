import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBridgePublicationMetadata,
  buildCommentMetadata,
  buildIssueMetadata,
  extractMetadataBlocks,
  extractSingleIssueMetadata
} from "./metadata.mjs";

test("buildIssueMetadata round-trips through extractSingleIssueMetadata", () => {
  const block = buildIssueMetadata({
    syncId: "ACP-PUBLIC-52",
    publicRepository: "yacketrj/acp-discordbot",
    publicIssue: 52,
    createdFromEvent: "issues.opened:abcd1234"
  });
  assert.match(block, /^<!-- ACP-ISSUE-BRIDGE\n/);
  assert.match(block, /-->$/);

  const body = `# [PUBLIC #52] Something broke\n\nSome body text.\n\n${block}`;
  const parsed = extractSingleIssueMetadata(body);
  assert.deepEqual(parsed, {
    schema_version: "1",
    sync_id: "ACP-PUBLIC-52",
    public_repository: "yacketrj/acp-discordbot",
    public_issue: "52",
    created_from_event: "issues.opened:abcd1234"
  });
});

test("buildCommentMetadata includes direction and source comment id", () => {
  const block = buildCommentMetadata({
    syncId: "ACP-PUBLIC-52",
    sourceRepository: "yacketrj/acp-discordbot",
    sourceIssue: 52,
    sourceComment: 23891827
  });
  const [parsed] = extractMetadataBlocks(block);
  assert.equal(parsed.direction, "public-to-private");
  assert.equal(parsed.source_comment, "23891827");
});

test("buildBridgePublicationMetadata marks origin as bridge", () => {
  const block = buildBridgePublicationMetadata({
    syncId: "ACP-PUBLIC-52",
    privateRepository: "yacketrj/arrakis-control-panel",
    privateIssue: 300,
    privateComment: 999,
    kind: "public-status"
  });
  const [parsed] = extractMetadataBlocks(block);
  assert.equal(parsed.origin, "bridge");
  assert.equal(parsed.kind, "public-status");
});

test("buildBridgePublicationMetadata round-trips an optional source_comment for idempotency checks", () => {
  const block = buildBridgePublicationMetadata({
    syncId: "ACP-PUBLIC-52",
    privateRepository: "yacketrj/arrakis-control-panel",
    privateIssue: 300,
    kind: "public",
    sourceComment: 555111
  });
  const [parsed] = extractMetadataBlocks(block);
  assert.equal(parsed.source_comment, "555111");
});

test("extractMetadataBlocks returns an empty array for plain text", () => {
  assert.deepEqual(extractMetadataBlocks("just a normal comment, nothing special"), []);
  assert.deepEqual(extractMetadataBlocks(""), []);
  assert.deepEqual(extractMetadataBlocks(null), []);
});

test("extractSingleIssueMetadata fails closed (returns null) when zero blocks are present", () => {
  assert.equal(extractSingleIssueMetadata("no metadata here"), null);
});

test("extractSingleIssueMetadata fails closed when a forged block is missing required fields", () => {
  const forged = "<!-- ACP-ISSUE-BRIDGE\norigin: bridge\n-->";
  assert.equal(extractSingleIssueMetadata(forged), null);
});

test("extractSingleIssueMetadata fails closed (ambiguous) when multiple well-formed blocks are present", () => {
  const one = buildIssueMetadata({ syncId: "ACP-PUBLIC-1", publicRepository: "a/b", publicIssue: 1 });
  const two = buildIssueMetadata({ syncId: "ACP-PUBLIC-2", publicRepository: "a/b", publicIssue: 2 });
  assert.equal(extractSingleIssueMetadata(`${one}\n\n${two}`), null);
});

test("a public user typing a fake bridge block does not produce trusted metadata by itself", () => {
  // This is the untrusted-parsing half of SEC-011; the trust decision itself
  // lives in loopProtection.mjs and must be combined with actor identity.
  const forged = buildBridgePublicationMetadata({
    syncId: "ACP-PUBLIC-52",
    privateRepository: "yacketrj/arrakis-control-panel",
    privateIssue: 1,
    privateComment: 1,
    kind: "public"
  });
  const blocks = extractMetadataBlocks(forged);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].origin, "bridge");
  // extractMetadataBlocks is intentionally "just a parser" — it has no
  // opinion on trust. Documented here so the invariant has a regression test.
});
