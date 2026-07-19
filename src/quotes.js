export const ARRAKIS_TERMS = [
  "The spice must flow.",
  "Fear is the mind-killer.",
  "Bless the Maker and His water.",
  "Walk without rhythm.",
  "God created Arrakis to train the faithful.",
  "He who controls the spice controls the universe.",
  "A beginning is a very delicate time.",
  "Deep in the human unconscious is a pervasive need for a logical universe that makes sense.",
  "The Fremen were supreme in the quality of their swordsmanship.",
  "Survival is the ability to swim in strange water."
];

export const FACTION_QUOTES = {
  atreides: [
    "We are House Atreides. There is no call we do not answer. There is no faith that we betray.",
    "A great man doesn't seek to lead. He's called to it.",
    "Our strength is in our honor. Our future is in our loyalty.",
    "The Atreides legacy is built on trust, not fear.",
    "We will not abandon Arrakis. We will not abandon our duty.",
    "Leadership is not about power. It is about responsibility.",
    "The Duke Leto Atreides taught us: a leader is best when people barely know he exists.",
    "Without change, something sleeps inside us and seldom awakens.",
    "The mystery of life isn't a problem to solve, but a reality to experience.",
    "Hope strengthens the will. The Atreides banner still flies over Caladan.",
    "We fight not for glory, but for the future of all who call Arrakis home.",
    "The blood of Atreides flows through the desert. It will never dry.",
    "A ruler must be just. A leader must be present. A Duke must be both.",
    "Paul Atreides showed us: the sleeper must awaken.",
  ],
  harkonnen: [
    "The blue griffin watches from Giedi Prime. Nothing escapes its gaze.",
    "He who controls the spice controls the universe.",
    "Power is not given. It is taken.",
    "The Baron's robe is dark blue, lined with scarlet — just as our patience is lined with ambition.",
    "Mercy is a weakness we cannot afford.",
    "Fear will keep the local systems in line.",
    "The Harkonnens do not negotiate. We conquer.",
    "Glory is fleeting, but power is eternal.",
    "The blue griffin's claws reach across the Imperium.",
    "Obey or be destroyed. There is no third option.",
    "Resources exist to be extracted. Planets exist to be ruled.",
    "Giedi Prime's factories never sleep. Neither does our ambition.",
    "A Harkonnen never forgives. A Harkonnen never forgets.",
    "The Baron's spies see everything. The Baron's hand reaches everywhere.",
    "Let them hate — so long as they fear.",
    "Victory is celebrated. Defeat is punished. This is the way of Giedi Prime.",
  ],
  fremen: [
    "Bless the Maker and His water. Bless the coming and going of Him.",
    "The Fremen were supreme in the quality of their swordsmanship.",
    "Walk without rhythm and you won't attract the worm.",
    "Survival is the ability to swim in strange water.",
    "God created Arrakis to train the faithful.",
    "The desert takes the weak. The strong become Fremen.",
    "There is no escape — we pay for the violence of our ancestors.",
    "A man's flesh is his own; his water belongs to the tribe.",
    "The stillsuit is your second skin. Treat it as you would your own flesh.",
    "Shai-Hulud watches from the deep desert. Respect the Maker.",
    "The crysknife is drawn. It cannot be sheathed until it tastes blood.",
    "Water is life. The tribe's water belongs to all.",
    "The sietch walls hold a thousand years of memory.",
    "A Fremen warrior fights with the desert at their back.",
    "The spice must flow. The Fremen will ensure it.",
    "We have worm-sign the size of a carryall. The Maker comes.",
    "In the deep desert, only the strong survive. The Fremen are the strongest.",
    "Our water is our bond. Our tribe is our strength.",
    "The desert teaches patience. The worm teaches humility.",
    "Biy-la kaifa. Nothing needs be explained to the faithful.",
  ]
};

export function randomQuote(faction) {
  const quotes = FACTION_QUOTES[faction] || ARRAKIS_TERMS;
  return quotes[Math.floor(Math.random() * quotes.length)];
}
