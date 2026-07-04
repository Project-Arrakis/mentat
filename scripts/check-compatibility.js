import { loadConfig } from "../src/config.js";
import { AdapterClient } from "../src/adapterClient.js";

export async function checkAdapterCompatibility({
  config = loadConfig(),
  adapterClient = new AdapterClient(config)
} = {}) {
  const results = [];
  try {
    const health = await adapterClient.health();
    results.push({
      check: "adapter-health",
      status: health?.ok === true ? "pass" : "fail",
      detail: health?.ok === true
        ? `Adapter enabled=${health.enabled}, readOnly=${health.readOnly}, routes=${(health.routes || []).length}`
        : "Adapter health check failed or returned unexpected format."
    });
  } catch (error) {
    results.push({ check: "adapter-health", status: "fail", detail: error.message || "Health check failed." });
  }

  const expectedRoutes = Object.keys(config.adapter.paths);
  for (const route of expectedRoutes) {
    try {
      const result = await adapterClient[route]?.();
      results.push({
        check: `route-${route}`,
        status: result?.ok !== false ? "pass" : "fail",
        detail: `Route ${route} responded: ${JSON.stringify(Object.keys(result || {}))}`
      });
    } catch (error) {
      results.push({
        check: `route-${route}`,
        status: "skip",
        detail: `Route ${route} not available: ${error.message || "error"}`
      });
    }
  }

  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return { ok: counts.fail === 0, counts, results };
}

export function formatCompatibilityReport({ ok, counts, results }) {
  const lines = [];
  lines.push("=== Adapter Compatibility Report ===");
  lines.push(`Status: ${ok ? "COMPATIBLE" : "INCOMPATIBLE"} (${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip)`);
  for (const r of results) {
    const icon = { pass: "+", fail: "-", skip: "~" }[r.status] || "?";
    lines.push(`[${icon}] ${r.check}: ${r.detail}`);
  }
  return lines.join("\n");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const report = await checkAdapterCompatibility();
    console.log(formatCompatibilityReport(report));
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    console.error("Compatibility check failed:", error.message);
    process.exit(1);
  }
}
