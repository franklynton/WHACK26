// Races: every nation is one race, with real strengths and weaknesses in the sim,
// a voice for the AI, and a leader the god can talk to. Pure data, no three.js,
// so the API routes can import it too.
import type { Resources } from "@/types/world";

export type RaceId = "human" | "goblin" | "elf" | "dwarf" | "lizardfolk";

export interface Race {
  id: RaceId;
  name: string; // "Goblin"
  plural: string; // "goblins"
  icon: string;
  blurb: string;
  pros: string[]; // shown on the landing page
  cons: string[];
  // Multipliers on the sim (1 = human baseline)
  births: number; // how often adults have children
  appetite: number; // how fast they get hungry
  fight: number; // war strength
  speed: number; // walking speed
  lifespan: number; // extra years of life (can be negative)
  faithDecay: number; // how fast faith fades
  stability: number; // added to the nation's target stability
  tech: number; // how fast they climb the eras towards space
  yield: Partial<Resources>; // what they're good (or bad) at gathering
  home: string; // the planet type they thrive on (+20% births and gathering)
  // For the AI and the leader portrait
  voice: string; // how they talk, given to the LLM
  titles: string[]; // leader titles
  names: { start: string[]; end: string[] };
  skin: string[]; // portrait skin tones
}

export const RACES: Race[] = [
  {
    id: "human", name: "Human", plural: "humans", icon: "🧑",
    blurb: "Curious, stubborn and quick to invent things.",
    pros: ["Fastest to reach space", "Balanced at everything"], cons: ["No special talent", "Average fighters"],
    births: 1, appetite: 1, fight: 1, speed: 1, lifespan: 0, faithDecay: 1, stability: 0, tech: 1, yield: {}, home: "Verdant",
    voice: "plain-spoken, ambitious and a little self-important; they make plans and speeches and love the word 'progress'",
    titles: ["King", "Queen", "Chancellor", "High Steward", "First Consul"],
    names: { start: ["Al", "Bren", "Cas", "Ed", "Mar", "Ro", "Is", "Wil"], end: ["ric", "wyn", "da", "mund", "ella", "bert", "ora", "an"] },
    skin: ["#f1c7a5", "#d9a37c", "#a8714f", "#6e4630"],
  },
  {
    id: "goblin", name: "Goblin", plural: "goblins", icon: "👺",
    blurb: "Loud, greedy, and terrifying in a fight.",
    pros: ["Twice as strong in war", "Breed very fast", "Great at finding gold"], cons: ["Ten times slower to reach space", "Always hungry", "Unstable and quarrelsome"],
    births: 1.5, appetite: 1.35, fight: 2, speed: 1.15, lifespan: -12, faithDecay: 1.3, stability: -12, tech: 0.1, yield: { gold: 1.6, metal: 1.2, herbs: 0.5, food: 0.8 }, home: "Gilded",
    voice: "SHOUTY, greedy and not very clever; broken grammar ('we smash', 'you give shiny'), refers to themselves in the third person, obsessed with gold, meat and fighting",
    titles: ["Warboss", "Big Chief", "Head Biter", "Lord of Shinies", "Grand Smasher"],
    names: { start: ["Grukk", "Snag", "Zog", "Rikk", "Nob", "Skab", "Gitz", "Muk"], end: ["", "a", "nob", "gob", "le", "ka"] },
    skin: ["#7fae4e", "#5d8f3a", "#93a03d", "#6b7f45"],
  },
  {
    id: "elf", name: "Elf", plural: "elves", icon: "🧝",
    blurb: "Ancient, devout and very sure they are right.",
    pros: ["Live very long", "Faith barely fades", "Masters of herbs and forests"], cons: ["Very few children", "Weak in war", "Slow to expand"],
    births: 0.55, appetite: 0.8, fight: 0.75, speed: 1.1, lifespan: 30, faithDecay: 0.4, stability: 6, tech: 0.8, yield: { herbs: 1.8, wood: 1.3, metal: 0.6, stone: 0.7 }, home: "Timberworld",
    voice: "poetic, slow and smug; speaks in metaphors about stars, roots and centuries, quietly condescending to younger races",
    titles: ["High Lady", "Elder", "Star-Warden", "Keeper of Leaves", "the Undying"],
    names: { start: ["Ael", "Sil", "Ith", "Faen", "Lor", "Ny", "Ela", "Thal"], end: ["anor", "wen", "iel", "thas", "ariel", "orin", "ithra"] },
    skin: ["#f4e0cf", "#e8cdb5", "#d6c1d8", "#c9b79c"],
  },
  {
    id: "dwarf", name: "Dwarf", plural: "dwarves", icon: "🧔",
    blurb: "Gruff miners who trust stone more than gods.",
    pros: ["Double stone and metal", "Tough fighters", "Very stable cities"], cons: ["Slow walkers", "Hate forests (poor wood)", "Faith fades fast"],
    births: 0.85, appetite: 1, fight: 1.4, speed: 0.75, lifespan: 15, faithDecay: 1.4, stability: 12, tech: 1.15, yield: { stone: 2, metal: 2, wood: 0.5, herbs: 0.7 }, home: "Ironworld",
    voice: "gruff, blunt and grumbling; measures everything in ore, ale and grudges, suspicious of anything they can't hit with a hammer",
    titles: ["Thane", "Under-King", "Forge-Lord", "Keeper of the Deep", "Old Beard"],
    names: { start: ["Bor", "Dur", "Grim", "Thra", "Bal", "Kaz", "Hur", "Dvo"], end: ["in", "ak", "grim", "dun", "rik", "nar", "li"] },
    skin: ["#e3b08c", "#c98d6a", "#a56d4d", "#8a5a42"],
  },
  {
    id: "lizardfolk", name: "Lizardfolk", plural: "lizardfolk", icon: "🦎",
    blurb: "Cold-blooded, patient, and at home in the sea.",
    pros: ["Thrive on islands", "Eat very little", "Rich in food from the sea"], cons: ["Short-lived", "Distrust the god (faith fades)", "Slow to invent"],
    births: 1.1, appetite: 0.7, fight: 1.2, speed: 1, lifespan: -8, faithDecay: 1.2, stability: 4, tech: 0.6, yield: { food: 1.4, herbs: 1.2, metal: 0.6, gold: 0.8 }, home: "Archipelago",
    voice: "cold, ritualistic and unsettling; hisses (draws out 's' sounds), talks about tides, eggs, the sun and patience, never shows emotion",
    titles: ["Sun-Speaker", "Eldest Egg", "Tide-Queen", "Cold King", "Scale-Mother"],
    names: { start: ["Ssa", "Kesh", "Ix", "Thss", "Zhar", "Yss", "Ka", "Sev"], end: ["ka", "rith", "ssa", "esh", "oth", "ix", "ul"] },
    skin: ["#4fa38a", "#3e8a7c", "#7aa65a", "#5c7f9e"],
  },
];

export const RACE: Record<RaceId, Race> = Object.fromEntries(RACES.map((r) => [r.id, r])) as Record<RaceId, Race>;

// The ladder to the stars. Tech points come from population, stability and race;
// humans reach the Space Age in a few minutes of play, goblins take about ten times as long.
export const ERAS = ["Stone Age", "Bronze Age", "Iron Age", "Medieval Age", "Renaissance", "Industrial Age", "Atomic Age", "Space Age"] as const;
export const ERA_AT = [0, 120, 300, 520, 780, 1080, 1420, 1800];

export function eraOf(tech: number) {
  let e = 0;
  while (e + 1 < ERA_AT.length && tech >= ERA_AT[e + 1]) e++;
  return e;
}

// 0..1 progress through the current era (1 once in the Space Age).
export function eraProgress(tech: number) {
  const e = eraOf(tech);
  if (e === ERA_AT.length - 1) return 1;
  return (tech - ERA_AT[e]) / (ERA_AT[e + 1] - ERA_AT[e]);
}

export interface Leader {
  name: string;
  title: string;
  seed: number; // varies the portrait
}

export function makeLeader(race: Race): Leader {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { name: pick(race.names.start) + pick(race.names.end), title: pick(race.titles), seed: Math.floor(Math.random() * 1e6) };
}
