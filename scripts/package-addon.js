import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, lstat, writeFile } from "node:fs/promises";
import { basename, join, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const TAR_BLOCK_SIZE = 512;
const TAR_MTIME_SECONDS = 0;
const DEFAULT_ADDON_DIR = "addon";
const DEFAULT_OUTPUT_DIR = "dist";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export async function packageAddon({
  addonDir = DEFAULT_ADDON_DIR,
  outputDir = DEFAULT_OUTPUT_DIR
} = {}) {
  const resolvedAddonDir = resolve(addonDir);
  const manifest = await readAddonManifest(resolvedAddonDir);
  const files = await collectAddonFiles(resolvedAddonDir);
  const packagePrefix = manifest.id;
  const artifactName = `${manifest.id}-v${manifest.version}.tar.gz`;
  const artifactPath = join(resolve(outputDir), artifactName);
  const checksumPath = `${artifactPath}.sha256`;

  const tarEntries = await Promise.all(files.map(async (file) => ({
    name: `${packagePrefix}/${file.packagePath}`,
    contents: await readFile(file.absolutePath)
  })));
  const archive = gzipSync(createTarBuffer(tarEntries), { mtime: TAR_MTIME_SECONDS });
  const sha256 = createHash("sha256").update(archive).digest("hex");

  await mkdir(resolve(outputDir), { recursive: true });
  await writeFile(artifactPath, archive);
  await writeFile(checksumPath, `${sha256}  ${basename(artifactPath)}\n`);

  return {
    artifactPath,
    checksumPath,
    files: files.map((file) => file.packagePath),
    manifest,
    sha256
  };
}

export async function readAddonManifest(addonDir) {
  const manifestPath = resolve(addonDir, "addon.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.schemaVersion !== 1) {
    throw new Error("Addon manifest schemaVersion must be 1.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id || "")) {
    throw new Error("Addon manifest id must be lowercase letters, digits, and hyphens.");
  }
  if (!SEMVER_PATTERN.test(manifest.version || "")) {
    throw new Error("Addon manifest version must use semver major.minor.patch format with optional prerelease.");
  }
  if (manifest.type !== "ui") {
    throw new Error("Addon manifest type must be ui.");
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length !== 0) {
    throw new Error("Addon release packaging requires a zero-permission manifest.");
  }
  if (!manifest.entry || typeof manifest.entry !== "object") {
    throw new Error("Addon manifest entry is required.");
  }

  const entryPath = assertSafePackagePath(manifest.entry.path, "Addon entry path");
  const entryFile = resolveInside(addonDir, entryPath);
  const entryStats = await lstat(entryFile);
  if (!entryStats.isFile()) {
    throw new Error("Addon manifest entry path must point to a file.");
  }

  return manifest;
}

export async function collectAddonFiles(addonDir) {
  const resolvedAddonDir = resolve(addonDir);
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Addon package refuses symbolic links: ${relative(resolvedAddonDir, absolutePath)}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Addon package refuses non-file entry: ${relative(resolvedAddonDir, absolutePath)}`);
      }

      const packagePath = relative(resolvedAddonDir, absolutePath).split(sep).join("/");
      files.push({
        absolutePath,
        packagePath: assertSafePackagePath(packagePath, "Addon file path")
      });
    }
  }

  await walk(resolvedAddonDir);
  if (!files.some((file) => file.packagePath === "addon.json")) {
    throw new Error("Addon package must include addon.json.");
  }

  return files;
}

export function createTarBuffer(entries) {
  const buffers = [];

  for (const entry of entries) {
    const name = assertSafePackagePath(entry.name, "Tar entry name");
    if (Buffer.byteLength(name) > 100) {
      throw new Error(`Tar entry name is too long for the release package: ${name}`);
    }

    const contents = Buffer.from(entry.contents);
    buffers.push(createTarHeader(name, contents.length));
    buffers.push(contents);
    buffers.push(Buffer.alloc((TAR_BLOCK_SIZE - (contents.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE));
  }

  buffers.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return Buffer.concat(buffers);
}

function createTarHeader(name, size) {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, TAR_MTIME_SECONDS, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeString(header, checksumText, 148, 6);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function writeString(buffer, value, offset, length) {
  buffer.write(value, offset, length, "ascii");
}

function writeOctal(buffer, value, offset, length) {
  const octal = value.toString(8).padStart(length - 1, "0");
  if (octal.length > length - 1) {
    throw new Error(`Tar numeric value is too large: ${value}`);
  }
  writeString(buffer, octal, offset, length - 1);
  buffer[offset + length - 1] = 0;
}

function assertSafePackagePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
    throw new Error(`${label} must be a relative POSIX path.`);
  }

  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must not contain traversal or redundant segments.`);
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must contain only safe path segments.`);
  }

  return value;
}

function resolveInside(baseDir, packagePath) {
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(resolvedBase, packagePath);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(`${resolvedBase}${sep}`)) {
    throw new Error("Resolved addon path escaped the addon directory.");
  }
  return resolvedPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageAddon()
    .then((result) => {
      console.log(`Created ${result.artifactPath}`);
      console.log(`SHA-256 ${result.sha256}`);
    })
    .catch((error) => {
      console.error(error?.message || "Addon packaging failed.");
      process.exit(1);
    });
}
