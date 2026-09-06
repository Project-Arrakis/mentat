import test from "node:test";
import assert from "node:assert/strict";
import { ARRAKIS_TERMS, FACTION_QUOTES, randomQuote, randomComputationOpener } from "../src/quotes.js";

test("randomQuote: no faction returns a line from ARRAKIS_TERMS", () => {
  const q = randomQuote(undefined);
  assert.ok(ARRAKIS_TERMS.includes(q));
});

test("randomQuote: an unknown faction falls back to ARRAKIS_TERMS", () => {
  const q = randomQuote("spacing-guild");
  assert.ok(ARRAKIS_TERMS.includes(q));
});

test("randomQuote: a known faction returns a line from that faction's own pool, never a different one", () => {
  for (const faction of Object.keys(FACTION_QUOTES)) {
    for (let i = 0; i < 20; i++) {
      const q = randomQuote(faction);
      assert.ok(FACTION_QUOTES[faction].includes(q), `${faction} quote must come from its own pool`);
    }
  }
});

test("every ARRAKIS_TERMS and FACTION_QUOTES entry is a non-empty string", () => {
  for (const q of ARRAKIS_TERMS) {
    assert.equal(typeof q, "string");
    assert.ok(q.length > 0);
  }
  for (const list of Object.values(FACTION_QUOTES)) {
    for (const q of list) {
      assert.equal(typeof q, "string");
      assert.ok(q.length > 0);
    }
  }
});

test("randomComputationOpener: always returns a short, non-empty string", () => {
  for (let i = 0; i < 20; i++) {
    const opener = randomComputationOpener();
    assert.equal(typeof opener, "string");
    assert.ok(opener.length > 0 && opener.length < 60, "computation openers must stay short -- they sit above a status header, not as a standalone flavor field");
  }
});
