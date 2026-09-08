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
  const inlineScriptMatches = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const nonEmptyInline = inlineScriptMatches.filter((m) => m[1].trim().length > 0);
  // False positive below: this is a test assertion reading regex-matched substrings out of a
  // locally-generated HTML string (never rendered, never sent to a browser) to prove NO
  // inline <script> content exists -- there is no XSS sink here, no DOM write, no external
  // input. The rule can't distinguish "asserting on extracted text" from "writing extracted
  // text into a script tag."
  const nonEmptyScripts = nonEmptyInline.map((m) => m[0]);
  assert.deepEqual(nonEmptyScripts, [], "renderPage() must not emit an inline <script> block with real content -- it's served under a CSP with no 'unsafe-inline', so an inline script would be silently blocked by the browser"); // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
});

test("renderPage() references its sand-particle script via a same-origin src, not inline", () => {
  const html = renderPage("Test Page", "<p>body</p>");
  assert.match(html, /<script src="\/js\/sand\.js"><\/script>/);
});

test("errorPage() output also has no inline <script> with content", () => {
  let sentHtml = null;
  const mockRes = { status: () => ({ send: (html) => { sentHtml = html; } }) };
  errorPage(mockRes, 500, "Oops", "Something went wrong.");
  const inlineScriptMatches = [...sentHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const nonEmptyInline = inlineScriptMatches.filter((m) => m[1].trim().length > 0);
  // Same false positive as the test above -- see that comment.
  const nonEmptyScripts = nonEmptyInline.map((m) => m[0]);
  assert.deepEqual(nonEmptyScripts, []); // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
});

// L3 audit finding (2026-09-08): the regex above originally used `\ssrc=`
// in its negative lookahead, which matches any attribute merely ENDING in
// "-src=" (a word boundary exists at the hyphen) -- not only a literal
// `src` attribute. A future <script data-src="x">doRealWork()</script>
// (no true src, so the inline content still executes and is still blocked
// by CSP) would have incorrectly been excluded from inlineScriptMatches by
// that lookahead, silently passing this "no inline script" regression
// test. Fixed to `\ssrc=` (requires actual whitespace immediately before
// "src="), which only matches a genuine standalone src attribute.
test("the inline-script detection regex itself does not mistake a 'data-src' attribute for a real 'src' attribute", () => {
  const html = '<script data-src="x">doRealWork();</script>';
  const inlineScriptMatches = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const nonEmptyInline = inlineScriptMatches.filter((m) => m[1].trim().length > 0);
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- same false positive as the other tests in this file: asserting on a regex-extracted length from a locally-constructed literal string, no XSS sink involved.
  assert.equal(nonEmptyInline.length, 1, "a <script data-src=...> with real inline content must still be detected as inline -- 'data-src' is not 'src'");
});
