import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { packageAddon } from "../scripts/package-addon.js";

test("packageAddon creates a zero-permission addon artifact and checksum", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dune-addon-package-"));

  try {
    const result = await packageAddon({
      addonDir: join(process.cwd(), "addon"),
      outputDir: dir
    });

    assert.equal(basename(result.artifactPath), "discord-readonly-bot-v0.1.0.tar.gz");
    assert.deepEqual(result.files, ["addon.json", "web/index.html"]);
    assert.equal(result.manifest.permissions.length, 0);

    const archive = await readFile(result.artifactPath);
    const checksum = createHash("sha256").update(archive).digest("hex");
    assert.equal(result.sha256, checksum);
    assert.equal(
      await readFile(result.checksumPath, "utf8"),
      `${checksum}  discord-readonly-bot-v0.1.0.tar.gz\n`
    );

    assert.deepEqual(listTarEntries(gunzipSync(archive)), [
      "discord-readonly-bot/addon.json",
      "discord-readonly-bot/web/index.html"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("packageAddon rejects non-zero addon permissions", async () => {
  const addonDir = await createTempAddon({
    permissions: ["docker"]
  });

  try {
    await assert.rejects(
      () => packageAddon({ addonDir, outputDir: join(addonDir, "dist") }),
      /zero-permission/
    );
  } finally {
    await rm(addonDir, { recursive: true, force: true });
  }
});

test("packageAddon rejects traversal in the addon entry path", async () => {
  const addonDir = await createTempAddon({
    entry: {
      navigation: "Discord Bot",
      path: "../outside.html"
    }
  });

  try {
    await assert.rejects(
      () => packageAddon({ addonDir, outputDir: join(addonDir, "dist") }),
      /traversal/
    );
  } finally {
    await rm(addonDir, { recursive: true, force: true });
  }
});

async function createTempAddon(overrides = {}) {
  const addonDir = await mkdtemp(join(tmpdir(), "dune-addon-invalid-"));
  await mkdir(join(addonDir, "web"), { recursive: true });
  await writeFile(join(addonDir, "web", "index.html"), "<!doctype html><title>Discord Bot</title>\n");
  await writeFile(join(addonDir, "addon.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "discord-readonly-bot",
    name: "Discord Read-Only Bot",
    description: "Zero-permission setup panel for the external Dune Discord bot.",
    author: "dune-awakening-selfhost-discordbot contributors",
    version: "0.1.0",
    type: "ui",
    entry: {
      navigation: "Discord Bot",
      path: "web/index.html"
    },
    permissions: [],
    ...overrides
  })}\n`);
  return addonDir;
}

function listTarEntries(buffer) {
  const names = [];
  let offset = 0;

  while (offset < buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.toString("ascii", 0, 100).replace(/\0.*$/, "");
    const sizeText = header.toString("ascii", 124, 136).replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText, 8);

    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return names;
}
