import { createCanvas, GlobalFonts, loadImage, Image } from "@napi-rs/canvas";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

let BANNER = null;
async function loadBanner() {
  if (!BANNER) {
    try { BANNER = await loadImage(join(ASSETS, "status-bg.png")); }
    catch { BANNER = new Image(); }
  }
  return BANNER;
}

const W = 1200, H = 640;
const PAD = 40;
const CARD_TOP = 184, CARD_BOT = 576;

const FACTION_COLORS = {
  atreides: { primary: "#3b82f6", secondary: "#1e40af", accent: "#60a5fa" },
  harkonnen: { primary: "#ef4444", secondary: "#991b1b", accent: "#f87171" },
  fremen: { primary: "#f59e0b", secondary: "#92400e", accent: "#fbbf24" },
  default: { primary: "#a06839", secondary: "#8b6914", accent: "#c2a44e" }
};

const ERROR_COLORS = { primary: "#dc2626", secondary: "#7f1d1d", accent: "#fca5a5" };

export async function generateStatusCard({ title, overall, region, mode, population, maps = [], services = 0, latency = 0, quote = "", faction, isError = false } = {}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const colors = isError ? ERROR_COLORS : (FACTION_COLORS[faction] || FACTION_COLORS.default);

  const bg = await loadBanner();
  if (bg.width > 0) {
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }

  if (isError) {
    ctx.fillStyle = "rgba(40,0,0,0.55)";
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
  }
  ctx.fillRect(0, 0, W, H);

  const cx = PAD, cy = CARD_TOP, cw = W - PAD * 2, ch = CARD_BOT - CARD_TOP;
  ctx.fillStyle = isError ? "rgba(30,8,8,0.9)" : "rgba(15,12,8,0.85)";
  roundRect(ctx, cx, cy, cw, ch, 12, true, false);
  ctx.strokeStyle = colors.accent + "66";
  ctx.lineWidth = isError ? 2 : 1;
  roundRect(ctx, cx, cy, cw, ch, 12, false, true);

  ctx.fillStyle = colors.primary;
  ctx.font = "32px \"Dune Rise\"";
  ctx.fillText(title || "Server", cx + 24, cy + 44);

  ctx.fillStyle = "#ffffff";
  ctx.font = "18px \"Dune Rise\"";
  const badge = overall || "UNKNOWN";
  const bw = ctx.measureText(badge).width + 24;
  const bc = overall === "READY" ? colors.primary : overall === "ISSUE" ? colors.accent : isError ? colors.secondary : colors.secondary;
  ctx.fillStyle = bc;
  roundRect(ctx, cx + cw - 24 - bw, cy + 20, bw, 26, 13, true, false);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(badge, cx + cw - 24 - bw / 2 - ctx.measureText(badge).width / 2, cy + 40);

  const stats = [
    { label: "PLAYERS", value: population || "—" },
    { label: "REGION", value: region || "—" },
    { label: "MODE", value: mode || "—" },
    { label: "LATENCY", value: latency ? `${latency}ms` : "—" },
    { label: "SERVICES", value: String(services) },
  ];
  const statY = cy + 74;
  const statW = cw / stats.length;
  stats.forEach((s, i) => {
    const sx = cx + 12 + i * statW;
    ctx.fillStyle = colors.accent;
    ctx.font = "12px \"Dune Rise\"";
    ctx.fillText(s.label, sx, statY + 14);
    ctx.fillStyle = "#ffffff";
    ctx.font = "14px \"Dune Rise\"";
    ctx.fillText(s.value, sx, statY + 40);
  });

  ctx.strokeStyle = colors.accent + "4D";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 20, statY + 62);
  ctx.lineTo(cx + cw - 20, statY + 62);
  ctx.stroke();

  const mapY = statY + 80;
  ctx.fillStyle = colors.primary;
  ctx.font = "12px \"Dune Rise\"";
  ctx.fillText("ACTIVE MAPS", cx + 24, mapY + 14);

  const mh = 34, mg = 6, maxM = Math.min(maps.length, 4);
  const fcs = [colors.primary, colors.secondary, colors.accent, colors.primary];
  maps.slice(0, maxM).forEach((m, i) => {
    const my = mapY + 24 + i * (mh + mg);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(ctx, cx + 20, my, cw - 40, mh, 6, true, false);

    ctx.fillStyle = "#ffffff";
    ctx.font = "16px \"Dune Rise\"";
    ctx.fillText(m.name || "?", cx + 42, my + 24);

    if (m.uptime) {
      ctx.fillStyle = "#b8956e";
      ctx.font = "12px \"Dune Rise\"";
      ctx.fillText(m.uptime, cx + 240, my + 24);
    }

    const st = m.state || m.status || "?";
    const sw = ctx.measureText(st).width + 18;
    ctx.fillStyle = fcs[i % fcs.length];
    roundRect(ctx, cx + cw - 42 - sw, my + 6, sw, 22, 11, true, false);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px \"Dune Rise\"";
    ctx.fillText(st, cx + cw - 42 - sw / 2 - ctx.measureText(st).width / 2, my + 22);
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = "12px \"Dune Rise\"";
  ctx.fillText(`Thumper · ${quote || "The spice must flow."}`, cx + 24, CARD_BOT - 20);

  return canvas;
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof r === "object") r = r.tl || r.tr || r.br || r.bl || 0;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

import { writeFileSync } from "node:fs";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const c = await generateStatusCard({
    title: "Tabr-Tau", overall: "READY", region: "North America", mode: "public",
    population: "0/60", maps: [
      { name: "Survival_1", state: "READY", uptime: "Up 18h" },
      { name: "Overmap", state: "READY", uptime: "Up 18h" },
    ], services: 10, quote: "The spice must flow."
  });
  writeFileSync("/tmp/status-card-test.png", c.toBuffer("image/png"));
  console.log("Test card saved");
}
