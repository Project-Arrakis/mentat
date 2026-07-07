import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

// Dune palette
const COLORS = {
  bg: "#1a1208",
  cardBg: "#2a1f14",
  accent: "#D4A03C",
  text: "#E8D5B5",
  muted: "#8B7355",
  success: "#2ECC71",
  warning: "#F39C12",
  error: "#E74C3C",
  blue: "#5DADE2",
  border: "#4A3728",
};

const W = 800, H = 420;
const PAD = 24;

export function generateStatusCard({ title, overall, region, mode, population, maps = [], services = 0, latency = 0, quote = "" } = {}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // Card body
  ctx.fillStyle = COLORS.cardBg;
  roundRect(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 12, true, false);

  // Accent bar at top
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, PAD, PAD, W - PAD * 2, 4, { tl: 12, tr: 12 }, true, false);

  // Title
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 26px system-ui, sans-serif";
  ctx.fillText(`🌍 ${title || "Server Status"}`, PAD + 20, PAD + 52);

  // Status badge
  const badgeColor = overall === "READY" ? COLORS.success : overall === "ISSUE" ? COLORS.warning : COLORS.error;
  ctx.fillStyle = badgeColor;
  const badgeW = ctx.measureText(overall || "UNKNOWN").width + 24;
  roundRect(ctx, W - PAD - 20 - badgeW, PAD + 28, badgeW, 28, 14, true, false);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px system-ui, sans-serif";
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
  ctx.font = "13px system-ui, sans-serif";

  stats.forEach((s, i) => {
    const sx = PAD + 20 + i * statW;
    // Icon
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillText(s.icon, sx, statY + 22);
    // Label
    ctx.fillStyle = COLORS.muted;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(s.label, sx + 30, statY + 12);
    // Value
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 16px system-ui, sans-serif";
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
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("ACTIVE MAPS", PAD + 20, mapY - 8);

  const mapBarH = 32;
  const mapGap = 8;
  const maxMaps = Math.min(maps.length, 5);

  maps.slice(0, maxMaps).forEach((m, i) => {
    const my = mapY + i * (mapBarH + mapGap);
    const state = m.state || m.status || "UNKNOWN";
    const barColor = state === "READY" ? COLORS.success : state === "STARTING" ? COLORS.warning : COLORS.error;

    // Map row background
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    roundRect(ctx, PAD + 20, my, W - PAD * 2 - 40, mapBarH, 6, true, false);

    // Name
    ctx.fillStyle = COLORS.text;
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(m.name || "?", PAD + 40, my + 22);

    // Uptime
    if (m.uptime) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "11px system-ui, sans-serif";
      const ux = PAD + 200;
      ctx.fillText(m.uptime, ux, my + 22);
    }

    // State badge
    const bw = ctx.measureText(state).width + 16;
    const bx = W - PAD - 40 - bw;
    ctx.fillStyle = barColor;
    roundRect(ctx, bx, my + 6, bw, 20, 10, true, false);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.fillText(state, bx + 8, my + 20);
  });

  // Footer
  const footerY = H - PAD - 12;
  ctx.fillStyle = COLORS.muted;
  ctx.font = "10px system-ui, sans-serif";
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
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const canvas = generateStatusCard({
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
