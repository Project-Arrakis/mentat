import { EmbedBuilder } from "discord.js";
import { ARRAKIS_TERMS, FACTION_QUOTES, randomQuote } from "./quotes.js";

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
  if (val === null || val === undefined) return "— None —";
  if (typeof val === "boolean") return val ? "✅ Yes" : "❌ No";
  if (typeof val === "number") return val < 10000 ? `\`${val.toLocaleString()}\`` : `\`${(val / 1000).toFixed(1)}k\``;
  let s = String(val).trim();
  if (!s) return "— None —";
  // #218/P4: truncate BEFORE wrapping in markdown, so a downstream
  // 1024-char field slice can never cut a closing ** off and corrupt
  // the rest of the field's rendering.
  if (s.length > 1000) s = `${s.slice(0, 999)}…`;
  return `**${s}**`;
}

function fmtBool(val) { return val === true ? "✅ Yes" : val === false ? "❌ No" : "— Unknown —"; }
function fmtCount(val) { return val != null ? `\`${val}\`` : "— None —"; }
function fmtStatus(val) { return val ? "🟢 Enabled" : "🔒 Disabled"; }
function fmtEmpty(val, fallback = "— None —") { return val != null && String(val).trim() ? String(val) : fallback; }

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
  const name = (item.display_name || item.displayName || item.template_id || item.templateId || "").toString();
  if (/chest|armor|guard|garment|helmet|boots|gloves|suit/i.test(name)) return MAX_ARMOR_AUGMENTS;
  return MAX_RANGED_AUGMENTS;
}

export function duneEmbed({ title, color = "spice", description, fields = [], timestamp = true, faction, quote: includeQuote } = {}) {
  const embedColor = faction ? (DUNE_COLORS[faction] || DUNE_COLORS[color] || DUNE_COLORS.spice) : (DUNE_COLORS[color] || DUNE_COLORS.spice);
  // #218/PR1: never append a flavor quote to an error embed — a random
  // faction quote ("Obey or be destroyed.") under a denial or failure
  // reads as taunting the user. Callers may override via `quote`.
  const showQuote = includeQuote ?? color !== "error";
  // #217/C2: the footer carries the brand only. setTimestamp() below
  // already renders the time localized to each viewer — the old text
  // time duplicated it in the SERVER's locale/timezone, not theirs.
  const footerText = "🏜️ Dune: Awakening Docker — Sentinel";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(embedColor)
    .setFooter({ text: footerText, iconURL: undefined });
  if (description) embed.setDescription(description);
  if (timestamp) embed.setTimestamp();

  // #218/T3: never silently drop overflow fields — Discord allows 25;
  // reserve one for the quote (when shown) and one for an explicit
  // overflow marker whenever anything would be cut.
  const maxData = showQuote ? 24 : 25;
  let dataFields = fields;
  let dropped = 0;
  if (fields.length > maxData) {
    dataFields = fields.slice(0, maxData - 1);
    dropped = fields.length - dataFields.length;
  }
  for (const field of dataFields) {
    embed.addFields({ name: String(field.name).slice(0, 256), value: String(field.value).slice(0, 1024), inline: field.inline ?? false });
  }
  if (dropped > 0) {
    embed.addFields({ name: "…", value: `*…and ${dropped} more entr${dropped === 1 ? "y" : "ies"} not shown*`, inline: false });
  }

  if (showQuote) {
    embed.addFields({ name: "\u200b", value: `*"${randomQuote(faction)}"*`, inline: false });
  }

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
  const mapStr = maps.length === 0
    ? "— No map data available —"
    : maps.map(m => `${m.state === "READY" ? "🟢" : "🔴"} **${m.name || "Unknown Map"}**`).join(" · ");

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

  // Fallback: show available data, note that CLI detail wasn't returned
  const maps = Array.isArray(r.maps) ? r.maps : [];
  const isReady = (r.overall || "").includes("READY");
  return duneEmbed({
    title: "🔬 Detailed Status",
    color: isReady ? "success" : "warning",
    description: isReady ? "🟢 **Server is running**" : "🟡 Issues detected",
    fields: [
      { name: "Overall", value: fmt(r.overall), inline: true },
      { name: "Maps", value: maps.map(m => `${m.state === "READY" ? "🟢" : "🔴"} ${m.name}`).join("\n") || "— None —", inline: false },
      { name: "Diagnostic Detail", value: "Container-level CLI output (CPU, memory, uptime per service) was not returned. The server may be starting up or the status command timed out. Check the console web UI or server logs directly.", inline: false }
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
  // #215/A7: only claim (green) success when a real number came back —
  // the old code substituted the truthy string "unknown", rendering a
  // green "**unknown** / **unknown** players online".
  const online = population?.online;
  const total = population?.total;
  const hasData = typeof online === "number" || (typeof online === "string" && online !== "" && online !== "unknown");
  return duneEmbed({
    title: "👥 Server Population",
    color: hasData ? "success" : "warning",
    description: hasData
      ? `### **${online}** / **${total ?? "?"}** players online`
      : "🟡 **Population data unavailable** — the console did not return player counts.",
    fields: [
      { name: "🔒 Aggregate", value: fmtBool(population?.aggregate), inline: true },
      // "Visible" is honest without reading like a breach report the way
      // "⚠️ Exposed" did to every player (#215/A7).
      { name: "🔐 Details", value: population?.detailsSuppressed ? "🔒 Suppressed" : "👁️ Visible", inline: true },
    ]
  });
}

// ── Backups ──
export function formatBackupsEmbed(backups) {
  const list = backups?.backups || [];
  const desc = list.length === 0
    ? "— No backups found —"
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
  // #210/P2: "availableCount" previously also mapped to "Available",
  // rendering two identically-named fields in one embed.
  availableCount: "Available Count", rbacMode: "RBAC",
};

// #217/C5: shared label prettifier so nested sub-keys get the same
// capitalization treatment as top-level keys ("Registry › Groups", not
// "Registry › groups").
function displayLabel(key) {
  return DISPLAY_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1");
}

export function formatGenericEmbed(payload, title) {
  const ok = payload?.ok !== false;
  const result = payload?.result || payload || {};
  const safe = typeof result === "object" ? result : { value: String(result) };

  // Filter out noise and flatten one level
  const fields = [];
  for (const [key, val] of Object.entries(safe)) {
    if (key === "ok" || key === "timestamp") continue;
    if (val === null || val === undefined) {
        fields.push({ name: key, value: "— None —", inline: true });
        continue;
      }

    const label = displayLabel(key);

    if (typeof val === "object" && !Array.isArray(val)) {
      // Flatten nested objects into sub-fields
      for (const [k2, v2] of Object.entries(val).slice(0, 5)) {
        if (v2 === null || v2 === undefined) continue;
        fields.push({ name: `${label} › ${displayLabel(k2)}`, value: formatValue(v2), inline: true });
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

  // #217/C5: title-case the label so generic titles match the dedicated
  // embeds' casing ("📊 Verify", not "📊 verify").
  const displayTitle = String(title).charAt(0).toUpperCase() + String(title).slice(1);
  return duneEmbed({
    title: `📊 ${displayTitle}`,
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
    ? "— No map data available —"
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
  if (!payload?.ok && !payload?.rows) {
    return duneEmbed({
      title: "📦 Inventory",
      color: "warning",
      description: payload?.error || "Could not load inventory.",
      fields: [
        { name: "💡 Tip", value: "Use `/dune player link <character-name>` first to link your Discord to your game character." }
      ]
    });
  }
  const name = payload?.characterName || "Unknown";
  const items = payload?.rows || payload?.items || [];
  const total = payload?.count ?? payload?.totalItems ?? items.length;
  const desc = items.length === 0
    ? "— No items in inventory —"
    : items.slice(0, 25).map((item, i) => {
        const id = item.display_name || item.displayName || item.template_id || item.templateId || "Unknown";
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

// FIX (2026-07-27, found via a real live user report: /dune player
// storage showed "No owned storage containers found" despite a real
// base with 5 real containers, including a Spice Silo full of Stone).
// This formatter previously read payload.groups / totalContainers /
// totalItems (a nested map-of-arrays shape with camelCase c.name /
// c.itemCount fields) -- a contract that Core's playerStorageProvider
// (console/api/src/integrations/discord/inventoryProvider.js) has
// NEVER actually returned, since this formatter was first added
// (commit a15d4a8, 2026-07-20). Core has always returned a flat
// { grouped: [...], rows: [...], count } shape: grouped is an array of
// containers, each with container_id/container_name/item_count/items
// (see groupByContainer() in inventoryProvider.js). Rewritten to match
// Core's real, current shape.
export function formatStorageEmbed(payload) {
  const containers = payload?.grouped || [];
  const scope = payload?.scope || "owned";
  const scopeLabel = scope === "guild" ? "Guild" : "Owned";
  const desc = containers.length === 0
    ? `— No ${scope} storage containers found —`
    : containers.map(c => `📦 \`${c.container_name}\` — ${c.item_count} item${c.item_count === 1 ? "" : "s"}`).join("\n");
  const totalItems = containers.reduce((sum, c) => sum + (Number(c.item_count) || 0), 0);
  return duneEmbed({
    title: `🗄️ ${scopeLabel} Storage`,
    // #215/A5: key on the containers actually rendered (payload.grouped)
    // — payload.containers never exists, so success renders orange.
    color: containers.length ? "success" : "warning",
    description: desc.slice(0, 2048),
    fields: [
      { name: "📦 Containers", value: fmtCount(payload?.count ?? containers.length), inline: true },
      { name: "📊 Items", value: fmtCount(totalItems), inline: true }
    ]
  });
}

// Same class of fix as formatStorageEmbed above, same live bug report.
// Core's itemSearchProvider groups matches by item type (template_id),
// not by container -- each item in a group now carries its own
// container_name/map (added directly in duneDb.js's
// searchItemsInContainers() SQL, a companion fix to this one, since
// Core never supplied those fields either). Grouping by item type
// rather than by container matches what a player actually wants from
// "find": "where are all my X", not "what's in container Y".
export function formatFindEmbed(payload) {
  const query = payload?.query || "";
  const groups = payload?.grouped || [];
  const rows = payload?.rows || [];
  const desc = groups.length === 0
    ? `— No items matching "${query}" found —`
    : groups.map(g => {
        const name = g.items?.[0]?.display_name || g.items?.[0]?.displayName || g.template_id;
        const byContainer = g.items.map(i => `  📍 \`${i.container_name || "Unknown"}\` (${i.map || "Unknown"}) ×${i.stack_size || i.stackSize || 0}${Number(i.quality_level || i.qualityLevel || 0) > 0 ? ` G${Number(i.quality_level || i.qualityLevel || 0)}` : ""}`).join("\n");
        return `**${name}** — ${g.total_count} total\n${byContainer}`;
      }).join("\n\n");
  return duneEmbed({
    title: `🔍 Search: "${query}"`,
    color: groups.length > 0 ? "success" : "warning",
    description: desc.slice(0, 2048),
    fields: [
      { name: "📦 Item Types", value: fmtCount(groups.length), inline: true },
      { name: "📊 Stacks", value: fmtCount(rows.length), inline: true }
    ]
  });
}

// ── Link / Identity ──
// FIX (2026-07-27, found via a real live report): re-linking an
// already-linked character now short-circuits on the Core side
// (linkPlayerProvider() in dune-awakening-selfhost-docker) with a
// distinct { ok: true, alreadyLinked: true, message: "..." } response --
// no whisper sent, no Steam-link round-trip, and a real, custom
// (Fremen-styled, per explicit operator direction) message explaining
// nothing needed to happen. This formatter previously ignored both
// alreadyLinked and message entirely, always showing the identical
// generic "🔗 Character Linked / Linked as X" text regardless -- so a
// real operator saw the SAME generic success message three times in a
// row for three different re-link attempts, with no visible difference
// from an actual fresh link, and never saw Core's own explanatory text
// at all. Now checks alreadyLinked first and displays Core's own
// message verbatim with a distinct title, before falling through to the
// original fresh-link copy for a genuine new link.
export function formatLinkEmbed(payload) {
  if (!payload?.ok && !payload?.alreadyLinked && !payload?.playerControllerId) {
    return duneEmbed({
      title: "🔗 Link Failed",
      color: "error",
      description: payload?.error || "Unknown error"
    });
  }
  if (payload?.alreadyLinked) {
    return duneEmbed({
      title: "🔗 Already Linked",
      color: "spice",
      description: payload?.message || `You are already linked as **${payload?.characterName || "Unknown"}**.`
    });
  }
  return duneEmbed({
    title: "🔗 Character Linked",
    color: "success",
    description: `Linked as **${payload?.characterName || payload?.linked || "Unknown"}**.\nUse \`/dune player inventory\` to view your inventory.`
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
  if (!payload?.characterName) {
    return duneEmbed({
      title: "🔗 Not Linked",
      color: "warning",
      description: "You are not linked to a game character.\nUse `/dune player link <name>` to link."
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
    ? "— No active cooldowns —"
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
  const desc = entries.length === 0
    ? "— No requests recorded yet —"
    : entries.slice(-10).map(e => {
        const icon = e.status === 200 ? "🟢" : "🔴";
        return `${icon} \`${e.method} ${e.route}\` — ${e.durationMs}ms`;
      }).join("\n");
  return duneEmbed({
    title: "📡 Adapter Latency History",
    color: avg < 200 ? "success" : avg < 1000 ? "warning" : "error",
    description: entries.length > 0 ? `**Avg: ${avg}ms** over ${entries.length} requests\n${desc}`.slice(0, 2048) : desc,
    fields: [
      { name: "🔢 Requests", value: fmtCount(entries.length), inline: true },
      { name: "⏱️ Average", value: entries.length > 0 ? `\`${avg}ms\`` : "— None —", inline: true },
    ]
  });
}

// ── Events ──
export function formatEventsEmbed(incidents) {
  const entries = incidents || [];
  const desc = entries.length === 0
    ? "— No incidents recorded —"
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
  const ready = r.ready === true;
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
  // Route provenance for "maintenance" is unverified against upstream main
  // (see adapterClient.js maintenance() comment); a false/missing "ok" must
  // read as unknown/unavailable, never as a healthy "no maintenance" state.
  if (payload?.ok !== true) {
    return duneEmbed({
      title: "🛠️ Maintenance Status",
      color: "warning",
      description: "❔ **Unknown** — the console did not return a maintenance status."
    });
  }

  const maintenance = payload?.maintenance || "";
  const hasMaintenance = maintenance && maintenance.trim().length > 0;

  const desc = hasMaintenance
    ? "🔧 **Maintenance window active**"
    : "✅ **No maintenance scheduled**";

  return duneEmbed({
    title: "🛠️ Maintenance Status",
    color: hasMaintenance ? "warning" : "success",
    description: `${desc}\n\n${maintenance.slice(0, 2048)}`.slice(0, 2048)
  });
}

export function formatServersEmbed(payload) {
  const output = payload?.result?.output || payload?.output || "";
  const partitions = parseServerPartitions(output);

  const running = partitions.filter(p => p.ready || p.alive);
  const desc = partitions.length === 0
    ? "— No server partitions found —"
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
    color: payload?.ok ? "success" : "warning",
    description: items.length > 0 ? items.join("\n").slice(0, 2000) : "— No port data —",
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
    description: items.length > 0 ? items.join("\n").slice(0, 2000) : "— No database data —",
    fields: [{ name: "🔢 Checks", value: fmtCount(items.length), inline: true }]
  });
}

export function formatSetupEmbed(setup) {
  const inviteUrl = setup?.inviteUrl || "";
  const guildId = setup?.guildId || "";

  // #213/A1: in multi-tenant mode the ONLY working setup path is the
  // portal — the onboarding DM tells users this command has "the setup
  // link", so it must actually show it (the old embed rendered
  // single-tenant self-host instructions with no portal link at all).
  if (setup?.multiTenant && setup?.setupUrl) {
    return duneEmbed({
      title: "🔧 Connect This Server to Sentinel",
      color: "spice",
      description: [
        "**Connect your Discord server to your Dune Awakening console** via the setup portal.\n",
        "### 🚀 Setup Portal",
        `**${setup.setupUrl}**`,
        "",
        "The portal walks you through:",
        "1. Signing in with Discord and picking this server",
        "2. Enabling the Discord adapter in your console's `.env`, creating the adapter token file, and recreating the console container",
        "3. Entering your console URL and adapter token",
        "4. Mapping Discord roles to the four permission tiers — **Player**, **Moderator**, **Admin**, **Owner**",
        "",
        "After setup, run `/dune core help` to see your available commands and `/dune server status` to verify the console connection."
      ].join("\n").slice(0, 2048)
    });
  }

  const clientId = setup?.clientId || "?";
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
      "• **Dune Player** — can use all read-only commands",
      "• **Dune Admin** — can use admin commands and diagnostics",
      "",
      "### 📐 Step 3: Find Your Role & Guild IDs",
      "1. **Enable Developer Mode:** Settings → Advanced → Developer Mode ON",
      "2. **Right-click your server icon** → Copy Server ID",
      "3. **Right-click each role** → Copy Role ID",
      `Your guild ID${guildId ? " is \`" + guildId + "\`" : ": *(run this command in a server to see it)*"}`,
      "",
      "### ⚙️ Step 4: Configure the Bot",
      "Add these values to your \`.env\` file (the Player role goes in the",
      "config's observer slot — same tier, older internal name):",
      "```bash",
      "DISCORD_OBSERVER_ROLE_IDS=your-player-role-id",
      "DISCORD_ADMIN_ROLE_IDS=your-admin-role-id",
      "DISCORD_GUILD_ID=" + (guildId || "your-server-id"),
      "```",
      "",
      "📖 **Full documentation:** [Admin Guide](https://github.com/yacketrj/arrakis-control-panel/blob/main/docs/admin-guide.md)"
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
  // #220/F2: Core sends deathsByCause as an ARRAY of {cause, count} —
  // the old object-shaped deathCauses is kept as a fallback.
  const causeEntries = Array.isArray(r.deathsByCause)
    ? r.deathsByCause.map((c) => [c.cause, c.count])
    : Object.entries(r.deathCauses || {});
  if (causeEntries.length > 0) {
    fields.push({ name: "☠️ Deaths by Cause", value: causeEntries.slice(0, 5).map(([cause, count]) => `• ${cause}: ${count}`).join("\n"), inline: false });
  }
  // #212/T1: guard on length too — an empty array produced a field with
  // value "", which Discord's API rejects (whole reply fails).
  if (Array.isArray(r.topPvP) && r.topPvP.length > 0) {
    fields.push({ name: "🥇 Top PvP", value: r.topPvP.slice(0, 3).map(p => `• ${p.name || p.character}: ${p.kills || 0} kills`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "⚔️ Combat Statistics",
    color: (r.deaths ?? r.totalDeaths ?? 0) > 0 ? "warning" : "success",
    description: r.deaths || r.totalDeaths ? "⚔️ **Combat data available**" : "🟡 **No combat data**",
    fields
  });
}

// ── OPS: Resources (Spice Melange) ──
// #212: per-size field accessor for instance/sietch rows. Previously a
// helper named `sf` was stranded INSIDE formatCombatEmbed's topPvP
// branch (and `ssf` didn't exist at all), so every summary-less payload
// crashed with "sf is not defined" / "ssf is not defined" and the user
// saw a raw ReferenceError instead of their resource stats.
function sizeField(row, size, field) {
  const sizes = Array.isArray(row?.sizes) ? row.sizes : [];
  const s = sizes.find((x) => x.size === size);
  return s?.[field] ?? row?.[size + field.charAt(0).toUpperCase() + field.slice(1)] ?? 0;
}

// #220/F2: Core's real resources shape (console/api/src/duneDb.js) is
// { deepDesert: { summary: { totalActiveFields, totalRemainingSpice,
// pvpInstances, pveInstances, bySize: [{size, activeFields,
// remainingSpice}] }, instances: [{ dimensionIndex, name, combatState,
// activeFields, remainingSpice, sizes: [...] }] }, haggaBasin: { same —
// note `instances`, not `sietches` } }. The previous version read
// imagined flat fields (smallActive, totalSietches, …) that Core never
// sends, so real deployments rendered a summary contradicted by all-zero
// instance rows and an empty Hagga section. Legacy synthetic shapes are
// kept as fallbacks.
function resourceSectionStats(section) {
  const list = Array.isArray(section?.instances)
    ? section.instances
    : (Array.isArray(section?.sietches) ? section.sietches : []);
  const sum = section?.summary || {};
  const bySize = Array.isArray(sum.bySize) ? sum.bySize : [];
  const isPvp = (row) => String(row?.combatState || row?.type || row?.mode || "").toUpperCase() === "PVP";
  const isPve = (row) => String(row?.combatState || row?.type || row?.mode || "").toUpperCase() === "PVE";
  const rowTotal = (row, field) =>
    row?.[field] ?? (sizeField(row, "small", field) + sizeField(row, "medium", field) + sizeField(row, "large", field));
  const sizeStat = (size, field) => {
    const b = bySize.find((x) => x.size === size);
    if (b && b[field] != null) return b[field];
    return list.reduce((acc, row) => acc + sizeField(row, size, field), 0);
  };
  return {
    list,
    totalActive: sum.totalActiveFields ?? list.reduce((acc, row) => acc + rowTotal(row, "activeFields"), 0),
    totalRemaining: sum.totalRemainingSpice ?? list.reduce((acc, row) => acc + rowTotal(row, "remainingSpice"), 0),
    sizeStat,
    pvp: sum.pvpInstances ?? sum.pvpSietches ?? list.filter(isPvp).length,
    pve: sum.pveInstances ?? sum.pveSietches ?? list.filter(isPve).length
  };
}

function resourceRowField(row, fallbackName) {
  const name = row.name || row.id || fallbackName;
  const state = String(row.combatState || row.type || row.mode || "UNKNOWN").toUpperCase();
  const badge = state === "PVP" ? "🔴" : state === "PVE" ? "🟢" : "⚪";
  const line = (size, label) => {
    const active = sizeField(row, size, "activeFields");
    const remaining = sizeField(row, size, "remainingSpice");
    return `**${label}** ${String(active).padStart(3)} active   ${Number(remaining || 0).toLocaleString().padStart(8)} remaining`;
  };
  const lines = [line("small", "Small:  ")];
  const mA = sizeField(row, "medium", "activeFields"); const mR = sizeField(row, "medium", "remainingSpice");
  const lA = sizeField(row, "large", "activeFields"); const lR = sizeField(row, "large", "remainingSpice");
  if (mA > 0 || mR > 0) lines.push(line("medium", "Medium:"));
  if (lA > 0 || lR > 0) lines.push(line("large", "Large: "));
  return { name: `${badge} ${name} — ${state}`, value: lines.join("\n"), inline: false };
}

export function formatResourcesEmbed(payload) {
  const r = payload?.result || payload || {};
  const fields = [];

  const dd = resourceSectionStats(r.deepDesert || {});
  const hb = resourceSectionStats(r.haggaBasin || {});

  if (dd.list.length > 0 || (r.deepDesert && Object.keys(r.deepDesert).length > 0)) {
    const txt = [
      `**Total Active Fields:** ${dd.totalActive.toLocaleString()}`,
      `**Total Remaining Spice:** ${dd.totalRemaining.toLocaleString()}`,
      `**Small Fields:** ${dd.sizeStat("small", "activeFields").toLocaleString()} active · ${dd.sizeStat("small", "remainingSpice").toLocaleString()} remaining`,
      `**Medium Fields:** ${dd.sizeStat("medium", "activeFields").toLocaleString()} active · ${dd.sizeStat("medium", "remainingSpice").toLocaleString()} remaining`,
      `**Large Fields:** ${dd.sizeStat("large", "activeFields").toLocaleString()} active · ${dd.sizeStat("large", "remainingSpice").toLocaleString()} remaining`,
      `**PvP Instances:** ${dd.pvp} · **PvE Instances:** ${dd.pve}`
    ].join("\n");
    fields.push({ name: "🏜️ Deep Desert — Summary", value: txt, inline: false });

    const sorted = [...dd.list].sort((a, b) => {
      const aNum = a.dimensionIndex ?? (parseInt(String(a.name || a.id || "").replace(/\D/g, ""), 10) || 0);
      const bNum = b.dimensionIndex ?? (parseInt(String(b.name || b.id || "").replace(/\D/g, ""), 10) || 0);
      return aNum - bNum || String(a.name || "").localeCompare(String(b.name || ""));
    });
    sorted.forEach((row, idx) => fields.push(resourceRowField(row, `Instance ${idx + 1}`)));
  }

  if (hb.list.length > 0 || (r.haggaBasin && Object.keys(r.haggaBasin).length > 0)) {
    const txt = [
      `**Total Active Fields:** ${hb.totalActive.toLocaleString()}`,
      `**Total Remaining Spice:** ${hb.totalRemaining.toLocaleString()}`,
      `**Total Sietches:** ${hb.list.length}`,
      `**PvP Sietches:** ${hb.pvp} · **PvE Sietches:** ${hb.pve}`
    ].join("\n");
    fields.push({ name: "🏔️ Hagga Basin — Summary", value: txt, inline: false });

    const sorted = [...hb.list].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    sorted.forEach((row, idx) => fields.push(resourceRowField(row, `Sietch ${idx + 1}`)));
  }

  // Legacy fallback (no sectioned data at all)
  if (fields.length === 0) {
    fields.push({ name: "🌶️ Spice Fields", value: fmtCount(r.spiceFields), inline: true });
    fields.push({ name: "💧 Water Wells", value: fmtCount(r.waterWells), inline: true });
    fields.push({ name: "⛏️ Mineral Nodes", value: fmtCount(r.mineralNodes), inline: true });
    fields.push({ name: "☀️ Solar Arrays", value: fmtCount(r.solarArrays), inline: true });
    fields.push({ name: "🌿 Organic Farms", value: fmtCount(r.organicFarms), inline: true });
  }

  if (r.resourceRates && Object.keys(r.resourceRates).length > 0) {
    fields.push({ name: "📊 Extraction Rates", value: Object.entries(r.resourceRates).slice(0, 5).map(([res, rate]) => `• ${res}: ${rate}/h`).join("\n"), inline: false });
  }

  const hasDetailedData = dd.list.length > 0 || hb.list.length > 0;
  return duneEmbed({
    title: "🌶️ Spice Melange",
    color: ((r.spiceFields ?? 0) > 0 || dd.totalActive > 0 || hb.totalActive > 0) ? "success" : "warning",
    description: hasDetailedData ? "🏜️ **Deep Desert & Hagga Basin spice field overview**" : "🏜️ **Resource field overview**",
    fields
  });
}

// ── OPS: Economy ──
// #220/F2: Core's real economy shape is { totalCurrencyHolders,
// totalSupply, activeOrders, fulfilledOrders, taxCollected,
// currencyBreakdown, topTradedItems } — the previous field names
// (totalCurrency, totalTaxes, transactions24h, marketplaces, topTraders)
// rendered "— None —" on every real deployment. Legacy names kept as
// fallbacks.
export function formatEconomyEmbed(payload) {
  const r = payload?.result || payload || {};
  const supply = r.totalSupply ?? r.totalCurrency ?? r.totalSolari;
  const fields = [
    { name: "💰 Total Currency", value: fmtCount(supply), inline: true },
    { name: "👥 Currency Holders", value: fmtCount(r.totalCurrencyHolders), inline: true },
    { name: "📦 Active Orders", value: fmtCount(r.activeOrders), inline: true },
    { name: "✅ Fulfilled Orders", value: fmtCount(r.fulfilledOrders), inline: true },
    { name: "🏛️ Taxes Collected", value: fmtCount(r.taxCollected ?? r.totalTaxes), inline: true },
  ];
  const topItems = Array.isArray(r.topTradedItems) ? r.topTradedItems : [];
  if (topItems.length > 0) {
    fields.push({
      name: "🥇 Top Traded Items",
      value: topItems.slice(0, 5).map((t) => `• ${t.display_name || t.displayName || t.template_id || t.templateId || t.item || t.name || "?"}: ${t.count ?? t.total ?? t.volume ?? "?"}`).join("\n"),
      inline: false
    });
  }
  // Legacy synthetic shape fallback (#212/T1 length guard retained)
  if (Array.isArray(r.topTraders) && r.topTraders.length > 0) {
    fields.push({ name: "🥇 Top Traders", value: r.topTraders.slice(0, 3).map(t => `• ${t.name || t.character}: ${fmtCount(t.volume)}`).join("\n"), inline: false });
  }
  return duneEmbed({
    title: "💰 Economy Statistics",
    color: ((supply ?? 0) > 0 || (r.activeOrders ?? 0) > 0) ? "success" : "warning",
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
    { name: "🧮 Total Crafted", value: fmtCount(r.totalCrafted), inline: true },
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
  // #212/T1: guard on length too — an empty array produced a field with
  // value "", which Discord's API rejects (whole reply fails).
  if (Array.isArray(r.hotspots) && r.hotspots.length > 0) {
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
  // Core returns: platformHealth, bridgeRequests, bridgeErrors, bridgeSuccessRate
  const active = r.bridgeRequests > 0;
  const healthy = r.platformHealth === "healthy" || r.platformHealth === "ok";
  const fields = [
    { name: "Status", value: active ? "🟢 Active — receiving requests" : healthy ? "🟡 Idle — no requests yet" : "⚪ No data", inline: false },
    { name: "Requests", value: fmtCount(r.bridgeRequests), inline: true },
    { name: "Errors", value: fmtCount(r.bridgeErrors), inline: true },
  ];
  if (r.bridgeSuccessRate != null && r.bridgeSuccessRate !== undefined) {
    fields.push({ name: "Success Rate", value: `${Math.round(r.bridgeSuccessRate * 100)}%`, inline: true });
  }
  return duneEmbed({
    title: "🔌 OPS Bridge Health",
    color: active ? "success" : "warning",
    description: active ? "🟢 **Bridge is active and processing requests**" : "The OPS bridge has not received any requests yet. This is normal if no addons or external services are querying the bridge.",
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
  // Core returns nested dashboard.{section}.result.{field}
  const a = r.activity?.result || r.activity || {};
  const c = r.combat?.result || r.combat || {};
  const soc = r.soc?.result || r.soc || {};
  const fields = [
    { name: "👥 Online", value: fmtCount(a.onlinePlayers ?? a.totalPlayers), inline: true },
    { name: "⚔️ Combat (24h)", value: fmtCount(c.totalDeaths ?? c.deaths), inline: true },
    { name: "📦 Items", value: fmtCount(r.inventory?.result?.totalItems ?? r.inventory?.totalItems), inline: true },
    { name: "🔌 Bridge", value: soc.platformHealth === "healthy" ? "🟢 OK" : "🟡 No data", inline: true },
  ];
  return duneEmbed({
    title: "📊 OPS Dashboard",
    color: r.serverStatus === "healthy" || r.status === "ok" ? "success" : "warning",
    description: "🏜️ **Aggregated operational summary**",
    fields
  });
}

// ── OPS: Alerts (#221/F3) ──
// Renders /dune ops alerts (Prometheus alert query) — the generic
// formatter showed the firing list as "**[object Object]**".
export function formatAlertsEmbed(payload) {
  if (payload?.ok === false) {
    return duneEmbed({
      title: "🚨 Active Alerts",
      color: "error",
      description: `🔴 ${payload?.error || "Failed to query alerts."}`,
      fields: payload?.hint ? [{ name: "💡 Hint", value: payload.hint, inline: false }] : []
    });
  }
  const a = payload?.alerts || {};
  const firing = Array.isArray(a.summary) ? a.summary : [];
  const fields = [
    { name: "🔥 Firing", value: fmtCount(a.firing ?? firing.length), inline: true },
    { name: "⏳ Pending", value: fmtCount(a.pending ?? 0), inline: true },
    { name: "📊 Total", value: fmtCount(a.total ?? firing.length), inline: true }
  ];
  for (const alert of firing.slice(0, 10)) {
    const detail = [alert.summary, alert.instance ? `on \`${alert.instance}\`` : "", alert.startsAt ? `since ${alert.startsAt}` : ""]
      .filter(Boolean).join(" · ");
    fields.push({
      name: `🔥 ${alert.alertname || "unknown"} (${alert.severity || "none"})`,
      value: detail || "— no detail —",
      inline: false
    });
  }
  if (firing.length > 10) {
    fields.push({ name: "…", value: `*…and ${firing.length - 10} more firing alerts*`, inline: false });
  }
  const anyFiring = (a.firing ?? firing.length) > 0;
  const anyPending = (a.pending ?? 0) > 0;
  return duneEmbed({
    title: "🚨 Active Alerts",
    color: anyFiring ? "error" : anyPending ? "warning" : "success",
    description: anyFiring
      ? `🔥 **${a.firing ?? firing.length} alert${(a.firing ?? firing.length) === 1 ? "" : "s"} firing**`
      : anyPending ? "🟡 **Alerts pending — none firing**" : "🟢 **No active alerts**"
  , fields });
}

// ── OPS: Announcements ──
export function formatAnnouncementsEmbed(payload) {
  const announcements = payload?.announcements || payload?.result?.announcements || [];
  const desc = announcements.length === 0
    ? "— No announcements —"
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

// ── Dedicated formatters replacing formatGenericEmbed ──

// #210/U6: services payloads are { result: { overall, services: [{ name,
// status }] } } — the old version expected an object map and never
// matched, so /dune server services rendered "Services: 3 items"
// without naming a single service.
export function formatServicesSummaryEmbed(payload) {
  const raw = payload?.result?.services ?? payload?.services ?? [];
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([name, status]) => ({ name, status }));
  const down = list.filter((svc) => !/^(up|running|ready|ok|healthy)$/i.test(String(svc.status || "")));
  const fields = list.slice(0, 23).map((svc) => ({
    name: `${down.includes(svc) ? "🔴" : "🟢"} ${svc.name || "unknown"}`,
    value: String(svc.status || "— Unknown —"),
    inline: true
  }));
  return duneEmbed({
    title: "🔧 Services",
    color: list.length === 0 ? "warning" : down.length > 0 ? "warning" : "success",
    description: list.length === 0
      ? "— No service data available —"
      : down.length === 0
        ? `🟢 **All ${list.length} services healthy**`
        : `🔴 **${down.length} of ${list.length} services unhealthy**`,
    fields
  });
}

// #210: rolesConfigPayload returns two shapes — multi-tenant
// ({ roles: ["player: …", …], rbacMode, source }) and single-tenant
// ({ admin: […], observer: […], allowedUserIds: […] }). Render both;
// the observer tier is labeled "Player" on every display surface (#217).
export function formatRolesEmbed(payload) {
  const fields = [];
  if (Array.isArray(payload?.roles)) {
    fields.push({
      name: "🎭 Configured Roles",
      value: payload.roles.map((r) => `• ${r}`).join("\n").slice(0, 1024) || "— None —",
      inline: false
    });
  } else {
    const tiers = [
      ["👤 Player Roles", payload?.observer],
      ["🛡️ Admin Roles", payload?.admin],
      ["🔑 Allowed User IDs", payload?.allowedUserIds]
    ];
    for (const [label, values] of tiers) {
      if (Array.isArray(values) && values.length > 0) {
        fields.push({ name: label, value: values.map((v) => `• ${v}`).join("\n").slice(0, 1024), inline: false });
      }
    }
  }
  if (payload?.rbacMode) fields.push({ name: "⚙️ RBAC Mode", value: `\`${payload.rbacMode}\``, inline: true });
  if (payload?.source) fields.push({ name: "📦 Source", value: payload.source, inline: true });
  return duneEmbed({
    title: "👥 Role Configuration",
    color: "spice",
    fields: fields.length > 0 ? fields : [{ name: "Status", value: "— No role data available —" }]
  });
}

// #210/T2/P3: logs responses are { logs: [...] } — render as a code
// block (log text must not be interpreted as markdown) with far more
// than the generic formatter's 5-line cap.
export function formatLogsEmbed(payload, service = "") {
  const lines = payload?.logs ?? payload?.result?.logs ?? payload?.lines ?? [];
  const svc = service || payload?.service || "unknown";
  let body = "— No log output —";
  let shown = 0;
  if (Array.isArray(lines) && lines.length > 0) {
    const kept = [];
    let size = 0;
    // newest lines are most useful — walk backwards until the budget fills
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      // #221/F7: a log line containing ``` would close the code fence
      // early and let the remainder render as markdown — break the run
      // with a zero-width space.
      const line = String(lines[i]).replaceAll("```", "`\u200b``");
      if (size + line.length + 1 > 3600) break;
      kept.unshift(line);
      size += line.length + 1;
    }
    shown = kept.length;
    const omitted = lines.length - shown;
    body = `\`\`\`\n${kept.join("\n")}\n\`\`\`${omitted > 0 ? `\n*…${omitted} earlier line${omitted === 1 ? "" : "s"} not shown*` : ""}`;
  }
  return duneEmbed({
    title: `📋 Logs: ${svc}`,
    color: shown > 0 ? "spice" : "warning",
    description: body.slice(0, 4000),
    fields: [{ name: "Lines Shown", value: `\`${shown}\` of \`${Array.isArray(lines) ? lines.length : 0}\``, inline: true }]
  });
}

export function formatVersionEmbed(payload) {
  const v = payload?.version || payload?.result?.version || "unknown";
  const adapter = payload?.adapter || payload?.result?.adapter || {};
  return duneEmbed({
    title: "📦 Version",
    color: "success",
    description: `**${v}**`,
    // #221/F4: Discord does not render markdown in field NAMES — the old
    // `**${k}**` showed literal asterisks around lowercase keys.
    fields: Object.entries(adapter).slice(0, 6).map(([k, val]) => ({
      name: displayLabel(k),
      value: String(val || "— Unknown —"),
      inline: true
    }))
  });
}

export function formatPlayerCommandEmbed(payload, commandName) {
  const ok = payload?.ok !== false;
  const msg = payload?.message || payload?.error || "";
  return duneEmbed({
    title: `👤 Player: ${commandName}`,
    color: ok ? "success" : "warning",
    description: msg || (ok ? "Command completed." : "Command failed."),
    fields: payload?.characterName ? [{ name: "Character", value: `**${payload.characterName}**`, inline: true }] : []
  });
}

// #210/U1/T4: renders the FULL command surface, one field per command
// group (a single comma-joined field overflowed the 1024-char limit and
// truncated mid-name). The old generic-formatter path showed the first
// 5 of 50+ commands.
export function formatHelpEmbed(payload) {
  const available = payload?.available || [];
  const locked = payload?.locked || [];
  const total = payload?.total ?? available.length + locked.length;

  const groupOf = (name) => (name.includes(":") ? name.split(":")[0] : name);
  const shortOf = (name) => (name.includes(":") ? name.split(":").slice(1).join(":") : name);

  const byGroup = new Map();
  for (const name of available) {
    const g = groupOf(name);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(shortOf(name));
  }

  const fields = [];
  for (const [g, names] of byGroup) {
    fields.push({
      name: `📂 ${g}`,
      value: names.map((n) => `\`${n}\``).join(" · ").slice(0, 1024),
      inline: false
    });
  }
  if (locked.length > 0) {
    const lockedNames = locked.map((n) => `\`${n}\``);
    let value = "";
    let omitted = 0;
    for (const n of lockedNames) {
      if (value.length + n.length + 3 > 990) { omitted = lockedNames.length - (value ? value.split(" · ").length : 0); break; }
      value += (value ? " · " : "") + n;
    }
    fields.push({
      name: `🔒 Locked for your role (${locked.length})`,
      value: `${value}${omitted > 0 ? ` · *…and ${omitted} more*` : ""}`,
      inline: false
    });
  }

  return duneEmbed({
    title: "📚 Command Reference",
    color: "spice",
    description: `**${payload?.availableCount ?? available.length}** of **${total}** commands available for your role · RBAC: \`${payload?.rbacMode || "unknown"}\``,
    fields
  });
}

// #210/P1 + #199/U9: dedicated renderer for the sync-commands drift
// check — action in the description, one field per drift direction,
// capped lists labeled, color keyed to drift state.
export function formatSyncCommandsEmbed(payload) {
  if (payload?.ok === false) {
    return duneEmbed({
      title: "🔄 Command Catalog Drift Check",
      color: "error",
      description: `🔴 ${payload?.error || "Drift check failed."}`,
      fields: payload?.hint ? [{ name: "💡 Hint", value: payload.hint, inline: false }] : []
    });
  }

  const drift = payload?.drift || {};
  const inSync = drift.inSync === true;
  const reg = payload?.registry || {};
  const core = payload?.coreCatalog || {};

  const fields = [
    { name: "🤖 Bot Registry", value: `v${reg.version ?? "?"} · ${reg.groups ?? "?"} groups · ${reg.commandCount ?? "?"} commands`, inline: true },
    { name: "🎛️ Core Catalog", value: `v${core.version ?? "?"} · ${core.groups ?? "?"} groups · ${core.commandCount ?? "?"} commands`, inline: true }
  ];

  const capNote = (shownArr, totalCount) =>
    totalCount > (shownArr?.length || 0) ? ` — showing first ${shownArr.length}` : "";
  if (Array.isArray(drift.added) && drift.added.length > 0) {
    fields.push({
      name: `➕ In Core, not in registry (${drift.addedCount ?? drift.added.length})${capNote(drift.added, drift.addedCount ?? drift.added.length)}`,
      value: drift.added.map((k) => `• \`${k}\``).join("\n").slice(0, 1024),
      inline: false
    });
  }
  if (Array.isArray(drift.removed) && drift.removed.length > 0) {
    fields.push({
      name: `➖ In registry, not in Core (${drift.removedCount ?? drift.removed.length})${capNote(drift.removed, drift.removedCount ?? drift.removed.length)}`,
      value: drift.removed.map((k) => `• \`${k}\``).join("\n").slice(0, 1024),
      inline: false
    });
  }

  return duneEmbed({
    title: "🔄 Command Catalog Drift Check",
    color: inSync ? "success" : "warning",
    description: inSync
      ? "🟢 **In sync** — Core's catalog matches the bot's committed registry. No action needed."
      : "🟡 **Drift detected** — Core's catalog differs from the committed registry.\n**Next step:** regenerate the artifact (`npm run registry:generate`) against this Core and deploy it. Slash-command registration only changes on deploy — this check is read-only.",
    fields
  });
}
