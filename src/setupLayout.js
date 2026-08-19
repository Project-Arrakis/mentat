import { esc } from "./htmlEscape.js";

const SHARED_CSS = `
  :root {
    --bg-deep: #0d0f12;
    --bg-board: #1a1510;
    --parchment: #f5e6c8;
    --parchment-dark: #d4c4a0;
    --sand-light: #ffd08a;
    --sand-mid: #c68b4a;
    --spice-glow: #e8a84c;
    --sienna: #6b3a2a;
    --text-light: #f3efe7;
    --muted: #ad9f89;
    --border: #302b25;
    --border-strong: #4d4032;
    --danger: #e05a4a;
    --danger-bg: rgba(224, 90, 74, .12);
    --success: #5aab61;
    --success-bg: rgba(90, 171, 97, .12);
    --font-heading: 'Marcellus', serif;
    --font-body: 'Inter', sans-serif;
    --font-code: ui-monospace, 'SF Mono', 'Consolas', monospace;
    --radius: 10px;
    --radius-sm: 6px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-body);
    background: var(--bg-deep);
    color: var(--text-light);
    line-height: 1.6;
    min-height: 100vh;
  }
  .sand-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
  .sand-particle {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 208, 138, 0.35);
    animation: sandDrift linear infinite;
  }
  @keyframes sandDrift {
    0%   { transform: translateX(-5vw) translateY(0); opacity: 0; }
    10%  { opacity: 0.7; }
    90%  { opacity: 0.7; }
    100% { transform: translateX(105vw) translateY(15vh); opacity: 0; }
  }
  .hero-glow {
    position: fixed;
    width: min(500px, 80vw); height: min(500px, 80vw);
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(232, 168, 76, 0.06) 0%, transparent 70%);
    animation: glowPulse 6s ease-in-out infinite alternate;
    pointer-events: none;
    z-index: 0;
  }
  @keyframes glowPulse {
    0% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
  }
  .page {
    position: relative; z-index: 1;
    max-width: 640px; margin: 0 auto;
    padding: 40px 20px 60px;
  }
  .page--center {
    min-height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .hero-icon {
    width: 80px; height: 80px;
    margin: 0 auto 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, var(--spice-glow), var(--sand-mid), var(--sienna));
    box-shadow: 0 0 30px rgba(232, 168, 76, 0.3), 0 0 60px rgba(232, 168, 76, 0.15);
    animation: iconFloat 4s ease-in-out infinite alternate;
  }
  @keyframes iconFloat {
    0% { transform: translateY(0); }
    100% { transform: translateY(-6px); }
  }
  h1 {
    font-family: var(--font-heading);
    font-size: clamp(24px, 5vw, 38px);
    color: var(--sand-light);
    text-align: center;
    letter-spacing: 0.02em;
  }
  .subtitle {
    font-family: var(--font-heading);
    font-style: italic;
    font-size: clamp(16px, 2.5vw, 18px);
    color: var(--parchment-dark);
    text-align: center;
    margin-bottom: 28px;
  }
  .welcome {
    color: var(--parchment-dark);
    font-size: 15px;
    text-align: center;
    margin-top: 4px;
  }
  .panel {
    background: var(--bg-board);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: clamp(16px, 3vw, 24px);
    margin-bottom: 16px;
    width: 100%;
  }
  .panel h2 {
    font-family: var(--font-heading);
    font-size: clamp(16px, 2.5vw, 18px);
    color: var(--sand-light);
    margin-bottom: 14px;
  }
  .panel p {
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
  }
  label {
    display: block;
    margin-bottom: 4px;
    font-weight: 600;
    font-size: 13px;
    color: var(--parchment-dark);
  }
  label em { font-weight: 400; color: var(--muted); font-style: italic; }
  input, select {
    width: 100%;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: rgba(13, 15, 18, 0.6);
    color: var(--text-light);
    font-family: var(--font-body);
    font-size: 14px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  input:focus, select:focus {
    outline: none;
    border-color: var(--spice-glow);
    box-shadow: 0 0 0 2px rgba(232, 168, 76, 0.2);
  }
  .field { margin-bottom: 14px; }
  .field:last-child { margin-bottom: 0; }
  .hint {
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
    line-height: 1.4;
  }
  code {
    font-family: var(--font-code);
    font-size: 0.9em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(232, 168, 76, 0.12);
    color: var(--sand-light);
  }
  .token-row {
    display: flex; gap: 8px;
  }
  .token-row input { flex: 1; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    background: linear-gradient(135deg, var(--spice-glow), var(--sand-mid));
    color: var(--bg-deep);
    border: none;
    padding: 12px 26px;
    border-radius: var(--radius);
    font-weight: 700; font-size: 15px;
    cursor: pointer; text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    box-shadow: 0 4px 24px rgba(232, 168, 76, 0.3);
  }
  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 36px rgba(232, 168, 76, 0.5);
  }
  .btn:disabled {
    opacity: 0.6; cursor: not-allowed; transform: none;
  }
  .btn--sm {
    padding: 9px 14px; font-size: 13px; white-space: nowrap;
  }
  .btn--block { width: 100%; justify-content: center; }
  .btn--text-center { text-align: center; }
  .notification {
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    margin-bottom: 16px;
    font-size: 14px;
    display: none;
    align-items: flex-start;
    gap: 10px;
    line-height: 1.45;
  }
  .notification--visible { display: flex; }
  .notification--error {
    background: var(--danger-bg);
    border: 1px solid rgba(224, 90, 74, .3);
    color: #f5aca5;
  }
  .notification--success {
    background: var(--success-bg);
    border: 1px solid rgba(90, 171, 97, .3);
    color: #a5d6a7;
  }
  .notification__icon { flex-shrink: 0; font-size: 18px; line-height: 1; }
  .notification__body { flex: 1; min-width: 0; }
  .notification__title { font-weight: 700; margin-bottom: 2px; }
  .success-page {
    text-align: center; padding: 60px 20px;
  }
  .success-icon {
    width: 64px; height: 64px;
    margin: 0 auto 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, var(--spice-glow), var(--sand-mid));
    box-shadow: 0 0 30px rgba(232, 168, 76, 0.4);
    display: flex; align-items: center; justify-content: center;
    font-size: 30px; color: var(--bg-deep);
  }
  .footer { text-align: center; margin-top: 24px; color: var(--muted); font-size: 12px; }
  @media (max-width: 480px) {
    .page { padding: 24px 16px 40px; }
    .token-row { flex-direction: column; }
    .btn { width: 100%; justify-content: center; }
  }
`;

function sandScript() {
  return `
    (function() {
      var layer = document.getElementById('sandLayer');
      if (!layer) return;
      for (var i = 0; i < 20; i++) {
        var p = document.createElement('div');
        p.className = 'sand-particle';
        var size = Math.random() * 4 + 2;
        p.style.cssText = 'width:' + size + 'px;height:' + size + 'px;top:' + (Math.random() * 100) + '%;left:' + (Math.random() * -10) + '%;animation-duration:' + (Math.random() * 15 + 10) + 's;animation-delay:' + (Math.random() * 10) + 's;';
        layer.appendChild(p);
      }
    })();`;
}

export function renderPage(title, body, opts = {}) {
  const center = opts.center ? " page--center" : "";
  const hero = opts.hero
    ? `<div class="hero-icon" aria-hidden="true"></div>`
    : "";
  const glow = opts.glow !== false
    ? `<div class="hero-glow" aria-hidden="true"></div>`
    : "";
  const heading = opts.heading
    ? `<h1>${esc(opts.heading)}</h1>`
    : "";
  const subtitle = opts.subtitle
    ? `<p class="subtitle">${esc(opts.subtitle)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Marcellus&display=swap" rel="stylesheet">
  <style>${SHARED_CSS}</style>
</head>
<body>
  <div class="sand-layer" id="sandLayer" aria-hidden="true"></div>
  ${glow}
  <div class="page${center}">
    ${hero}${heading}${subtitle}
    ${body}
  </div>
  <script>${sandScript()}</script>
  <script src="/setup.js"></script>
</body>
</html>`;
}

export function errorPage(res, status, title, message) {
  const body = `
    <section class="panel" style="text-align:center;max-width:480px;margin:0 auto;">
      <p style="font-size:15px;">${esc(message)}</p>
      <a href="/setup" class="btn" style="margin-top:16px;">Start Over</a>
    </section>`;
  return res.status(status).send(renderPage(title, body, {
    heading: title,
    hero: false,
    glow: true
  }));
}
