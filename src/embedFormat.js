import { EmbedBuilder } from "discord.js";

// Atreides: Green & Gold — Nobility, Honor, Nature
// Harkonnen: Red & Black — Ruthlessness, Ambition, Power
// Fremen: Spice Blue — Desert, Melange, Blue-within-Blue Eyes
// Default (unchosen): Violet — Raw Spice
const DUNE_COLORS = {
  spice: 0x2563eb,
  sand: 0xC2A44E,
  desert: 0x8B6914,
  atreides: 0x16a34a,
  harkonnen: 0xef4444,
  fremen: 0x2563eb,
  success: 0x2ECC71,
  warning: 0xF39C12,
  error: 0xE74C3C,
};

// ── Value formatting helpers ──
function fmt(val) {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "✅ Yes" : "❌ No";
  if (typeof val === "number") return val < 10000 ? `\`${val.toLocaleString()}\`` : `\`${(val / 1000).toFixed(1)}k\``;
  const s = String(val).trim();
  if (!s) return "—";
  return `\`${s}\``;
}

function fmtBool(val) { return val ? "✅ Yes" : "❌ No"; }
function fmtCount(val) { return `\`${val ?? 0}\``; }
function fmtStatus(val) { return val ? "🟢 Enabled" : "🔒 Disabled"; }

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

const FACTION_QUOTES = {
  atreides: [
    "We are House Atreides. There is no call we do not answer. There is no faith that we betray.",
    "A great man doesn't seek to lead. He's called to it.",
    "Our strength is in our honor. Our future is in our loyalty.",
    "The Atreides legacy is built on trust, not fear.",
    "We will not abandon Arrakis. We will not abandon our duty.",
    "Leadership is not about power. It is about responsibility.",
    "The Duke Leto Atreides taught us: a leader is best when people barely know he exists.",
    "Without change, something sleeps inside us and seldom awakens.",
    "The mystery of life isn't a problem to solve, but a reality to experience.",
    "Hope strengthens the will. The Atreides banner still flies over Caladan.",
    "We fight not for glory, but for the future of all who call Arrakis home.",
    "The blood of Atreides flows through the desert. It will never dry.",
    "A ruler must be just. A leader must be present. A Duke must be both.",
    "Paul Atreides showed us: the sleeper must awaken.",
  ],
  harkonnen: [
    "The blue griffin watches from Giedi Prime. Nothing escapes its gaze.",
    "He who controls the spice controls the universe.",
    "Power is not given. It is taken.",
    "The Baron's robe is dark blue, lined with scarlet — just as our patience is lined with ambition.",
    "Mercy is a weakness we cannot afford.",
    "Fear will keep the local systems in line.",
    "The Harkonnens do not negotiate. We conquer.",
    "Glory is fleeting, but power is eternal.",
    "The blue griffin's claws reach across the Imperium.",
    "Obey or be destroyed. There is no third option.",
    "Resources exist to be extracted. Planets exist to be ruled.",
    "Giedi Prime's factories never sleep. Neither does our ambition.",
    "A Harkonnen never forgives. A Harkonnen never forgets.",
    "The Baron's spies see everything. The Baron's hand reaches everywhere.",
    "Let them hate — so long as they fear.",
    "Victory is celebrated. Defeat is punished. This is the way of Giedi Prime.",
  ],
  fremen: [
    "Bless the Maker and His water. Bless the coming and going of Him.",
    "The Fremen were supreme in the quality of their swordsmanship.",
    "Walk without rhythm and you won't attract the worm.",
    "Survival is the ability to swim in strange water.",
    "God created Arrakis to train the faithful.",
    "The desert takes the weak. The strong become Fremen.",
    "There is no escape — we pay for the violence of our ancestors.",
    "A man's flesh is his own; his water belongs to the tribe.",
    "The stillsuit is your second skin. Treat it as you would your own flesh.",
    "Shai-Hulud watches from the deep desert. Respect the Maker.",
    "The crysknife is drawn. It cannot be sheathed until it tastes blood.",
    "Water is life. The tribe's water belongs to all.",
    "The sietch walls hold a thousand years of memory.",
    "A Fremen warrior fights with the desert at their back.",
    "The spice must flow. The Fremen will ensure it.",
    "We have worm-sign the size of a carryall. The Maker comes.",
    "In the deep desert, only the strong survive. The Fremen are the strongest.",
    "Our water is our bond. Our tribe is our strength.",
    "The desert teaches patience. The worm teaches humility.",
    "Biy-la kaifa. Nothing needs be explained to the faithful.",
  ]
};

function randomQuote(faction) {
  const quotes = FACTION_QUOTES[faction] || ARRAKIS_TERMS;
  return quotes[Math.floor(Math.random() * quotes.length)];
}

function factionColor(faction) {
  if (faction === "atreides") return "atreides";
  if (faction === "harkonnen") return "harkonnen";
  if (faction === "fremen") return "fremen";
  return "spice";
}

const MAX_RANGED_AUGMENTS = 3;
const MAX_MELEE_AUGMENTS = 3;
const MAX_ARMOR_AUGMENTS = 2;

function augmentMax(item) {
  const name = (item.displayName || item.template_id || item.templateId || "").toString();
  if (/chest|armor|guard|garment|helmet|boots|gloves|suit/i.test(name)) return MAX_ARMOR_AUGMENTS;
  return MAX_RANGED_AUGMENTS;
}

export function duneEmbed({ title, color = "spice", description, fields = [], timestamp = true, faction } = {}) {
  const embedColor = faction ? (DUNE_COLORS[faction] || DUNE_COLORS[color] || DUNE_COLORS.spice) : (DUNE_COLORS[color] || DUNE_COLORS.spice);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(embedColor)
    .setFooter({ text: "Dune Awakening · Self-Host Discord Bot" });
  if (description) embed.setDescription(description);
  if (timestamp) embed.setTimestamp();
  for (const field of fields) {
    embed.addFields({ name: field.name, value: String(field.value).slice(0, 1024), inline: field.inline ?? false });
  }
  const quote = randomQuote(faction);
  embed.addFields({ name: " ", value: `*"${quote}"*`, inline: false });
  return embed;
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
      { name: "📡 Service", value: fmt(health?.service), inline: true },
      { name: "🔒 Read-Only", value: fmtBool(health?.readOnly), inline: true },
      { name: "✍️ Writes", value: fmtStatus(health?.writesEnabled), inline: true },
      { name: "🟢 Live Routes", value: fmtCount(health?.liveRoutes?.length), inline: true },
      { name: "📋 Planned Routes", value: fmtCount(health?.plannedRoutes?.length), inline: true },
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
      { name: "💬 Discord", value: `\`${ping?.discord?.deferReplyMs || 0}ms\``, inline: true },
      { name: "🔄 Adapter", value: `\`${ping?.adapter?.roundTripMs || 0}ms\``, inline: true },
      { name: "📍 Route", value: fmt(ping?.adapter?.route), inline: true },
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
      { name: "🌎 Region", value: fmt(r.region), inline: true },
      { name: "🎮 Mode", value: fmt(r.mode), inline: true },
      { name: "👥 Population", value: fmt(r.population), inline: true },
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
      { name: "Overall", value: fmt(r.overall), inline: true },
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
      { name: "🔒 Aggregate", value: fmtBool(population?.aggregate), inline: true },
      { name: "🔐 Details", value: population?.detailsSuppressed ? "🔒 Suppressed" : "⚠️ Exposed", inline: true },
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
    fields: [{ name: "📦 Total", value: fmtCount(list.length), inline: true }]
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
  return fmt(val);
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
    fields: [{ name: "🌍 Total Maps", value: fmtCount(list.length), inline: true }]
  });
}

// ── Inventory ──
export function formatInventoryEmbed(payload) {
  if (!payload?.ok) {
    return duneEmbed({
      title: "📦 Inventory",
      color: "warning",
      description: payload?.error || "Could not load inventory.",
      fields: [
        { name: "💡 Tip", value: "Use `/dune data link <character-name>` first to link your Discord to your game character." }
      ]
    });
  }
  const name = payload?.characterName || "Unknown";
  const items = payload?.rows || payload?.items || [];
  const total = payload?.count ?? payload?.totalItems ?? items.length;
  const desc = items.length === 0
    ? "*No items in inventory*"
    : items.slice(0, 25).map((item, i) => {
        const id = item.displayName || item.template_id || item.templateId || "Unknown";
        const qty = item.stack_size || item.stackSize || 0;
        const g = Number(item.quality_level || item.qualityLevel || 0);
        const grade = g > 0 ? ` G${g}` : "";
        const stats = item.stats || {};
        const augs = stats.FCustomizationStats?.[0] || [];
        const augNote = Array.isArray(augs) && augs.length > 0 ? ` [${augs.length}/${augmentMax(item)}]` : "";
        return `\`${id}\` ×${qty}${grade}${augNote}`;
      }).join("\n") + (items.length > 25 ? `\n\n*...and ${items.length - 25} more*` : "");
  return duneEmbed({
    title: `📦 ${name}'s Inventory`,
    color: "spice",
    description: desc.slice(0, 2048),
    fields: [
      { name: "📊 Total Items", value: fmtCount(total), inline: true }
    ]
  });
}

export function formatStorageEmbed(payload) {
  const groups = payload?.groups || {};
  const totalContainers = payload?.totalContainers || 0;
  const totalItems = payload?.totalItems || 0;
  const scope = payload?.scope || "owned";
  const scopeLabel = scope === "guild" ? "Guild" : "Owned";
  const desc = Object.keys(groups).length === 0
    ? `*No ${scope} storage containers found*`
    : Object.entries(groups).map(([map, containers]) => {
        return `**${map}** (${containers.length})\n` +
          containers.map(c => `  📦 \`${c.name}\` — ${c.itemCount} items`).join("\n");
      }).join("\n\n");
  return duneEmbed({
    title: `🗄️ ${scopeLabel} Storage`,
    color: "spice",
    description: desc.slice(0, 2048),
    fields: [
      { name: "📦 Containers", value: fmtCount(totalContainers), inline: true },
      { name: "📊 Items", value: fmtCount(totalItems), inline: true }
    ]
  });
}

export function formatFindEmbed(payload) {
  const query = payload?.query || "";
  const matches = payload?.matches || [];
  const totalContainers = payload?.totalContainers || 0;
  const totalStacks = payload?.totalItemStacks || 0;
  const desc = matches.length === 0
    ? `*No items matching "${query}" found*`
    : matches.map(m => {
        return `**${m.containerName}** (${m.map || "Unknown"})\n` +
          (m.items || []).map(i => `  \`${i.displayName || i.template_id || i.templateId}\` ×${i.stack_size || i.stackSize || 0}${Number(i.quality_level || i.qualityLevel || 0) > 0 ? ` G${Number(i.quality_level || i.qualityLevel || 0)}` : ""}`).join("\n");
      }).join("\n\n");
  return duneEmbed({
    title: `🔍 Search: "${query}"`,
    color: matches.length > 0 ? "success" : "warning",
    description: desc.slice(0, 2048),
    fields: [
      { name: "📦 Containers", value: fmtCount(totalContainers), inline: true },
      { name: "📊 Stacks", value: fmtCount(totalStacks), inline: true }
    ]
  });
}

// ── Link / Identity ──
export function formatLinkEmbed(payload) {
  if (!payload?.ok) {
    return duneEmbed({
      title: "🔗 Link Failed",
      color: "error",
      description: payload?.error || "Unknown error"
    });
  }
  return duneEmbed({
    title: "🔗 Character Linked",
    color: "success",
    description: `Linked as **${payload?.characterName || payload?.linked || "Unknown"}**.\nUse \`/dune data inventory\` to view your inventory.`
  });
}

export function formatUnlinkEmbed(payload) {
  return duneEmbed({
    title: "🔗 Unlinked",
    color: "spice",
    description: payload?.message || "Your Discord is no longer linked to a game character."
  });
}

export function formatWhoamiEmbed(payload) {
  if (!payload?.linked) {
    return duneEmbed({
      title: "🔗 Not Linked",
      color: "warning",
      description: "You are not linked to a game character.\nUse `/dune data link <name>` to link."
    });
  }
  return duneEmbed({
    title: "🔗 Player Identity",
    color: "success",
    description: `Character: **${payload?.characterName || "Unknown"}**`,
    fields: [
      { name: "🟢 Status", value: fmt(payload?.onlineStatus), inline: true },
      { name: "🆔 ID", value: fmt(payload?.controllerId), inline: true }
    ]
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
    fields: [{ name: "🔢 Active", value: fmtCount(entries.length), inline: true }]
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
      { name: "🔢 Requests", value: fmtCount(entries.length), inline: true },
      { name: "⏱️ Average", value: `\`${avg}ms\``, inline: true },
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
    fields: [{ name: "📝 Incidents", value: fmtCount(entries.length), inline: true }]
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
      { name: "✅ Ready", value: fmtBool(ready), inline: true },
      { name: "⚠️ Issues", value: fmtCount(issues.length), inline: true },
    ]
  });
}

export function formatServicesDetailEmbed(payload) {
  const services = payload?.services?.result?.services || [];
  const logs = payload?.logs?.logs || [];
  const mapState = payload?.mapState?.mapState || "";

  const down = services.filter(s => s.status !== "up" && s.status !== "running");
  const desc = down.length === 0
    ? "🟢 **All services healthy**"
    : `🔴 **${down.length} service(s) unhealthy**`;

  const fields = [
    { name: "📊 Total Services", value: fmtCount(services.length), inline: true },
    { name: "✅ Healthy", value: fmtCount(services.length - down.length), inline: true },
    { name: "❌ Unhealthy", value: fmtCount(down.length), inline: true },
  ];

  if (down.length > 0) {
    fields.push({
      name: "⚠️ Unhealthy Services",
      value: down.slice(0, 10).map(s => `• ${s.name || "?"}: ${s.status || "DOWN"}`).join("\n"),
      inline: false
    });
  }

  if (logs.length > 0) {
    fields.push({
      name: "📜 Recent Logs",
      value: logs.slice(-10).join("\n").slice(0, 1024),
      inline: false
    });
  }

  if (mapState) {
    fields.push({
      name: "🗺️ Map State",
      value: mapState.slice(0, 1024),
      inline: false
    });
  }

  return duneEmbed({
    title: "🔧 Services Detail",
    color: down.length === 0 ? "success" : "error",
    description: desc,
    fields
  });
}

export function formatMaintenanceEmbed(payload) {
  const maintenance = payload?.maintenance || "";
  const hasMaintenance = maintenance && maintenance.trim().length > 0;

  const desc = hasMaintenance
    ? "🔧 **Maintenance window active**"
    : "✅ **No maintenance scheduled**";

  return duneEmbed({
    title: "🛠️ Maintenance Status",
    color: hasMaintenance ? "warning" : "success",
    description: `${desc}\n\n${maintenance.slice(0, 2048)}`
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
      { name: "🗺️ Total", value: fmtCount(partitions.length), inline: true },
      { name: "🟢 Ready", value: fmtCount(running.length), inline: true }
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
    fields: [{ name: "🔢 Listeners", value: fmtCount(items.length), inline: true }]
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
    fields: [{ name: "🔢 Checks", value: fmtCount(items.length), inline: true }]
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

// ── OPS: Activity ──
export function formatActivityEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "🟢 Online (1h)", value: fmtCount(r.activeLast1h ?? r.activeLastHour), inline: true },
    { name: "🟢 Online (24h)", value: fmtCount(r.activeLast24h ?? r.activeLastDay), inline: true },
    { name: "👥 Peak Concurrent", value: fmtCount(r.peakConcurrent ?? r.peakOnline), inline: true },
    { name: "📊 Total Sessions", value: fmtCount(r.totalSessions), inline: true },
    { name: "⏱️ Avg Session", value: r.avgSessionMinutes ? `\`${r.avgSessionMinutes}m\`` : "—", inline: true },
  ];
  if (r.perGuild && Object.keys(r.perGuild).length > 0) {
    fields.push({ name: "🏰 Per-Guild Activity", value: Object.entries(r.perGuild).slice(0, 5).map(([g, c]) => `• ${g}: ${c}`).join("\n"), inline: false });
  }
  if (r.perMap && Object.keys(r.perMap).length > 0) {
    fields.push({ name: "🗺️ Per-Map Activity", value: Object.entries(r.perMap).slice(0, 5).map(([m, c]) => `• ${m}: ${c}`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "📈 Player Activity",
    color: (r.activeLast1h ?? r.activeLastHour ?? 0) > 0 ? "success" : "warning",
    description: r.activeLast1h || r.activeLastHour ? "🟢 **Players active**" : "🟡 **No recent activity**",
    fields
  });
}

// ── OPS: Combat ──
export function formatCombatEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "💀 Total Deaths", value: fmtCount(r.deaths ?? r.totalDeaths), inline: true },
    { name: "⚔️ PvP Deaths", value: fmtCount(r.pvpDeaths), inline: true },
    { name: "🐛 PvE Deaths", value: fmtCount(r.pveDeaths), inline: true },
    { name: "🏆 Top Killer", value: fmt(r.topKiller), inline: true },
    { name: "📊 K/D Ratio", value: r.kdRatio ? `\`${r.kdRatio}\`` : "—", inline: true },
  ];
  if (r.deathCauses && Object.keys(r.deathCauses).length > 0) {
    fields.push({ name: "☠️ Deaths by Cause", value: Object.entries(r.deathCauses).slice(0, 5).map(([cause, count]) => `• ${cause}: ${count}`).join("\n"), inline: false });
  }
  if (r.topPvP && Array.isArray(r.topPvP)) {
    fields.push({ name: "🥇 Top PvP", value: r.topPvP.slice(0, 3).map(p => `• ${p.name || p.character}: ${p.kills || 0} kills`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "⚔️ Combat Statistics",
    color: (r.deaths ?? r.totalDeaths ?? 0) > 0 ? "warning" : "success",
    description: r.deaths || r.totalDeaths ? "⚔️ **Combat data available**" : "🟡 **No combat data**",
    fields
  });
}

// ── OPS: Resources ──
export function formatResourcesEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "🌶️ Spice Fields", value: fmtCount(r.spiceFields), inline: true },
    { name: "💧 Water Wells", value: fmtCount(r.waterWells), inline: true },
    { name: "⛏️ Mineral Nodes", value: fmtCount(r.mineralNodes), inline: true },
    { name: "☀️ Solar Arrays", value: fmtCount(r.solarArrays), inline: true },
    { name: "🌿 Organic Farms", value: fmtCount(r.organicFarms), inline: true },
  ];
  if (r.resourceRates && Object.keys(r.resourceRates).length > 0) {
    fields.push({ name: "📊 Extraction Rates", value: Object.entries(r.resourceRates).slice(0, 5).map(([res, rate]) => `• ${res}: ${rate}/h`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "⛏️ Resource Statistics",
    color: (r.spiceFields ?? 0) > 0 ? "success" : "warning",
    description: "🏜️ **Resource field overview**",
    fields
  });
}

// ── OPS: Economy ──
export function formatEconomyEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "💰 Total Currency", value: fmtCount(r.totalCurrency ?? r.totalSolari), inline: true },
    { name: "📦 Active Orders", value: fmtCount(r.activeOrders), inline: true },
    { name: "🏛️ Total Taxes", value: fmtCount(r.totalTaxes), inline: true },
    { name: "📈 Transactions (24h)", value: fmtCount(r.transactions24h), inline: true },
    { name: "🏪 Marketplaces", value: fmtCount(r.marketplaces), inline: true },
  ];
  if (r.topTraders && Array.isArray(r.topTraders)) {
    fields.push({ name: "🥇 Top Traders", value: r.topTraders.slice(0, 3).map(t => `• ${t.name || t.character}: ${fmtCount(t.volume)}`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "💰 Economy Statistics",
    color: (r.totalCurrency ?? r.totalSolari ?? 0) > 0 ? "success" : "warning",
    description: "🪙 **Economic overview**",
    fields
  });
}

// ── OPS: Inventory ──
export function formatOpsInventoryEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "📦 Total Items", value: fmtCount(r.totalItems), inline: true },
    { name: "🔨 Crafted Items", value: fmtCount(r.craftedItems), inline: true },
    { name: "📊 Unique Templates", value: fmtCount(r.uniqueTemplates), inline: true },
    { name: "🏆 Most Common", value: fmt(r.mostCommonItem), inline: true },
    { name: "📈 Crafting Rate (24h)", value: fmtCount(r.craftingRate24h), inline: true },
  ];
  if (r.itemDistribution && Object.keys(r.itemDistribution).length > 0) {
    fields.push({ name: "📊 Item Distribution", value: Object.entries(r.itemDistribution).slice(0, 5).map(([cat, count]) => `• ${cat}: ${count}`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "📦 Inventory Statistics",
    color: (r.totalItems ?? 0) > 0 ? "success" : "warning",
    description: "🎒 **Global inventory overview**",
    fields
  });
}

// ── OPS: Location ──
export function formatLocationEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "🗺️ Active Maps", value: fmtCount(r.activeMaps), inline: true },
    { name: "📍 Total Markers", value: fmtCount(r.totalMarkers), inline: true },
    { name: "🏰 Territories", value: fmtCount(r.territories), inline: true },
    { name: "👥 Avg Density", value: r.avgDensity ? `\`${r.avgDensity}/km²\`` : "—", inline: true },
  ];
  if (r.hotspots && Array.isArray(r.hotspots)) {
    fields.push({ name: "🔥 Hotspots", value: r.hotspots.slice(0, 5).map(h => `• ${h.name || h.location}: ${h.players || h.count} players`).join("\n"), inline: false });
  }
  if (r.territoryControl && Object.keys(r.territoryControl).length > 0) {
    fields.push({ name: "🏴 Territory Control", value: Object.entries(r.territoryControl).slice(0, 5).map(([t, f]) => `• ${t}: ${f}`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "📍 Location Activity",
    color: (r.activeMaps ?? 0) > 0 ? "success" : "warning",
    description: "🗺️ **Map and territory overview**",
    fields
  });
}

// ── OPS: SOC ──
export function formatSocEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "🟢 Bridge Health", value: r.bridgeHealth === "healthy" || r.health === "ok" ? "🟢 Healthy" : "🔴 Degraded", inline: true },
    { name: "📊 Total Requests", value: fmtCount(r.totalRequests), inline: true },
    { name: "⚠️ Alerts", value: fmtCount(r.alerts), inline: true },
    { name: "📈 Avg Response", value: r.avgResponseMs ? `\`${r.avgResponseMs}ms\`` : "—", inline: true },
    { name: "🔴 Errors", value: fmtCount(r.errors), inline: true },
  ];
  if (r.endpoints && Object.keys(r.endpoints).length > 0) {
    fields.push({ name: "🔌 Endpoint Status", value: Object.entries(r.endpoints).slice(0, 5).map(([ep, s]) => `• ${ep}: ${s === "ok" ? "🟢" : "🔴"} ${s}`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "🔌 OPS Bridge Health",
    color: r.bridgeHealth === "healthy" || r.health === "ok" ? "success" : "error",
    description: r.bridgeHealth === "healthy" || r.health === "ok" ? "🟢 **All systems nominal**" : "🔴 **Bridge degraded**",
    fields
  });
}

// ── OPS: Prometheus ──
export function formatPrometheusEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [];
  if (r.containers && Array.isArray(r.containers)) {
    for (const c of r.containers.slice(0, 8)) {
      const cpu = c.cpuPercent != null ? `${c.cpuPercent}%` : "—";
      const mem = c.memoryMb != null ? `${c.memoryMb}MB` : "—";
      const restarts = c.restarts != null ? `${c.restarts}` : "—";
      const icon = c.status === "running" ? "🟢" : "🔴";
      fields.push({ name: `${icon} ${c.name || "container"}`, value: `CPU: ${cpu} · Mem: ${mem} · Restarts: ${restarts}`, inline: false });
    }
  }
  if (r.cpuAvg != null) fields.push({ name: "📊 Avg CPU", value: `\`${r.cpuAvg}%\``, inline: true });
  if (r.memAvg != null) fields.push({ name: "📊 Avg Memory", value: `\`${r.memAvg}MB\``, inline: true });
  if (r.totalRestarts != null) fields.push({ name: "🔄 Total Restarts", value: fmtCount(r.totalRestarts), inline: true });
  return duneEmbed({
    title: "📈 Infrastructure Metrics",
    color: (r.cpuAvg ?? 0) < 80 ? "success" : "warning",
    description: "🖥️ **Container and infrastructure overview**",
    fields
  });
}

// ── OPS: Dashboard ──
export function formatDashboardEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [
    { name: "🌍 Server Status", value: r.serverStatus === "healthy" || r.status === "ok" ? "🟢 Healthy" : "🔴 Issue", inline: true },
    { name: "👥 Online Players", value: fmtCount(r.onlinePlayers), inline: true },
    { name: "⚔️ Combat Events (24h)", value: fmtCount(r.combatEvents24h), inline: true },
    { name: "📦 Items Traded (24h)", value: fmtCount(r.itemsTraded24h), inline: true },
    { name: "🔌 Bridge Health", value: r.bridgeHealth === "healthy" ? "🟢 OK" : "🔴 Down", inline: true },
  ];
  if (r.summary && typeof r.summary === "object") {
    for (const [k, v] of Object.entries(r.summary).slice(0, 5)) {
      fields.push({ name: k.charAt(0).toUpperCase() + k.slice(1), value: fmt(v), inline: true });
    }
  }
  return duneEmbed({
    title: "📊 OPS Dashboard",
    color: r.serverStatus === "healthy" || r.status === "ok" ? "success" : "warning",
    description: "🏜️ **Aggregated operational summary**",
    fields
  });
}

// ── OPS: Announcements ──
export function formatAnnouncementsEmbed(payload) {
  const announcements = payload?.announcements || payload?.result?.announcements || [];
  const desc = announcements.length === 0
    ? "*No announcements*"
    : announcements.slice(0, 10).map((a, i) => {
        const time = a.timestamp || a.time || a.createdAt || "";
        const source = a.source || a.type || "system";
        return `**${i + 1}.** [${source}] ${a.message || a.text || "No message"}${time ? ` — _${time}_` : ""}`;
      }).join("\n");
  return duneEmbed({
    title: "📢 Announcements",
    color: announcements.length > 0 ? "spice" : "warning",
    description: desc.slice(0, 2048),
    fields: [{ name: "📦 Total", value: fmtCount(announcements.length), inline: true }]
  });
}
