export class AdapterHttpError extends Error {
  constructor(message, { status, route, body }) {
    super(message);
    this.name = "AdapterHttpError";
    this.status = status;
    this.route = route;
    this.body = body;
  }
}

export class AdapterClient {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime.");
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  health(actor) {
    return this.request("health", actor);
  }

  status(actor) {
    return this.request("status", actor);
  }

  readiness(actor) {
    return this.request("readiness", actor);
  }


  population(actor) { return this.request("population", actor); }

  backups(actor) { return this.request("backups", actor); }

opsActivity(actor) { return this.request("ops-activity", actor); }
  opsCombat(actor) { return this.request("ops-combat", actor); }
  opsResources(actor) { return this.request("ops-resources", actor); }
  opsEconomy(actor) { return this.request("ops-economy", actor); }
  opsInventory(actor) { return this.request("ops-inventory", actor); }
  opsLocation(actor) { return this.request("ops-location", actor); }
  opsSoc(actor) { return this.request("ops-soc", actor); }
  opsPrometheus(actor) { return this.request("ops-prometheus", actor); }
  opsDashboard(actor) { return this.request("ops-dashboard", actor); }

  announcements(actor) {
    return this.request("announcements", actor);
  }
  services(actor) {
    return this.request("services", actor);
  }

  async request(route, actor) {
    const path = this.config.adapter.paths[route];
    const method = this.config.adapter.methods[route];
    if (!path || !method) throw new Error(`Unsupported adapter route: ${route}`);

    const url = new URL(path, ensureTrailingSlash(this.config.adapter.baseUrl));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.adapter.timeoutMs);

    try {
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${this.config.adapter.token}`
      };
      const options = { method, headers, signal: controller.signal };

      if (method === "POST") {
        headers["content-type"] = "application/json";
        options.body = JSON.stringify({ actor: actor || null });
      }

      const response = await this.fetchImpl(url, options);
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw new AdapterHttpError(`Adapter ${route} returned HTTP ${response.status}.`, {
          status: response.status,
          route,
          body
        });
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Adapter ${route} request timed out after ${this.config.adapter.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseResponseBody(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, body: text };
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
