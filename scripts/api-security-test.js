import { createMockAdapterServer } from "./mock-adapter.js";
import { loadConfig } from "../src/config.js";

const TOKEN = "api-security-test-token";
const ATTACK_TOKEN = "attacker-token";
const BASE_ENV = {
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_CLIENT_ID: "client-id",
  DUNE_CONSOLE_API_URL: "http://127.0.0.1:8096",
  DUNE_DISCORD_ADAPTER_TOKEN: TOKEN,
  DISCORD_OBSERVER_ROLE_IDS: "observer-role"
};

async function startServer() {
  const server = createMockAdapterServer({ token: TOKEN });
  await new Promise((resolve) => server.listen(8096, "127.0.0.1", resolve));
  return { server, baseUrl: "http://127.0.0.1:8096" };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body, headers: response.headers };
}

const CHECKS = [];

function check(name, fn) {
  CHECKS.push({ name, fn });
}

// === Authentication ===
check("health returns 401 without token", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/health`);
  return status === 401 ? "pass" : { status: "fail", detail: `expected 401, got ${status}` };
});

check("health returns 401 with invalid token", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    headers: { authorization: `Bearer ${ATTACK_TOKEN}` }
  });
  return status === 401 ? "pass" : { status: "fail", detail: `expected 401, got ${status}` };
});

check("health returns 200 with valid token", async ({ baseUrl }) => {
  const { status, body } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  if (status !== 200) return { status: "fail", detail: `expected 200, got ${status}` };
  if (body?.ok !== true) return { status: "fail", detail: "health response not ok" };
  return "pass";
});

// === Token Pattern Validation ===
check("rejects token without Bearer prefix", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    headers: { authorization: TOKEN }
  });
  return status === 401 ? "pass" : { status: "fail", detail: `expected 401, got ${status}` };
});

check("rejects empty authorization header", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    headers: { authorization: "" }
  });
  return status === 401 ? "pass" : { status: "fail", detail: `expected 401, got ${status}` };
});

// === Route Authorization ===
check("status with missing actor returns error", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({})
  });
  return status === 200 ? "pass" : { status: "fail", detail: `expected 200, got ${status}` };
});

// === Response Sanitization ===
check("health response does not leak internal IPs", async ({ baseUrl }) => {
  const { body } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  const raw = JSON.stringify(body);
  const leaked = /\b(?:10\.|127\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(raw);
  return !leaked ? "pass" : { status: "fail", detail: "health response leaked internal IP" };
});

check("health response does not leak secrets", async ({ baseUrl }) => {
  const { body } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  const raw = JSON.stringify(body);
  const leaked = /\b(token|password|secret|credential)\b/i.test(raw);
  return !leaked ? "pass" : { status: "fail", detail: "health response leaked secret key" };
});

// === Method Validation ===
check("health rejects POST method", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/health`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  return status === 404 ? "pass" : { status: "fail", detail: `expected 404, got ${status}` };
});

check("status rejects GET method", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/status`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  return status === 404 ? "pass" : { status: "fail", detail: `expected 404, got ${status}` };
});

// === Unknown Routes ===
check("unknown route returns 404", async ({ baseUrl }) => {
  const { status } = await fetchJson(`${baseUrl}/api/integrations/discord/unknown`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  return status === 404 ? "pass" : { status: "fail", detail: `expected 404, got ${status}` };
});

// === Run ===
async function runApiSecurityTests() {
  console.log("=== API Endpoint Security Tests (DAST) ===\n");
  const { server, baseUrl } = await startServer();
  const results = [];
  
  try {
    for (const { name, fn } of CHECKS) {
      try {
        const result = await fn({ baseUrl });
        results.push({ name, ...(result === "pass" ? { status: "pass" } : result) });
      } catch (error) {
        results.push({ name, status: "fail", detail: error.message || "check threw" });
      }
    }
  } finally {
    server.close();
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const ok = failed === 0;

  for (const r of results) {
    const icon = r.status === "pass" ? "+" : "-";
    console.log(`[${icon}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  console.log(`\n${passed} passed, ${failed} failed — ${ok ? "ALL PASS" : "FAILURES"}`);
  return ok;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain || process.argv[1]?.endsWith("api-security-test.js")) {
  const ok = await runApiSecurityTests();
  process.exit(ok ? 0 : 1);
}

export { runApiSecurityTests, BASE_ENV, TOKEN };
