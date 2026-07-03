import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const evidencePath = "docs/release-evidence/v1.0.0-rc.1.md";

test("v1.0.0-rc.1 publication evidence records release identity", async () => {
  const evidence = await readFile(evidencePath, "utf8");

  for (const required of [
    "v1.0.0-rc.1",
    "GitHub prerelease",
    "Not draft",
    "5fb957ca719d1625593cb066071ed265854c4372",
    "2026-07-03T02:48:09Z",
    "https://github.com/yacketrj/dune-awakening-selfhost-discordbot/releases/tag/v1.0.0-rc.1"
  ]) {
    assert.match(evidence, new RegExp(escapeRegExp(required)), required);
  }
});

test("v1.0.0-rc.1 publication evidence records workflow and assets", async () => {
  const evidence = await readFile(evidencePath, "utf8");

  for (const required of [
    "Release Artifacts",
    "28635077937",
    "Success",
    "discord-readonly-bot-v1.0.0-rc.1.tar.gz",
    "discord-readonly-bot-v1.0.0-rc.1.tar.gz.sha256",
    "dune-awakening-selfhost-discordbot.cdx.json",
    "dune-awakening-selfhost-discordbot.cdx.json.sha256",
    "Downloaded release assets were verified locally after publication"
  ]) {
    assert.match(evidence, new RegExp(escapeRegExp(required)), required);
  }
});

test("release roadmap records validated v1.0.0 candidate state", async () => {
  const roadmap = await readFile("docs/roadmap.md", "utf8");
  const plan = await readFile("docs/production-release-plan.md", "utf8");

  assert.match(roadmap, /Latest release candidate validated: `v1\.0\.0-rc\.1`/);
  assert.match(roadmap, /Next stable target: `v1\.0\.0`/);
  assert.match(plan, /Latest published release candidate: `v1\.0\.0-rc\.1`/);
  assert.match(plan, new RegExp(escapeRegExp(evidencePath)));
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
