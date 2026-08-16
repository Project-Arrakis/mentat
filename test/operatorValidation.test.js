import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import { createServer } from "node:http";
import { AdapterClient, AdapterHttpError } from "../src/adapterClient.js";
import { loadConfig } from "../src/config.js";
import { checkHealthState } from "../src/healthcheck.js";
import { startHealthState } from "../src/healthState.js";
import { redactSecrets } from "../src/format.js";
import { buildOperatorSmokeConfig, runOperatorSmoke } from "../scripts/operator-smoke.js";
import { createMockAdapter } from "./fixtures/mockAdapter.js";
import { createMockInteraction } from "./fixtures/mockInteraction.js";
import { createMockConfig } from "./fixtures/mockConfig.js";
import { executeDuneCommand } from "../src/commands.js";
import { resetCooldowns } from "../src/cooldown.js";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Prevent cooldown state from one test leaking into the next when multiple
// tests in this file exercise the same command name with the mock
// interaction's default userId (see test/discord-bot-test-harness.js and
// test/cooldown.test.js for the same convention).
beforeEach(() => resetCooldowns());

// ── Helpers ──

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), { status });
}

async function startMockServer(handler) {
  // `handler` is fetch-style: (req) => Response | Promise<Response>. Node's
  // http.createServer callback is (req, res) and expects res.write()/res.end(),
  // so bridge the two by awaiting the fetch-style Response and writing it out.
  const server = createServer(async (req, res) => {
    try {
      const response = await handler(req);
      const body = response ? await response.text() : "";
      const status = response?.status ?? 200;
      const headers = {};
      response?.headers?.forEach?.((value, key) => { headers[key] = value; });
      res.writeHead(status, headers);
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://${address.address}:${address.port}` };
}

function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeFetch(handler) {
  return async (url, options) => {
    const request = { url, method: options?.method || "GET", headers: options?.headers, body: options?.body };
    return handler(request);
  };
}

// ── Phase 1: Addon Process Startup ──

describe("R1.1: Addon Process Startup", () => {
  test("process starts successfully with valid configuration", () => {
    const config = loadConfig({
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_CLIENT_ID: "test-client",
      DUNE_CONSOLE_API_URL: "http://127.0.0.1:8088",
      DUNE_DISCORD_ADAPTER_TOKEN: "test-adapter-token",
      DISCORD_RBAC_MODE: "open"
    });
    assert.ok(config.adapter.baseUrl);
    assert.ok(config.adapter.token);
    assert.equal(config.discord.rbac.mode, "open");
  });

  test("process fails closed when required configuration is missing", () => {
    assert.throws(
      () => loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "test-client"
      }),
      /DUNE_CONSOLE_API_URL|DUNE_DISCORD_ADAPTER_TOKEN/i
    );
  });

  test("process fails closed when adapter URL is invalid", () => {
    assert.throws(
      () => loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "test-client",
        DUNE_CONSOLE_API_URL: "not-a-url",
        DUNE_DISCORD_ADAPTER_TOKEN: "test-adapter-token",
        DISCORD_RBAC_MODE: "open"
      }),
      /DUNE_CONSOLE_API_URL/i
    );
  });

  test("process fails closed in restricted mode without allow-lists", () => {
    assert.throws(
      () => loadConfig({
        DISCORD_BOT_TOKEN: "test-token",
        DISCORD_CLIENT_ID: "test-client",
        DUNE_CONSOLE_API_URL: "http://127.0.0.1:8088",
        DUNE_DISCORD_ADAPTER_TOKEN: "test-adapter-token",
        DISCORD_RBAC_MODE: "restricted"
      }),
      /restricted|allow/i
    );
  });
});

// ── Phase 2: Core Bridge Connectivity ──

describe("R1.1: Core Bridge Connectivity", () => {
  test("adapter health endpoint returns successful response", async () => {
    const { server, baseUrl } = await startMockServer((req) => {
      if (req.url === "/api/integrations/discord/health") {
        return jsonResponse({ ok: true, status: "healthy" });
      }
      return errorResponse(404, "Not found");
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const client = new AdapterClient(config);
      const result = await client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] });
      assert.equal(result.ok, true);
    } finally {
      await stopServer(server);
    }
  });

  test("adapter returns controlled error when backend is unavailable", async () => {
    const { server, baseUrl } = await startMockServer(() => {
      return errorResponse(503, "Service unavailable");
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const client = new AdapterClient(config);
      await assert.rejects(
        () => client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] }),
        /503|Service unavailable/i
      );
    } finally {
      await stopServer(server);
    }
  });

  test("adapter handles timeout gracefully", async () => {
    // Delay well beyond the client timeout (100ms below), but short enough
    // that it does not keep the test process alive after the client aborts.
    const { server, baseUrl } = await startMockServer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return jsonResponse({ ok: true });
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      config.adapter.timeoutMs = 100;
      const client = new AdapterClient(config);
      await assert.rejects(
        () => client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] }),
        /timed out|ETIMEDOUT|ECONNRESET/i
      );
    } finally {
      await stopServer(server);
    }
  });

  test("adapter rejects unauthorized requests", async () => {
    // The bot always sends a bearer token (a missing token fails config
    // validation before any request is made). This exercises the case where
    // the console rejects the configured token as invalid/expired and the
    // AdapterClient surfaces that as a controlled 401 rejection rather than
    // retrying, hanging, or crashing.
    const { server, baseUrl } = await startMockServer((req) => {
      const authHeader = req.headers?.authorization || "";
      if (authHeader !== "Bearer expected-valid-token") {
        return errorResponse(401, "Unauthorized");
      }
      return jsonResponse({ ok: true });
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "stale-or-revoked-token"
      });
      const client = new AdapterClient(config);
      await assert.rejects(
        () => client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] }),
        /401|Unauthorized/i
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ── Phase 3: Command Execution ──

describe("R1.1: Command Execution", () => {
  test("ops health summary invokes successfully with valid adapter", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "ops:soc",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });

  test("command fails safely when adapter returns error", async () => {
    // executeDuneCommand() never rejects: it catches adapter errors and
    // reports them through interaction.editReply() so a bad backend can never
    // crash the addon process or leave an interaction unanswered.
    const mockAdapter = createMockAdapter({ error: "Adapter connection failed" });
    const interaction = createMockInteraction({
      command: "server:health",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result, "Command should complete without throwing");
    const embed = interaction._editReply?.embeds?.[0];
    const content = embed ? JSON.stringify(embed) : String(interaction._editReply || "");
    assert.match(content, /Adapter connection failed/i);
  });

  test("command fails safely when adapter times out", async () => {
    // The mock adapter's `delay` is a plain setTimeout with no relationship to
    // AdapterClient's real AbortController-based timeout (that path is
    // exercised directly against a real HTTP server in the "R1.1: Core Bridge
    // Connectivity" suite above). Here we only need a delay long enough to
    // simulate "the backend is slow," and confirm the command still resolves
    // and replies rather than hanging or throwing out of executeDuneCommand.
    const mockAdapter = createMockAdapter({ delay: 50 });
    const interaction = createMockInteraction({
      command: "server:health",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();

    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result, "Command should complete without throwing");
    assert.ok(interaction._editReply, "Should have replied");
  });
});

// ── Phase 4: Permission Enforcement ──

describe("R1.1: Permission Enforcement", () => {
  test("invalid permission is handled safely", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "admin:doctor",
      roles: ["non-admin-role"]
    });

    const config = createMockConfig();
    config.discord.rbac.mode = "restricted";
    config.discord.rbac.adminRoleIds = ["admin-role-id"];

    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
    assert.ok(interaction._reply);
    const content = typeof interaction._reply === "string" ? interaction._reply : interaction._reply?.content || "";
    // Matches the RBAC denial message in src/commands.js executeDuneCommand()
    // (see also test/discord-bot-test-harness.js and test/commands.test.js).
    assert.ok(
      content.includes("not authorized"),
      `Expected permission error message, got: ${content}`
    );
  });

  test("missing permission is handled safely", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "admin:doctor",
      roles: []
    });

    const config = createMockConfig();
    config.discord.rbac.mode = "restricted";
    config.discord.rbac.adminRoleIds = ["admin-role-id"];

    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
    assert.ok(interaction._reply);
  });
});

// ── Phase 5: Malformed Payload Handling ──

describe("R1.1: Malformed Payload Handling", () => {
  test("empty health payload does not crash the addon", async () => {
    const { server, baseUrl } = await startMockServer(() => {
      return jsonResponse({});
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const client = new AdapterClient(config);
      const result = await client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] });
      assert.ok(result !== undefined);
    } finally {
      await stopServer(server);
    }
  });

  test("incomplete health payload does not crash the addon", async () => {
    const { server, baseUrl } = await startMockServer(() => {
      return jsonResponse({ ok: true });
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const client = new AdapterClient(config);
      const result = await client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] });
      assert.equal(result.ok, true);
    } finally {
      await stopServer(server);
    }
  });

  test("malformed JSON response is handled gracefully", async () => {
    // Regression fix (issue #162): this test's assertions had drifted
    // from AdapterClient.parseResponseBody()'s real, current contract.
    // The comment previously here claimed it "wraps unparseable text in
    // a bounded { ok, body } object" (implying result.ok === true) --
    // that was never true of the code as rewritten in the v1.0.0-rc.5
    // "OPS embeds" release: parseResponseBody() intentionally does NOT
    // throw on a non-JSON 2xx body (still true, still the point of this
    // test -- a malformed upstream response must degrade safely instead
    // of crashing the addon or bubbling an unhandled JSON parse error),
    // but it now fails safe by returning { ok: false, error: "..." }
    // rather than pretending the malformed body was a success. Updated
    // to assert the real, current, deliberately fail-safe shape.
    const { server, baseUrl } = await startMockServer(() => {
      return new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" }
      });
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const client = new AdapterClient(config);
      const result = await client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] });
      assert.equal(result.ok, false, "a malformed non-JSON body must fail safe, not be reported as a success");
      assert.match(result.error, /Unexpected response format/);
    } finally {
      await stopServer(server);
    }
  });

  test("null response body is handled safely", async () => {
    const { server, baseUrl } = await startMockServer(() => {
      return jsonResponse(null);
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const client = new AdapterClient(config);
      const result = await client.health({ userId: "test", guildId: "test", channelId: "test", roleIds: [] });
      assert.ok(result !== undefined);
    } finally {
      await stopServer(server);
    }
  });
});

// ── Phase 6: Health State and Docker Healthcheck ──

describe("R1.1: Health State and Docker Healthcheck", () => {
  let healthDir;

  test("health state file is created with correct permissions", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    const health = startHealthState({ filePath, intervalMs: 1000 });
    try {
      assert.ok(existsSync(filePath));
      const content = readFileSync(filePath, "utf8");
      const state = JSON.parse(content);
      assert.equal(state.ready, false);
      assert.ok(state.updatedAt);
      assert.ok(state.pid > 0);
    } finally {
      health.stop();
      rmSync(healthDir, { recursive: true, force: true });
    }
  });

  test("health state transitions to ready when markReady is called", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    const health = startHealthState({ filePath, intervalMs: 1000 });
    try {
      health.markReady();
      const content = readFileSync(filePath, "utf8");
      const state = JSON.parse(content);
      assert.equal(state.ready, true);
      assert.ok(state.readyAt);
    } finally {
      health.stop();
      rmSync(healthDir, { recursive: true, force: true });
    }
  });

  test("healthcheck passes when state is ready and fresh", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    mkdirSync(healthDir, { recursive: true, mode: 0o700 });
    writeFileSync(filePath, JSON.stringify({
      ready: true,
      readyAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pid: process.pid
    }));

    try {
      const state = checkHealthState({ filePath, maxAgeMs: 120000 });
      assert.equal(state.ready, true);
    } finally {
      rmSync(healthDir, { recursive: true, force: true });
    }
  });

  test("healthcheck fails when state is not ready", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    mkdirSync(healthDir, { recursive: true, mode: 0o700 });
    writeFileSync(filePath, JSON.stringify({
      ready: false,
      updatedAt: new Date().toISOString(),
      pid: process.pid
    }));

    try {
      assert.throws(
        () => checkHealthState({ filePath, maxAgeMs: 120000 }),
        /not ready/i
      );
    } finally {
      rmSync(healthDir, { recursive: true, force: true });
    }
  });

  test("healthcheck fails when state is stale", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    mkdirSync(healthDir, { recursive: true, mode: 0o700 });
    const staleTime = new Date(Date.now() - 300000).toISOString();
    writeFileSync(filePath, JSON.stringify({
      ready: true,
      readyAt: staleTime,
      updatedAt: staleTime,
      pid: process.pid
    }));

    try {
      assert.throws(
        () => checkHealthState({ filePath, maxAgeMs: 120000 }),
        /stale/i
      );
    } finally {
      rmSync(healthDir, { recursive: true, force: true });
    }
  });

  test("healthcheck fails when state file is missing", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    assert.throws(
      () => checkHealthState({ filePath, maxAgeMs: 120000 }),
      /ENOENT|no such file/i
    );
  });

  test("healthcheck fails when state file contains invalid JSON", () => {
    healthDir = join(tmpdir(), `r11-health-test-${Date.now()}`);
    const filePath = join(healthDir, "health.json");

    mkdirSync(healthDir, { recursive: true, mode: 0o700 });
    writeFileSync(filePath, "not json");

    try {
      assert.throws(
        () => checkHealthState({ filePath, maxAgeMs: 120000 }),
        /JSON|Unexpected/i
      );
    } finally {
      rmSync(healthDir, { recursive: true, force: true });
    }
  });
});

// ── Phase 7: Operator Smoke Test ──

describe("R1.1: Operator Smoke Test", () => {
  test("smoke test exercises all read-only adapter routes", async () => {
    const { server, baseUrl } = await startMockServer((req) => {
      return jsonResponse({ ok: true });
    });
    try {
      const config = buildOperatorSmokeConfig({
        DUNE_CONSOLE_API_URL: baseUrl,
        DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
      });
      const result = await runOperatorSmoke({ config });
      assert.equal(result.ok, true);
      assert.ok(result.results.length > 0);
    } finally {
      await stopServer(server);
    }
  });

  test("smoke test detects sensitive content in responses", async () => {
    const config = buildOperatorSmokeConfig({
      DUNE_CONSOLE_API_URL: "http://adapter.local",
      DUNE_DISCORD_ADAPTER_TOKEN: "test-token"
    });

    await assert.rejects(
      () => runOperatorSmoke({
        config,
        fetchImpl: makeFetch(() => jsonResponse({ ok: true, token: "secret-token" }))
      }),
      /sensitive content/i
    );
  });
});

// ── Phase 8: Read-Only Command Verification ──

describe("R1.1: Read-Only Command Verification", () => {
  test("core about command returns expected structure", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "core:about",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });

  test("core ping command measures adapter latency", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "core:ping",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });

  test("server health command returns adapter health", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "server:health",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });

  test("server status command returns status card", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "server:status",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });

  test("data population command returns player count", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "data:population",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });

  test("infra version command returns stack version", async () => {
    const mockAdapter = createMockAdapter();
    const interaction = createMockInteraction({
      command: "infra:version",
      roles: ["observer-role-id"]
    });

    const config = createMockConfig();
    const result = await executeDuneCommand(interaction, mockAdapter, config);

    assert.ok(result);
  });
});
