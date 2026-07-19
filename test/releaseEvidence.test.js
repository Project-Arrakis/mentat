import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const evidencePath = "docs/release-evidence/v1.0.0-rc.2.md";

test("v1.0.0-rc.2 publication evidence records release identity", async () => {
  const evidence = await readFile(evidencePath, "utf8");

  for (const required of [
    "v1.0.0-rc.2",
    "GitHub prerelease",
    "Not draft",
    "https://github.com/yacketrj/Arrakis-Control-Panel/releases/tag/v1.0.0-rc.2"
  ]) {
    assert.match(evidence, new RegExp(escapeRegExp(required)), required);
  }
});

test("v1.0.0-rc.2 publication evidence records workflow and assets", async () => {
  const evidence = await readFile(evidencePath, "utf8");

  for (const required of [
    "Release Artifacts",
    "discord-readonly-bot-v1.0.0-rc.2.tar.gz",
    "discord-readonly-bot-v1.0.0-rc.2.tar.gz.sha256",
    "arrakis-control-panel.cdx.json",
    "arrakis-control-panel.cdx.json.sha256"
  ]) {
    assert.match(evidence, new RegExp(escapeRegExp(required)), required);
  }
});

test("release roadmap records validated v1.0.0 candidate state", async () => {
  const roadmap = await readFile("docs/roadmap.md", "utf8");
  const plan = await readFile("docs/production-release-plan.md", "utf8");

  assert.match(roadmap, /Latest release candidate validated: `v1\.0\.0-rc\.2`/);
  assert.match(roadmap, /Next stable target: `v1\.0\.0`/);
  assert.match(plan, /Latest published release candidate: `v1\.0\.0-rc\.2`/);
  assert.match(plan, new RegExp(escapeRegExp(evidencePath)));
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
