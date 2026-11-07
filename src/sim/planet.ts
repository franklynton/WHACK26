// The planet simulation: a sphere of ~27,000 triangular tiles, the god powers that
// reshape it, and the little people who live on it. Data lives in typed arrays and is
// mutated in place for speed; React only polls `snapshot()` a few times a second.
import * as THREE from "three";
import { fbm, tileRand } from "./noise";
import { RACE, RACES, eraOf, ERAS, makeLeader, type Leader, type RaceId } from "./races";
import type { Crisis, GodPower, NationInfo, Needs, PlanetStats, Policy, Relation, Resources } from "@/types/world";

export const DETAIL = 36; // tiles = 20 * (DETAIL + 1)^2

export enum T {
  Deep,
  Shallow,
  Sand,
  Grass,
  Forest,
  Desert,
  Rock,
  Snow,
}
// Resource deposits on a tile, shown as specks on the globe.
export enum D {
  None,
  Metal,
  Gold,
  Herbs,
}

export const isWater = (t: T) => t === T.Deep || t === T.Shallow;
const walkable = (t: T) => !isWater(t) && t !== T.Snow;

// Food regrowth per second on each terrain (0..1 food per tile).
const REGROW: Record<T, number> = { [T.Deep]: 0, [T.Shallow]: 0, [T.Sand]: 0.01, [T.Grass]: 0.06, [T.Forest]: 0.04, [T.Desert]: 0.004, [T.Rock]: 0.002, [T.Snow]: 0 };

export interface Person {
  id: number;
  face: number; // tile they are walking to
  from: number; // tile they are walking from
  t: number; // 0..1 along the walk
  hunger: number; // 1 = full, 0 = starved
  age: number; // years (1 second = 1 year)
  village: number | null;
  nation: number; // index into PlanetSim.nations
  goal?: number; // a pioneer walking to this tile to found a new village
}

export interface Village {
  id: number;
  face: number;
  name: string;
  residents: number;
  houses: number;
  nation: number;
  tier: 0 | 1 | 2; // village, town, city
}

// Settlement names: each nation draws from its own sounds, so its places sound alike.
const SOUNDS = [
  { start: ["Kal", "Tor", "Vey", "Mor", "Ash", "Dun", "Ser"], mid: ["a", "e", "o", "i"], end: ["gard", "mar", "veth", "dor", "holm", "rin"] },
  { start: ["Lu", "Mi", "Sa", "Ne", "Ori", "Ae", "Ti"], mid: ["la", "ri", "na", "ve", "si"], end: ["sa", "lia", "nor", "ne", "wyn", "elle"] },
  { start: ["Zar", "Qel", "Xan", "Vor", "Ith", "Ul", "Ny"], mid: ["a", "u", "y", "o"], end: ["ith", "esh", "qar", "zun", "oth", "ax"] },
  { start: ["Bra", "Gro", "Hal", "Fen", "Wyr", "Cal", "Sten"], mid: ["e", "a", "o", ""], end: ["wick", "ford", "stead", "by", "mere", "ton"] },
  { start: ["Ama", "Ixi", "Tla", "Coa", "Yu", "Pa", "Nah"], mid: ["ca", "to", "li", "hu", "ma"], end: ["tlan", "pec", "co", "lan", "tzin", "pa"] },
];
// A random name for a nation until its mind names itself, so no two planets start alike.
const placeholderWord = (i: number) => {
  const s = SOUNDS[(i + Math.floor(Math.random() * SOUNDS.length)) % SOUNDS.length];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return pick(s.start) + pick(s.end);
};
const TIER_NAME = ["village", "town", "city"] as const;
const TIER_AT = [0, 12, 30]; // residents needed to grow into a town, then a city
const TIER_HOUSES = [16, 26, 38];

// A nation: one people with its own AI mind, religion, focus and needs.
// Nations share the planet, so their borders touch and they trade or fight.
export interface Nation {
  id: number; // index into PlanetSim.nations
  name: string; // placeholder until its mind names itself
  color: string;
  policy: Policy;
  faith: number;
  stability: number;
  recentDeaths: number;
  alive: boolean;
  race: RaceId; // see src/sim/races.ts: changes births, war, gathering, faith and tech speed
  tech: number; // progress up the eras towards space (ERA_AT in races.ts)
  leader: Leader; // the ruler the god can talk to
}

// A drifting rain cloud or storm. `pos` is a unit vector; `face` is the tile underneath.
export type Weather = {
  id: number; face: number; pos: [number, number, number]; axis: [number, number, number]; storm: boolean;
  speed: number; age: number; life: number; rainTimer: number; nextStrike: number; flash: { face: number; at: number } | null;
};
const MAX_WEATHER = 8;
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const FATE_TITLES: Record<GodPower, string> = {
  spawn: "Strangers", raise: "The earth rises", lower: "The sea rises", forest: "A new forest", rain: "Rain", drought: "Drought",
  miracle: "A miracle", peace: "Calm", discord: "Unrest", fire: "Wildfire", meteor: "Meteor",
};
const FATE_ICONS: Record<GodPower, string> = {
  spawn: "🧍", raise: "⛰️", lower: "🌊", forest: "🌲", rain: "🌧️", drought: "☀️",
  miracle: "✨", peace: "🕊️", discord: "😈", fire: "🔥", meteor: "☄️",
};
// A tsunami ring spreading from `face`; a meteor falling towards `face`; an erupting volcano at `face`.
export type Wave = { id: number; face: number; at: number; r: number };
// A ship sails from tile to tile across the sea (`from` -> `face`, `t` along the way).
// Warships belong to a nation; merchants carry trade between two nations; pirates (nation -1) belong to no one.
export type Ship = { id: number; kind: "war" | "merchant" | "pirate"; nation: number; dest?: number; port?: number; face: number; from: number; t: number; path: number[]; hp: number; cooldown: number; replan: number };
// ---- The god's own powers (see the "God" section of PlanetSim) ----
export type MiracleId = "bless" | "rain" | "calm" | "smite";
export const MIRACLES: { id: MiracleId; name: string; icon: string; cost: number; cooldown: number; tool: GodPower; blurb: string }[] = [
  { id: "bless", name: "Bless harvest", icon: "✨", cost: 30, cooldown: 20, tool: "miracle", blurb: "Fields bloom where you click. The people there love you more." },
  { id: "rain", name: "Send rain", icon: "🌧️", cost: 20, cooldown: 12, tool: "rain", blurb: "Rain ends droughts and puts out fires." },
  { id: "calm", name: "Calm", icon: "🕊️", cost: 25, cooldown: 20, tool: "peace", blurb: "Clears storms, fire and drought, and soothes angry nations." },
  { id: "smite", name: "Smite", icon: "⚡", cost: 35, cooldown: 25, tool: "meteor", blurb: "Lightning strikes where you click. They will fear you, and love you less." },
];
export type Prayer = { id: number; nation: number; kind: "rain" | "harvest" | "peace" | "sign"; other?: number; text: string; cost: number; at: number };
export type Choice = { id: number; kind: "disaster" | "war" | "revolution"; title: string; text: string; face: number; nations: number[]; cost: number; at: number };
export const GOAL_YEAR = 30; // calendar year the goal is judged at
export const PRAYER_LIFE = 15, CHOICE_LIFE = 15; // seconds before an unanswered prayer or choice lapses
const DISASTER_ICONS = new Set(["🌊", "☄️", "🌋", "⛈️", "🫨", "☀️", "☠️"]);
// A drought's heat haze over `face`, for the globe to draw while it lasts.
export type Drought = { id: number; face: number; at: number; r: number; life: number };
export type Meteor = { id: number; face: number; at: number; radius: number; fall: number; natural: boolean };
// Volcanoes stay on the map. Most of the time they sleep; `active` while erupting, then dormant until `wakeAt`.
export type Volcano = { id: number; face: number; active: boolean; at: number; life: number; nextBurst: number; wakeAt: number };
// The latest thing that happened, for the HUD's pop-up.
export type Alert = { icon: string; title: string; text: string; at: number; face: number };

// The sim runs in fast ticks (one per real second); a calendar year is this many of them.
export const SECONDS_PER_YEAR = 25;
export const MIN_NATIONS = 3;
const NAVY_ERA = 2; // ships from the Iron Age
const MAX_SHIPS = 6; // warships per nation
const MAX_MERCHANTS = 10, MAX_PIRATES = 3;
// How much each resource counts towards the planet's output score.
const VALUE: Resources = { food: 1, wood: 1, stone: 2, metal: 3, gold: 5, herbs: 3 };
const DISASTER_EVERY = 50; // seconds between natural disasters
const MINOR_ALERT_GAP = 30; // seconds a routine pop-up waits after the last one // newcomers arrive whenever fewer than this are left
const MAX_NATIONS = 10; // alive at once (more over time: the fallen make room)
// Nations after the first five get a neon colour from the golden angle, skipping yellows and greens that blend with land.
export function nationColor(i: number) {
  if (i < NATION_COLORS.length) return NATION_COLORS[i];
  let h = (200 + i * 137.508) % 360;
  if (h > 35 && h < 160) h = (h + 140) % 360;
  return `hsl(${Math.round(h)}, 100%, 62%)`;
}

export const NATION_COLORS = ["#ff2bd6", "#00f0ff", "#a24dff", "#ff1f4b", "#3d5aff"]; // neon, so borders pop against the terrain

// Something the narrator might want to talk about.
export interface SimEvent {
  kind: GodPower | Crisis | "village" | "milestone" | "extinct" | "disaster" | "diplomacy" | "captured" | "fallen";
  detail: string;
  nation?: number; // the nation this is mostly about (narrated from its point of view)
  other?: number; // the other nation, for diplomacy and captures
}

// Every planet rolls a type, so planets are rich in different resources and
// players have a reason to trade. `yield` multiplies what villagers gather.
export interface PlanetType {
  name: string;
  blurb: string;
  ocean: number; // share of the surface under water
  moisture: number; // added to the climate noise
  rockLine: number; // elevation where land turns to bare rock
  deposits: number; // how many ore and herb deposits to scatter
  yield: Resources;
  hazard: string; // the natural disaster this world suffers most (see maybeDisaster)
  hazardRoll: number; // the roll in maybeDisaster that triggers it
  weakTo: string; // the planet type whose armies beat this one (for invasions between planets)
  weakWhy: string;
}
export const PLANET_TYPES: PlanetType[] = [
  { name: "Verdant", blurb: "Fertile plains, rich in food and herbs", ocean: 0.56, moisture: 0.08, rockLine: 0.5, deposits: 0.6, yield: { food: 2, wood: 1, stone: 0.6, metal: 0.5, gold: 0.4, herbs: 1.6 }, hazard: "plague", hazardRoll: 0.96, weakTo: "Ironworld", weakWhy: "iron blades cut through farmers" },
  { name: "Timberworld", blurb: "Endless forests, rich in wood", ocean: 0.5, moisture: 0.2, rockLine: 0.5, deposits: 0.6, yield: { food: 1, wood: 2.2, stone: 0.6, metal: 0.5, gold: 0.5, herbs: 1.3 }, hazard: "lightning storm", hazardRoll: 0.4, weakTo: "Verdant", weakWhy: "well-fed armies outlast hungry loggers" },
  { name: "Ironworld", blurb: "Mountain ranges veined with metal", ocean: 0.48, moisture: -0.02, rockLine: 0.28, deposits: 1.8, yield: { food: 0.8, wood: 0.8, stone: 1.6, metal: 2.2, gold: 0.7, herbs: 0.5 }, hazard: "volcano", hazardRoll: 0.27, weakTo: "Gilded", weakWhy: "gold hires their smiths away" },
  { name: "Gilded", blurb: "Dry hills hiding rich gold seams", ocean: 0.45, moisture: -0.16, rockLine: 0.4, deposits: 1.4, yield: { food: 0.7, wood: 0.6, stone: 1.2, metal: 1, gold: 2.4, herbs: 0.4 }, hazard: "drought", hazardRoll: 0.6, weakTo: "Archipelago", weakWhy: "island pirates raid the gold coast" },
  { name: "Archipelago", blurb: "Scattered islands, scarce land, rare medicines", ocean: 0.72, moisture: 0.1, rockLine: 0.45, deposits: 1, yield: { food: 1.6, wood: 1.2, stone: 1, metal: 0.6, gold: 0.8, herbs: 2 }, hazard: "tsunami", hazardRoll: 0.05, weakTo: "Timberworld", weakWhy: "timber fleets blockade the islands" },
];

const MAX_PEOPLE = 1500;
const BIRTHS: Record<Policy, number> = { settle: 1, expand: 1.2, farm: 1.4, worship: 0.9, explore: 1, hoard: 0.6, rebel: 0.8 };
const STEP_TIME = 0.7; // seconds to walk one tile

// Attack bonus between planets: rock-paper-scissors on planet type (weakTo above).
export function invasionBonus(attacker: string, defender: string) {
  const d = PLANET_TYPES.find((t) => t.name === defender);
  const a = PLANET_TYPES.find((t) => t.name === attacker);
  if (d?.weakTo === attacker) return 1.5;
  if (a?.weakTo === defender) return 0.67;
  return 1;
}
const VILLAGE_RANGE = 0.2; // radians: how far people roam from home / how close villages can be

export class PlanetSim {
  readonly n: number; // tile count
  readonly geometry: THREE.BufferGeometry; // non-indexed, 3 vertices per tile
  readonly centroids: Float32Array; // unit vectors, 3 per tile
  readonly neighbours: Int32Array; // 3 per tile
  readonly vertexId: Int32Array; // per geometry vertex: id of the shared corner
  readonly cornerCount: number;

  elevation: Float32Array; // < 0 is sea
  moisture: Float32Array; // 0..1
  forest: Uint8Array; // 1 = trees
  food: Float32Array; // 0..1
  fire: Float32Array; // seconds left burning
  scorch: Float32Array; // seconds left looking burnt
  parched: Float32Array; // seconds left looking sun-baked after a drought
  farm: Uint8Array; // 1 = farmland around a village
  terrain: Uint8Array; // derived, see classify()
  deposit: Uint8Array; // D.None, D.Metal, D.Gold or D.Herbs

  people: Person[] = [];
  villages: Village[] = [];
  burning = new Set<number>();
  events: SimEvent[] = [];
  year = 0;
  version = 0; // bumps whenever the look of the terrain changes
  nations: Nation[] = [];
  // Between every pair of nations: how they stand and how much tension has built up (0-100).
  relation: Relation[][] = [];
  tension: number[][] = [];
  owner: Int16Array; // which nation's land each tile is, -1 = nobody's
  private contact: number[][] = []; // how many border tiles each pair of nations shares
  private borderTimer = 0;
  // Stockpiled resources: the planet's score, and later what it trades with other planets.
  // Production is scaled by stability, so a peaceful planet out-produces a troubled one.
  resources: Resources = { food: 0, wood: 0, stone: 0, metal: 0, gold: 0, herbs: 0 };
  output = 0; // the planet's production per year, in value points (see VALUE): the score
  private produced = 0; // value gathered since the last output sample
  private outputTimer = 0;
  private nextId = 1;
  private milestones = new Set<string>();

  readonly type: PlanetType;

  constructor(readonly seed = Math.floor(Math.random() * 1e6)) {
    this.type = PLANET_TYPES[seed % PLANET_TYPES.length];
    this.geometry = new THREE.IcosahedronGeometry(1, DETAIL);
    const pos = this.geometry.getAttribute("position");
    this.n = pos.count / 3;

    // Tiles share corners; find each corner's id so neighbours and heights line up.
    const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const ids = new Map<string, number>();
    this.vertexId = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = key(i);
      if (!ids.has(k)) ids.set(k, ids.size);
      this.vertexId[i] = ids.get(k)!;
    }
    this.cornerCount = ids.size;

    this.centroids = new Float32Array(this.n * 3);
    const v = new THREE.Vector3();
    for (let f = 0; f < this.n; f++) {
      v.set(0, 0, 0);
      for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
      v.normalize();
      this.centroids.set([v.x, v.y, v.z], f * 3);
    }

    // Two tiles are neighbours if they share an edge.
    this.neighbours = new Int32Array(this.n * 3).fill(-1);
    const edges = new Map<number, number>();
    const M = this.cornerCount;
    for (let f = 0; f < this.n; f++) {
      for (let k = 0; k < 3; k++) {
        const a = this.vertexId[f * 3 + k], b = this.vertexId[f * 3 + ((k + 1) % 3)];
        const e = Math.min(a, b) * M + Math.max(a, b);
        const other = edges.get(e);
        if (other === undefined) edges.set(e, f);
        else {
          this.link(f, other);
          this.link(other, f);
        }
      }
    }

    this.elevation = new Float32Array(this.n);
    this.moisture = new Float32Array(this.n);
    this.forest = new Uint8Array(this.n);
    this.food = new Float32Array(this.n);
    this.fire = new Float32Array(this.n);
    this.scorch = new Float32Array(this.n);
    this.parched = new Float32Array(this.n);
    this.farm = new Uint8Array(this.n);
    this.terrain = new Uint8Array(this.n);
    this.deposit = new Uint8Array(this.n);
    this.owner = new Int16Array(this.n).fill(-1);
    this.generate();
  }

  private link(f: number, other: number) {
    for (let k = 0; k < 3; k++)
      if (this.neighbours[f * 3 + k] === -1) {
        this.neighbours[f * 3 + k] = other;
        return;
      }
  }

  private generate() {
    const raw = new Float32Array(this.n);
    for (let f = 0; f < this.n; f++) {
      const [x, y, z] = this.c(f);
      raw[f] = fbm(x * 1.6 + 10, y * 1.6, z * 1.6, this.seed);
      this.moisture[f] = Math.max(0, Math.min(1, fbm(x * 2.2 - 7, y * 2.2, z * 2.2, this.seed + 999) + this.type.moisture));
    }
    // Put sea level where the planet type's share of the surface is ocean.
    const sorted = Float32Array.from(raw).sort();
    const sea = sorted[Math.floor(this.n * this.type.ocean)];
    const top = sorted[this.n - 1];
    const bottom = sorted[0];
    for (let f = 0; f < this.n; f++) {
      this.elevation[f] = raw[f] >= sea ? (raw[f] - sea) / (top - sea) : -(sea - raw[f]) / (sea - bottom);
      this.forest[f] = this.elevation[f] > 0.05 && this.elevation[f] < this.type.rockLine && this.moisture[f] > 0.55 ? 1 : 0;
      this.classify(f);
      this.food[f] = REGROW[this.terrain[f] as T] > 0.03 ? 0.8 : 0.1;
    }
    // Deposits come in clusters (noise peaks): metal and gold in hills and mountains, herbs in forests.
    for (let f = 0; f < this.n; f++) {
      const [x, y, z] = this.c(f);
      const vein = fbm(x * 6, y * 6, z * 6, this.seed + 4242, 3);
      const t = this.terrain[f] as T;
      const k = this.type.deposits;
      // Only gold shows as deposits; metal is mined from any mountain and herbs gathered in any forest.
      if (t === T.Rock && vein > 0.72 - 0.03 * k) this.deposit[f] = D.Gold;
      else if ((t === T.Grass || t === T.Desert) && this.elevation[f] > 0.25 && vein > 0.7 - 0.03 * k) this.deposit[f] = D.Gold;
    }
    this.seedVolcanoes();
    this.version++;
  }

  // A few dormant volcanoes on the highest, well-separated peaks (more on volcanic planets).
  private seedVolcanoes() {
    const want = 2 + (this.seed % 3) + (this.type.hazard === "volcano" ? 2 : 0);
    const peaks = [...Array(this.n).keys()].filter((f) => this.terrain[f] === T.Rock && this.elevation[f] > 0.3).sort((a, b) => this.elevation[b] - this.elevation[a]);
    for (const f of peaks) {
      if (this.volcanoes.length >= want) break;
      if (this.volcanoes.some((v) => this.angle(v.face, f) < 0.6)) continue;
      this.raiseCone(f);
      this.volcanoes.push({ id: this.nextId++, face: f, active: false, at: 0, life: 0, nextBurst: 0, wakeAt: 150 + tileRand(f, 9) * 450 });
    }
  }

  private raiseCone(top: number) {
    for (const [f, w] of this.tilesNear(top, 0.07)) {
      this.elevation[f] = Math.min(0.66, Math.max(this.elevation[f], 0.3 + 0.32 * w * w) + 0.03 * w); // stays below the snow line
      this.forest[f] = 0;
      this.classify(f);
    }
  }

  c(f: number): [number, number, number] {
    return [this.centroids[f * 3], this.centroids[f * 3 + 1], this.centroids[f * 3 + 2]];
  }
  dot(a: number, b: number) {
    return this.centroids[a * 3] * this.centroids[b * 3] + this.centroids[a * 3 + 1] * this.centroids[b * 3 + 1] + this.centroids[a * 3 + 2] * this.centroids[b * 3 + 2];
  }
  angle(a: number, b: number) {
    return Math.acos(Math.min(1, this.dot(a, b)));
  }

  private classify(f: number) {
    const e = this.elevation[f];
    const lat = Math.abs(this.centroids[f * 3 + 1]);
    let t: T;
    if (e < -0.25) t = T.Deep;
    else if (e < 0) t = T.Shallow;
    else if (e > 0.7 || (lat > 0.9 && e > 0.02)) t = T.Snow;
    else if (e > this.type.rockLine) t = T.Rock;
    else if (e < 0.04) t = T.Sand;
    else if (this.moisture[f] < 0.32) t = T.Desert;
    else if (this.forest[f]) t = T.Forest;
    else t = T.Grass;
    this.terrain[f] = t;
  }

  // Tiles within `radius` radians of `centre`, with a 0..1 falloff (1 at the centre).
  tilesNear(centre: number, radius: number): [number, number][] {
    const out: [number, number][] = [];
    const cos = Math.cos(radius);
    for (let f = 0; f < this.n; f++) {
      const d = this.dot(centre, f);
      if (d >= cos) out.push([f, 1 - Math.acos(Math.min(1, d)) / radius]);
    }
    return out;
  }

  // ---- God powers ----

  apply(power: GodPower, centre: number, radius: number) {
    const area = this.tilesNear(centre, radius);
    // Nations whose land or people are in the area feel the god's hand most.
    const touched = this.nationsIn(area.map(([f]) => f));
    const bless = (faith: number) => {
      for (const nt of this.nations) if (nt.alive) nt.faith = Math.min(100, nt.faith + (touched.has(nt.id) ? faith : faith * 0.2));
    };
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    switch (power) {
      case "raise":
      case "lower": {
        const s = power === "raise" ? 0.05 : -0.05;
        for (const [f, w] of area) this.elevation[f] = clamp(this.elevation[f] + s * (0.4 + w));
        break;
      }
      case "forest":
        for (const [f] of area) if (this.terrain[f] === T.Grass || this.terrain[f] === T.Sand) {
          this.forest[f] = 1;
          this.moisture[f] = Math.max(this.moisture[f], 0.5);
        }
        break;
      case "rain":
        for (const [f, w] of area) {
          this.moisture[f] = Math.min(1, this.moisture[f] + 0.08 * (0.5 + w));
          this.food[f] = Math.min(1, this.food[f] + 0.1);
        }
        bless(0.3);
        break;
      case "drought":
        this.parch(centre, radius);
        for (const [f, w] of area) {
          this.moisture[f] = Math.max(0, this.moisture[f] - 0.08 * (0.5 + w));
          this.food[f] *= 0.6;
          if (this.moisture[f] < 0.3 && Math.random() < 0.3) this.forest[f] = 0;
        }
        bless(0.4);
        break;
      case "fire":
        for (const [f] of area) this.ignite(f);
        bless(0.5);
        break;
      case "miracle":
        for (const [f] of area) {
          this.food[f] = 1;
          this.moisture[f] = Math.max(this.moisture[f], 0.55);
          this.fire[f] = 0;
        }
        for (const p of this.people) if (area.some(([f]) => f === p.face)) p.hunger = 1;
        this.burning.forEach((f) => this.fire[f] === 0 && this.burning.delete(f));
        bless(12);
        break;
      case "meteor": {
        const crater = this.tilesNear(centre, radius * 1.6);
        for (const [f, w] of crater) {
          // A bowl in the middle and a raised rim.
          this.elevation[f] = clamp(this.elevation[f] + (w > 0.45 ? -0.5 * w : 0.15));
          this.forest[f] = 0;
          if (w < 0.6) this.ignite(f);
          else this.scorch[f] = 25;
        }
        const r = radius * 1.6;
        const killed = this.killWhere((p) => this.angle(p.face, centre) < r);
        this.villages = this.villages.filter((v) => this.angle(v.face, centre) >= r);
        bless(10);
        for (const id of touched) this.nations[id].stability -= 15;
        this.events.push({ kind: "meteor", detail: `A meteor struck the planet, killing ${killed} people.`, nation: [...touched][0] });
        break;
      }
      case "spawn":
        for (let i = 0; i < 6; i++) this.spawnNear(centre);
        bless(1);
        break;
      // Calm or inflame every nation in the area towards all the others.
      case "peace":
      case "discord": {
        const d = power === "peace" ? -4 : 4;
        for (const a of touched) for (const nt of this.nations) if (nt.id !== a) this.sway(a, nt.id, d);
        bless(power === "peace" ? 0.4 : 0.2);
        break;
      }
    }
    for (const [f] of area) this.classify(f);
    if (power === "meteor") this.tilesNear(centre, radius * 1.6).forEach(([f]) => this.classify(f));
    // Anyone now standing in water drowns.
    const drowned = this.killWhere((p) => isWater(this.terrain[p.face] as T));
    if (drowned > 3) this.events.push({ kind: "lower", detail: `The sea rose and ${drowned} people drowned.` });
    this.villages = this.villages.filter((v) => !isWater(this.terrain[v.face] as T));
    this.version++;
  }

  // Which nations own land, or have people, among these tiles.
  private nationsIn(tiles: number[]): Set<number> {
    const set = new Set<number>(tiles.map((f) => this.owner[f]).filter((o) => o >= 0));
    if (!set.size) {
      const inArea = new Set(tiles);
      for (const p of this.people) if (inArea.has(p.face)) set.add(p.nation);
    }
    return set;
  }

  // Change the tension between two nations (the god's powers, or a mind's wishes).
  sway(a: number, b: number, delta: number) {
    if (a === b || !this.tension[a]) return;
    const t = Math.max(0, Math.min(100, this.tension[a][b] + delta));
    this.tension[a][b] = this.tension[b][a] = t;
  }

  // ---- Nations ----

  // Start 3-5 nations, each with a small band of people as far apart as the land allows.
  seedNations(count = MIN_NATIONS + Math.floor(Math.random() * 3), peoplePerNation = 10, firstRace?: RaceId) {
    const starts = [this.bestStart()];
    const candidates: number[] = [];
    for (let f = 0; f < this.n; f += 3) if (this.terrain[f] === T.Grass || this.terrain[f] === T.Forest) candidates.push(f);
    while (starts.length < count && candidates.length) {
      let best = candidates[0], far = -1;
      for (const f of candidates) {
        const d = Math.min(...starts.map((s) => this.angle(s, f))) + this.moisture[f] * 0.1;
        if (d > far) {
          far = d;
          best = f;
        }
      }
      starts.push(best);
    }
    // The god's chosen race goes first; the others are drawn so races don't repeat until all are used.
    const pool = RACES.map((r) => r.id).filter((r) => r !== firstRace).sort(() => Math.random() - 0.5);
    const races = starts.map((_, i) => (i === 0 && firstRace ? firstRace : pool[(i - (firstRace ? 1 : 0)) % pool.length]));
    this.nations = starts.map((_, i) => ({
      id: i, name: `the ${placeholderWord(i)} ${RACE[races[i]].plural}`, color: NATION_COLORS[i], policy: "settle" as Policy, faith: 100, stability: 70, recentDeaths: 0, alive: true,
      race: races[i], tech: 0, leader: makeLeader(RACE[races[i]]),
    }));
    const k = this.nations.length;
    this.relation = Array.from({ length: k }, () => new Array<Relation>(k).fill("peace"));
    this.tension = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) this.tension[a][b] = this.tension[b][a] = 30 + Math.random() * 20;
    this.contact = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    starts.forEach((f, i) => {
      for (let j = 0; j < peoplePerNation; j++) this.spawnNear(f, i);
    });
  }

  race(id: number) {
    return RACE[this.nations[id]?.race ?? "human"];
  }
  // Races thrive on their home world: more children and better gathering.
  private homeBonus(id: number) {
    return this.race(id).home === this.type.name ? 1.2 : 1;
  }

  nationName(id: number) {
    return this.nations[id]?.name ?? "a lost people";
  }

  private tradePartners(id: number) {
    return this.relation[id]?.filter((r) => r === "trade").length ?? 0;
  }
  atWar(a: number, b: number) {
    return a !== b && this.relation[a]?.[b] === "war";
  }

  private ignite(f: number) {
    if (isWater(this.terrain[f] as T) || this.terrain[f] === T.Snow) return;
    this.fire[f] = 2 + Math.random() * 2;
    this.burning.add(f);
  }

  spawnNear(face: number, nation?: number) {
    if (this.people.length >= MAX_PEOPLE || !this.nations.length) return;
    // Walk outwards until we find dry land.
    let f = face;
    for (let i = 0; i < 20 && !walkable(this.terrain[f] as T); i++) f = this.neighbours[f * 3 + Math.floor(Math.random() * 3)];
    if (!walkable(this.terrain[f] as T)) return;
    // People the god creates join whoever owns the land, or the nearest nation.
    const nat = nation ?? (this.owner[f] >= 0 ? this.owner[f] : this.nearestNation(f));
    this.people.push({ id: this.nextId++, face: f, from: f, t: Math.random(), hunger: 0.8, age: 16 + Math.random() * 10, village: null, nation: nat });
  }

  // Where a nation is: its biggest village, or else where its people are.
  nationHome(id: number): number | null {
    const v = this.villages.filter((x) => x.nation === id).sort((a, b) => b.houses - a.houses)[0];
    return v?.face ?? this.people.find((p) => p.nation === id)?.face ?? null;
  }

  nearestNation(f: number) {
    let best = this.nations.find((n) => n.alive)?.id ?? 0, d = Infinity;
    for (const p of this.people) {
      const a = this.angle(p.face, f);
      if (a < d) {
        d = a;
        best = p.nation;
      }
    }
    return best;
  }

  private killWhere(test: (p: Person) => boolean) {
    const before = this.people.length;
    this.people = this.people.filter((p) => {
      if (!test(p)) return true;
      this.nations[p.nation].recentDeaths++;
      return false;
    });
    return before - this.people.length;
  }

  // ---- Time ----

  step(dt: number) {
    this.year += dt;
    this.outputTimer += dt;
    if (this.outputTimer >= 2) {
      // Smoothed value gathered per year.
      this.output = this.output * 0.6 + (this.produced / this.outputTimer) * 0.4;
      this.produced = 0;
      this.outputTimer = 0;
    }
    this.stepFire(dt);
    this.stepFood(dt);
    this.stepPeople(dt);
    this.stepVillages(dt);
    this.stepNations(dt);
    this.stepNationLife(dt);
    this.stepNavy(dt);
    this.stepGod(dt);
    this.stepNeeds(dt);
    this.stepWeather(dt);
    this.stepCatastrophes(dt);
    this.maybeDisaster(dt);
    this.maybeFate(dt);
    this.checkMilestones();
  }

  private stepFire(dt: number) {
    if (!this.burning.size) return;
    for (const f of [...this.burning]) {
      this.fire[f] -= dt;
      // Fire spreads through trees and, more slowly, grass.
      for (let k = 0; k < 3; k++) {
        const nb = this.neighbours[f * 3 + k];
        if (this.fire[nb] > 0) continue;
        const t = this.terrain[nb] as T;
        const chance = t === T.Forest ? 0.35 : t === T.Grass ? 0.06 : 0;
        if (Math.random() < chance * dt) this.ignite(nb);
      }
      if (this.fire[f] <= 0) {
        this.fire[f] = 0;
        this.forest[f] = 0;
        this.food[f] = 0;
        this.scorch[f] = 20;
        this.burning.delete(f);
        this.classify(f);
      }
    }
    const burnt = this.killWhere((p) => this.fire[p.face] > 0);
    const lost = this.villages.filter((v) => this.fire[v.face] > 0);
    if (lost.length) {
      this.villages = this.villages.filter((v) => this.fire[v.face] <= 0);
      this.events.push({ kind: "fire", detail: `Fire destroyed ${lost.map((v) => v.name).join(", ")}${burnt ? ` and killed ${burnt} people` : ""}.`, nation: lost[0].nation });
    }
    this.version++;
  }

  private stepFood(dt: number) {
    // Droughts fade: the baked look eases off a little at a time (redrawn every couple of seconds).
    this.droughts = this.droughts.filter((d) => this.year - d.at < d.life);
    let fading = false;
    for (let f = 0; f < this.n; f++) if (this.parched[f] > 0) {
      this.parched[f] = Math.max(0, this.parched[f] - dt);
      fading = true;
    }
    if (fading && Math.floor(this.year / 2) !== Math.floor((this.year - dt) / 2)) this.version++;
    for (let f = 0; f < this.n; f++) {
      if (this.scorch[f] > 0) {
        this.scorch[f] = Math.max(0, this.scorch[f] - dt);
        if (this.scorch[f] === 0) this.version++;
        continue;
      }
      const grow = REGROW[this.terrain[f] as T] * (0.4 + this.moisture[f]) * (this.farm[f] ? 2.5 : 1);
      this.food[f] = Math.min(1, this.food[f] + grow * dt);
    }
  }

  private stepPeople(dt: number) {
    const born: Person[] = [];
    const villageById = new Map(this.villages.map((v) => [v.id, v]));
    // Who is standing where, so soldiers at war can find each other.
    const at = new Map<number, Person[]>();
    for (const p of this.people) {
      const list = at.get(p.face);
      if (list) list.push(p);
      else at.set(p.face, [p]);
    }
    const target = this.warTargets();
    for (const p of this.people) {
      const nt = this.nations[p.nation];
      const pol = nt.policy;
      const race = RACE[nt.race];
      p.age += dt;
      p.hunger -= (pol === "hoard" ? 0.035 : 0.05) * race.appetite * dt;
      p.t += (dt / STEP_TIME) * race.speed;
      if (p.village !== null && villageById.get(p.village)?.nation !== p.nation) p.village = null;
      if (p.t < 1 || p.hunger <= 0) continue;

      // Arrived: eat, then pick the next tile.
      p.t = 0;
      const home = p.village !== null ? villageById.get(p.village) : undefined;

      const eat = Math.min(this.food[p.face], 0.3);
      this.food[p.face] -= eat;
      p.hunger = Math.min(1, p.hunger + eat * 1.6);
      // Villagers gather for the stockpile: surplus food, wood from forests, stone from mountains.
      // A stable nation works harder, and every trading partner adds a quarter more.
      if (home) {
        const peace = (0.5 + nt.stability / 100) * (1 + 0.25 * this.tradePartners(p.nation));
        const ry = (r: keyof Resources) => (race.yield[r] ?? 1) * this.homeBonus(p.nation); // what this race is good at
        const t = this.terrain[p.face] as T;
        if (p.hunger > 0.9 && this.food[p.face] > 0.2) {
          this.food[p.face] -= 0.1;
          this.gain("food", 0.1 * peace * this.type.yield.food * ry("food"));
        }
        const y = this.type.yield;
        if (t === T.Forest) {
          this.gain("wood", 0.03 * peace * y.wood * ry("wood"));
          // Logging: woodcutters slowly clear the forest near home, felling the tile for a big haul.
          if (this.angle(p.face, home.face) < 0.09 && Math.random() < 0.06) {
            this.forest[p.face] = 0;
            this.classify(p.face);
            this.gain("wood", 0.6 * y.wood * ry("wood"));
            this.version++;
          }
        }
        if (t === T.Rock) {
          this.gain("stone", 0.05 * peace * y.stone * ry("stone"));
          this.gain("metal", 0.02 * peace * y.metal * ry("metal")); // ore from the mountainside
        }
        if (t === T.Forest) this.gain("herbs", 0.006 * peace * y.herbs * ry("herbs")); // medicinal plants from the woods
        if (this.deposit[p.face] === D.Gold) this.gain("gold", 0.03 * peace * y.gold * ry("gold"));
      }

      // War: fight any enemy on this tile or the next one. Either side may fall.
      if (p.age > 16) {
        for (let k = -1; k < 3; k++) {
          const f = k < 0 ? p.face : this.neighbours[p.face * 3 + k];
          const foe = at.get(f)?.find((q) => q.hunger > 0 && this.atWar(p.nation, q.nation));
          if (foe && Math.random() < 0.35) {
            // The more stable nation fights a little better.
            // Race matters most: goblins and dwarves win more fights than elves.
            const foeRace = RACE[this.nations[foe.nation].race];
            const odds = 0.5 + (nt.stability - this.nations[foe.nation].stability) / 400 + (race.fight - foeRace.fight) * 0.2;
            const pWins = Math.random() < Math.max(0.1, Math.min(0.9, odds));
            const dead = pWins ? foe : p;
            dead.hunger = -1; // removed below
            this.nations[dead.nation].recentDeaths += 1;
            break;
          }
        }
        if (p.hunger <= 0) continue;
      }

      // Soldiers march on the enemy; everyone else heads home or wanders towards food.
      // Pioneers who reached their goal found a village there (if the land is still free).
      if (p.goal !== undefined && (this.angle(p.face, p.goal) < 0.03 || Math.random() < 0.004)) {
        const free = this.owner[p.face] < 0 || this.owner[p.face] === p.nation;
        const own = this.villages.find((v) => v.nation === p.nation && this.angle(v.face, p.face) < VILLAGE_RANGE * 0.5);
        if (own) p.village = own.id;
        else if (free && this.joinsUp(p.face, p.nation) && (this.terrain[p.face] === T.Grass || this.terrain[p.face] === T.Forest || this.terrain[p.face] === T.Sand)) p.village = this.foundVillage(p.face, p.nation).id;
        p.goal = undefined;
      }
      const march = target[p.nation];
      const marching = march !== undefined && p.age > 16 && p.age < 50 && p.hunger > 0.4 && (p.id % 5 < 2);
      let next = p.face;
      let best = -Infinity;
      for (let k = 0; k < 3; k++) {
        const nb = this.neighbours[p.face * 3 + k];
        if (!walkable(this.terrain[nb] as T) || this.fire[nb] > 0) continue;
        const roam = pol === "explore" ? 2 : 0.6;
        const score = p.goal !== undefined
          ? this.dot(nb, p.goal) * 10 + Math.random() * 0.2
          : marching
          ? this.dot(nb, march) * 10 + Math.random() * 0.2
          : home && this.angle(p.face, home.face) > VILLAGE_RANGE * roam
            ? this.dot(nb, home.face) * 10
            : this.food[nb] + Math.random() * 0.6;
        if (score > best) {
          best = score;
          next = nb;
        }
      }
      p.from = p.face;
      p.face = next;

      // Children: well-fed adults, a little more often in a village.
      if (p.hunger > 0.55 && p.age > 16 && p.age < 45 && Math.random() < (home ? 0.09 : 0.05) * STEP_TIME * BIRTHS[pol] * race.births * this.homeBonus(p.nation) && this.people.length + born.length < MAX_PEOPLE) {
        born.push({ id: this.nextId++, face: p.face, from: p.face, t: 0, hunger: 0.6, age: 0, village: p.village, nation: p.nation });
        p.hunger -= 0.2;
      }

      // Settle: join a nearby village of their own nation, or found one on good land
      // that no other nation has claimed.
      if (!home && p.age > 14 && p.goal === undefined) {
        const range = pol === "expand" ? VILLAGE_RANGE * 0.6 : VILLAGE_RANGE;
        const near = this.villages.find((v) => v.nation === p.nation && this.angle(v.face, p.face) < range);
        const claimed = this.owner[p.face] >= 0 && this.owner[p.face] !== p.nation;
        if (near) p.village = near.id;
        else if (!claimed && this.joinsUp(p.face, p.nation) && (this.terrain[p.face] === T.Grass || this.terrain[p.face] === T.Forest) && Math.random() < (pol === "expand" ? 0.15 : 0.04)) {
          const v = this.foundVillage(p.face, p.nation);
          p.village = v.id;
        }
      }
    }
    this.people = this.people.filter((p) => {
      if (p.hunger > 0 && p.age < 55 + this.race(p.nation).lifespan + (p.id % 25) + Math.min(20, this.resources.herbs / 20)) return true;
      if (p.hunger > -1) this.nations[p.nation].recentDeaths++; // war deaths were counted already
      return false;
    });
    this.people.push(...born);
  }

  // Crowded villages send a few young adults off to found a new one on free land nearby.
  // This is how nations spread, meet each other's borders, and start to trade or fight.
  private sendPioneers(dt: number) {
    for (const v of this.villages) {
      const pol = this.nations[v.nation].policy;
      if (v.residents < (pol === "expand" ? 10 : 18) || Math.random() > (pol === "expand" ? 0.12 : pol === "hoard" || pol === "settle" ? 0.02 : 0.05) * dt) continue;
      let goal = -1, best = -Infinity;
      for (const [f, w] of this.tilesNear(v.face, VILLAGE_RANGE * 2)) {
        if (w > 0.45 || this.owner[f] >= 0 || (this.terrain[f] !== T.Grass && this.terrain[f] !== T.Forest)) continue;
        // Only right on the edge of their own land, so a nation is always one joined-up area.
        let frontier = false;
        for (let k = 0; k < 3; k++) if (this.owner[this.neighbours[f * 3 + k]] === v.nation) frontier = true;
        if (!frontier) continue;
        const score = this.food[f] + this.moisture[f] + Math.random() * 0.5;
        if (score > best) {
          best = score;
          goal = f;
        }
      }
      if (goal < 0) continue;
      const band = this.people.filter((p) => p.village === v.id && p.age > 16 && p.age < 35 && p.goal === undefined).slice(0, 4);
      for (const p of band) {
        p.village = null;
        p.goal = goal;
      }
    }
  }

  // For each nation at war: the enemy village nearest its own land, to march on.
  private warTargets(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const nt of this.nations) {
      const mine = this.villages.filter((v) => v.nation === nt.id);
      if (!mine.length) continue;
      let best = Infinity;
      for (const v of this.villages) {
        if (!this.atWar(nt.id, v.nation)) continue;
        const d = Math.min(...mine.map((m) => this.angle(m.face, v.face)));
        if (d < best) {
          best = d;
          out[nt.id] = v.face;
        }
      }
    }
    return out;
  }

  private foundVillage(face: number, nation: number): Village {
    const count = this.villages.filter((v) => v.nation === nation).length + 1;
    const v: Village = { id: this.nextId++, face, name: this.placeName(nation), residents: 1, houses: 1, nation, tier: 0 };
    this.villages.push(v);
    this.events.push({ kind: "village", detail: `${this.nationName(nation)} founded the village of ${v.name} (${count} settlements now).`, nation });
    return v;
  }

  private usedNames = new Set<string>();
  private placeName(nation: number) {
    const sounds = SOUNDS[nation % SOUNDS.length];
    const pick = (a: readonly string[]) => a[Math.floor(Math.random() * a.length)];
    for (let i = 0; i < 30; i++) {
      const name = pick(sounds.start) + (Math.random() < 0.5 ? pick(sounds.mid) : "") + pick(sounds.end);
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    return pick(sounds.start) + pick(sounds.end) + " " + (this.usedNames.size + 1);
  }

  // A nation's capital: its biggest settlement.
  capital(nation: number) {
    let best: Village | null = null;
    for (const v of this.villages) if (v.nation === nation && (!best || v.residents > best.residents)) best = v;
    return best;
  }

  // Villages grow into towns and towns into cities as people move in (and never shrink back a tier).
  private growSettlement(v: Village) {
    const next = v.tier + 1;
    if (next > 2 || v.residents < TIER_AT[next]) return;
    v.tier = next as 1 | 2;
    const where = this.nationName(v.nation);
    this.events.push({ kind: "milestone", detail: `${v.name} in ${where} has grown into a ${TIER_NAME[next]}.`, nation: v.nation });
    this.announce(next === 2 ? "🏙️" : "🏘️", next === 2 ? "A new city!" : "A new town", `${v.name} in ${where} has grown into a ${TIER_NAME[next]}.`, v.face, true);
  }

  private stepVillages(dt: number) {
    const counts = new Map<number, number>();
    for (const p of this.people) if (p.village !== null) counts.set(p.village, (counts.get(p.village) ?? 0) + 1);
    let farmsChanged = false;
    const farm = new Uint8Array(this.n);
    this.villages = this.villages.filter((v) => {
      v.residents = counts.get(v.id) ?? 0;
      if (v.residents === 0 && v.houses <= 1) return false; // abandoned
      this.growSettlement(v);
      const target = Math.min(TIER_HOUSES[v.tier], Math.ceil(v.residents / 3));
      if (v.houses < target && Math.random() < 0.05) v.houses++;
      else if (v.houses > target && Math.random() < 0.01) v.houses--;
      // Farmland grows with the village: the home tile and rings around it.
      let ring = [v.face];
      const rings = Math.min(3, Math.floor(v.houses / 3)) + (this.nations[v.nation].policy === "farm" ? 1 : 0);
      for (let r = 0; r <= rings; r++) {
        const nextRing: number[] = [];
        for (const f of ring) {
          if (!isWater(this.terrain[f] as T) && this.terrain[f] !== T.Rock && this.terrain[f] !== T.Snow) {
            farm[f] = 1;
            // Villages clear the trees off their fields to plant crops.
            if (this.forest[f] && Math.random() < 0.02) {
              this.forest[f] = 0;
              this.classify(f);
              this.version++;
            }
          }
          for (let k = 0; k < 3; k++) nextRing.push(this.neighbours[f * 3 + k]);
        }
        ring = nextRing;
      }
      return true;
    });
    this.sendPioneers(dt);
    for (let f = 0; f < this.n && !farmsChanged; f++) if (farm[f] !== this.farm[f]) farmsChanged = true;
    if (farmsChanged) {
      this.farm = farm;
      this.version++;
    }
    this.borderTimer -= dt;
    if (this.borderTimer <= 0) {
      this.borderTimer = 0.5;
      this.updateBorders();
      this.captureVillages();
    }
  }

  // Each village claims the land around it (more as it grows). Where claims meet,
  // the nearer village wins: a breadth-first flood from every village at once.
  private updateBorders() {
    const owner = new Int16Array(this.n).fill(-1);
    const depth = new Int16Array(this.n);
    const reach = new Int16Array(this.n);
    const queue: number[] = [];
    for (const v of this.villages) {
      if (owner[v.face] >= 0) continue;
      owner[v.face] = v.nation;
      reach[v.face] = 3 + Math.min(5, Math.floor(v.houses / 2));
      queue.push(v.face);
    }
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      if (depth[f] >= reach[f]) continue;
      for (let k = 0; k < 3; k++) {
        const nb = this.neighbours[f * 3 + k];
        if (owner[nb] >= 0 || isWater(this.terrain[nb] as T)) continue;
        owner[nb] = owner[f];
        depth[nb] = depth[f] + 1;
        reach[nb] = reach[f];
        queue.push(nb);
      }
    }
    // Count shared border between each pair of nations.
    for (const row of this.contact) row.fill(0);
    let changed = false;
    for (let f = 0; f < this.n; f++) {
      if (owner[f] !== this.owner[f]) changed = true;
      const a = owner[f];
      if (a < 0) continue;
      for (let k = 0; k < 3; k++) {
        const b = owner[this.neighbours[f * 3 + k]];
        if (b >= 0 && b !== a) this.contact[a][b]++;
      }
    }
    if (changed) {
      this.owner = owner;
      this.version++;
    }
  }

  // At war, a village falls when the enemy around it clearly outnumbers its defenders.
  private captureVillages() {
    for (const v of this.villages) {
      const near = this.people.filter((p) => p.age > 16 && this.angle(p.face, v.face) < 0.05);
      const defenders = near.filter((p) => p.nation === v.nation).length;
      const attackers = new Map<number, number>();
      for (const p of near) if (this.atWar(p.nation, v.nation)) attackers.set(p.nation, (attackers.get(p.nation) ?? 0) + 1);
      for (const [n, count] of attackers) {
        if (count > defenders * 1.5 + 1) {
          const from = v.nation;
          v.nation = n;
          this.nations[from].stability -= 10;
          this.events.push({ kind: "captured", detail: `${this.nationName(n)} captured ${v.name} from ${this.nationName(from)}.`, nation: from, other: n });
          this.conqueror.set(from, n);
          break;
        }
      }
    }
  }

  // The year shown to players and the minds (the sim's own clock runs much faster).
  get calendar() {
    return this.year / SECONDS_PER_YEAR;
  }

  // ---- God: devotion (the god's currency), each nation's love, miracles, prayers, choices and the goal ----

  devotion = 40;
  love: number[] = []; // 0..100 per nation; 50 = indifferent
  ready: Record<MiracleId, number> = { bless: 0, rain: 0, calm: 0, smite: 0 }; // year each miracle can be cast again
  prayers: Prayer[] = [];
  choice: Choice | null = null;
  outcome: { won: boolean; title: string; text: string } | null = null;
  spacefaring = false; // your nation has reached the Space Age, which unlocks the galaxy (multiplayer)
  private nextPrayer = 25;

  loveOf(id: number) {
    return this.love[id] ?? 50;
  }
  private adore(id: number, delta: number) {
    this.love[id] = Math.max(0, Math.min(100, this.loveOf(id) + delta));
  }
  private aware(nt: Nation) {
    return nt.alive && this.villages.some((v) => v.nation === nt.id);
  }

  private stepGod(dt: number) {
    for (const nt of this.nations) {
      if (!this.aware(nt)) continue;
      // Worship pays: more from a nation that loves you or is busy worshipping.
      this.devotion += dt * (0.07 + (nt.policy === "worship" ? 0.15 : 0)) * (0.3 + this.loveOf(nt.id) / 50);
      // Love slowly fades back towards indifference, and a nation that hates you grows restless.
      this.adore(nt.id, (50 - this.loveOf(nt.id)) * 0.004 * dt);
      if (this.loveOf(nt.id) < 15) nt.stability -= 0.3 * dt;
    }
    // Prayers: now and then a nation asks for something it needs.
    this.nextPrayer -= dt;
    if (this.nextPrayer <= 0) {
      this.nextPrayer = 30 + Math.random() * 20;
      const askers = this.nations.filter((nt) => this.aware(nt) && !this.prayers.some((p) => p.nation === nt.id));
      const nt = askers[Math.floor(Math.random() * askers.length)];
      if (nt) this.prayers.push(this.makePrayer(nt));
    }
    for (const p of this.prayers) if (this.year - p.at > PRAYER_LIFE) {
      this.adore(p.nation, -8);
      this.events.push({ kind: "drought", detail: `${cap(this.nationName(p.nation))} prayed to their god and heard nothing. They feel abandoned.`, nation: p.nation });
    }
    this.prayers = this.prayers.filter((p) => this.year - p.at <= PRAYER_LIFE && this.nations[p.nation]?.alive);
    if (this.choice && this.year - this.choice.at > CHOICE_LIFE) this.decide(false);
    this.checkGoal();
  }

  private makePrayer(nt: Nation): Prayer {
    const name = cap(this.nationName(nt.id));
    const foe = this.nations.find((o) => o.alive && o.id !== nt.id && (this.relation[nt.id][o.id] === "war" || this.relation[nt.id][o.id] === "rival"));
    const base = { id: this.nextId++, nation: nt.id, at: this.year };
    if (foe) return { ...base, kind: "peace", other: foe.id, cost: 25, text: `${name} pray for peace with ${this.nationName(foe.id)}.` };
    if (this.nationFood(nt.id) < 55) return Math.random() < 0.5 ? { ...base, kind: "rain", cost: 15, text: `${name} pray for rain on their fields.` } : { ...base, kind: "harvest", cost: 20, text: `${name} pray for a good harvest.` };
    return { ...base, kind: "sign", cost: 10, text: `${name} pray for a sign that you are watching.` };
  }

  answerPrayer(id: number, yes: boolean) {
    const p = this.prayers.find((x) => x.id === id);
    if (!p) return false;
    if (yes && this.devotion < p.cost) return false;
    this.prayers = this.prayers.filter((x) => x !== p);
    const name = this.nationName(p.nation);
    if (!yes) {
      this.adore(p.nation, -6);
      this.events.push({ kind: "discord", detail: `Their god refused the prayer of ${name}.`, nation: p.nation });
      return true;
    }
    this.devotion -= p.cost;
    const home = this.capital(p.nation)?.face ?? this.villages.find((v) => v.nation === p.nation)?.face ?? 0;
    if (p.kind === "rain") this.rainMiracle(home, 0.14);
    if (p.kind === "harvest") for (let i = 0; i < 3; i++) this.apply("miracle", home, 0.12);
    if (p.kind === "peace" && p.other != null) this.makePeace(p.nation, p.other);
    if (p.kind === "sign") this.nations[p.nation].stability += 8;
    this.adore(p.nation, 12);
    this.announce("🙏", "Prayer answered", `You answered ${name}. ${p.kind === "peace" ? "The fighting stops." : p.kind === "sign" ? "They saw your sign and rejoice." : p.kind === "rain" ? "Rain falls on their fields." : "Their fields overflow."}`, home, true);
    this.events.push({ kind: "miracle", detail: `Their god answered their prayer: ${p.text}`, nation: p.nation });
    return true;
  }

  // Cast a miracle where the god clicked. Returns false if it isn't ready or affordable.
  cast(id: MiracleId, face: number) {
    const m = MIRACLES.find((x) => x.id === id)!;
    if (this.devotion < m.cost || this.year < this.ready[id] || this.outcome) return false;
    this.devotion -= m.cost;
    this.ready[id] = this.year + m.cooldown;
    const touched = [...this.nationsIn(this.tilesNear(face, 0.15).map(([f]) => f))];
    const where = this.where(face);
    if (id === "bless") {
      for (let i = 0; i < 3; i++) this.apply("miracle", face, 0.12);
      for (const n of touched) {
        this.adore(n, 10);
        this.nations[n].stability += 5;
      }
    } else if (id === "rain") {
      this.rainMiracle(face, 0.15);
      for (const n of touched) this.adore(n, 5);
    } else if (id === "calm") {
      this.calmAt(face, 0.3);
      for (const n of touched) {
        this.adore(n, 5);
        this.nations[n].stability += 10;
        for (const o of this.nations) if (o.alive && o.id !== n) this.sway(n, o.id, -10);
      }
    } else {
      // Smite: lightning, fire and fear.
      for (const [f, w] of this.tilesNear(face, 0.04)) if (Math.random() < 0.7 * w + 0.2) this.ignite(f);
      const killed = this.killWhere((p) => this.angle(p.face, face) < 0.035);
      this.addWeather(face, true);
      const w = this.weather[this.weather.length - 1];
      if (w) w.flash = { face, at: this.year };
      for (const n of touched) {
        this.adore(n, -18);
        this.nations[n].stability -= 8;
        this.nations[n].policy = "worship"; // fear makes them pray harder
      }
      this.events.push({ kind: "fire", detail: `Their god struck the land near ${where} with lightning${killed ? `, killing ${killed}` : ""}. They are terrified.`, nation: touched[0] });
    }
    if (id !== "smite") this.events.push({ kind: m.tool === "peace" ? "peace" : m.tool, detail: `Their god worked a miracle near ${where}: ${m.name.toLowerCase()}. The people saw it.`, nation: touched[0] });
    this.announce(m.icon, m.name, `${m.name} near ${where}.`, face);
    this.version++;
    return true;
  }

  private rainMiracle(face: number, r: number) {
    for (let i = 0; i < 3; i++) this.apply("rain", face, r);
    this.addWeather(face, false);
    for (const [f] of this.tilesNear(face, r)) {
      this.parched[f] = 0;
      if (this.fire[f] > 0) this.fire[f] = 0;
    }
  }

  private calmAt(face: number, r: number) {
    this.weather = this.weather.filter((w) => !w.storm || this.angle(this.nearestTile(w.pos), face) > r);
    for (const [f] of this.tilesNear(face, r)) {
      this.parched[f] = 0;
      if (this.fire[f] > 0) this.fire[f] = 0;
    }
    this.version++;
  }

  private nearestTile(pos: [number, number, number]) {
    let best = 0, bd = -2;
    for (let f = 0; f < this.n; f += 7) {
      const d = this.centroids[f * 3] * pos[0] + this.centroids[f * 3 + 1] * pos[1] + this.centroids[f * 3 + 2] * pos[2];
      if (d > bd) [best, bd] = [f, d];
    }
    return best;
  }

  private makePeace(a: number, b: number) {
    this.relation[a][b] = this.relation[b][a] = "peace";
    this.tension[a][b] = this.tension[b][a] = 30;
    this.events.push({ kind: "diplomacy", detail: `${this.nationName(a)} and ${this.nationName(b)} made peace, by the will of their god.`, nation: a, other: b });
  }

  // When something big starts, the god may step in (for devotion) or let fate decide.
  private offer(kind: Choice["kind"], title: string, text: string, face: number, nations: number[]) {
    if (this.choice || this.outcome || !nations.length) return;
    const cost = kind === "war" ? 35 : kind === "revolution" ? 25 : 30;
    this.choice = { id: this.nextId++, kind, title, text, face, nations, cost, at: this.year };
  }

  decide(intervene: boolean) {
    const c = this.choice;
    if (!c) return false;
    if (intervene && this.devotion < c.cost) return false;
    this.choice = null;
    if (!intervene) {
      if (c.kind === "disaster") for (const n of c.nations) this.adore(n, -4); // "our god did nothing"
      return true;
    }
    this.devotion -= c.cost;
    if (c.kind === "disaster") {
      // Turn the disaster aside: waves fall, meteors burn up, the volcano sleeps, fires die.
      this.waves = this.waves.filter((w) => this.angle(w.face, c.face) > 0.5);
      this.meteors = this.meteors.filter((m) => this.angle(m.face, c.face) > 0.3);
      for (const v of this.volcanoes) if (v.active && this.angle(v.face, c.face) < 0.3) Object.assign(v, { active: false, wakeAt: this.year + 400 });
      this.calmAt(c.face, 0.3);
      for (const [f] of this.tilesNear(c.face, 0.2)) this.food[f] = Math.max(this.food[f], 0.6);
      for (const n of c.nations) {
        this.adore(n, 10);
        this.nations[n].stability += 8;
      }
    } else if (c.kind === "war" && c.nations.length === 2) {
      this.makePeace(c.nations[0], c.nations[1]);
      for (const n of c.nations) this.adore(n, 5);
    } else {
      for (const n of c.nations) {
        this.nations[n].stability += 35;
        this.adore(n, 8);
      }
      this.revolt.delete(c.nations[0]);
    }
    this.announce("✨", "You intervened", `${c.title.replace(/!$/, "")}: the god stepped in.`, c.face, true);
    this.events.push({ kind: "miracle", detail: `Their god intervened: ${c.text}`, nation: c.nations[0] });
    return true;
  }

  // The goal: keep your chosen people (the first nation) alive to Year GOAL_YEAR, and be loved.
  avgLove() {
    const alive = this.nations.filter((n) => this.aware(n));
    return alive.length ? alive.reduce((t, n) => t + this.loveOf(n.id), 0) / alive.length : 50;
  }
  private checkGoal() {
    if (this.outcome || !this.nations.length || this.year < 20) return;
    const mine = this.nations[0];
    if (!mine.alive) this.outcome = { won: false, title: "Your people have fallen", text: `${cap(mine.name)}, the people you chose, have been wiped out.` };
    else if (this.avgLove() < 15) this.outcome = { won: false, title: "The planet has turned on you", text: "Every nation now believes their god is cruel. They have stopped praying." };
    else if (this.calendar >= GOAL_YEAR)
      this.outcome = this.avgLove() >= 50
        ? { won: true, title: "A beloved god", text: `You guided ${mine.name} to Year ${GOAL_YEAR}, and the nations love you.` }
        : { won: false, title: "Survived, but unloved", text: `${cap(mine.name)} reached Year ${GOAL_YEAR}, but the nations do not love their god.` };
  }

  // ---- The seas: from the Iron Age, coastal towns build warships; trading nations send merchant ships
  // to each other's ports; pirates prey on merchants and coasts, and every navy hunts them ----

  ships: Ship[] = [];
  private navyTimer = 3;
  private tradeTimer = 8;
  private pirateTimer = 90;

  navySize(id: number) {
    return this.ships.filter((s) => s.kind === "war" && s.nation === id).length;
  }

  // A sea tile next to a settlement, if it is on the coast.
  private harbour(face: number) {
    let best = -1, bd = -2;
    for (const [f] of this.tilesNear(face, 0.07)) if (isWater(this.terrain[f] as T) && this.dot(face, f) > bd) [best, bd] = [f, this.dot(face, f)];
    return best;
  }
  private portOf(nation: number) {
    const mine = this.villages.filter((v) => v.nation === nation).sort((a, b) => b.tier - a.tier);
    for (const v of mine.slice(0, 4)) {
      const h = this.harbour(v.face);
      if (h >= 0) return h;
    }
    return -1;
  }

  // Would `a` fire on `b`? Warships fight enemies at war and pirates; pirates attack everyone; merchants never fight.
  private hostile(a: Ship, b: Ship) {
    if (a.kind === "merchant" || a === b) return false;
    if (a.kind === "pirate") return b.kind !== "pirate";
    return b.kind === "pirate" || (b.kind === "war" && this.atWar(a.nation, b.nation));
  }

  // Plan a route by sea (breadth-first over water tiles) to the nearest thing worth sailing to,
  // or else a patrol to some reachable stretch of sea. Returns false if a merchant can't reach its port.
  private planRoute(sh: Ship) {
    let foes: number[], towns: number[];
    if (sh.kind === "merchant") [foes, towns] = [[sh.port!], []];
    else if (sh.kind === "pirate") {
      foes = this.ships.filter((o) => o.kind === "merchant").map((o) => o.face);
      towns = foes.length ? [] : this.villages.map((v) => v.face);
    } else {
      foes = this.ships.filter((o) => this.hostile(sh, o)).map((o) => o.face);
      towns = this.villages.filter((v) => this.atWar(v.nation, sh.nation)).map((v) => v.face);
    }
    const parent = new Int32Array(this.n).fill(-2);
    parent[sh.face] = -1;
    const order = [sh.face];
    let found = -1;
    for (let i = 0; i < order.length && order.length < 12000 && found < 0; i++) {
      const f = order[i];
      if (i > 0 && (foes.some((g) => this.angle(g, f) < 0.03) || towns.some((g) => this.angle(g, f) < 0.06))) found = f;
      for (let k = 0; k < 3; k++) {
        const nb = this.neighbours[f * 3 + k];
        if (parent[nb] !== -2 || !isWater(this.terrain[nb] as T)) continue;
        parent[nb] = f;
        order.push(nb);
      }
    }
    if (found < 0) {
      if (sh.kind === "merchant") return false;
      found = order[Math.min(order.length - 1, 10 + Math.floor(Math.random() * 60))]; // patrol
    }
    const path: number[] = [];
    for (let f = found; f !== sh.face && f >= 0; f = parent[f]) path.push(f);
    sh.path = path.reverse();
    sh.replan = sh.kind === "merchant" ? 1e9 : foes.length || towns.length ? 8 : 30;
    return true;
  }

  private launch(kind: Ship["kind"], nation: number, at: number, extra: Partial<Ship> = {}) {
    const sh: Ship = { id: this.nextId++, kind, nation, face: at, from: at, t: 1, path: [], hp: kind === "merchant" ? 2 : 3, cooldown: 0, replan: 0, ...extra };
    this.ships.push(sh);
    return sh;
  }

  private stepNavy(dt: number) {
    // Shipyards: every few seconds, each nation that has reached the Iron Age may launch a warship.
    this.navyTimer -= dt;
    if (this.navyTimer <= 0) {
      this.navyTimer = 6;
      for (const nt of this.nations) {
        if (!nt.alive || eraOf(nt.tech) < NAVY_ERA) continue;
        const mine = this.villages.filter((v) => v.nation === nt.id);
        const limit = Math.min(MAX_SHIPS, mine.reduce((t, v) => t + (v.tier === 2 ? 2 : v.tier === 1 ? 1 : 0), 1));
        if (this.navySize(nt.id) >= limit || Math.random() > 0.35) continue;
        const port = this.portOf(nt.id);
        if (port < 0) continue;
        const first = this.navySize(nt.id) === 0;
        this.launch("war", nt.id, port);
        if (first) {
          const text = `${cap(nt.name)} launched their first warship. They now have a navy.`;
          this.announce("⚓", "A navy is born", text, port, true);
          this.events.push({ kind: "milestone", detail: text, nation: nt.id });
        }
      }
    }
    // Trade: nations at peace (trading partners most of all) with ports on the same sea send merchant ships
    // to each other; every delivery eases tension, so trade begets more trade.
    this.tradeTimer -= dt;
    if (this.tradeTimer <= 0) {
      this.tradeTimer = 7;
      const merchants = this.ships.filter((s) => s.kind === "merchant");
      const pairs: [number, number][] = [];
      for (const a of this.nations) for (const b of this.nations)
        if (a.alive && b.alive && a.id !== b.id && eraOf(a.tech) >= 1) {
          const rel = this.relation[a.id][b.id];
          if (rel === "trade") pairs.push([a.id, b.id], [a.id, b.id]);
          else if (rel === "peace") pairs.push([a.id, b.id]);
        }
      const pick = pairs[Math.floor(Math.random() * pairs.length)];
      if (pick && merchants.length < MAX_MERCHANTS && merchants.filter((m) => m.nation === pick[0]).length < 2) {
        const [from, port] = [this.portOf(pick[0]), this.portOf(pick[1])];
        if (from >= 0 && port >= 0) {
          const sh = this.launch("merchant", pick[0], from, { dest: pick[1], port });
          if (!this.planRoute(sh)) this.ships.pop(); // no sea route between them
        }
      }
    }
    // Pirates: now and then a pirate ship appears out on the open sea.
    this.pirateTimer -= dt;
    if (this.pirateTimer <= 0) {
      this.pirateTimer = 70 + Math.random() * 50;
      if (this.ships.filter((s) => s.kind === "pirate").length < MAX_PIRATES && (this.ships.length || this.calendar > 6)) {
        const sea = [...Array(40)].map(() => Math.floor(Math.random() * this.n)).find((f) => this.terrain[f] === T.Deep);
        if (sea != null) {
          this.launch("pirate", -1, sea);
          this.announce("🏴‍☠️", "Pirates!", `A pirate ship has been sighted near ${this.where(sea)}. Merchants beware.`, sea);
          this.events.push({ kind: "disaster", detail: "Pirates have been sighted at sea, preying on merchant ships.", nation: this.nearestNation(sea) });
        }
      }
    }
    for (const sh of this.ships) {
      // Sail along the planned route, one sea tile at a time; replan now and then (targets move).
      sh.replan -= dt;
      sh.t += dt * (sh.kind === "merchant" ? 1.3 : 1.6);
      if (sh.t >= 1) {
        if (!sh.path.length || sh.replan <= 0) {
          if (sh.kind === "merchant" && !sh.path.length) {
            this.deliver(sh);
            continue;
          }
          this.planRoute(sh);
        }
        const next = sh.path.shift();
        sh.from = sh.face;
        sh.t = next == null ? 1 : 0;
        if (next != null) sh.face = next;
      }
      // Fight: fire on a hostile ship in range, or raid/shell a settlement.
      sh.cooldown -= dt;
      if (sh.cooldown > 0 || sh.kind === "merchant") continue;
      const foe = this.ships.find((o) => o.hp > 0 && this.hostile(sh, o) && this.angle(o.face, sh.face) < 0.05);
      if (foe) {
        sh.cooldown = 1.5;
        if (Math.random() < 0.5) foe.hp--;
        if (foe.hp <= 0) this.sunk(foe, sh);
        continue;
      }
      const town = this.villages.find((v) => (sh.kind === "pirate" || this.atWar(v.nation, sh.nation)) && this.angle(v.face, sh.face) < 0.07);
      if (town) {
        sh.cooldown = 3;
        const killed = this.killWhere((p) => p.nation === town.nation && this.angle(p.face, town.face) < 0.04 && Math.random() < 0.12);
        this.nations[town.nation].stability -= 1;
        if (sh.kind === "pirate") {
          this.resources.gold = Math.max(0, this.resources.gold - 3);
          this.resources.food = Math.max(0, this.resources.food - 10);
          if (Math.random() < 0.3) this.events.push({ kind: "disaster", detail: `Pirates raided ${town.name}${killed ? `, killing ${killed}` : ""} and carrying off food and gold.`, nation: town.nation });
        } else if (killed) this.events.push({ kind: "disaster", detail: `Warships of ${this.nationName(sh.nation)} shelled ${town.name}, killing ${killed}.`, nation: town.nation, other: sh.nation });
      }
    }
    // Sunk ships, and ships of nations that have fallen, leave the sea.
    this.ships = this.ships.filter((sh) => sh.hp > 0 && (sh.kind === "pirate" || this.nations[sh.nation]?.alive));
  }

  // A merchant reaches port: both nations profit and grow closer.
  private deliver(sh: Ship) {
    sh.hp = 0;
    const [a, b] = [sh.nation, sh.dest!];
    if (!this.nations[b]?.alive) return;
    this.gain("gold", 4);
    this.gain("food", 15);
    this.gain("wood", 10);
    this.sway(a, b, -4);
    for (const n of [a, b]) this.nations[n].stability += 2;
    if (Math.random() < 0.25) this.events.push({ kind: "diplomacy", detail: `A merchant ship from ${this.nationName(a)} reached ${this.nationName(b)}, laden with goods.`, nation: a, other: b });
  }

  private sunk(foe: Ship, by: Ship) {
    if (foe.kind === "pirate") {
      this.events.push({ kind: "milestone", detail: `${cap(this.nationName(by.nation))} sank a pirate ship.`, nation: by.nation });
      this.gain("gold", 6); // the pirates' hoard
    } else if (by.kind === "pirate") {
      const what = foe.kind === "merchant" ? "plundered a merchant ship" : "sank a warship";
      this.events.push({ kind: "disaster", detail: `Pirates ${what} of ${this.nationName(foe.nation)}.`, nation: foe.nation });
      if (foe.kind === "merchant") this.resources.gold = Math.max(0, this.resources.gold - 5);
    } else this.events.push({ kind: "disaster", detail: `A warship of ${this.nationName(foe.nation)} was sunk by ${this.nationName(by.nation)}.`, nation: foe.nation, other: by.nation });
  }

  // ---- Continents: every big landmass gets a name (worked out once, from the starting map) ----

  private _continents: { name: string; face: number; size: number }[] | null = null;
  continents() {
    if (this._continents) return this._continents;
    const seen = new Int32Array(this.n).fill(-1);
    const out: { name: string; face: number; size: number }[] = [];
    const A = ["Ael", "Bor", "Cyr", "Dra", "Eld", "Fal", "Gal", "Hes", "Ith", "Kor", "Lum", "Myr", "Nor", "Ost", "Pyr", "Ryn", "Sol", "Tal", "Vel", "Wyn", "Zan"];
    const B = ["ia", "os", "ara", "eth", "on", "ura", "ond", "is", "ea", "ar", "oria", "andi"];
    const used = new Set<string>();
    for (let f0 = 0; f0 < this.n; f0++) {
      if (seen[f0] >= 0 || isWater(this.terrain[f0] as T)) continue;
      const tiles = [f0];
      seen[f0] = out.length;
      for (let i = 0; i < tiles.length; i++)
        for (let k = 0; k < 3; k++) {
          const nb = this.neighbours[tiles[i] * 3 + k];
          if (seen[nb] < 0 && !isWater(this.terrain[nb] as T)) {
            seen[nb] = out.length;
            tiles.push(nb);
          }
        }
      if (tiles.length < 120) {
        out.push({ name: "", face: f0, size: tiles.length }); // islands keep their slot but no name
        continue;
      }
      // Label it at the tile nearest the landmass's middle.
      let x = 0, y = 0, z = 0;
      for (const f of tiles) {
        x += this.centroids[f * 3];
        y += this.centroids[f * 3 + 1];
        z += this.centroids[f * 3 + 2];
      }
      let face = tiles[0], best = -2;
      for (const f of tiles) {
        const d = this.centroids[f * 3] * x + this.centroids[f * 3 + 1] * y + this.centroids[f * 3 + 2] * z;
        if (d > best) [face, best] = [f, d];
      }
      let name = "";
      for (let i = 0; i < 20 && (!name || used.has(name)); i++) name = A[Math.floor(tileRand(f0, i) * A.length)] + B[Math.floor(tileRand(f0, i + 50) * B.length)];
      used.add(name);
      out.push({ name, face, size: tiles.length });
    }
    this._continents = out.filter((c) => c.name);
    return this._continents;
  }

  // ---- Nations come and go ----

  // A new nation: grows every nation-by-nation table by one row and column.
  addNation(name?: string) {
    const id = this.nations.length;
    const word = placeholderWord(id);
    const race = RACES[Math.floor(Math.random() * RACES.length)].id;
    this.nations.push({
      id, name: name ?? `the ${word} ${RACE[race].plural}`, color: nationColor(id), policy: "settle", faith: 100, stability: 60, recentDeaths: 0, alive: true,
      race, tech: Math.max(0, ...this.nations.filter((n) => n.alive).map((n) => n.tech)) * 0.5, leader: makeLeader(RACE[race]),
    });
    for (const row of this.relation) row.push("peace");
    for (const row of this.tension) row.push(40);
    for (const row of this.contact) row.push(0);
    this.relation.push(new Array<Relation>(id + 1).fill("peace"));
    this.tension.push(new Array<number>(id + 1).fill(40));
    this.contact.push(new Array<number>(id + 1).fill(0));
    this.tension[id][id] = 0;
    return id;
  }

  private nationTimer = 1;
  private lastSplit = -99;
  private revolt = new Map<number, number>(); // when each nation's revolution began
  private conqueror = new Map<number, number>(); // who last took a settlement from each nation

  private stepNationLife(dt: number) {
    this.nationTimer -= dt;
    if (this.nationTimer > 0) return;
    this.nationTimer = 1;
    const alive = () => this.nations.filter((n) => n.alive);

    // Revolution: if it drags on, the people storm the palace and a new ruler takes over.
    for (const nt of alive()) {
      if (this.crisis(nt.id) !== "revolution") {
        this.revolt.delete(nt.id);
        continue;
      }
      const since = this.revolt.get(nt.id) ?? this.year;
      if (!this.revolt.has(nt.id)) this.offer("revolution", "Revolution!", `The people of ${nt.name} have risen against their ruler.`, this.capital(nt.id)?.face ?? 0, [nt.id]);
      this.revolt.set(nt.id, since);
      if (this.year - since < 15 || Math.random() > 0.15) continue;
      const old = `${nt.leader.title} ${nt.leader.name}`;
      nt.leader = makeLeader(RACE[nt.race]);
      nt.stability = 45; // a fresh start, for now
      nt.policy = "settle";
      this.revolt.delete(nt.id);
      const dead = this.killWhere((p) => p.nation === nt.id && Math.random() < 0.08); // the uprising costs lives
      const home = this.capital(nt.id)?.face ?? this.villages.find((v) => v.nation === nt.id)?.face ?? 0;
      const text = `The people of ${nt.name} overthrew ${old}. ${nt.leader.title} ${nt.leader.name} now rules${dead ? `; ${dead} died in the uprising` : ""}.`;
      this.announce("👑", "Leader overthrown!", text, home);
      this.events.push({ kind: "revolution", detail: text, nation: nt.id });
    }

    // A beaten nation with no settlements left is wiped out: its stragglers join the victor.
    for (const nt of alive()) {
      const mine = this.villages.filter((v) => v.nation === nt.id).length;
      const people = this.people.filter((p) => p.nation === nt.id);
      if (mine > 0 || people.length >= 6 || this.year < 20) continue;
      const victor = this.conqueror.get(nt.id) ?? (people.length ? this.nearestOtherNation(people[0].face, nt.id) : -1);
      if (victor >= 0 && this.nations[victor]?.alive) for (const p of people) p.nation = victor;
      else this.killWhere((p) => p.nation === nt.id);
      nt.alive = false;
      const by = victor >= 0 ? ` by ${this.nationName(victor)}` : "";
      this.events.push({ kind: "fallen", detail: `${nt.name} has been wiped out${by}.`, nation: nt.id, other: victor >= 0 ? victor : undefined });
      this.announce("💀", "A nation falls", `${cap(nt.name)} has been wiped out${by}.`, people[0]?.face ?? 0);
    }

    // Too few nations: wanderers arrive on empty land and found a new one.
    if (alive().length < MIN_NATIONS && this.people.length < MAX_PEOPLE - 20) {
      const home = this.emptiestLand();
      const id = this.addNation();
      for (let j = 0; j < 10; j++) this.spawnNear(home, id);
      this.events.push({ kind: "village", detail: `Wanderers arrive from beyond the sea and settle near the coast.`, nation: id });
      this.announce("⛵", "Newcomers", `A new people, ${this.nationName(id)}, arrive and settle on empty land.`, home, true);
    }

    // Land that has been cut off from the capital (by war or disaster) can't stay part of the nation.
    for (const nt of alive()) {
      const cut = this.cutOff(nt.id);
      if (!cut.length) continue;
      if (alive().length < MAX_NATIONS) this.splitOff(nt.id, cut, false, "cut off");
      else {
        // No room for another nation: the cut-off settlements join whichever neighbour surrounds them.
        for (const v of cut) {
          const n = this.nearestOtherNation(v.face, nt.id);
          if (n >= 0) v.nation = n;
        }
        this.updateBorders();
      }
      return;
    }

    // Breakaways: an unhappy or overgrown nation loses its farthest settlement, which declares itself a nation.
    if (alive().length >= MAX_NATIONS || this.year - this.lastSplit < 12) return;
    for (const nt of alive()) {
      const mine = this.villages.filter((v) => v.nation === nt.id);
      const capital = this.capital(nt.id);
      if (mine.length < 2 || !capital) continue;
      const unrest = nt.stability < 25 || nt.policy === "rebel";
      if (!(unrest ? Math.random() < 0.25 : mine.length >= 4 && Math.random() < 0.04)) continue;
      const far = mine.filter((v) => v !== capital).sort((a, b) => this.angle(b.face, capital.face) - this.angle(a.face, capital.face))[0];
      this.splitOff(nt.id, [far], unrest, unrest ? "civil war" : "independence");
      break;
    }
  }

  // Can this nation found a settlement here without leaving a gap? Its first one can go anywhere;
  // after that, only on or right next to its own land.
  private joinsUp(f: number, nation: number) {
    if (!this.villages.some((v) => v.nation === nation)) return true;
    if (this.owner[f] === nation) return true;
    for (let k = 0; k < 3; k++) if (this.owner[this.neighbours[f * 3 + k]] === nation) return true;
    return false;
  }

  // Settlements of a nation whose land no longer touches the capital's.
  private cutOff(id: number) {
    const capital = this.capital(id);
    if (!capital || this.owner[capital.face] !== id) return [];
    const seen = new Uint8Array(this.n);
    const queue = [capital.face];
    seen[capital.face] = 1;
    for (let i = 0; i < queue.length; i++) {
      for (let k = 0; k < 3; k++) {
        const nb = this.neighbours[queue[i] * 3 + k];
        if (!seen[nb] && this.owner[nb] === id) {
          seen[nb] = 1;
          queue.push(nb);
        }
      }
    }
    return this.villages.filter((v) => v.nation === id && this.owner[v.face] === id && !seen[v.face]);
  }

  // Some of a nation's settlements become a new nation of their own.
  private splitOff(from: number, places: Village[], war: boolean, why: "civil war" | "independence" | "cut off") {
    const nt = this.nations[from];
    const id = this.addNation();
    const ids = new Set(places.map((v) => v.id));
    for (const v of places) v.nation = id;
    for (const p of this.people) if ((p.village !== null && ids.has(p.village)) || (p.nation === from && places.some((v) => this.angle(p.face, v.face) < 0.06))) p.nation = id;
    this.relation[id][from] = this.relation[from][id] = war ? "war" : "rival";
    this.tension[id][from] = this.tension[from][id] = war ? 85 : 65;
    nt.stability -= 10;
    this.lastSplit = this.year;
    const name = places[0].name;
    this.events.push({ kind: "village", detail: `${name} broke away from ${nt.name} to found a new nation.`, nation: id });
    const text =
      why === "civil war" ? `${name} has risen up against ${nt.name} and formed a new nation.`
      : why === "cut off" ? `Cut off from the rest of ${nt.name}, ${name} now rules itself.`
      : `${name} has broken away from ${nt.name} to rule itself.`;
    this.events.push({ kind: "diplomacy", detail: text, nation: from, other: id });
    this.announce(war ? "⚔️" : "🏳️", why === "civil war" ? "Civil war!" : "Independence!", text, places[0].face);
    this.updateBorders();
  }

  private nearestOtherNation(face: number, not: number) {
    let best = -1, d = Infinity;
    for (const p of this.people) if (p.nation !== not && this.nations[p.nation].alive) {
      const a = this.angle(p.face, face);
      if (a < d) [best, d] = [p.nation, a];
    }
    return best;
  }

  // Habitable land as far as possible from anyone.
  private emptiestLand() {
    let best = this.bestStart(), far = -1;
    for (let f = 0; f < this.n; f += 11) {
      if (this.terrain[f] !== T.Grass && this.terrain[f] !== T.Forest) continue;
      let d = Infinity;
      for (let i = 0; i < this.people.length; i += 4) d = Math.min(d, this.angle(this.people[i].face, f));
      if (d > far) [best, far] = [f, d];
    }
    return best;
  }

  // Relations drift with tension. Shared borders, hunger and expansion build it; trade,
  // worship and the god's Peace power ease it. War burns itself out as people die.
  private stepNations(dt: number) {
    const k = this.nations.length;
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const A = this.nations[a], B = this.nations[b];
        if (!A.alive || !B.alive) continue;
        const rel = this.relation[a][b];
        const touching = this.contact[a][b] > 0;
        let drift: number;
        if (rel === "war") drift = -1; // war exhausts both sides
        else {
          // Tension drifts towards a level set by what is going on between them.
          let level = 40 + 18 * Math.sin(this.year / 40 + a * 7.1 + b * 3.3); // old grudges come and go
          if (touching) level += 12 + Math.min(25, this.contact[a][b] / 2);
          for (const n of [A, B]) level += n.policy === "expand" ? 10 : n.policy === "rebel" ? 10 : n.policy === "worship" ? -8 : 0;
          if (this.nationFood(a) < 40 || this.nationFood(b) < 40) level += 15;
          // Envy: a much bigger neighbour makes the smaller one nervous.
          const pa = this.people.filter((p) => p.nation === a).length, pb = this.people.filter((p) => p.nation === b).length;
          if (Math.max(pa, pb) > 2 * Math.max(1, Math.min(pa, pb))) level += 8;
          if (rel === "trade") level -= 10;
          drift = (level - this.tension[a][b]) * 0.04;
        }
        this.sway(a, b, drift * dt);
        const t = this.tension[a][b];
        let next: Relation = rel;
        if (rel === "peace" && t < 25) next = "trade"; // caravans travel even without a shared border
        else if (rel === "peace" && t > 55) next = "rival";
        else if (rel === "trade" && t > 45) next = "peace";
        else if (rel === "rival" && t > 75) next = "war";
        else if (rel === "rival" && t < 40) next = "peace";
        else if (rel === "war" && t < 35) next = "peace";
        if (next !== rel) {
          this.relation[a][b] = this.relation[b][a] = next;
          const words: Record<Relation, string> = {
            trade: `${A.name} and ${B.name} began trading with each other.`,
            peace: rel === "war" ? `${A.name} and ${B.name} made peace after their war.` : `${A.name} and ${B.name} are at peace.`,
            rival: `${A.name} and ${B.name} have become rivals. Tension is rising on their border.`,
            war: `${A.name} and ${B.name} have gone to war!`,
          };
          this.events.push({ kind: "diplomacy", detail: words[next], nation: a, other: b });
          if (next === "war") this.offer("war", "War!", words[next], this.capital(a)?.face ?? 0, [a, b]);
        }
      }
    }
    for (const nt of this.nations) {
      if (!nt.alive) continue;
      if (!this.people.some((p) => p.nation === nt.id) && !this.villages.some((v) => v.nation === nt.id)) {
        nt.alive = false;
        this.events.push({ kind: "fallen", detail: `${nt.name} is no more. Its last people are gone.`, nation: nt.id });
      }
    }
  }

  private stepNeeds(dt: number) {
    for (const nt of this.nations) {
      if (!nt.alive) continue;
      const food = this.nationFood(nt.id);
      nt.faith = 100; // faith is no longer a need (Frank's call): it never decays, so no cult crisis
      // Rebels burn the god's shrines now and then.
      const mine = this.villages.filter((v) => v.nation === nt.id);
      if (nt.policy === "rebel" && mine.length && Math.random() < 0.03 * dt) this.ignite(this.neighbours[mine[Math.floor(Math.random() * mine.length)].face * 3]);
      nt.recentDeaths *= Math.pow(0.85, dt); // fades over a few seconds
      const wars = this.relation[nt.id].filter((r) => r === "war").length;
      const target =
        (nt.policy === "worship" ? 50 : 40) + Math.min(30, mine.length * 4) + (food - 50) * 0.4 - Math.min(40, nt.recentDeaths * 1.5) - wars * 15 + this.tradePartners(nt.id) * 5 + RACE[nt.race].stability;
      nt.stability = Math.max(0, Math.min(100, nt.stability + (target - nt.stability) * 0.15 * dt));
      this.stepTech(nt, mine.length, dt);
    }
  }

  // Climbing the eras: bigger, calmer nations invent faster, and race sets the pace
  // (goblins are ten times slower than humans). Reaching a new era is news.
  private stepTech(nt: Nation, villages: number, dt: number) {
    if (!villages) return;
    const pop = this.people.filter((p) => p.nation === nt.id).length;
    const before = eraOf(nt.tech);
    nt.tech += Math.sqrt(pop) * (0.5 + nt.stability / 100) * 0.35 * RACE[nt.race].tech * dt;
    const after = eraOf(nt.tech);
    if (after > before) {
      const space = after === ERAS.length - 1;
      const text = space ? `${cap(nt.name)} have reached the Space Age! Their first ship leaves the planet.` : `${cap(nt.name)} enter the ${ERAS[after]}.`;
      this.events.push({ kind: "milestone", detail: text, nation: nt.id });
      const home = this.nationHome(nt.id);
      if (home != null) this.announce(space ? "🚀" : "📜", space ? "The Space Age" : `The ${ERAS[after]}`, text, home, true);
      // Your own nation reaching space unlocks travel to other players' planets (multiplayer).
      if (space && nt.id === 0 && !this.spacefaring) {
        this.spacefaring = true;
        if (home != null) this.announce("🚀", "Multiplayer unlocked", `${cap(nt.name)} can travel to other worlds. Open the galaxy to meet other gods' planets.`, home);
      }
    }
  }

  // Random natural disasters, not caused by the god (though the people may blame them).
  // Rare at first; the more people there are, the more there is to hit.
  // ---- Fate ----
  // The player can't use powers directly: the heavens use them at random, and the
  // people believe their god did it. The player's only influence is talking to them.
  private nextFate = 20 + Math.random() * 15;
  fate: { power: GodPower; text: string; at: number } | null = null; // the latest act, for the HUD

  private maybeFate(dt: number) {
    this.nextFate -= dt;
    if (this.nextFate > 0 || !this.people.length) return;
    this.nextFate = 40 + Math.random() * 30;
    const bag: [GodPower, number][] = [
      ["rain", 3], ["forest", 2], ["miracle", 2], ["peace", 2], ["drought", 2], ["discord", 2],
      ["raise", 1], ["lower", 1], ["fire", 1],
    ];
    let r = Math.random() * bag.reduce((t, [, w]) => t + w, 0);
    const power = bag.find(([, w]) => (r -= w) < 0)![0];
    // Mostly aim near people, so it matters.
    const target = Math.random() < 0.8 ? this.people[Math.floor(Math.random() * this.people.length)].face : Math.floor(Math.random() * this.n);
    const radius = 0.05 + Math.random() * 0.08;
    const strokes = power === "meteor" || power === "spawn" ? 1 : power === "fire" ? 2 : 6; // a brush power is painted several times
    if (power === "meteor") this.startMeteor(target, radius, false); // falls for a few years before it strikes
    else for (let i = 0; i < strokes; i++) this.apply(power, target, radius);
    const nation = this.owner[target] >= 0 ? this.owner[target] : this.nearestNation(target);
    const where = this.nationName(nation);
    const words: Record<GodPower, string> = {
      rain: `Rain falls on ${where}.`, forest: `A forest springs up near ${where}.`, miracle: `The fields of ${where} bloom overnight.`,
      peace: `A strange calm settles over ${where}.`, drought: `Drought grips ${where}.`, discord: `Anger spreads through ${where}.`,
      spawn: `Strangers appear from nowhere near ${where}.`, raise: `The land heaves up near ${where}.`, lower: `The sea swallows land near ${where}.`,
      fire: `Fire breaks out near ${where}.`, meteor: `A meteor falls near ${where}.`,
    };
    if (power === "rain") this.addWeather(target, false); // a visible rain cloud over the spot
    this.fate = { power, text: words[power], at: this.year };
    if (power !== "meteor") this.announce(FATE_ICONS[power], FATE_TITLES[power], words[power], target, true);
    this.events.push({ kind: power, detail: `${words[power]} The people believe their god did it.`, nation });
  }

  // ---- Catastrophes: tsunamis, meteors and volcanoes play out over a few years ----

  waves: Wave[] = [];
  meteors: Meteor[] = [];
  volcanoes: Volcano[] = [];
  alert: Alert | null = null;

  // Pop-ups: big news always shows; routine news (towns, eras, newcomers) only if nothing has popped up for a while.
  // Bake the land around `face` a dusty gold for a while, with heat haze above it.
  droughts: Drought[] = [];
  private parch(face: number, radius: number) {
    for (const [f, w] of this.tilesNear(face, radius)) if (!isWater(this.terrain[f] as T)) this.parched[f] = Math.max(this.parched[f], 30 * (0.4 + 0.6 * w));
    if (!this.droughts.some((d) => d.face === face)) this.droughts.push({ id: this.nextId++, face, at: this.year, r: radius, life: 25 });
    this.version++;
  }

  private announce(icon: string, title: string, text: string, face: number, minor = false) {
    if (minor && this.alert && this.year - this.alert.at < MINOR_ALERT_GAP) return;
    this.alert = { icon, title, text, at: this.year, face };
    if (!minor && DISASTER_ICONS.has(icon)) this.offer("disaster", title, text, face, [...this.nationsIn(this.tilesNear(face, 0.2).map(([f]) => f))]);
  }

  private where(face: number) {
    return this.nationName(this.owner[face] >= 0 ? this.owner[face] : this.nearestNation(face));
  }

  // Find open sea a little way off a coast near `face`, for a tsunami to start from.
  private seaNear(face: number) {
    let best = -1, bd = -2;
    for (const [f] of this.tilesNear(face, 0.25)) if (this.terrain[f] === T.Deep || this.terrain[f] === T.Shallow) {
      const d = this.dot(face, f) - Math.abs(this.angle(face, f) - 0.12) * 4; // prefer ~0.12 rad offshore
      if (d > bd) [best, bd] = [f, d];
    }
    return best;
  }

  startTsunami(face: number) {
    const sea = this.seaNear(face);
    if (sea < 0) return false;
    this.waves.push({ id: this.nextId++, face: sea, at: this.year, r: 0 });
    this.announce("🌊", "Tsunami!", `A great wave rises from the sea and races towards ${this.where(face)}.`, sea);
    return true;
  }

  startMeteor(face: number, radius: number, natural: boolean) {
    this.meteors.push({ id: this.nextId++, face, at: this.year, radius, fall: 2.5, natural });
    this.announce("☄️", "Meteor incoming!", `A burning star is falling towards ${this.where(face)}.`, face);
  }

  // Wake the sleeping volcano nearest `face`; only if the planet has none does a new one break through.
  startVolcano(face: number) {
    let v = this.volcanoes.filter((x) => !x.active).sort((a, b) => this.angle(a.face, face) - this.angle(b.face, face))[0];
    if (!v && this.volcanoes.length) return; // all already erupting
    if (!v) {
      let top = face;
      for (const [f] of this.tilesNear(face, 0.12)) if (this.elevation[f] > this.elevation[top]) top = f;
      this.raiseCone(top);
      v = { id: this.nextId++, face: top, active: false, at: 0, life: 0, nextBurst: 0, wakeAt: 0 };
      this.volcanoes.push(v);
    }
    this.erupt(v);
  }

  private erupt(v: Volcano) {
    Object.assign(v, { active: true, at: this.year, life: 14 + Math.random() * 8, nextBurst: 0 });
    this.version++;
    this.announce("🌋", "Volcano!", `The volcano near ${this.where(v.face)} roars back to life.`, v.face);
    this.events.push({ kind: "disaster", detail: `A volcano erupted near ${this.where(v.face)}.`, nation: this.owner[v.face] >= 0 ? this.owner[v.face] : undefined });
  }

  private stepCatastrophes(dt: number) {
    // Tsunami: the ring grows, and low land it passes over is swept clean.
    for (const w of this.waves) {
      const r0 = w.r;
      w.r = Math.min(0.32, w.r + dt * 0.09);
      if (w.r === r0) continue;
      const cosIn = Math.cos(r0), cosOut = Math.cos(w.r);
      const hit = new Set<number>();
      for (let f = 0; f < this.n; f++) {
        const d = this.dot(w.face, f);
        if (d > cosIn || d < cosOut || isWater(this.terrain[f] as T)) continue;
        // The wave weakens as it spreads, so only ever-lower ground floods far out.
        if (this.elevation[f] > 0.22 - w.r * 0.4) continue;
        this.forest[f] = 0;
        this.food[f] = 0;
        this.farm[f] = 0;
        this.scorch[f] = Math.max(this.scorch[f], 6);
        hit.add(f);
        this.classify(f);
      }
      if (hit.size) {
        const killed = this.killWhere((p) => hit.has(p.face));
        const lost = this.villages.filter((v) => hit.has(v.face));
        this.villages = this.villages.filter((v) => !hit.has(v.face));
        this.version++;
        if (killed || lost.length) {
          const n = this.owner[[...hit][0]];
          this.events.push({ kind: "disaster", detail: `A tsunami swept the coast${lost.length ? `, destroying ${lost.map((v) => v.name).join(", ")}` : ""}${killed ? ` and drowning ${killed} people` : ""}.`, nation: n >= 0 ? n : undefined });
          if (n >= 0) this.nations[n].stability -= 6;
        }
      }
    }
    this.waves = this.waves.filter((w) => this.year - w.at < 5);

    // Meteors: fall for a few years, then strike.
    for (const m of this.meteors) if (this.year - m.at >= m.fall) {
      this.apply("meteor", m.face, m.radius);
      this.announce("💥", "Impact!", `The meteor struck near ${this.where(m.face)}.`, m.face);
    }
    this.meteors = this.meteors.filter((m) => this.year - m.at < m.fall);

    // Volcanoes: bursts of lava set the slopes alight and bury the land in ash.
    for (const v of this.volcanoes) {
      if (!v.active) {
        if (this.year >= v.wakeAt) {
          // Only erupt on its own if no other disaster is due soon; otherwise wait for a quiet spell.
          if (this.nextDisaster > DISASTER_EVERY / 2 && this.year - this.lastDisasterAt > DISASTER_EVERY * 0.8) {
            this.erupt(v);
            this.lastDisasterAt = this.year;
            this.nextDisaster = DISASTER_EVERY;
          } else v.wakeAt = this.year + 30 + Math.random() * 30;
        }
        continue;
      }
      if (this.year - v.at >= v.life) {
        // Back to sleep for several years.
        Object.assign(v, { active: false, wakeAt: this.year + 400 + Math.random() * 600 });
        continue;
      }
      v.nextBurst -= dt;
      if (v.nextBurst > 0) continue;
      v.nextBurst = 1 + Math.random() * 1.5;
      for (const [f, w] of this.tilesNear(v.face, 0.09)) {
        if (Math.random() < 0.35 * w + 0.05) this.ignite(f);
        this.scorch[f] = Math.max(this.scorch[f], 20 * w);
        this.food[f] *= 0.5;
      }
      const killed = this.killWhere((p) => this.angle(p.face, v.face) < 0.05 && Math.random() < 0.6);
      const before = this.villages.length;
      this.villages = this.villages.filter((x) => this.angle(x.face, v.face) > 0.04);
      if (killed || this.villages.length < before) this.events.push({ kind: "disaster", detail: `Lava from the volcano killed ${killed} people${this.villages.length < before ? " and buried a village" : ""}.`, nation: this.owner[v.face] >= 0 ? this.owner[v.face] : undefined });
      this.version++;
    }
  }

  // ---- Weather: rain clouds and storms that drift around the planet ----

  weather: Weather[] = [];
  private nextWeather = 2 + Math.random() * 4;

  // Start a rain cloud (or a storm) over `face`, drifting along a random great circle.
  addWeather(face: number, storm: boolean, loud = false) {
    if (this.weather.length >= MAX_WEATHER) this.weather.shift();
    const pos = this.c(face);
    const axis = new THREE.Vector3().randomDirection().cross(new THREE.Vector3(...pos)).normalize();
    this.weather.push({
      id: this.nextId++, face, pos, axis: [axis.x, axis.y, axis.z], storm,
      speed: 0.04 + Math.random() * 0.05, age: 0, life: storm ? 10 + Math.random() * 8 : 14 + Math.random() * 14,
      rainTimer: 0, nextStrike: 1 + Math.random() * 2, flash: null,
    });
    const nation = this.owner[face];
    if (!loud) return; // passing weather is just scenery
    if (storm) this.announce("⛈️", "Storm!", `A thunderstorm is building over ${this.where(face)}.`, face);
    if (storm && nation >= 0) this.events.push({ kind: "disaster", detail: `A great storm rolls over ${this.nationName(nation)}.`, nation });
  }

  private stepWeather(dt: number) {
    this.nextWeather -= dt;
    if (this.nextWeather <= 0) {
      this.nextWeather = 3 + Math.random() * 6;
      const nearPeople = this.people.length && Math.random() < 0.6;
      const face = nearPeople ? this.people[Math.floor(Math.random() * this.people.length)].face : Math.floor(Math.random() * this.n);
      this.addWeather(face, Math.random() < 0.12);
    }
    const v = new THREE.Vector3(), ax = new THREE.Vector3();
    for (const w of this.weather) {
      w.age += dt;
      // Drift: rotate the position about the cloud's own axis, then follow it across tiles.
      v.set(...w.pos).applyAxisAngle(ax.set(...w.axis), w.speed * dt);
      w.pos = [v.x, v.y, v.z];
      w.face = this.faceToward(w.face, v);
      w.rainTimer -= dt;
      if (w.rainTimer <= 0) {
        w.rainTimer = 0.5;
        this.rainOn(w.face, w.storm ? 0.11 : 0.08, w.storm ? 2 : 1);
      }
      if (w.storm) {
        w.nextStrike -= dt;
        if (w.nextStrike <= 0) {
          w.nextStrike = 1.5 + Math.random() * 2.5;
          // Lightning lands somewhere under the storm; on dry land it can start a fire.
          let f = w.face;
          for (let i = 0; i < 6; i++) f = this.neighbours[f * 3 + Math.floor(Math.random() * 3)];
          w.flash = { face: f, at: this.year };
          if (Math.random() < 0.35) this.ignite(f);
          const killed = this.killWhere((p) => p.face === f && Math.random() < 0.5);
          const o = this.owner[f];
          if (o >= 0) this.nations[o].stability -= 1;
          if (killed && o >= 0) this.events.push({ kind: "disaster", detail: `Lightning struck in ${this.nationName(o)}, killing ${killed}.`, nation: o });
        }
      }
    }
    this.weather = this.weather.filter((w) => w.age < w.life);
  }

  // Greedy walk across neighbouring tiles towards direction `v` (clouds move a little each frame).
  faceToward(f: number, v: THREE.Vector3) {
    for (let i = 0; i < 40; i++) {
      let best = f, bd = this.centroids[f * 3] * v.x + this.centroids[f * 3 + 1] * v.y + this.centroids[f * 3 + 2] * v.z;
      for (let k = 0; k < 3; k++) {
        const nb = this.neighbours[f * 3 + k];
        const d = this.centroids[nb * 3] * v.x + this.centroids[nb * 3 + 1] * v.y + this.centroids[nb * 3 + 2] * v.z;
        if (d > bd) [best, bd] = [nb, d];
      }
      if (best === f) return f;
      f = best;
    }
    return f;
  }

  // Rain waters the land, grows food and puts out fires within a few tiles of `centre`.
  private rainOn(centre: number, radius: number, strength: number) {
    let changed = false;
    for (const [f, w] of this.tilesNear(centre, radius)) {
      this.moisture[f] = Math.min(1, this.moisture[f] + 0.015 * strength * w);
      this.food[f] = Math.min(1, this.food[f] + 0.04 * strength * w);
      if (this.fire[f] > 0) {
        this.fire[f] = 0;
        this.burning.delete(f);
        changed = true;
      }
      const before = this.terrain[f];
      this.classify(f);
      if (this.terrain[f] !== before) changed = true;
    }
    if (changed) this.version++;
  }

  private lastDisasterAt = -99;
  private nextDisaster = DISASTER_EVERY * (0.6 + Math.random() * 0.4); // seconds until the next one

  private maybeDisaster(dt: number) {
    this.nextDisaster -= dt;
    if (this.nextDisaster > 0 || this.people.length < 20) return;
    this.nextDisaster = DISASTER_EVERY * (0.9 + Math.random() * 0.2);
    this.lastDisasterAt = this.year;
    // Usually aim near people, so the disaster matters.
    const target = this.people.length && Math.random() < 0.75 ? this.people[Math.floor(Math.random() * this.people.length)].face : Math.floor(Math.random() * this.n);
    // Each planet type suffers its own hazard far more often (volcanoes on Ironworld, tsunamis on Archipelago...).
    const roll = Math.random() < 0.45 ? this.type.hazardRoll : Math.random();
    // The big three play out over several years and announce themselves.
    if (roll < 0.12) return void (this.startTsunami(target) || this.startVolcano(target));
    if (roll < 0.22) return this.startMeteor(target, 0.06 + Math.random() * 0.04, true);
    if (roll < 0.32) return this.startVolcano(target);
    const before = this.people.length;
    let kind: string;
    if (roll < 0.5) {
      kind = "lightning storm";
      this.addWeather(target, true, true);
      this.ignite(target);
      for (let k = 0; k < 3; k++) this.ignite(this.neighbours[target * 3 + k]);
    } else if (roll < 0.66) {
      kind = "drought";
      this.parch(target, 0.2);
      for (const [f] of this.tilesNear(target, 0.2)) {
        this.moisture[f] = Math.max(0, this.moisture[f] - 0.15);
        this.food[f] *= 0.4;
        this.classify(f);
      }
    } else if (roll < 0.82) {
      kind = "earthquake";
      for (const [f, w] of this.tilesNear(target, 0.12)) {
        this.elevation[f] = Math.max(-1, Math.min(1, this.elevation[f] + (Math.random() - 0.5) * 0.25 * w));
        this.classify(f);
      }
      this.villages = this.villages.filter((v) => this.angle(v.face, target) > 0.05 || Math.random() < 0.5);
      this.killWhere((p) => isWater(this.terrain[p.face] as T));
    } else if (roll < 0.93) {
      kind = "flood";
      for (const [f, w] of this.tilesNear(target, 0.1)) {
        if (this.elevation[f] < 0.12) this.elevation[f] -= 0.1 * w;
        this.classify(f);
      }
      this.killWhere((p) => isWater(this.terrain[p.face] as T));
      this.villages = this.villages.filter((v) => !isWater(this.terrain[v.face] as T));
    } else {
      kind = "plague";
      // Stockpiled herbs are medicine: they protect against plague.
      const medicine = 1 - (1 - Math.min(0.8, this.resources.herbs / 200));
      this.killWhere((p) => this.angle(p.face, target) < 0.25 && Math.random() < 0.5 * (1 - medicine));
    }
    const dead = before - this.people.length;
    const hit = this.nationsIn(this.tilesNear(target, 0.2).map(([f]) => f));
    for (const id of hit) this.nations[id].stability -= 8;
    this.version++;
    this.events.push({ kind: "disaster", detail: `A natural ${kind} struck${dead ? `, killing ${dead} people` : ""}. The god did not cause it.`, nation: [...hit][0] });
    const icons: Record<string, string> = { "lightning storm": "⛈️", drought: "☀️", earthquake: "🫨", flood: "🌊", plague: "☠️" };
    this.announce(icons[kind] ?? "⚠️", cap(kind) + "!", `A ${kind} strikes ${this.where(target)}${dead ? `, killing ${dead} people` : ""}.`, target);
  }

  private nationFood(id: number) {
    let sum = 0, n = 0;
    for (const p of this.people) if (p.nation === id) {
      sum += p.hunger;
      n++;
    }
    return n ? (sum / n) * 100 : 0;
  }

  private checkMilestones() {
    const once = (key: string, ok: boolean, e: SimEvent) => {
      if (ok && !this.milestones.has(key)) {
        this.milestones.add(key);
        this.events.push(e);
      }
    };
    const pop = this.people.length;
    for (const n of [50, 150, 400, 1000]) once(`pop${n}`, pop >= n, { kind: "milestone", detail: `The population reached ${n}.` });
    for (const n of [3, 8, 15]) once(`vil${n}`, this.villages.length >= n, { kind: "milestone", detail: `There are now ${n} villages.` });
    once("extinct", this.milestones.has("pop50") && pop === 0, { kind: "extinct", detail: "Every last person has died." });
  }

  // ---- Read-outs for the UI and the narrator ----

  nationNeeds(id: number): Needs {
    const nt = this.nations[id];
    return { food: this.nationFood(id), faith: nt.faith, stability: nt.stability };
  }

  // The whole planet's needs: each nation's, weighted by its population.
  needs(): Needs {
    const out = { food: 0, faith: 0, stability: 0 };
    const total = this.people.length;
    if (!total) return out;
    for (const nt of this.nations) {
      const share = this.people.filter((p) => p.nation === nt.id).length / total;
      if (!share) continue;
      const n = this.nationNeeds(nt.id);
      out.food += n.food * share;
      out.faith += n.faith * share;
      out.stability += n.stability * share;
    }
    return out;
  }

  crisis(id: number): Crisis | null {
    if (this.people.filter((p) => p.nation === id).length < 8) return null;
    const n = this.nationNeeds(id);
    if (n.food < 30) return "famine";
    if (n.stability < 20) return "revolution";
    return null;
  }

  nationInfo(): NationInfo[] {
    return this.nations.map((nt) => ({
      id: nt.id,
      name: nt.name,
      color: nt.color,
      alive: nt.alive,
      policy: nt.policy,
      population: this.people.filter((p) => p.nation === nt.id).length,
      villages: this.villages.filter((v) => v.nation === nt.id).length,
      cities: this.villages.filter((v) => v.nation === nt.id && v.tier === 2).length,
      towns: this.villages.filter((v) => v.nation === nt.id && v.tier === 1).length,
      capital: this.capital(nt.id)?.name,
      race: nt.race,
      tech: Math.round(nt.tech),
      ships: this.navySize(nt.id),
      love: Math.round(this.loveOf(nt.id)),
      era: eraOf(nt.tech),
      leader: nt.leader,
      needs: this.nationNeeds(nt.id),
      crisis: this.crisis(nt.id),
      relations: this.nations
        .filter((o) => o.id !== nt.id && o.alive)
        .map((o) => ({ id: o.id, relation: this.relation[nt.id][o.id], tension: Math.round(this.tension[nt.id][o.id]) })),
    }));
  }

  // ---- Economy ----

  private gain(r: keyof Resources, amount: number) {
    this.resources[r] += amount;
    this.produced += amount * VALUE[r];
  }

  // ---- The galaxy (multiplayer): effects of trades and invasions with other players' planets ----

  // Resources sent to (negative) or received from (positive) another planet.
  galaxyTrade(r: keyof Resources, amount: number, other: string) {
    this.resources[r] = Math.max(0, this.resources[r] + amount);
    const home = this.nationHome(0);
    if (amount > 0 && home != null) this.announce("🛸", "A gift from the stars", `${other} sent ${amount} ${r}.`, home);
  }

  // Another god's fleet raided us: some people die near the home village.
  invadedFromSpace(attacker: string, lost: number) {
    let left = lost;
    this.killWhere(() => left > 0 && Math.random() < 0.3 && left-- > 0);
    this.resources.gold = Math.max(0, this.resources.gold - 20);
    const home = this.nationHome(0);
    if (home != null) this.announce("🛸", "Invaded from space!", `A fleet from ${attacker} raided the planet.`, home);
  }

  // Military strength (for invading other planets later): a fifth of the population can fight.
  military() {
    return Math.round(this.people.length * 0.2); // one in five people can fight
  }

  stats(): PlanetStats {
    const count = new Array(8).fill(0);
    for (let f = 0; f < this.n; f++) count[this.terrain[f]]++;
    const pct = (x: number) => Math.round((x / this.n) * 100);
    return {
      planetType: this.type.name,
      population: this.people.length,
      villages: this.villages.length,
      ocean: pct(count[T.Deep] + count[T.Shallow]),
      forest: pct(count[T.Forest]),
      desert: pct(count[T.Desert]),
      mountains: pct(count[T.Rock] + count[T.Snow]),
      resources: Object.fromEntries(Object.entries(this.resources).map(([k, v]) => [k, Math.floor(v)])) as unknown as Resources,
    };
  }

  // A good starting spot: the grass tile with the most grass around it.
  bestStart(): number {
    let best = 0, score = -1;
    for (let f = 0; f < this.n; f += 7) {
      if (this.terrain[f] !== T.Grass) continue;
      const s = this.dot(f, f) + this.moisture[f] + tileRand(f) * 0.3 + (this.elevation[f] < 0.3 ? 0.5 : 0);
      if (s > score) {
        score = s;
        best = f;
      }
    }
    return best;
  }
}
