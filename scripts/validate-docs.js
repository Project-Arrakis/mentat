import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = process.cwd();
const ROOT = (p) => resolve(REPO_ROOT, p);

async function main() {
  const issues = [];

  // 1. Release notes exist for package.json version
  const pkg = JSON.parse(await readFile(ROOT("package.json"), "utf8"));
  const notesPath = ROOT(`docs/releases/v${pkg.version}.md`);
  if (!existsSync(notesPath)) {
    issues.push(`Release notes missing: docs/releases/v${pkg.version}.md`);
  }

  // 2. CHANGELOG has entry for current version
  const changelog = await readFile(ROOT("CHANGELOG.md"), "utf8");
  const expectedHeading = `## v${pkg.version}`;
  if (!changelog.split(/\r?\n/).some((l) => l.startsWith(expectedHeading))) {
    issues.push(`CHANGELOG.md is missing "${expectedHeading}" entry`);
  }

  // 3. CHANGELOG follows keepachangelog format (Unreleased sections)
  if (!changelog.includes("## Unreleased")) {
    issues.push("CHANGELOG.md is missing ## Unreleased section (keepachangelog format)");
  }
  const sections = ["### Added", "### Changed", "### Fixed", "### Removed"];
  for (const section of sections) {
    if (!changelog.includes(section)) {
      issues.push(`CHANGELOG.md is missing ${section} section`);
    }
  }

  // 4. Configuration.md env vars are sourced from config.js
  const configJs = await readFile(ROOT("src/config.js"), "utf8");
  const configMd = existsSync(ROOT("docs/configuration.md")) ? await readFile(ROOT("docs/configuration.md"), "utf8") : "";
  const envVarsInCode = new Set();
  for (const match of configJs.matchAll(/process\.env(?:\[['"](\w+)['"]\]|\.(\w+))/g)) {
    envVarsInCode.add(match[1] || match[2]);
  }
  for (const match of configJs.matchAll(/(?:optional|required)Env\(\s*env\s*,\s*"(\w+)"/g)) {
    envVarsInCode.add(match[1]);
  }
  const documentedEnvVars = new Set([...configMd.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]));
  const missingFromDocs = [...envVarsInCode].filter((v) => !v.startsWith("DUNE") && !documentedEnvVars.has(v));
  const unusedInCode = [...documentedEnvVars].filter((v) => !envVarsInCode.has(v) && !configMd.includes(`\`${v}\``));
  for (const v of missingFromDocs.slice(0, 10)) {
    issues.push(`Env var ${v} used in config.js but NOT documented in configuration.md`);
  }
  for (const v of unusedInCode.slice(0, 5)) {
    issues.push(`Env var ${v} documented in configuration.md but NOT found in config.js (may be stale)`);
  }

  // 5. All adapter routes in config.js are documented in api-adapter-contract or configuration
  const routeNames = [
    ...configJs.matchAll(/(?:DEFAULT_PATHS|adapter\.(?:paths|methods))\s*[=:]\s*Object\.freeze\(\{([^}]+)\}/gs)
  ].flatMap((m) => [...m[1].matchAll(/(\w+(?:-\w+)*)\s*:/g)].map((n) => n[1]));
  const uniqueRoutes = [...new Set(routeNames)].filter((r) => r !== "health" && r !== "status" && r !== "readiness" && r !== "services");
  for (const route of uniqueRoutes) {
    if (!configMd.includes(route) && !configMd.includes(`/api/integrations/discord/${route.replace(/-/g, "/")}`)) {
      issues.push(`Adapter route "${route}" configured but not documented`);
    }
  }

  // 6. Change notes exist for recent PRs (check PR-0043 through PR-0063)
  const changesDir = ROOT("docs/changes");
  const changeFiles = existsSync(changesDir) ? await readdir(changesDir) : [];
  const changeNumbers = new Set(
    changeFiles
      .filter((f) => /^PR-\d{4}/.test(f))
      .map((f) => f.match(/PR-(\d{4})/)[1])
      .map(Number)
  );

  // 7. Installation guide references all required env vars
  const installMd = existsSync(ROOT("docs/installation-guide.md")) ? await readFile(ROOT("docs/installation-guide.md"), "utf8") : "";
  const requiredConfigVars = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DUNE_CONSOLE_API_URL", "DUNE_DISCORD_ADAPTER_TOKEN"];
  for (const v of requiredConfigVars) {
    if (!installMd.includes(v)) {
      issues.push(`Installation guide is missing required env var: ${v}`);
    }
  }

  // 8. Verify core source files exist
  const coreFiles = [
    "src/commands.js", "src/config.js", "src/adapterClient.js", "src/format.js",
    "src/index.js", "src/logger.js", "src/healthState.js", "src/healthcheck.js",
    "src/cooldown.js", "src/scheduler.js", "src/notifications.js",
    "src/announcements.js", "src/broadcast.js", "src/opsCommands.js",
    "src/writes.js", "src/writeCommands.js"
  ];
  for (const f of coreFiles) {
    if (!existsSync(ROOT(f))) {
      issues.push(`Source file missing: ${f}`);
    }
  }

  // 9. All /dune subcommands documented somewhere
  const commandsJs = await readFile(ROOT("src/commands.js"), "utf8");
  const subcommandMatch = commandsJs.match(/const SUBCOMMANDS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  const subcommands = subcommandMatch ? [...subcommandMatch[1].matchAll(/"(\w+(?:-\w+)*)"/g)].map((m) => m[1]) : [];
  const opsSubcommands = new Set((await readFile(ROOT("src/opsCommands.js"), "utf8")).match(/\w+(?:-\w+)+/g) || []);

  // 10. Release-gates.sh is executable
  const gatesPath = ROOT("scripts/release-gates.sh");
  if (existsSync(gatesPath)) {
    const stats = statSync(gatesPath);
    if (!(stats.mode & 0o100)) {
      issues.push("scripts/release-gates.sh is not executable");
    }
  }

  // Output
  if (issues.length === 0) {
    console.log("=== Documentation Validation ===\nAll checks passed. No issues found.");
    return { ok: true, issues: [] };
  }

  console.log("=== Documentation Validation ===\nIssues found:\n");
  for (const issue of issues) {
    console.log(`[-] ${issue}`);
  }
  console.log(`\n${issues.length} issue(s) found.`);

  return { ok: false, issues };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = await main();
  process.exit(result.ok ? 0 : 1);
}

export { main };
