import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = process.cwd();

const CHECKS = Object.freeze([
  {
    name: "env",
    label: "Environment Variables",
    run: () => {
      const required = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DUNE_CONSOLE_API_URL", "DUNE_DISCORD_ADAPTER_TOKEN"];
      const missing = required.filter((k) => !process.env[k]);
      return {
        status: missing.length === 0 ? "pass" : "fail",
        detail: missing.length
          ? `Missing: ${missing.join(", ")}. Set via env or *_FILE variants.`
          : "All required environment variables present."
      };
    }
  },
  {
    name: "node",
    label: "Node.js Runtime",
    run: () => {
      const version = process.version;
      const major = Number.parseInt(version.slice(1).split(".")[0], 10);
      return {
        status: major >= 20 ? "pass" : "fail",
        detail: `Node.js ${version} (requires >= 20.18.0)`
      };
    }
  },
  {
    name: "package",
    label: "Package Integrity",
    run: () => {
      const pkgPath = resolve(REPO_ROOT, "package.json");
      if (!existsSync(pkgPath)) return { status: "fail", detail: "package.json not found." };
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        return { status: "pass", detail: `Version ${pkg.version}, type ${pkg.type}` };
      } catch {
        return { status: "fail", detail: "package.json is invalid JSON." };
      }
    }
  },
  {
    name: "addon",
    label: "Addon Artifact",
    run: () => {
      const addonPath = resolve(REPO_ROOT, "addon", "addon.json");
      if (!existsSync(addonPath)) return { status: "fail", detail: "addon/addon.json not found." };
      try {
        const addon = JSON.parse(readFileSync(addonPath, "utf8"));
        const permsOk = Array.isArray(addon.permissions) && addon.permissions.length === 0;
        return {
          status: permsOk ? "pass" : "fail",
          detail: permsOk ? "Zero-permission addon boundary confirmed." : `Unexpected permissions: ${JSON.stringify(addon.permissions)}`
        };
      } catch {
        return { status: "fail", detail: "addon/addon.json is invalid JSON." };
      }
    }
  },
  {
    name: "gitignore",
    label: "Secrets in .gitignore",
    run: () => {
      const giPath = resolve(REPO_ROOT, ".gitignore");
      if (!existsSync(giPath)) return { status: "fail", detail: ".gitignore not found." };
      const content = readFileSync(giPath, "utf8");
      const checked = [".env", ".security-audit/"];
      const missing = checked.filter((pat) => !content.includes(pat));
      return {
        status: missing.length === 0 ? "pass" : "warn",
        detail: missing.length ? `Consider adding to .gitignore: ${missing.join(", ")}` : "Secrets patterns found in .gitignore."
      };
    }
  },
  {
    name: "dockerfile",
    label: "Dockerfile Hardening",
    run: () => {
      const dockerPath = resolve(REPO_ROOT, "Dockerfile");
      if (!existsSync(dockerPath)) return { status: "fail", detail: "Dockerfile not found." };
      const content = readFileSync(dockerPath, "utf8");
      const checks = {
        nonRoot: content.includes("USER node"),
        noNpm: content.includes("rm -rf") && content.includes("npm"),
        healthcheck: content.includes("HEALTHCHECK"),
        multiStage: content.split("\n").filter((l) => l.includes("FROM ")).length >= 2
      };
      const issues = [];
      if (!checks.nonRoot) issues.push("Missing USER node");
      if (!checks.noNpm) issues.push("npm left in runtime image");
      if (!checks.healthcheck) issues.push("Missing HEALTHCHECK");
      const status = issues.length === 0 ? "pass" : "warn";
      return {
        status,
        detail: issues.length ? issues.join("; ") : "Dockerfile hardened: non-root, HEALTHCHECK, no npm in runtime."
      };
    }
  },
  {
    name: "deps",
    label: "Dependency Audit",
    run: () => {
      const plPath = resolve(REPO_ROOT, "package-lock.json");
      if (!existsSync(plPath)) return { status: "fail", detail: "package-lock.json not found." };
      try {
        const pl = JSON.parse(readFileSync(plPath, "utf8"));
        const deps = Object.keys(pl.packages || {}).filter((k) => k);
        return { status: "pass", detail: `Lockfile present (${deps.length} packages). Run npm audit for vulnerability scan.` };
      } catch {
        return { status: "fail", detail: "package-lock.json is invalid." };
      }
    }
  },
  {
    name: "rbac",
    label: "RBAC Configuration",
    run: () => {
      const configPath = resolve(REPO_ROOT, "src", "config.js");
      if (!existsSync(configPath)) return { status: "fail", detail: "src/config.js not found." };
      const content = readFileSync(configPath, "utf8");
      const checks = {
        failsClosed: content.includes("restricted") && content.includes("hasAnyRbacPrincipal"),
        fileSecrets: content.includes("readSecret") && content.includes("_FILE"),
        validateMethods: content.includes("GET") && content.includes("POST"),
        noWriteMethod: !content.includes("PUT") && !content.includes("DELETE") && !content.includes("PATCH")
      };
      const issues = [];
      if (!checks.failsClosed) issues.push("RBAC may not fail closed");
      if (!checks.fileSecrets) issues.push("File-based secrets not supported");
      if (!checks.validateMethods) issues.push("HTTP method validation missing");
      if (!checks.noWriteMethod) issues.push("Write HTTP method detected");
      const status = issues.length === 0 ? "pass" : "warn";
      return {
        status,
        detail: issues.length ? issues.join("; ") : "RBAC fails closed, file secrets supported, read-only methods only."
      };
    }
  }
]);

export function runOperatorValidation({ checks = CHECKS } = {}) {
  const results = [];
  for (const check of checks) {
    try {
      const result = check.run();
      results.push({ name: check.name, label: check.label, ...result });
    } catch (error) {
      results.push({ name: check.name, label: check.label, status: "fail", detail: error.message || "Check failed." });
    }
  }
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  return { ok: counts.fail === 0, counts, results };
}

export function formatValidationReport({ ok, counts, results }) {
  const lines = [];
  lines.push("=== Operator Validation Report ===");
  lines.push(`Status: ${ok ? "PASS" : "FAIL"} (${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail)`);
  lines.push("");
  for (const r of results) {
    const icon = { pass: "+", warn: "!", fail: "-" }[r.status] || "?";
    lines.push(`[${icon}] ${r.label}: ${r.detail}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = runOperatorValidation();
  console.log(formatValidationReport(report));
  process.exit(report.ok ? 0 : 1);
}
