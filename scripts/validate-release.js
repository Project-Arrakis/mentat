import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

async function defaultReadText(path) {
  return readFile(path, "utf8");
}

export async function validateReleaseMetadata({
  rootDir = process.cwd(),
  releaseVersion,
  readText = defaultReadText,
  fileExists = existsSync
} = {}) {
  const packagePath = resolve(rootDir, "package.json");
  const addonPath = resolve(rootDir, "addon", "addon.json");
  const changelogPath = resolve(rootDir, "CHANGELOG.md");

  const packageJson = await readJson(packagePath, "package.json", readText);
  const addonJson = await readJson(addonPath, "addon/addon.json", readText);
  const version = releaseVersion || packageJson.version;
  const errors = [];

  if (!SEMVER_PATTERN.test(version || "")) {
    errors.push("Release version must use semver major.minor.patch format.");
  }
  if (packageJson.version !== version) {
    errors.push(`package.json version ${packageJson.version || "<missing>"} does not match release ${version}.`);
  }
  if (addonJson.version !== version) {
    errors.push(`addon/addon.json version ${addonJson.version || "<missing>"} does not match release ${version}.`);
  }

  const notesPath = resolve(rootDir, "docs", "releases", `v${version}.md`);
  if (!fileExists(notesPath)) {
    errors.push(`Release notes file is missing: docs/releases/v${version}.md.`);
  }

  let changelog = "";
  try {
    changelog = await readText(changelogPath);
  } catch {
    errors.push("CHANGELOG.md is missing or unreadable.");
  }

  if (changelog && !hasChangelogEntry(changelog, version)) {
    errors.push(`CHANGELOG.md must include a "## v${version}" entry.`);
  }

  if (errors.length > 0) {
    const error = new Error(`Release metadata validation failed:\n- ${errors.join("\n- ")}`);
    error.errors = errors;
    throw error;
  }

  return {
    version,
    notesPath
  };
}

async function readJson(path, label, readText) {
  try {
    return JSON.parse(await readText(path));
  } catch (error) {
    throw new Error(`${label} is missing or invalid JSON: ${error.message}`);
  }
}

function hasChangelogEntry(changelog, version) {
  const expectedHeading = `## v${version}`;
  return changelog.split(/\r?\n/).some((line) => (
    line === expectedHeading || line.startsWith(`${expectedHeading} `)
  ));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateReleaseMetadata({ releaseVersion: process.env.RELEASE_VERSION })
    .then((result) => {
      console.log(`Release metadata OK for v${result.version}`);
    })
    .catch((error) => {
      console.error(error.message || "Release metadata validation failed.");
      process.exit(1);
    });
}
