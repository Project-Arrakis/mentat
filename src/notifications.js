import { redactSecrets } from "./format.js";

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

export function alertSubscriber({
  adapterClient,
  client,
  channelId,
  onError = () => {}
} = {}) {
  const digestFormatter = createDigestFormatter();

  return {
    async checkReadiness() {
      try {
        const readiness = await adapterClient.readiness(defaultActor());
        const alert = digestFormatter.formatReadinessAlert(readiness);
        if (alert) {
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased?.()) await channel.send(alert);
        }
      } catch (error) {
        onError(error);
      }
    },

    async checkServices() {
      try {
        const services = await adapterClient.services(defaultActor());
        const alert = digestFormatter.formatServicesAlert(services);
        if (alert) {
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased?.()) await channel.send(alert);
        }
      } catch (error) {
        onError(error);
      }
    }
  };
}

function defaultActor() {
  return { userId: "scheduler", guildId: "scheduler", channelId: "scheduler", roleIds: [] };
}
