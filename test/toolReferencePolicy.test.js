import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

const blocked = [
  { label: "workspace tool name", parts: ["co", "dex"] },
  { label: "provider name", parts: ["open", "a", "i"] },
  { label: "chat tool name", parts: ["chat", "gpt"] },
  { label: "standalone automation acronym", parts: ["a", "i"] },
  { label: "model acronym", parts: ["l", "l", "m"] }
].map(({ label, parts }) => ({
  label,
  regex: new RegExp(`\\b${escapeRegExp(parts.join(""))}\\b`, "i")
}));

test("durable docs and PR templates avoid tool/provider references", async () => {
  const files = await trackedFiles();
  const durableEvidenceFiles = files.filter((file) =>
    file === "README.md" ||
    file === "CHANGELOG.md" ||
    file.startsWith("docs/") ||
    file.startsWith(".github/")
  );

  const findings = [];
  for (const file of durableEvidenceFiles) {
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      for (const term of blocked) {
        if (term.regex.test(line)) {
          findings.push(`${file}:${index + 1}: ${term.label}`);
        }
      }
    }
  }

  assert.deepEqual(findings, []);
});

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
