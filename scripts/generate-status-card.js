import { createCanvas, GlobalFonts, loadImage, Image } from "@napi-rs/canvas";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Register bundled fonts
const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "assets");

try {
  GlobalFonts.registerFromPath(join(ASSETS, "Ubuntu-R.ttf"), "Ubuntu");
  GlobalFonts.registerFromPath(join(ASSETS, "Ubuntu-B.ttf"), "Ubuntu Bold");
  GlobalFonts.registerFromPath(join(ASSETS, "DuneRise.ttf"), "Dune Rise");
} catch {
  GlobalFonts.registerFromPath("/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf", "Ubuntu");
  GlobalFonts.registerFromPath("/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf", "Ubuntu Bold");
}

// Cache the background image
let BANNER = null;
async function loadBanner() {
  if (!BANNER) {
    try {
      BANNER = await loadImage(join(ASSETS, "status-bg.png"));
    } catch {
      try {
        BANNER = await loadImage(join(ASSETS, "bot-banner.png"));
      } catch {
        BANNER = new Image();
      }
    }
  }
  return BANNER;
}

// Dune palette — warm amber/desert, tuned for the new background
const COLORS = {
  bg: "#0c0a06",
  cardBg: "rgba(28,21,16,0.70)",
  accent: "#a06839",
  text: "#ecd5b5",
  muted: "#b8956e",
  success: "#6eeb83",
  warning: "#fbbf24",
  error: "#f87171",
  atreides: "#4ade80",
  harkonnen: "#f87171",
  fremen: "#fbbf24",
  border: "#4a321c",
  fieldBg: "rgba(255,255,255,0.05)",
};

const W = 1200, H = 640;
const PAD = 36;
const TOP = 80; // Content starts after accent bar — background is the clean content zone

export async function generateStatusCard({ title, overall, region, mode, population, maps = [], services = 0, latency = 0, quote = "" } = {}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Banner background — fills the entire canvas, no card body rectangle
  const banner = await loadBanner();
  if (banner.width > 0) {
    const scale = Math.max(W / banner.width, H / banner.height);
    const sw = banner.width * scale;
    const sh = banner.height * scale;
    ctx.drawImage(banner, (W - sw) / 2, (H - sh) / 2, sw, sh);

    // Gradient overlay — heavier at top, fading to bottom for readability
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(0,0,0,0.25)");
    grad.addColorStop(0.3, "rgba(0,0,0,0.15)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.20)");
    grad.addColorStop(1, "rgba(0,0,0,0.40)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

  } else {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
  }

  // No card body — text sits directly on the background
  // Text shadow helper for readability against the varying background
  function drawText(text, x, y, font, color, shadow = true) {
    ctx.font = font;
    if (shadow) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(text, x + 2, y + 2);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawTextBold(text, x, y, font, color) {
    drawText(text, x, y, font, color, true);
  }

  // Accent bar at top
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, PAD + 10, PAD + 10, W - 2 * (PAD + 10), 3, 8, true, false);

  // Title — Dune Rise, amber accent color
  drawTextBold(`${title || "Server Status"}`, PAD + 30, TOP + 22, "34px Dune Rise", COLORS.accent);

  // Status badge
  const badgeColor = overall === "READY" ? COLORS.success : overall === "ISSUE" ? COLORS.warning : COLORS.error;
  ctx.fillStyle = badgeColor;
  const badgeText = overall || "UNKNOWN";
  const badgeW = ctx.measureText(badgeText).width + 28;
  roundRect(ctx, W - PAD - 30 - badgeW, TOP - 8, badgeW, 32, 16, true, false);
  drawText(badgeText, W - PAD - 30 - badgeW / 2 - ctx.measureText(badgeText).width / 2, TOP + 16, "bold 16px Ubuntu Bold", "#ffffff", false);

  // Stats row — icons with data
  const stats = [
    { icon: "👥", label: "Players", value: population || "—" },
    { icon: "🌎", label: "Region", value: region || "—" },
    { icon: "🎮", label: "Mode", value: mode || "—" },
    { icon: "📡", label: "Latency", value: latency ? `${latency}ms` : "—" },
    { icon: "⚙️", label: "Services", value: String(services) },
  ];

  const statY = TOP + 60;
  const statW = (W - PAD * 2 - 60) / stats.length;

  stats.forEach((s, i) => {
    const sx = PAD + 30 + i * statW;
    ctx.font = "28px Ubuntu Bold";
    drawText(s.icon, sx, statY + 28, "28px Ubuntu Bold", COLORS.text, false);
    drawText(s.label, sx + 36, statY + 16, "bold 13px Ubuntu Bold", COLORS.muted);
    drawTextBold(s.value, sx + 36, statY + 42, "19px Dune Rise", COLORS.text);
  });

  // Separator line
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD + 20, statY + 80);
  ctx.lineTo(W - PAD - 20, statY + 80);
  ctx.stroke();

  // Maps section header
  let mapY = statY + 110;
  drawText("ACTIVE MAPS", PAD + 30, mapY - 12, "bold 12px Ubuntu Bold", COLORS.accent);
  mapY += 10;

  const mapBarH = 34;
  const mapGap = 6;
  const maxMaps = Math.min(maps.length, 5);
  const factionColors = [COLORS.atreides, COLORS.harkonnen, COLORS.fremen];

  maps.slice(0, maxMaps).forEach((m, i) => {
    const my = mapY + i * (mapBarH + mapGap);
    const barColor = factionColors[i % 3];

    ctx.fillStyle = COLORS.fieldBg;
    roundRect(ctx, PAD + 20, my, W - PAD * 2 - 40, mapBarH, 6, true, false);

    drawTextBold(`${m.name || "?"}`, PAD + 42, my + 26, "15px Dune Rise", COLORS.text);
    if (m.uptime) drawText(m.uptime, PAD + 260, my + 26, "13px Ubuntu", COLORS.muted);

    const stateText = m.state || m.status || "UNKNOWN";
    const sw = ctx.measureText(stateText).width + 20;
    const sx = W - PAD - 60 - sw;
    ctx.fillStyle = barColor;
    roundRect(ctx, sx, my + 8, sw, 22, 11, true, false);
    drawText(stateText, sx + 10, my + 24, "bold 12px Ubuntu Bold", "#ffffff", false);
  });

  // Footer
  const footerY = H - 36;
  drawText(`Thumper · ${quote || "The spice must flow."}`, PAD + 30, footerY, "12px Ubuntu", COLORS.muted);

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
