import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8095;
const DEFAULT_TOKEN = "local-adapter-token";
const REQUEST_BODY_LIMIT = 32 * 1024;

const ROUTES = Object.freeze({
  "/api/integrations/discord/health": { method: "GET", fixture: "health.json" },
  "/api/integrations/discord/status": { method: "POST", fixture: "status.json" },
  "/api/integrations/discord/readiness": { method: "POST", fixture: "readiness.json" },
  "/api/integrations/discord/services": { method: "POST", fixture: "services.json" }
});

const DEFAULT_FIXTURE_DIR = new URL("../test/fixtures/adapter/", import.meta.url);

export function createMockAdapterServer({ token = DEFAULT_TOKEN, fixtureDir = DEFAULT_FIXTURE_DIR } = {}) {
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url || "/", "http://local.mock").pathname;
      const route = ROUTES[path];
      if (!route) return sendJson(res, 404, { ok: false, code: "adapter_route_not_found", error: "Discord adapter route not found." });

      if (bearerToken(req.headers.authorization) !== token) {
        return sendJson(res, 401, { ok: false, code: "invalid_adapter_token", error: "Missing or invalid Discord adapter bearer token." });
      }

      if (req.method !== route.method) {
        return sendJson(res, 404, { ok: false, code: "adapter_route_not_found", error: "Discord adapter route not found." });
      }

      if (route.method === "POST") await readRequestBody(req);
      const payload = await readFixture(fixtureDir, route.fixture);
      return sendJson(res, 200, payload);
    } catch (error) {
      return sendJson(res, 500, { ok: false, code: "mock_adapter_error", error: error?.message || "Mock adapter failed." });
    }
  });
}

export async function startMockAdapter({
  host = process.env.MOCK_ADAPTER_HOST || DEFAULT_HOST,
  port = Number.parseInt(process.env.MOCK_ADAPTER_PORT || String(DEFAULT_PORT), 10),
  token = process.env.DUNE_DISCORD_ADAPTER_TOKEN || DEFAULT_TOKEN
} = {}) {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error("MOCK_ADAPTER_PORT must be between 1 and 65535.");
  if (!isLoopback(host) && token === DEFAULT_TOKEN) {
    throw new Error("Set DUNE_DISCORD_ADAPTER_TOKEN before binding the mock adapter outside loopback.");
  }

  const server = createMockAdapterServer({ token });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  console.log(`Mock Discord adapter listening on ${baseUrl}`);
  console.log("Use DUNE_CONSOLE_API_URL with that base URL and DUNE_DISCORD_ADAPTER_TOKEN with your mock token.");
  console.log("Default local token is for loopback-only smoke tests: local-adapter-token");
  return server;
}

async function readFixture(fixtureDir, name) {
  const body = await readFile(new URL(name, fixtureDir), "utf8");
  return JSON.parse(body);
}

async function readRequestBody(req) {
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > REQUEST_BODY_LIMIT) throw new Error("Mock adapter request body is too large.");
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function bearerToken(value) {
  const parts = String(value || "").trim().split(/\s+/);
  return parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : "";
}

function isLoopback(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startMockAdapter();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}
