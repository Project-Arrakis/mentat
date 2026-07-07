import { EmbedBuilder } from "discord.js";

const DUNE_COLORS = {
  spice: 0xD4A03C,
  sand: 0xC2A44E,
  desert: 0x8B6914,
  blue: 0x1E90FF,
  deep: 0x4A3728,
  success: 0x2ECC71,
  warning: 0xF39C12,
  error: 0xE74C3C,
  info: 0x1E90FF
};

const ARRAKIS_TERMS = [
  "The spice must flow.",
  "Fear is the mind-killer.",
  "Bless the Maker and His water.",
  "Walk without rhythm.",
  "God created Arrakis to train the faithful.",
  "He who controls the spice controls the universe.",
  "A beginning is a very delicate time.",
  "Deep in the human unconscious is a pervasive need for a logical universe that makes sense.",
  "The Fremen were supreme in the quality of their swordsmanship.",
  "Survival is the ability to swim in strange water."
];

export function duneEmbed({ title, color = "spice", description, fields = [], timestamp = true } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(DUNE_COLORS[color] || DUNE_COLORS.spice)
    .setFooter({ text: `Thumper · ${randomArrakisTerm()}` });

  if (description) embed.setDescription(description);
  if (timestamp) embed.setTimestamp();

  for (const field of fields) {
    embed.addFields({ name: field.name, value: String(field.value).slice(0, 1024), inline: field.inline ?? false });
  }

  return embed;
}

export function formatHealthEmbed(health) {
  const status = health?.ok === true ? "🟢 Healthy" : "🔴 Unhealthy";
  return duneEmbed({
    title: "╔══════════════════════╗\n║   ADAPTER HEALTH     ║\n╚══════════════════════╝",
    color: health?.ok === true ? "success" : "error",
    description: `**${status}**`,
    fields: [
      { name: "Service", value: health?.service || "dune-console-discord-adapter", inline: true },
      { name: "Read-Only", value: health?.readOnly ? "✅ Yes" : "❌ No", inline: true },
      { name: "Writes Enabled", value: health?.writesEnabled ? "⚠️ Yes" : "🔒 No", inline: true },
      { name: "Live Routes", value: String(health?.liveRoutes?.length || 0), inline: true },
      { name: "Planned Routes", value: String(health?.plannedRoutes?.length || 0), inline: true }
    ]
  });
}

export function formatPingEmbed(ping) {
  return duneEmbed({
    title: "╔══════════════════════╗\n║   ADAPTER LATENCY    ║\n╚══════════════════════╝",
    color: ping?.ok === true ? "success" : "error",
    description: ping?.ok === true ? "🟢 Connected" : "🔴 Failed",
    fields: [
      { name: "Discord Response", value: `${ping?.discord?.deferReplyMs || 0}ms`, inline: true },
      { name: "Adapter Roundtrip", value: `${ping?.adapter?.roundTripMs || 0}ms`, inline: true },
      { name: "Adapter Route", value: ping?.adapter?.route || "health", inline: true }
    ]
  });
}

export function formatStatusEmbed(payload, subcommand) {
  const result = payload?.result || payload || {};
  const summary = result?.summary || result || {};
  const overall = summary.overall || result.overall || "UNKNOWN";
  const ok = payload?.ok !== false;
  return duneEmbed({
    title: `╔══════════════════════╗\n║   SERVER ${subcommand.toUpperCase().padEnd(8)} ║\n╚══════════════════════╝`,
    color: ok ? "success" : "error",
    description: ok ? `🟢 ${overall}` : `🔴 ${overall}`,
    fields: [
      { name: "Region", value: summary.region || result.region || "—", inline: true },
      { name: "Mode", value: summary.mode || result.mode || "—", inline: true }
    ].filter(f => f.value !== "—")
  });
}

export function formatPopulationEmbed(population) {
  const online = population?.online ?? "?";
  const total = population?.total ?? "?";
  return duneEmbed({
    title: "╔══════════════════════╗\n║   SERVER POPULATION  ║\n╚══════════════════════╝",
    color: "spice",
    description: `**${online}** / **${total}** players online`,
    fields: [
      { name: "Aggregate Only", value: population?.aggregate ? "✅ Yes" : "⚠️ Detail exposed", inline: true },
      { name: "Details Suppressed", value: population?.detailsSuppressed ? "🔒 Yes" : "🔓 No", inline: true }
    ]
  });
}

export function formatBackupsEmbed(backups) {
  const list = backups?.backups || [];
  const desc = list.length === 0
    ? "*No backups found.*"
    : list.map((b, i) => `${i + 1}. **${b.name}** — ${b.date} (${b.size})`).join("\n");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   RECENT BACKUPS     ║\n╚══════════════════════╝",
    color: list.length > 0 ? "success" : "warning",
    description: desc.slice(0, 2048),
    fields: [
      { name: "Total", value: String(list.length), inline: true }
    ]
  });
}

export function formatGenericEmbed(payload, title) {
  const ok = payload?.ok !== false;
  const result = payload?.result || payload || {};
  const safe = typeof result === "object" ? result : { value: String(result) };
  const fields = Object.entries(safe)
    .filter(([k]) => !["ok"].includes(k))
    .slice(0, 25)
    .map(([k, v]) => ({
      name: k,
      value: typeof v === "object" ? JSON.stringify(v).slice(0, 900) : String(v).slice(0, 900),
      inline: true
    }));

  return duneEmbed({
    title: `╔══════════════════════╗\n║   ${title.toUpperCase().padEnd(8)} ║\n╚══════════════════════╝`,
    color: ok ? "spice" : "error",
    description: ok ? "🟢 OK" : "🔴 Error",
    fields
  });
}

export function formatDoctorEmbed(doctor) {
  const fields = [
    { name: "Health", value: doctor?.health?.ok ? "🟢 OK" : "🔴 Down", inline: true },
    { name: "Status", value: doctor?.status?.ok ? "🟢 OK" : "🔴 Down", inline: true },
    { name: "Readiness", value: doctor?.readiness?.ok ? "🟢 Ready" : "🔴 Issues", inline: true },
    { name: "Services", value: doctor?.services?.ok ? `🟢 ${doctor?.services?.count || 0} running` : "🔴 Down", inline: true }
  ];

  if (doctor?.readiness?.issues?.length > 0) {
    fields.push({
      name: "Readiness Issues",
      value: doctor.readiness.issues.slice(0, 5).join("\n").slice(0, 900)
    });
  }

  return duneEmbed({
    title: "╔══════════════════════╗\n║   SYSTEM DIAGNOSTIC  ║\n╚══════════════════════╝",
    color: doctor?.ok ? "success" : "warning",
    description: doctor?.ok ? "🟢 All systems nominal" : "⚠️ Issues detected",
    fields
  });
}

function randomArrakisTerm() {
  return ARRAKIS_TERMS[Math.floor(Math.random() * ARRAKIS_TERMS.length)];
}

export function statusColor(payload) {
  if (payload?.ok === false) return "error";
  if (payload?.ready === false || payload?.overall === "ISSUE") return "warning";
  return "spice";
}

export function formatMapsEmbed(maps) {
  const list = Array.isArray(maps?.maps) ? maps.maps : (Array.isArray(maps?.result?.maps) ? maps.result.maps : []);
  const desc = list.length === 0
    ? "*No map data available*"
    : list.map((m) => {
        const state = m.state || m.status || "UNKNOWN";
        const icon = state === "READY" ? "🟢" : state === "STARTING" ? "🟡" : "🔴";
        return `${icon} **${m.name || "?"}** — ${state} (${m.uptime || "?"})`;
      }).join("\n");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   ACTIVE MAPS        ║\n╚══════════════════════╝",
    color: list.some(m => (m.state || m.status) !== "READY") ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "Maps", value: String(list.length), inline: true }]
  });
}

export function formatCooldownsEmbed(stats) {
  const entries = stats?.entries || [];
  const desc = entries.length === 0
    ? "*No active cooldowns*"
    : entries.map((e) => `**${e.userId}** → \`${e.command}\` (${Math.ceil(e.remaining / 1000)}s remaining)`).join("\n");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   ACTIVE COOLDOWNS   ║\n╚══════════════════════╝",
    color: entries.length > 0 ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "Active", value: String(entries.length), inline: true }]
  });
}

export function formatLatencyEmbed(history) {
  const entries = history || [];
  const avg = entries.length > 0
    ? Math.round(entries.reduce((s, e) => s + (e.durationMs || 0), 0) / entries.length)
    : 0;
  const desc = entries.slice(-10).map((e) => {
    const icon = e.status === 200 ? "🟢" : "🔴";
    return `${icon} \`${e.method} ${e.route}\` — ${e.durationMs}ms`;
  }).join("\n") || "*No requests recorded yet*";

  return duneEmbed({
    title: "╔══════════════════════╗\n║   ADAPTER LATENCY    ║\n╚══════════════════════╝",
    color: avg < 200 ? "success" : avg < 1000 ? "warning" : "error",
    description: `**Avg: ${avg}ms** over ${entries.length} requests\n${desc}`.slice(0, 2048),
    fields: [
      { name: "Total Requests", value: String(entries.length), inline: true },
      { name: "Average", value: `${avg}ms`, inline: true }
    ]
  });
}

export function formatEventsEmbed(incidents) {
  const entries = incidents || [];
  const desc = entries.length === 0
    ? "*No incidents recorded*"
    : entries.slice(0, 15).map((e, i) => `**${e.type}** — ${e.detail} (_${new Date(e.time).toLocaleTimeString()}_)`).join("\n");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   INCIDENT LOG       ║\n╚══════════════════════╝",
    color: entries.length > 0 ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "Incidents", value: String(entries.length), inline: true }]
  });
}

export function formatStatusDetailEmbed(payload) {
  const r = payload?.result || payload || {};
  const maps = Array.isArray(r.maps) ? r.maps : [];
  const issues = Array.isArray(r.issues) ? r.issues : [];

  // Build CLI-style summary
  const summary = [
    `\`\`\``,
    `=== Dune Status ===`,
    `Overall:     ${r.overall || "UNKNOWN"}`,
    `Title:       ${r.title || "?"}`,
    `Region:      ${r.region || "?"}`,
    `Mode:        ${r.mode || "?"}`,
    `Population:  ${r.population || "?"}`,
  ];

  if (r.battlegroup) summary.push(`Battlegroup: ${r.battlegroup}`);
  if (r.serverIP) summary.push(`Server IP:   ${r.serverIP}`);

  // Maps section
  if (maps.length > 0) {
    summary.push("");
    summary.push("--- Maps ---");
    for (const m of maps) {
      const icon = (m.state || m.status) === "READY" ? "READY" : (m.state || m.status || "?");
      summary.push(`${m.name || "?"} — ${icon} (${m.uptime || "?"})`);
    }
  }

  // Issues
  if (issues.length > 0) {
    summary.push("");
    summary.push("--- Issues ---");
    for (const issue of issues) summary.push(`⚠ ${issue}`);
  }

  summary.push("\`\`\`");

  const text = summary.join("\n");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   DIAGNOSTIC STATUS  ║\n╚══════════════════════╝",
    color: r.overall === "READY" ? "success" : "warning",
    description: text.slice(0, 2048),
    fields: [
      { name: "Maps", value: String(maps.length), inline: true },
      { name: "Issues", value: String(issues.length), inline: true }
    ]
  });
}

export function formatReadinessDetailEmbed(payload) {
  const r = payload?.result || payload || {};
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const ready = r.ready !== false;

  const text = [
    "\`\`\`",
    `=== Readiness Check ===`,
    `Status:      ${ready ? "READY ✅" : "NOT READY ❌"}`,
    `Overall:     ${r.overall || (ready ? "READY" : "ISSUE")}`,
  ];

  if (issues.length > 0) {
    text.push("");
    text.push("--- Issues ---");
    for (const issue of issues.slice(0, 15)) text.push(`⚠ ${issue}`);
  } else {
    text.push("");
    text.push("No issues detected.");
  }

  text.push("\`\`\`");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   DIAGNOSTIC READY   ║\n╚══════════════════════╝",
    color: ready ? "success" : "error",
    description: text.join("\n").slice(0, 2048),
    fields: [
      { name: "Ready", value: ready ? "✅ Yes" : "❌ No", inline: true },
      { name: "Issues", value: String(issues.length), inline: true }
    ]
  });
}

export function formatDoctorDetailEmbed(payload) {
  const r = payload || {};
  const text = [
    "\`\`\`",
    `=== System Diagnostic ===`,
    `Health:      ${r.health?.ok ? "✅ OK" : "❌ Down"}`,
    `  Enabled:   ${r.health?.enabled ? "Yes" : "No"}`,
    `  ReadOnly:  ${r.health?.readOnly ? "Yes" : "No"}`,
    `  Writes:    ${r.health?.writesEnabled ? "On" : "Off (disabled)"}`,
    "",
    `Status:      ${r.status?.ok ? "✅ OK" : "❌ Failed"}`,
    `  Overall:   ${r.status?.summary?.overall || "?"}`,
    "",
    `Readiness:   ${r.readiness?.ok ? "✅ Ready" : "❌ Issues"}`,
    `  Ready:     ${r.readiness?.ready ? "Yes" : "No"}`,
    `  Issues:    ${r.readiness?.issues?.length || 0}`,
    "",
    `Services:    ${r.services?.ok ? "✅ OK" : "❌ Failed"}`,
    `  Overall:   ${r.services?.overall || "?"}`,
    `  Running:   ${r.services?.count || 0}`,
    "\`\`\`"
  ].join("\n");

  return duneEmbed({
    title: "╔══════════════════════╗\n║   FULL DIAGNOSTIC    ║\n╚══════════════════════╝",
    color: r.ok ? "success" : "warning",
    description: text.slice(0, 2048),
    fields: [
      { name: "Timestamp", value: r.timestamp || "?", inline: true }
    ]
  });
}
