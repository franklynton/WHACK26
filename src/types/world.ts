// The shared world-state schema. Every track reads and writes this shape, so change
// it together (and tell the team) rather than adding private copies of fields.

import type { Leader, RaceId } from "@/sim/races";

// The planet itself is simulated in src/sim/planet.ts (typed arrays, ~27k tiles).
// This file holds the summaries that the UI, the API routes and the LLM share.

// God powers the player can use. Brush powers paint an area; spawn and meteor act on a click.
export type GodPower = "raise" | "lower" | "forest" | "rain" | "drought" | "fire" | "meteor" | "spawn" | "miracle" | "peace" | "discord";

// What the people's shared mind (the LLM) is focused on. The sim changes agent behaviour
// for each one: expand founds more villages, farm grows more food, worship keeps faith up,
// explore roams further, hoard eats less but has fewer children, rebel burns shrines.
export type Policy = "settle" | "expand" | "farm" | "worship" | "explore" | "hoard" | "rebel";
export const POLICIES: Policy[] = ["settle", "expand", "farm", "worship", "explore", "hoard", "rebel"];

// Needs decay over time, like Millennium Bug's pet stats. 0 = collapse, 100 = perfect.
export interface Needs {
  food: number;
  faith: number;
  stability: number;
}

// Planets are rich in different resources (see PLANET_TYPES in src/sim/planet.ts),
// which is what makes trading between planets worth it. Herbs are medicine.
export interface Resources {
  food: number;
  wood: number;
  stone: number;
  metal: number;
  gold: number;
  herbs: number;
}

export interface PlanetStats {
  planetType: string; // e.g. "Timberworld"; decides which resources are plentiful
  population: number;
  villages: number;
  ocean: number; // percentages of the planet's surface
  forest: number;
  desert: number;
  mountains: number;
  resources: Resources; // stockpiled, see PlanetSim.resources
}

// Everything the LLM has invented about this civilisation. Null until the first village.
export interface Civ {
  name: string; // what they call themselves
  demonym: string; // e.g. "the Vael"
  language: { name: string; words: Record<string, string> }; // a few invented words: english -> theirs
  religion: {
    name: string;
    godName: string; // what they call the player
    belief: string; // one sentence on what they think the player is
  };
  attitude: Attitude; // how they currently feel about the player
  myths: string[]; // newest last, at most ~8
  laws: string[]; // newest last, at most ~8
}

export type Attitude = "worship" | "fear" | "indifferent" | "resentful" | "hostile";

// Collapse states that the simulation triggers when needs fall too low.
export type Crisis = "famine" | "revolution" | "cult";

export type ChronicleKind = GodPower | Crisis | "genesis" | "village" | "milestone" | "extinct" | "disaster" | "mind" | "contact" | "diplomacy" | "captured" | "fallen";

// One line of the running history shown to the player.
export interface ChronicleEntry {
  year: number;
  kind: ChronicleKind;
  text: string;
}

// One line of conversation between the god (player) and the people's shared mind.
export interface MindMessage {
  from: "god" | "mind";
  text: string;
}

// How two nations on the same planet feel about each other. Tension (0-100) moves
// them along peace -> trade (low tension) or rival -> war (high tension).
export type Relation = "peace" | "trade" | "rival" | "war";

// A read-out of one nation for the HUD and the LLM, built by PlanetSim.nationInfo().
export interface NationInfo {
  id: number;
  name: string;
  color: string;
  alive: boolean;
  policy: Policy;
  population: number;
  villages: number; // every settlement, including towns and cities
  cities?: number;
  towns?: number;
  capital?: string;
  race: RaceId; // see src/sim/races.ts
  tech: number; // progress towards space
  ships?: number; // warships in its navy (from the Iron Age)
  love?: number; // 0..100: how much this nation loves its god
  era: number; // index into ERAS (0 = Stone Age, 7 = Space Age)
  leader: Leader;
  needs: Needs;
  crisis: Crisis | null;
  relations: { id: number; name?: string; relation: Relation; tension: number }[];
}

// The snapshot sent to the LLM. Built from the live sim each time.
export interface World {
  id: string;
  year: number;
  stats: PlanetStats;
  needs: Needs;
  crisis: Crisis | null;
  policy: Policy;
  civ: Civ | null;
  chronicle: ChronicleEntry[]; // newest last
  nation?: {
    id: number; name: string; population: number; villages: number; relations: { name: string; relation: Relation; tension: number }[];
    race?: RaceId; era?: number; leader?: Leader; // who they are, so the AI speaks in their race's voice
  }; // the nation whose mind is speaking
}

// ---- Multiplayer galaxy (Supabase Realtime) ----

// What each planet shares with everyone in the galaxy via presence.
export interface GalaxyPlanet {
  worldId: string;
  ownerName: string;
  civName: string | null;
  attitude: Attitude | null;
  position: { x: number; y: number }; // 0-1 on the galaxy map
}

// One turn of a negotiation between two civilisations, generated by the LLM.
export interface ContactTurn {
  fromWorldId: string;
  toWorldId: string;
  speaker: string; // civ name
  text: string; // what they said (may include invented words)
  intent: "greet" | "trade" | "threaten" | "misunderstand" | "ally" | "war";
}

// One line of a conversation between the god and a nation's leader (the leader dialogue).
export interface LeaderMessage {
  from: "god" | "leader";
  text: string;
}
