import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LOCKFILE = "package-lock.json";
const DEFAULT_OUTPUT_DIR = "dist";
const DEFAULT_OUTPUT_NAME = "dune-awakening-selfhost-discordbot.cdx.json";
const CYCLONEDX_SPEC_VERSION = "1.6";

export async function writeSbom({
  lockfilePath = DEFAULT_LOCKFILE,
  outputDir = DEFAULT_OUTPUT_DIR,
  outputName = DEFAULT_OUTPUT_NAME,
  timestamp = new Date().toISOString()
} = {}) {
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
  const sbom = buildCycloneDxSbom(lockfile, { timestamp });
  validateCycloneDxSbom(sbom);

  const contents = `${JSON.stringify(sbom, null, 2)}\n`;
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const outputPath = join(resolve(outputDir), outputName);
  const checksumPath = `${outputPath}.sha256`;

  await mkdir(resolve(outputDir), { recursive: true });
  await writeFile(outputPath, contents, "utf8");
  await writeFile(checksumPath, `${sha256}  ${basename(outputPath)}\n`, "utf8");

  return {
    outputPath,
    checksumPath,
    componentCount: sbom.components.length,
    sha256
  };
}

export function buildCycloneDxSbom(lockfile, { timestamp = new Date().toISOString() } = {}) {
  if (!lockfile || typeof lockfile !== "object" || !lockfile.packages) {
    throw new Error("package-lock.json must include a packages object.");
  }

  const root = lockfile.packages[""];
  if (!root?.name || !root?.version) {
    throw new Error("package-lock.json must include root package name and version.");
  }

  const rootRef = `pkg:npm/${encodeNpmName(root.name)}@${root.version}`;
  const components = [];
  const seenRefs = new Set();

  for (const [lockPath, packageInfo] of Object.entries(lockfile.packages)) {
    if (lockPath === "" || !lockPath.includes("node_modules/")) continue;

    const name = packageNameFromLockPath(lockPath);
    if (!name || !packageInfo.version) continue;

    const bomRef = `pkg:npm/${encodeNpmName(name)}@${packageInfo.version}`;
    if (seenRefs.has(bomRef)) continue;
    seenRefs.add(bomRef);

    const component = {
      type: "library",
      "bom-ref": bomRef,
      name,
      version: packageInfo.version,
      purl: bomRef,
      scope: packageInfo.dev ? "excluded" : "required"
    };

    if (packageInfo.license) component.licenses = [{ license: { id: packageInfo.license } }];
    if (packageInfo.resolved?.startsWith("https://")) {
      component.externalReferences = [{ type: "distribution", url: packageInfo.resolved }];
    }
    if (packageInfo.integrity) {
      const hash = integrityToHash(packageInfo.integrity);
      if (hash) component.hashes = [hash];
    }

    components.push(component);
  }

  components.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

  return {
    bomFormat: "CycloneDX",
    specVersion: CYCLONEDX_SPEC_VERSION,
    version: 1,
    serialNumber: deterministicSerialNumber(lockfile),
    metadata: {
      timestamp,
      tools: {
        components: [{
          type: "application",
          name: "dune-awakening-selfhost-discordbot-sbom-generator",
          version: root.version
        }]
      },
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: root.name,
        version: root.version
      }
    },
    components,
    dependencies: [{
      ref: rootRef,
      dependsOn: components.map((component) => component["bom-ref"])
    }]
  };
}

export function validateCycloneDxSbom(sbom) {
  if (sbom?.bomFormat !== "CycloneDX") {
    throw new Error("SBOM must use CycloneDX format.");
  }
  if (sbom.specVersion !== CYCLONEDX_SPEC_VERSION) {
    throw new Error(`SBOM must use CycloneDX ${CYCLONEDX_SPEC_VERSION}.`);
  }
  if (!Array.isArray(sbom.components)) {
    throw new Error("SBOM components must be an array.");
  }
  if (!sbom.metadata?.component?.name || !sbom.metadata?.component?.version) {
    throw new Error("SBOM metadata must include the root component name and version.");
  }

  for (const component of sbom.components) {
    if (component.type !== "library" || !component.name || !component.version || !component.purl) {
      throw new Error("SBOM components must include library type, name, version, and purl.");
    }
  }

  return sbom;
}

function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split("/");
  const nodeIndex = parts.lastIndexOf("node_modules");
  if (nodeIndex === -1) return undefined;

  const first = parts[nodeIndex + 1];
  if (!first) return undefined;
  if (first.startsWith("@")) return `${first}/${parts[nodeIndex + 2]}`;
  return first;
}

function encodeNpmName(name) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `%40${encodeURIComponent(scope.slice(1))}/${encodeURIComponent(packageName)}`;
  }
  return encodeURIComponent(name);
}

function integrityToHash(integrity) {
  const [algorithm, content] = integrity.split("-", 2);
  const algorithmMap = {
    sha1: "SHA-1",
    sha256: "SHA-256",
    sha384: "SHA-384",
    sha512: "SHA-512"
  };

  if (!algorithmMap[algorithm] || !content) return undefined;
  return {
    alg: algorithmMap[algorithm],
    content
  };
}

function deterministicSerialNumber(lockfile) {
  const digest = createHash("sha256").update(JSON.stringify(lockfile)).digest("hex");
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${digest.slice(18, 20)}`,
    digest.slice(20, 32)
  ].join("-");

  return `urn:uuid:${uuid}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeSbom()
    .then((result) => {
      console.log(`Created ${result.outputPath}`);
      console.log(`Components ${result.componentCount}`);
      console.log(`SHA-256 ${result.sha256}`);
    })
    .catch((error) => {
      console.error(error?.message || "SBOM generation failed.");
      process.exit(1);
    });
}
