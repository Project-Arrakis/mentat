import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const workflowDir = join(process.cwd(), ".github", "workflows");
const fullSha = /^[a-f0-9]{40}$/;

test("GitHub workflow actions are pinned to immutable commit SHAs", async () => {
  const files = (await readdir(workflowDir)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const findings = [];

  for (const file of files) {
    const content = await readFile(join(workflowDir, file), "utf8");
    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*-\s+uses:\s+([^@\s]+)@([^\s#]+)/);
      if (!match) continue;

      const reference = match[2];
      if (!fullSha.test(reference)) {
        findings.push(`${file}:${index + 1}: ${match[1]}@${reference}`);
      }
    }
  }

  assert.deepEqual(findings, []);
});
