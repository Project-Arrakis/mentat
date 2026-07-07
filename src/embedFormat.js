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
