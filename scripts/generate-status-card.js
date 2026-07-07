import { createCanvas, GlobalFonts, loadImage, Image } from "@napi-rs/canvas";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Register bundled fonts
const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "assets");

try {
  GlobalFonts.registerFromPath(join(ASSETS, "Ubuntu-R.ttf"), "Ubuntu");
  GlobalFonts.registerFromPath(join(ASSETS, "Ubuntu-B.ttf"), "Ubuntu Bold");
} catch {
  GlobalFonts.registerFromPath("/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf", "Ubuntu");
  GlobalFonts.registerFromPath("/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf", "Ubuntu Bold");
}

// Cache the banner image
let BANNER = null;
async function loadBanner() {
  if (!BANNER) {
    try {
      BANNER = await loadImage(join(ASSETS, "bot-banner.png"));
    } catch {
      BANNER = new Image(); // empty placeholder
    }
  }
  return BANNER;
}

// Dune palette — extracted from the ACP banner
const COLORS = {
  bg: "#0f0c08",
  cardBg: "#1c1510",
  accent: "#966f47",
  text: "#f0e6d3",
  muted: "#8a7355",
  success: "#6eeb83",
  warning: "#fbbf24",
  error: "#f87171",
  atreides: "#4ade80",
  harkonnen: "#f87171",
  fremen: "#fbbf24",
  border: "#362515",
  fieldBg: "#241a12",
};

const W = 900, H = 480;
const PAD = 28;

export async function generateStatusCard({ title, overall, region, mode, population, maps = [], services = 0, latency = 0, quote = "" } = {}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Banner background
  const banner = await loadBanner();
  if (banner.width > 0) {
    const scale = Math.max(W / banner.width, H / banner.height);
    const sw = banner.width * scale;
    const sh = banner.height * scale;
    ctx.drawImage(banner, (W - sw) / 2, (H - sh) / 2, sw, sh);

    // Dark overlay for text readability
    ctx.fillStyle = "rgba(0,0,0,0.60)";
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
  }

  // Card body with slight transparency
  ctx.fillStyle = "rgba(28,21,16,0.85)";
  roundRect(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 12, true, false);

  // Accent bar at top
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, PAD, PAD, W - PAD * 2, 4, { tl: 12, tr: 12 }, true, false);

  // Title
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 30px Ubuntu Bold";
  ctx.fillText(`🌍 ${title || "Server Status"}`, PAD + 20, PAD + 52);

  // Status badge
  const badgeColor = overall === "READY" ? COLORS.success : overall === "ISSUE" ? COLORS.warning : COLORS.error;
  ctx.fillStyle = badgeColor;
  const badgeW = ctx.measureText(overall || "UNKNOWN").width + 24;
  roundRect(ctx, W - PAD - 20 - badgeW, PAD + 28, badgeW, 28, 14, true, false);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Ubuntu Bold";
  ctx.fillText(overall || "UNKNOWN", W - PAD - 20 - badgeW / 2 - ctx.measureText(overall || "UNKNOWN").width / 2, PAD + 48);

  // Stats row
  const stats = [
    { icon: "👥", label: "Players", value: population || "—" },
    { icon: "🌎", label: "Region", value: region || "—" },
    { icon: "🎮", label: "Mode", value: mode || "—" },
    { icon: "📡", label: "Latency", value: latency ? `${latency}ms` : "—" },
    { icon: "⚙️", label: "Services", value: String(services) },
  ];

  const statY = PAD + 100;
  const statW = (W - PAD * 2 - 40) / stats.length;
  ctx.font = "14px Ubuntu";

  stats.forEach((s, i) => {
    const sx = PAD + 20 + i * statW;
    // Icon
    ctx.font = "22px Ubuntu Bold";
    ctx.fillText(s.icon, sx, statY + 22);
    // Label
    ctx.fillStyle = COLORS.muted;
    ctx.font = "13px Ubuntu";
    ctx.fillText(s.label, sx + 30, statY + 12);
    // Value
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 16px Ubuntu Bold";
    ctx.fillText(s.value, sx + 30, statY + 34);
  });

  // Separator line
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD + 20, statY + 70);
  ctx.lineTo(W - PAD - 20, statY + 70);
  ctx.stroke();

  // Maps section
  let mapY = statY + 100;
  ctx.fillStyle = COLORS.muted;
  ctx.font = "13px Ubuntu";
  ctx.fillText("ACTIVE MAPS", PAD + 20, mapY - 8);

  const mapBarH = 32;
  const mapGap = 8;
  const maxMaps = Math.min(maps.length, 5);

  maps.slice(0, maxMaps).forEach((m, i) => {
    const my = mapY + i * (mapBarH + mapGap);
    const state = m.state || m.status || "UNKNOWN";
    // State badge with faction colors
    const factionColors = [COLORS.atreides, COLORS.harkonnen, COLORS.fremen];
    const barColor = factionColors[i % 3];

    // Map row background
    ctx.fillStyle = COLORS.fieldBg;
    roundRect(ctx, PAD + 20, my, W - PAD * 2 - 40, mapBarH, 6, true, false);

    // Name
    ctx.fillStyle = COLORS.text;
    ctx.font = "14px Ubuntu";
    ctx.fillText(m.name || "?", PAD + 40, my + 22);

    // Uptime
    if (m.uptime) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "13px Ubuntu";
      const ux = PAD + 200;
      ctx.fillText(m.uptime, ux, my + 22);
    }

    // State badge
    const bw = ctx.measureText(state).width + 16;
    const bx = W - PAD - 40 - bw;
    ctx.fillStyle = barColor;
    roundRect(ctx, bx, my + 6, bw, 20, 10, true, false);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Ubuntu Bold";
    ctx.fillText(state, bx + 8, my + 20);
  });

  // Footer
  const footerY = H - PAD - 12;
  ctx.fillStyle = COLORS.muted;
  ctx.font = "11px Ubuntu";
  ctx.fillText(`Thumper · ${quote || "The spice must flow."}`, PAD + 20, footerY);

  return canvas;
}

function roundRect(ctx, x, y, w, h, r = 0, fill = false, stroke = false) {
  if (typeof r === "object") {
    r = { tl: r.tl || 0, tr: r.tr || 0, br: r.br || 0, bl: r.bl || 0 };
  } else {
    r = { tl: r, tr: r, br: r, bl: r };
  }
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// Quick test if run directly
import { writeFileSync } from "node:fs";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const canvas = await generateStatusCard({
    title: "Tabr-Tau",
    overall: "READY",
    region: "North America",
    mode: "public",
    population: "0/60",
    maps: [
      { name: "Survival_1", state: "READY", uptime: "Up 18 hours" },
      { name: "Overmap", state: "READY", uptime: "Up 18 hours" },
      { name: "SH_Arrakeen", state: "INACTIVE" },
      { name: "SH_HarkoVillage", state: "INACTIVE" },
    ],
    services: 10,
    latency: 12,
    quote: "The spice must flow."
  });
  writeFileSync("/tmp/status-card-test.png", canvas.toBuffer("image/png"));
  console.log("Test card saved to /tmp/status-card-test.png");
}
