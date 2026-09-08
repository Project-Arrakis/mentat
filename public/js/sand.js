// Cosmetic sand-particle background animation for the setup portal's
// shared page layout (see src/setupLayout.js's renderPage()). Externalized
// from an inline <script> tag so this page is compatible with a strict
// script-src 'self' Content-Security-Policy that carries no
// 'unsafe-inline' allowance -- see mentat-link#127.
//
// This exact rendered HTML is served through mentat-link's reverse proxy
// as an opaque passthrough (functions/_lib/reverseProxy.js), so a browser
// resolves this script's relative src against mentat-link's own origin,
// NOT this server -- it never actually reaches this file via the proxied
// path in the normal (proxied) flow. An identical copy is committed at
// mentat-link's js/sand.js so that relative request resolves directly,
// with zero extra proxy hop, matching every other static asset on that
// site. This copy exists so the page still renders correctly for anyone
// who reaches this server directly (e.g. internal debugging against
// mentat-backend.darkdante.org, bypassing the proxy) -- both copies must
// stay in sync; it's small and static enough that's a low-risk drift
// class, not worth a build step to dedupe for one file.
//
// Purely static, no templated data -- safe to serve as-is either place.
(function () {
  var layer = document.getElementById("sandLayer");
  if (!layer) return;
  for (var i = 0; i < 20; i++) {
    var p = document.createElement("div");
    p.className = "sand-particle";
    var size = Math.random() * 4 + 2;
    p.style.cssText = "width:" + size + "px;height:" + size + "px;top:" + (Math.random() * 100) + "%;left:" + (Math.random() * -10) + "%;animation-duration:" + (Math.random() * 15 + 10) + "s;animation-delay:" + (Math.random() * 10) + "s;";
    layer.appendChild(p);
  }
})();
