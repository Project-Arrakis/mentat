import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateReleaseMetadata } from "../scripts/validate-release.js";

test("validateReleaseMetadata accepts matching versions and documented release notes", async () => {
  const rootDir = await createReleaseTree({ version: "1.2.3" });

  try {
    const result = await validateReleaseMetadata({ rootDir });

    assert.equal(result.version, "1.2.3");
    assert.equal(result.notesPath, join(rootDir, "docs", "releases", "v1.2.3.md"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("validateReleaseMetadata rejects mismatched addon versions", async () => {
  const rootDir = await createReleaseTree({
    version: "1.2.3",
    addonVersion: "1.2.4"
  });

  try {
    await assert.rejects(
      () => validateReleaseMetadata({ rootDir }),
      /addon\/addon\.json version 1\.2\.4 does not match release 1\.2\.3/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("validateReleaseMetadata rejects missing release notes", async () => {
  const rootDir = await createReleaseTree({
    version: "1.2.3",
    writeReleaseNotes: false
  });

  try {
    await assert.rejects(
      () => validateReleaseMetadata({ rootDir }),
      /Release notes file is missing/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("validateReleaseMetadata rejects changelogs without the release entry", async () => {
  const rootDir = await createReleaseTree({
    version: "1.2.3",
    changelog: "# Changelog\n\n## v1.2.2 - 2026-06-27\n\n- Previous release.\n"
  });

  try {
    await assert.rejects(
      () => validateReleaseMetadata({ rootDir }),
      /CHANGELOG\.md must include a "## v1\.2\.3" entry/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function createReleaseTree({
  version = "1.2.3",
  addonVersion = version,
  changelog = `# Changelog\n\n## v${version} - 2026-06-28\n\n- Release entry.\n`,
  writeReleaseNotes = true
} = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "dune-release-check-"));
  await mkdir(join(rootDir, "addon"), { recursive: true });
  await mkdir(join(rootDir, "docs", "releases"), { recursive: true });

  await writeJson(join(rootDir, "package.json"), {
    name: "dune-awakening-selfhost-discordbot",
    version
  });
  await writeJson(join(rootDir, "addon", "addon.json"), {
    schemaVersion: 1,
    id: "discord-readonly-bot",
    version: addonVersion
  });
  await writeFile(join(rootDir, "CHANGELOG.md"), changelog, "utf8");

  if (writeReleaseNotes) {
    await writeFile(join(rootDir, "docs", "releases", `v${version}.md`), `# v${version}\n`, "utf8");
  }

  return rootDir;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
