import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPage, errorPage } from "../src/setupLayout.js";

// mentat-link#127: this HTML is served through mentat-link's reverse
// proxy as an opaque passthrough, under mentat-link's own strict
// Content-Security-Policy (script-src 'self', no 'unsafe-inline').
// renderPage() previously emitted an inline <script>...</script> block
// (a cosmetic sand-particle animation) that CSP would silently block --
// a real, live-verified gap, not a theoretical one (confirmed via a real
// wrangler pages dev instance rendering this proxy). Fixed by
// externalizing to a same-origin <script src="..."> reference (public/js/
// sand.js served by this repo, and an identical copy at mentat-link's
// own js/sand.js so the browser's relative request resolves without an
// extra proxy hop -- see that file's own comment). This test is a
// permanent regression backstop: any future renderPage() change that
// reintroduces an inline script with real content should fail this
// immediately, not get rediscovered as a silent production breakage.
test("renderPage() output has no inline <script> with content -- only same-origin <script src=...> references", () => {
  const html = renderPage("Test Page", "<p>body</p>");
  const inlineScriptMatches = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const nonEmptyInline = inlineScriptMatches.filter((m) => m[1].trim().length > 0);
  assert.deepEqual(
    nonEmptyInline.map((m) => m[0]),
    [],
    "renderPage() must not emit an inline <script> block with real content -- it's served under a CSP with no 'unsafe-inline', so an inline script would be silently blocked by the browser"
  );
});

test("renderPage() references its sand-particle script via a same-origin src, not inline", () => {
  const html = renderPage("Test Page", "<p>body</p>");
  assert.match(html, /<script src="\/js\/sand\.js"><\/script>/);
});

test("errorPage() output also has no inline <script> with content", () => {
  let sentHtml = null;
  const mockRes = { status: () => ({ send: (html) => { sentHtml = html; } }) };
  errorPage(mockRes, 500, "Oops", "Something went wrong.");
  const inlineScriptMatches = [...sentHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const nonEmptyInline = inlineScriptMatches.filter((m) => m[1].trim().length > 0);
  assert.deepEqual(nonEmptyInline.map((m) => m[0]), []);
});
