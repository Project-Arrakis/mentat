// Flavor-text quotes shown at the bottom of most embeds (see duneEmbed() in
// embedFormat.js), signed "— Sahir Venn". A mix of genuine Frank Herbert
// Dune-novel lines about Mentats/logic (verified against the books, not
// the 1984 film's "It is by will alone..." mantra, which is a film-only
// invention and deliberately NOT used here) and original computational
// asides written in the same voice -- Sahir Venn, a Mentat, speaking as
// one. ARRAKIS_TERMS is the generic pool (also the fallback for an
// unknown/missing faction); FACTION_QUOTES flavors the same computational
// voice through each in-game faction's own values, for report contexts
// where a faction/battlegroup is known.
export const ARRAKIS_TERMS = [
  // Genuine Dune-novel lines (Mentat-voiced, or in-universe Mentat texts) --
  // verified against the books, not the 1984 film's "It is by will alone..."
  // mantra, which is a film-only invention and deliberately not used here.
  "I am a Mentat. I trust logic and statistics, not mysticism and prophecy.", // Thufir Hawat, Dune
  "That's the curse of being a Mentat. You can't stop analyzing your data.", // Thufir Hawat, Dune
  "A process cannot be understood by stopping it. Understanding must move with the flow of the process, must join it and flow with it.", // the First Law of Mentat
  "Above all else, a Mentat must be a generalist, not a specialist.", // the Mentat Handbook
  "Many things we do naturally become difficult only when we try to make them intellectual subjects. It is possible to know so much about a subject that you become totally ignorant.", // the Mentat Handbook, Chapterhouse: Dune
  "Deep in the human unconscious is a pervasive need for a logical universe that makes sense.", // Dune
  "The beginning of knowledge is the discovery of something we do not understand.", // Dune
  // Original, written in the same voice
  "Computation complete. The variables were kinder than expected.",
  "The data holds. I have no reason to doubt it — yet.",
  "First-level analysis: the pattern holds.",
  "I compute; I do not guess.",
  "Every variable accounted for. That is the whole of my discipline.",
  "The numbers converge. Draw your own conclusions — I have already drawn mine.",
  "Uncertainty noted. Confidence: high.",
  "A Mentat trusts the data before the instinct. Today, they agree.",
  "Spice yield, player count, structural integrity — three inputs, one clear picture."
];

export const FACTION_QUOTES = {
  atreides: [
    "Duty is a variable I weight heavily. House Atreides taught me that.",
    "The Atreides calculus: strength in service, not conquest. The data still bears this out.",
    "A Duke asks for the truth, not comfort. Here is the truth.",
    "I have modeled loyalty as a variable. It rarely fails to converge.",
    "We are House Atreides. There is no call we do not answer. There is no faith that we betray.",
    "A great man doesn't seek to lead. He's called to it.",
    "Our strength is in our honor. Our future is in our loyalty.",
    "The Atreides legacy is built on trust, not fear.",
    "Leadership is not about power. It is about responsibility.",
    "Without change, something sleeps inside us and seldom awakens.",
    "The mystery of life isn't a problem to solve, but a reality to experience.",
    "Paul Atreides showed us: the sleeper must awaken.",
  ],
  harkonnen: [
    "Power is measurable. I have measured it.",
    "The Harkonnen model rewards efficiency over sentiment. The numbers do not care which you prefer.",
    "Fear is a variable too. I do not need to feel it to compute with it.",
    "Every resource is fungible. That is not cruelty — it is arithmetic.",
    "The weak assumption dies first in any model. Plan accordingly.",
    "The blue griffin watches from Giedi Prime. Nothing escapes its gaze.",
    "He who controls the spice controls the universe.",
    "Power is not given. It is taken.",
    "Mercy is a weakness we cannot afford.",
    "Glory is fleeting, but power is eternal.",
    "Resources exist to be extracted. Planets exist to be ruled.",
    "A Harkonnen never forgives. A Harkonnen never forgets.",
    "Let them hate — so long as they fear.",
  ],
  fremen: [
    "The desert punishes bad math. I do not make bad math.",
    "Water discipline and data discipline are the same discipline.",
    "Shai-Hulud does not negotiate with probability. Neither should you.",
    "Survival is a computation the Fremen perfected before I was trained to run it.",
    "The worm comes for the careless variable. Watch yours.",
    "Bless the Maker and His water. Bless the coming and going of Him.",
    "Walk without rhythm and you won't attract the worm.",
    "Survival is the ability to swim in strange water.",
    "God created Arrakis to train the faithful.",
    "The desert takes the weak. The strong become Fremen.",
    "A man's flesh is his own; his water belongs to the tribe.",
    "Water is life. The tribe's water belongs to all.",
    "The desert teaches patience. The worm teaches humility.",
  ]
};

export function randomQuote(faction) {
  const quotes = FACTION_QUOTES[faction] || ARRAKIS_TERMS;
  return quotes[Math.floor(Math.random() * quotes.length)];
}

// Short computation-style openers for report embeds (status/population/
// doctor) -- distinct from the longer bottom-of-embed quotes above. Kept
// deliberately brief since these sit directly above a status header, not
// as a standalone flavor field; a long line here would compete with the
// header for visual weight instead of framing it.
const COMPUTATION_OPENERS = [
  "Computation complete.",
  "First-level analysis complete.",
  "The data is in.",
  "Query resolved.",
  "Numbers checked, twice.",
  "Reading the data now.",
  "Analysis complete; the pattern is clear.",
  "The variables have spoken."
];

export function randomComputationOpener() {
  return COMPUTATION_OPENERS[Math.floor(Math.random() * COMPUTATION_OPENERS.length)];
}
