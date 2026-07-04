import { pathToFileURL } from "node:url";
import { AdapterClient } from "../src/adapterClient.js";
import { loadConfig } from "../src/config.js";
import { redactSecrets } from "../src/format.js";

const ROUTES = Object.freeze(["health", "status", "readiness", "services", "population", "backups", "announcements", "ops-activity", "ops-combat", "ops-resources", "ops-economy", "ops-inventory", "ops-location", "ops-soc", "ops-prometheus", "ops-dashboard"]);

const SMOKE_ACTOR = Object.freeze({
  userId: "operator-smoke-user",
  guildId: "operator-smoke-guild",
  channelId: "operator-smoke-channel",
  roleIds: ["operator-smoke-role"]
});

export function buildOperatorSmokeConfig(env = process.env) {
  return loadConfig({
    ...env,
    DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN || "operator-smoke-discord-token",
    DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID || "operator-smoke-client",
    DISCORD_OBSERVER_ROLE_IDS: env.DISCORD_OBSERVER_ROLE_IDS || "operator-smoke-role"
  });
}

export async function runOperatorSmoke({
  config = buildOperatorSmokeConfig(),
  actor = SMOKE_ACTOR,
  fetchImpl = globalThis.fetch
} = {}) {
  const client = new AdapterClient(config, { fetchImpl });
  const results = [];

  for (const route of ROUTES) {
    const methodName = routeToMethodName(route);
    const body = await client[methodName](actor);
    assertNoSensitiveContent(route, body);
    results.push({
      route,
      method: config.adapter.methods[route],
      path: config.adapter.paths[route],
      ok: body?.ok !== false
    });
  }

  return { ok: true, results };
}

function routeToMethodName(route) {
  return route.replace(/-(\w)/g, (_, c) => c.toUpperCase());
}

export function assertNoSensitiveContent(route, body) {
  const raw = JSON.stringify(body);
  const redacted = JSON.stringify(redactSecrets(body));
  if (raw !== redacted) {
    throw new Error(`Adapter ${route} response contains sensitive content that would be redacted before Discord output.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runOperatorSmoke();
    console.log("Operator adapter smoke check passed.");
    for (const item of result.results) {
      console.log(`PASS ${item.route} ${item.method} ${item.path}`);
    }
  } catch (error) {
    console.error(redactSecrets(error?.message || String(error)));
    process.exitCode = 1;
  }
}
