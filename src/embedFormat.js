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

function randomArrakisTerm() {
  return ARRAKIS_TERMS[Math.floor(Math.random() * ARRAKIS_TERMS.length)];
}

export function statusColor(payload) {
  if (payload?.ok === false) return "error";
  if (payload?.ready === false || payload?.overall === "ISSUE") return "warning";
  return "spice";
}

// ── Health ──
export function formatHealthEmbed(health) {
  return duneEmbed({
    title: "🩺 Adapter Health",
    color: health?.ok === true ? "success" : "error",
    description: health?.ok === true ? "🟢 **Healthy** — adapter is responding" : "🔴 **Unhealthy** — check console",
    fields: [
      { name: "📡 Service", value: health?.service || "dune-console-discord-adapter", inline: true },
      { name: "🔒 Read-Only", value: health?.readOnly ? "✅ Yes" : "❌ No", inline: true },
      { name: "✍️ Writes", value: health?.writesEnabled ? "⚠️ Enabled" : "🔒 Disabled", inline: true },
      { name: "🟢 Live Routes", value: String(health?.liveRoutes?.length || 0), inline: true },
      { name: "📋 Planned", value: String(health?.plannedRoutes?.length || 0), inline: true },
    ]
  });
}

// ── Ping ──
export function formatPingEmbed(ping) {
  return duneEmbed({
    title: "🏓 Adapter Latency",
    color: ping?.ok === true ? "success" : "error",
    description: ping?.ok === true ? "🟢 **Connected**" : "🔴 **Failed**",
    fields: [
      { name: "💬 Discord", value: `${ping?.discord?.deferReplyMs || 0}ms`, inline: true },
      { name: "🔄 Adapter", value: `${ping?.adapter?.roundTripMs || 0}ms`, inline: true },
      { name: "📍 Route", value: ping?.adapter?.route || "health", inline: true },
    ]
  });
}

// ── Status (summary) ──
export function formatStatusEmbed(payload, subcommand) {
  const r = payload?.result || payload || {};
  const overall = r.overall || "UNKNOWN";
  const ok = payload?.ok !== false;
  const maps = Array.isArray(r.maps) ? r.maps : [];
  const mapStr = maps.map(m => `${m.state === "READY" ? "🟢" : "🔴"} **${m.name}**`).join(" · ") || "—";

  return duneEmbed({
    title: "🌍 Server Status",
    color: overall === "READY" ? "success" : overall === "ISSUE" ? "warning" : "error",
    description: `### ${overall === "READY" ? "🟢 READY" : overall === "ISSUE" ? "🟡 ISSUE" : "🔴 DOWN"}${r.title ? ` — *${r.title}*` : ""}`,
    fields: [
      { name: "🌎 Region", value: r.region || "—", inline: true },
      { name: "🎮 Mode", value: r.mode || "—", inline: true },
      { name: "👥 Population", value: r.population || "—", inline: true },
      { name: "🗺️ Maps", value: mapStr, inline: false },
    ]
  });
}

// ── Status (diagnostic detail) ──
export function formatStatusDetailEmbed(payload) {
  const r = payload?.result || payload || {};
  const raw = r.redactedOutput || r.output || "";

  if (raw) {
    // Parse the CLI output into sections
    const sections = parseCliSections(raw);
    const fields = [];
    for (const [name, content] of Object.entries(sections)) {
      if (content && content.length > 0) {
        fields.push({ name, value: content.slice(0, 1024), inline: false });
      }
    }
    return duneEmbed({
      title: "🔬 Detailed Status",
      color: (r.overall || "").includes("READY") ? "success" : "warning",
      description: `### ${r.overall === "READY" ? "🟢 READY" : "🟡 ISSUES"}${r.title ? ` — *${r.title}*` : ""}`,
      fields: fields.slice(0, 25),
    });
  }

  // Fallback: build from parsed data
  const maps = Array.isArray(r.maps) ? r.maps : [];
  return duneEmbed({
    title: "🔬 Detailed Status",
    color: "warning",
    description: "*(Full diagnostic output not available — adapter must support diagnostic mode)*",
    fields: [
      { name: "Overall", value: r.overall || "UNKNOWN", inline: true },
      { name: "Maps", value: maps.map(m => `${m.state === "READY" ? "🟢" : "🔴"} ${m.name}`).join("\n") || "—", inline: false },
    ]
  });
}

function parseCliSections(raw = "") {
  const sections = {};
  let current = "";
  let heading = "Overview";
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const headingMatch = trimmed.match(/^===\s+(.+?)\s+===$/);
    if (headingMatch) {
      if (sections[heading]?.length === 0) delete sections[heading];
      heading = headingMatch[1];
      sections[heading] = sections[heading] || [];
      continue;
    }
    sections[heading] = sections[heading] || [];

    // Apply emojis for common status patterns
    let formatted = trimmed;
    if (/^OK\b|^OK\s|OK$/.test(trimmed)) formatted = `🟢 ${trimmed}`;
    else if (/^WARN\b/i.test(trimmed)) formatted = `🟡 ${trimmed}`;
    else if (/^FAIL\b|^ERROR\b/i.test(trimmed)) formatted = `🔴 ${trimmed}`;
    else if (/\bREADY\b/i.test(trimmed) && /map|sietch|server/i.test(heading)) formatted = `🟢 ${trimmed}`;
    else if (/\bUp\b.*\b(hours|minutes|days)\b/i.test(trimmed)) formatted = `🟢 ${trimmed}`;
    else if (/\bExited\b|\bDown\b|\bMissing\b/i.test(trimmed)) formatted = `🔴 ${trimmed}`;
    else if (/^\w+.*(OK|ok|ready)/.test(trimmed)) formatted = `🟢 ${trimmed}`;

    sections[heading].push(formatted);
  }

  // Convert arrays to strings, trim to fit Discord field limits
  const result = {};
  for (const [name, lines] of Object.entries(sections)) {
    const joined = lines.join("\n");
    if (joined.length > 1020) {
      result[name] = joined.slice(0, 1000) + "\n... *(truncated)*";
    } else if (joined.length > 0) {
      result[name] = joined;
    }
  }
  return result;
}

// ── Population ──
export function formatPopulationEmbed(population) {
  const online = population?.online ?? "?";
  const total = population?.total ?? "?";
  return duneEmbed({
    title: "👥 Server Population",
    color: "spice",
    description: `### **${online}** / **${total}** players online`,
    fields: [
      { name: "🔒 Aggregate", value: population?.aggregate ? "✅ Yes" : "⚠️ Detail exposed", inline: true },
      { name: "🔐 Details", value: population?.detailsSuppressed ? "Suppressed" : "Exposed", inline: true },
    ]
  });
}

// ── Backups ──
export function formatBackupsEmbed(backups) {
  const list = backups?.backups || [];
  const desc = list.length === 0
    ? "*No backups found*"
    : list.map((b, i) => `**${i + 1}.** ${b.name} — ${b.date} (${b.size})`).join("\n");
  return duneEmbed({
    title: "💾 Recent Backups",
    color: list.length > 0 ? "success" : "warning",
    description: desc.slice(0, 2048),
    fields: [{ name: "📦 Total", value: String(list.length), inline: true }]
  });
}

// ── Generic / OPS ──
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
    title: `📊 ${title}`,
    color: ok ? "spice" : "error",
    description: ok ? "🟢 OK" : "🔴 Error",
    fields
  });
}

// ── Doctor ──
export function formatDoctorEmbed(doctor) {
  const fields = [
    { name: "🩺 Health", value: doctor?.health?.ok ? "🟢 OK" : "🔴 Down", inline: true },
    { name: "🌍 Status", value: doctor?.status?.ok ? "🟢 OK" : "🔴 Down", inline: true },
    { name: "🔍 Readiness", value: doctor?.readiness?.ok ? "🟢 Ready" : "🔴 Issues", inline: true },
    { name: "⚙️ Services", value: doctor?.services?.ok ? `🟢 ${doctor?.services?.count || 0} running` : "🔴 Down", inline: true },
  ];
  if (doctor?.readiness?.issues?.length > 0) {
    fields.push({ name: "⚠️ Issues", value: doctor.readiness.issues.slice(0, 5).map(i => `• ${i}`).join("\n").slice(0, 900) });
  }
  return duneEmbed({
    title: "🏥 System Diagnostic",
    color: doctor?.ok ? "success" : "warning",
    description: doctor?.ok ? "🟢 **All systems nominal**" : "⚠️ **Issues detected**",
    fields
  });
}

// ── Maps ──
export function formatMapsEmbed(maps) {
  const list = Array.isArray(maps?.maps) ? maps.maps : (Array.isArray(maps?.result?.maps) ? maps.result.maps : []);
  const desc = list.length === 0
    ? "*No map data available*"
    : list.map(m => {
        const state = m.state || m.status || "UNKNOWN";
        const icon = state === "READY" ? "🟢" : state === "STARTING" ? "🟡" : "🔴";
        return `${icon} **${m.name || "?"}** — ${state}${m.uptime ? ` (${m.uptime})` : ""}`;
      }).join("\n");
  return duneEmbed({
    title: "🗺️ Active Maps",
    color: list.some(m => (m.state || m.status) !== "READY") ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "🌍 Maps", value: String(list.length), inline: true }]
  });
}

// ── Cooldowns ──
export function formatCooldownsEmbed(stats) {
  const entries = stats?.entries || [];
  const desc = entries.length === 0
    ? "*No active cooldowns*"
    : entries.map(e => `⏳ <@${e.userId}> → \`${e.command}\` (${Math.ceil(e.remaining / 1000)}s)`).join("\n");
  return duneEmbed({
    title: "⏱️ Active Cooldowns",
    color: entries.length > 0 ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "🔢 Active", value: String(entries.length), inline: true }]
  });
}

// ── Latency ──
export function formatLatencyEmbed(history) {
  const entries = history || [];
  const avg = entries.length > 0
    ? Math.round(entries.reduce((s, e) => s + (e.durationMs || 0), 0) / entries.length)
    : 0;
  const desc = entries.slice(-10).map(e => {
    const icon = e.status === 200 ? "🟢" : "🔴";
    return `${icon} \`${e.method} ${e.route}\` — ${e.durationMs}ms`;
  }).join("\n") || "*No requests recorded yet*";
  return duneEmbed({
    title: "📡 Adapter Latency History",
    color: avg < 200 ? "success" : avg < 1000 ? "warning" : "error",
    description: `**Avg: ${avg}ms** over ${entries.length} requests\n${desc}`.slice(0, 2048),
    fields: [
      { name: "🔢 Requests", value: String(entries.length), inline: true },
      { name: "⏱️ Average", value: `${avg}ms`, inline: true },
    ]
  });
}

// ── Events ──
export function formatEventsEmbed(incidents) {
  const entries = incidents || [];
  const desc = entries.length === 0
    ? "*No incidents recorded — the desert is quiet*"
    : entries.slice(0, 15).map(e => `• **${e.type}** — ${e.detail} (_${new Date(e.time).toLocaleTimeString()}_)`).join("\n");
  return duneEmbed({
    title: "📋 Incident Log",
    color: entries.length > 0 ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "📝 Incidents", value: String(entries.length), inline: true }]
  });
}

// ── Readiness detail ──
export function formatReadinessDetailEmbed(payload) {
  const r = payload?.result || payload || {};
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const ready = r.ready !== false;
  const desc = ready
    ? "🟢 **READY** — all checks passed"
    : `🔴 **NOT READY** — ${issues.length} issue(s) detected`;

  return duneEmbed({
    title: "🔍 Readiness Check",
    color: ready ? "success" : "error",
    description: `### ${desc}\n${issues.slice(0, 15).map(i => `• ${i}`).join("\n")}`.slice(0, 2048),
    fields: [
      { name: "✅ Ready", value: ready ? "Yes" : "No", inline: true },
      { name: "⚠️ Issues", value: String(issues.length), inline: true },
    ]
  });
}
