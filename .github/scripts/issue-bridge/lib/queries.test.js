import assert from "node:assert/strict";
import { test } from "node:test";
import { syncIdSearchQuery } from "./queries.mjs";

test("builds a deterministic search query for a sync id", () => {
  assert.equal(
    syncIdSearchQuery("yacketrj/arrakis-control-panel", "ACP-PUBLIC-52"),
    'repo:yacketrj/arrakis-control-panel "sync_id: ACP-PUBLIC-52" in:body,comments is:issue'
  );
});
