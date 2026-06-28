import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { buildCycloneDxSbom, validateCycloneDxSbom, writeSbom } from "../scripts/generate-sbom.js";

test("buildCycloneDxSbom creates CycloneDX metadata and npm components", () => {
  const sbom = buildCycloneDxSbom(sampleLockfile(), {
    timestamp: "2026-06-28T00:00:00.000Z"
  });

  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal(sbom.specVersion, "1.6");
  assert.equal(sbom.metadata.component.name, "dune-awakening-selfhost-discordbot");
  assert.equal(sbom.components.length, 1);
  assert.deepEqual(sbom.components[0], {
    type: "library",
    "bom-ref": "pkg:npm/discord.js@14.26.4",
    name: "discord.js",
    version: "14.26.4",
    purl: "pkg:npm/discord.js@14.26.4",
    scope: "required",
    licenses: [{ license: { id: "Apache-2.0" } }],
    externalReferences: [{
      type: "distribution",
      url: "https://registry.npmjs.org/discord.js/-/discord.js-14.26.4.tgz"
    }],
    hashes: [{
      alg: "SHA-512",
      content: "YWJj"
    }]
  });
  validateCycloneDxSbom(sbom);
});

test("writeSbom writes a CycloneDX SBOM and checksum", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dune-sbom-"));
  const lockfilePath = join(dir, "package-lock.json");
  await writeFile(lockfilePath, `${JSON.stringify(sampleLockfile())}\n`);

  try {
    const result = await writeSbom({
      lockfilePath,
      outputDir: dir,
      outputName: "test.cdx.json",
      timestamp: "2026-06-28T00:00:00.000Z"
    });

    assert.equal(basename(result.outputPath), "test.cdx.json");
    assert.equal(result.componentCount, 1);

    const contents = await readFile(result.outputPath, "utf8");
    const checksum = createHash("sha256").update(contents).digest("hex");
    assert.equal(result.sha256, checksum);
    assert.equal(await readFile(result.checksumPath, "utf8"), `${checksum}  test.cdx.json\n`);
    validateCycloneDxSbom(JSON.parse(contents));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateCycloneDxSbom rejects missing component details", () => {
  assert.throws(
    () => validateCycloneDxSbom({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: {
        component: {
          name: "app",
          version: "1.0.0"
        }
      },
      components: [{
        type: "library",
        name: "missing-purl",
        version: "1.0.0"
      }]
    }),
    /purl/
  );
});

function sampleLockfile() {
  return {
    name: "dune-awakening-selfhost-discordbot",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "dune-awakening-selfhost-discordbot",
        version: "0.1.0",
        dependencies: {
          "discord.js": "^14.26.4"
        }
      },
      "node_modules/discord.js": {
        version: "14.26.4",
        resolved: "https://registry.npmjs.org/discord.js/-/discord.js-14.26.4.tgz",
        integrity: "sha512-YWJj",
        license: "Apache-2.0"
      }
    }
  };
}
