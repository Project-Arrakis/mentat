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
const DISPLAY_NAMES = {
  overall: "Status", title: "Name", region: "Region", mode: "Mode",
  population: "Players", online: "Online", total: "Total",
  maps: "Maps", services: "Services", issues: "Issues",
  output: "Output", version: "Version", result: "Result",
  summary: "Summary", service: "Service", enabled: "Enabled",
  readOnly: "ReadOnly", writesEnabled: "Writes",
  ok: "Status", error: "Error", message: "Message",
  route: "Route", count: "Count", backups: "Backups",
  aggregate: "Aggregate", detailsSuppressed: "Suppressed",
  active: "Active", entries: "Entries",
  timestamp: "Time", health: "Health", status: "Status",
  readiness: "Readiness", ready: "Ready",
  onlinePlayers: "Online", totalPlayers: "Total",
  uptime: "Uptime", state: "State", name: "Name",
  date: "Date", size: "Size", type: "Type", detail: "Detail",
  durationMs: "Duration", roundTripMs: "Roundtrip",
  deferReplyMs: "Discord", idempotencyKey: "Idempotency",
  needsConfirmation: "Confirm?", risk: "Risk", tier: "Tier",
  family: "Family", available: "Available", locked: "Locked",
  availableCount: "Available", rbacMode: "RBAC",
};

export function formatGenericEmbed(payload, title) {
  const ok = payload?.ok !== false;
  const result = payload?.result || payload || {};
  const safe = typeof result === "object" ? result : { value: String(result) };

  // Filter out noise and flatten one level
  const fields = [];
  for (const [key, val] of Object.entries(safe)) {
    if (key === "ok" || key === "timestamp") continue;
    if (val === null || val === undefined) continue;

    const label = DISPLAY_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1");

    if (typeof val === "object" && !Array.isArray(val)) {
      // Flatten nested objects into sub-fields
      for (const [k2, v2] of Object.entries(val).slice(0, 5)) {
        if (v2 === null || v2 === undefined) continue;
        const subLabel = DISPLAY_NAMES[k2] || k2;
        fields.push({ name: `${label} › ${subLabel}`, value: formatValue(v2), inline: true });
      }
    } else if (Array.isArray(val)) {
      if (val.length === 0) continue;
      if (typeof val[0] === "object") {
        fields.push({ name: label, value: `${val.length} items`, inline: true });
      } else {
        fields.push({ name: label, value: val.slice(0, 5).map(formatValue).join("\n").slice(0, 900), inline: true });
      }
    } else {
      fields.push({ name: label, value: formatValue(val), inline: true });
    }
  }

  return duneEmbed({
    title: `📊 ${title}`,
    color: ok ? "spice" : "error",
    description: ok ? null : "🔴 Request failed",
    fields: fields.slice(0, 20)
  });
}

function formatValue(val) {
  if (typeof val === "boolean") return val ? "✅ Yes" : "❌ No";
  if (typeof val === "number") return val < 10000 ? val.toLocaleString() : `${(val / 1000).toFixed(1)}k`;
  return String(val).slice(0, 900);
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

export function formatServersEmbed(payload) {
  const output = payload?.result?.output || payload?.output || "";
  const partitions = parseServerPartitions(output);

  const running = partitions.filter(p => p.ready || p.alive);
  const desc = partitions.length === 0
    ? "*No server partitions found*"
    : partitions.slice(0, 20).map(p => {
        const icon = p.ready ? "🟢" : p.alive ? "🟡" : "🔴";
        const info = p.assigned ? `${p.assigned}` : "unassigned";
        return `${icon} **${p.map}** — ${p.label || "?"} (${info})`;
      }).join("\n");

  return duneEmbed({
    title: "🖥️ Server Partitions",
    color: running.length > 0 ? "success" : "warning",
    description: desc.slice(0, 2048),
    fields: [
      { name: "🗺️ Total", value: String(partitions.length), inline: true },
      { name: "🟢 Ready", value: String(running.length), inline: true }
    ]
  });
}

function parseServerPartitions(raw) {
  const partitions = [];
  const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.match(/^[-+\s]+$/));
  let headerFound = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^\d+\s+\|/)) {
      const cols = trimmed.split(/\s*\|\s*/);
      if (cols.length >= 9) {
        partitions.push({
          id: cols[0].trim(),
          map: cols[1].trim(),
          dim: cols[2].trim(),
          label: cols[3].trim(),
          assigned: cols[4].trim() || null,
          gamePort: cols[5].trim(),
          igwPort: cols[6].trim(),
          ready: cols[7].trim() === "true",
          alive: cols[8].trim() === "true"
        });
      }
    }
  }
  return partitions;
}

export function formatPortsEmbed(payload) {
  const output = payload?.result?.output || payload?.output || "";
  const lines = output.split(/\r?\n/).filter(l => l.trim() && !l.match(/^[-=\s]+$/) && !l.toLowerCase().includes("check") && !l.match(/^\s*$/));

  const items = [];
  for (const line of lines.slice(0, 15)) {
    const trimmed = line.trim();
    if (/^OK\b/i.test(trimmed)) items.push(`🟢 ${trimmed}`);
    else if (/^WARN\b/i.test(trimmed)) items.push(`🟡 ${trimmed}`);
    else if (/^FAIL\b/i.test(trimmed)) items.push(`🔴 ${trimmed}`);
    else items.push(trimmed);
  }

  return duneEmbed({
    title: "🔌 Network Ports",
    color: "spice",
    description: items.join("\n").slice(0, 2000) || "*No port data*",
    fields: [{ name: "Listeners", value: String(items.length), inline: true }]
  });
}

export function formatDbEmbed(payload) {
  const output = payload?.result?.output || payload?.output || "";
  const lines = output.split(/\r?\n/).filter(l => l.trim());
  const items = lines.slice(0, 10).map(l => {
    if (/^OK\b/i.test(l.trim())) return `🟢 ${l.trim()}`;
    if (/^WARN\b/i.test(l.trim())) return `🟡 ${l.trim()}`;
    return l.trim();
  });

  return duneEmbed({
    title: "🗄️ Database Status",
    color: items.some(l => l.includes("🔴") || l.includes("WARN")) ? "warning" : "success",
    description: items.join("\n").slice(0, 2000) || "*No database data*",
    fields: [{ name: "Checks", value: String(items.length), inline: true }]
  });
}

export function formatSetupEmbed(setup) {
  const inviteUrl = setup?.inviteUrl || "";
  const clientId = setup?.clientId || "?";
  const guildId = setup?.guildId || "";

  return duneEmbed({
    title: "🔧 Add This Bot to Your Server",
    color: "spice",
    description: [
      "**Host your own Dune Discord Bot.** Follow these steps to get the bot",
      "running on your server with full read-only monitoring.\n",
      "### 📋 Step 1: Invite the Bot",
      `Use this link to invite the bot to your server:`,
      `\`\`\`${inviteUrl}\`\`\``,
      `**Scopes:** \`bot\` + \`applications.commands\`  ·  **Permissions:** \`0\``,
      "",
      "### 🏷️ Step 2: Create Roles",
      "The bot uses Discord roles to control access. Create these roles:",
      "• **Dune Observer** — can use all read-only commands",
      "• **Dune Admin** — can use admin commands and diagnostics",
      "",
      "### 📐 Step 3: Find Your Role & Guild IDs",
      "1. **Enable Developer Mode:** Settings → Advanced → Developer Mode ON",
      "2. **Right-click your server icon** → Copy Server ID",
      "3. **Right-click each role** → Copy Role ID",
      `Your guild ID${guildId ? " is `" + guildId + "`" : ": *(run this command in a server to see it)*"}`,
      "",
      "### ⚙️ Step 4: Configure the Bot",
      "Add these values to your \`.env\` file:",
      "```bash",
      "DISCORD_OBSERVER_ROLE_IDS=your-observer-role-id",
      "DISCORD_ADMIN_ROLE_IDS=your-admin-role-id",
      "DISCORD_GUILD_ID=" + (guildId || "your-server-id"),
      "```",
      "",
      "📖 **Full documentation:** [Admin Guide](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/blob/main/docs/admin-guide.md)"
    ].join("\n").slice(0, 2048)
  });
}
