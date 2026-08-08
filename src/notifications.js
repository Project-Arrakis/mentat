import { redactSecrets } from "./format.js";

const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

function envFlag(envVar, defaultValue) {
  const val = process.env[envVar];
  if (val === "0" || val === "false") return false;
  if (val === "1" || val === "true") return true;
  return defaultValue;
}

export function createDigestFormatter(config = {}) {
  const maxDetailLength = Number.parseInt(process.env.DUNE_DIGEST_MAX_DETAIL_LENGTH || "300", 10) || 300;

  return {
    formatStatusDigest(statusResult) {
      const summary = statusResult?.result?.summary || {};
      const lines = [];
      lines.push("**Incident Digest**");
      lines.push(`Overall: ${summary.overall || "UNKNOWN"}`);
      lines.push(`Region: ${summary.region || "unknown"}`);
      lines.push(`Mode: ${summary.mode || "unknown"}`);
      if (summary.population) lines.push(`Population: ${summary.population}`);
      return redactSecrets(lines.join("\n").slice(0, maxDetailLength));
    },

    formatReadinessAlert(readinessResult) {
      const result = readinessResult?.result || {};
      const lines = [];
      if (!result.ready) {
        lines.push("**Readiness Alert: NOT READY**");
        if (Array.isArray(result.issues)) {
          for (const issue of result.issues.slice(0, 5)) {
            lines.push(`- ${String(issue).slice(0, 120)}`);
          }
        }
      }
      return lines.length ? redactSecrets(lines.join("\n").slice(0, maxDetailLength)) : null;
    },

    formatServicesAlert(servicesResult) {
      const result = servicesResult?.result || {};
      const services = result.services || [];
      const down = services.filter((s) => s.status !== "up" && s.status !== "running");
      if (down.length === 0) return null;
      const lines = [];
      lines.push("**Service Alert**");
      for (const svc of down.slice(0, 5)) {
        lines.push(`- ${svc.name || "unknown"}: ${svc.status || "DOWN"}`);
      }
      return redactSecrets(lines.join("\n").slice(0, maxDetailLength));
    }
  };
}

// Shared low-level "post one message to one Discord text channel" step.
// Both alertSubscriber() below and statsPusher.js's write-failure
// alerting (KV-4, docs/remediation-prompt-cross-repo.md Phase 3) go
// through this single function, so there is exactly one place that
// knows how to reach Discord for an operational alert -- reusing it for
// stats-push failures rather than inventing a second, parallel
// notification mechanism (e.g. a webhook), per that phase's explicit
// instruction to check for and reuse an existing pattern first.
export async function sendChannelAlert(client, channelId, message) {
  if (!message || !client || !channelId) return false;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) return false;
  await channel.send(message);
  return true;
}

export function alertSubscriber({
  adapterClient,
  client,
  channelId,
  onError = () => {}
} = {}) {
  const digestFormatter = createDigestFormatter();
  const cooldowns = new Map();

  function isCooledDown(checkName) {
    const last = cooldowns.get(checkName) || 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
    cooldowns.set(checkName, Date.now());
    return true;
  }

  async function checkAndAlert(checkName, { getData, format, enabled = true }) {
    if (!enabled) return;
    try {
      const data = await getData();
      const alert = typeof format === "function" ? format(data) : digestFormatter[format](data);
      if (alert && isCooledDown(checkName)) {
        await sendChannelAlert(client, channelId, alert);
      }
    } catch (error) {
      onError(error);
    }
  }

  return {
    // ── original checks ──
    async checkReadiness() {
      await checkAndAlert("readiness", {
        getData: () => adapterClient.readiness(defaultActor()),
        format: (d) => digestFormatter.formatReadinessAlert(d)
      });
    },

    async checkServices() {
      await checkAndAlert("services", {
        getData: () => adapterClient.services(defaultActor()),
        format: (d) => digestFormatter.formatServicesAlert(d)
      });
    },

    // ── new game-level checks ──
    async checkPopulation() {
      if (!envFlag("DUNE_ALERT_POPULATION_ENABLED", true)) return;
      await checkAndAlert("population", {
        getData: async () => {
          const activity = await adapterClient.opsActivity(defaultActor());
          return activity?.result || activity || {};
        },
        format: (d) => {
          const online = d.onlinePlayers ?? 0;
          if (online === 0) return "**Population Alert**\nServer has zero online players.";

          // spike/drop check
          const prev = this._prevPopulation;
          this._prevPopulation = online;
          if (prev !== undefined && prev > 0) {
            const change = ((online - prev) / prev) * 100;
            if (Math.abs(change) >= 50) {
              return `**Population Change**\nOnline players: ${prev} \u2192 ${online} (${change > 0 ? "+" : ""}${Math.round(change)}% change).`;
            }
          }
          return null;
        }
      });
    },

    async checkSpiceFields() {
      if (!envFlag("DUNE_ALERT_SPICE_ENABLED", true)) return;
      await checkAndAlert("spice", {
        getData: async () => {
          const resources = await adapterClient.opsResources(defaultActor());
          return resources?.result || resources || {};
        },
        format: (d) => {
          const dd = d.deepDesert?.summary?.totalActiveFields ?? null;
          const hb = d.haggaBasin?.summary?.totalActiveFields ?? null;
          if (dd === 0 && hb === 0) {
            return "**Spice Depletion Alert**\nAll spice fields are depleted across Deep Desert and Hagga Basin.";
          }
          return null;
        }
      });
    },

    async checkDbHealth() {
      if (!envFlag("DUNE_ALERT_DB_HEALTH_ENABLED", true)) return;
      await checkAndAlert("dbhealth", {
        getData: async () => {
          const db = await adapterClient.db(defaultActor());
          return db?.result || db || {};
        },
        format: (d) => {
          if (d.healthy === false || d.status === "unhealthy") {
            return `**Database Health Alert**\nDB check returned: ${d.status || "unhealthy"}.${d.error ? ` Error: ${d.error}` : ""}`;
          }
          return null;
        }
      });
    },

    async checkBridgeErrors() {
      if (!envFlag("DUNE_ALERT_BRIDGE_ENABLED", true)) return;
      await checkAndAlert("bridge", {
        getData: async () => {
          const soc = await adapterClient.opsSoc(defaultActor());
          return soc?.result || soc || {};
        },
        format: (d) => {
          const errors = d.bridgeErrors ?? 0;
          if (errors > 5) {
            return `**Bridge Error Alert**\nConsole bridge error rate elevated: ${errors} errors since last Console restart.`;
          }
          return null;
        }
      });
    }
  };
}

function defaultActor() {
  return { userId: "scheduler", username: "ACP", guildId: "scheduler", channelId: "scheduler", roleIds: [] };
}
