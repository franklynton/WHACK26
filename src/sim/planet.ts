// The planet simulation: a sphere of ~27,000 triangular tiles, the god powers that
// reshape it, and the little people who live on it. Data lives in typed arrays and is
// mutated in place for speed; React only polls `snapshot()` a few times a second.
import * as THREE from "three";
import { fbm, tileRand } from "./noise";
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
}

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
}

export const NATION_COLORS = ["#e63946", "#ffd166", "#b56cff", "#ff70a6", "#ff8c42"];
const NATION_HUES = ["Red", "Gold", "Violet", "Rose", "Amber"]; // placeholder names until each mind names itself

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
}
export const PLANET_TYPES: PlanetType[] = [
  { name: "Verdant", blurb: "Fertile plains, rich in food and herbs", ocean: 0.56, moisture: 0.08, rockLine: 0.5, deposits: 0.6, yield: { food: 2, wood: 1, stone: 0.6, metal: 0.5, gold: 0.4, herbs: 1.6 } },
  { name: "Timberworld", blurb: "Endless forests, rich in wood", ocean: 0.5, moisture: 0.2, rockLine: 0.5, deposits: 0.6, yield: { food: 1, wood: 2.2, stone: 0.6, metal: 0.5, gold: 0.5, herbs: 1.3 } },
  { name: "Ironworld", blurb: "Mountain ranges veined with metal", ocean: 0.48, moisture: -0.02, rockLine: 0.28, deposits: 1.8, yield: { food: 0.8, wood: 0.8, stone: 1.6, metal: 2.2, gold: 0.7, herbs: 0.5 } },
  { name: "Gilded", blurb: "Dry hills hiding rich gold seams", ocean: 0.45, moisture: -0.16, rockLine: 0.4, deposits: 1.4, yield: { food: 0.7, wood: 0.6, stone: 1.2, metal: 1, gold: 2.4, herbs: 0.4 } },
  { name: "Archipelago", blurb: "Scattered islands, scarce land, rare medicines", ocean: 0.72, moisture: 0.1, rockLine: 0.45, deposits: 1, yield: { food: 1.6, wood: 1.2, stone: 1, metal: 0.6, gold: 0.8, herbs: 2 } },
];

const MAX_PEOPLE = 1500;
const BIRTHS: Record<Policy, number> = { settle: 1, expand: 1.2, farm: 1.4, worship: 0.9, explore: 1, hoard: 0.6, rebel: 0.8 };
const STEP_TIME = 0.7; // seconds to walk one tile
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
  owner: Int8Array; // which nation's land each tile is, -1 = nobody's
  private contact: number[][] = []; // how many border tiles each pair of nations shares
  private borderTimer = 0;
  // Stockpiled resources: the planet's score, and later what it trades with other planets.
  // Production is scaled by stability, so a peaceful planet out-produces a troubled one.
  resources: Resources = { food: 0, wood: 0, stone: 0, metal: 0, gold: 0, herbs: 0 };
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
    this.farm = new Uint8Array(this.n);
    this.terrain = new Uint8Array(this.n);
    this.deposit = new Uint8Array(this.n);
    this.owner = new Int8Array(this.n).fill(-1);
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
      if (t === T.Rock && vein > 0.66 - 0.04 * k) this.deposit[f] = vein > 0.72 - 0.03 * k ? D.Gold : D.Metal;
      else if ((t === T.Grass || t === T.Desert) && this.elevation[f] > 0.25 && vein > 0.7 - 0.03 * k) this.deposit[f] = D.Gold;
      else if (t === T.Forest && vein > 0.64 - 0.04 * k) this.deposit[f] = D.Herbs;
    }
    this.version++;
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

  // Start 2-5 nations, each with a small band of people as far apart as the land allows.
  seedNations(count = 2 + Math.floor(Math.random() * 4), peoplePerNation = 10) {
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
    this.nations = starts.map((_, i) => ({ id: i, name: `the ${NATION_HUES[i]} tribe`, color: NATION_COLORS[i], policy: "settle" as Policy, faith: 50, stability: 70, recentDeaths: 0, alive: true }));
    const k = this.nations.length;
    this.relation = Array.from({ length: k }, () => new Array<Relation>(k).fill("peace"));
    this.tension = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) this.tension[a][b] = this.tension[b][a] = 30 + Math.random() * 20;
    this.contact = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    starts.forEach((f, i) => {
      for (let j = 0; j < peoplePerNation; j++) this.spawnNear(f, i);
    });
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
    this.stepFire(dt);
    this.stepFood(dt);
    this.stepPeople(dt);
    this.stepVillages(dt);
    this.stepNations(dt);
    this.stepNeeds(dt);
    this.maybeDisaster(dt);
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
      p.age += dt;
      p.hunger -= (pol === "hoard" ? 0.035 : 0.05) * dt;
      p.t += dt / STEP_TIME;
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
        const t = this.terrain[p.face] as T;
        if (p.hunger > 0.9 && this.food[p.face] > 0.2) {
          this.food[p.face] -= 0.1;
          this.resources.food += 0.1 * peace * this.type.yield.food;
        }
        const y = this.type.yield;
        if (t === T.Forest) this.resources.wood += 0.03 * peace * y.wood;
        if (t === T.Rock) this.resources.stone += 0.05 * peace * y.stone;
        const d = this.deposit[p.face] as D;
        if (d === D.Metal) this.resources.metal += 0.06 * peace * y.metal;
        if (d === D.Gold) this.resources.gold += 0.03 * peace * y.gold;
        if (d === D.Herbs) this.resources.herbs += 0.02 * peace * y.herbs;
      }

      // War: fight any enemy on this tile or the next one. Either side may fall.
      if (p.age > 16) {
        for (let k = -1; k < 3; k++) {
          const f = k < 0 ? p.face : this.neighbours[p.face * 3 + k];
          const foe = at.get(f)?.find((q) => q.hunger > 0 && this.atWar(p.nation, q.nation));
          if (foe && Math.random() < 0.35) {
            // The more stable nation fights a little better.
            const pWins = Math.random() < 0.5 + (nt.stability - this.nations[foe.nation].stability) / 400;
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
        else if (free && (this.terrain[p.face] === T.Grass || this.terrain[p.face] === T.Forest || this.terrain[p.face] === T.Sand)) p.village = this.foundVillage(p.face, p.nation).id;
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
      if (p.hunger > 0.55 && p.age > 16 && p.age < 45 && Math.random() < (home ? 0.09 : 0.05) * STEP_TIME * BIRTHS[pol] && this.people.length + born.length < MAX_PEOPLE) {
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
        else if (!claimed && (this.terrain[p.face] === T.Grass || this.terrain[p.face] === T.Forest) && Math.random() < (pol === "expand" ? 0.15 : 0.04)) {
          const v = this.foundVillage(p.face, p.nation);
          p.village = v.id;
        }
      }
    }
    this.people = this.people.filter((p) => {
      if (p.hunger > 0 && p.age < 55 + (p.id % 25) + Math.min(20, this.resources.herbs / 20)) return true;
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
    const v: Village = { id: this.nextId++, face, name: `${this.nationName(nation).replace(/^the /, "")} village ${count}`, residents: 1, houses: 1, nation };
    this.villages.push(v);
    this.events.push({ kind: "village", detail: `${this.nationName(nation)} founded a new village (${count} now).`, nation });
    return v;
  }

  private stepVillages(dt: number) {
    const counts = new Map<number, number>();
    for (const p of this.people) if (p.village !== null) counts.set(p.village, (counts.get(p.village) ?? 0) + 1);
    let farmsChanged = false;
    const farm = new Uint8Array(this.n);
    this.villages = this.villages.filter((v) => {
      v.residents = counts.get(v.id) ?? 0;
      if (v.residents === 0 && v.houses <= 1) return false; // abandoned
      const target = Math.min(16, Math.ceil(v.residents / 3));
      if (v.houses < target && Math.random() < 0.05) v.houses++;
      else if (v.houses > target && Math.random() < 0.01) v.houses--;
      // Farmland grows with the village: the home tile and rings around it.
      let ring = [v.face];
      const rings = Math.min(3, Math.floor(v.houses / 3)) + (this.nations[v.nation].policy === "farm" ? 1 : 0);
      for (let r = 0; r <= rings; r++) {
        const nextRing: number[] = [];
        for (const f of ring) {
          if (!isWater(this.terrain[f] as T) && this.terrain[f] !== T.Rock && this.terrain[f] !== T.Snow) farm[f] = 1;
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
    const owner = new Int8Array(this.n).fill(-1);
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
          v.name = `${v.name.replace(/ village \d+$/, "")} (taken by ${this.nationName(n)})`;
          break;
        }
      }
    }
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
      const decay = nt.policy === "worship" ? 0.15 : nt.policy === "rebel" ? 1.5 : 0.5;
      nt.faith = Math.max(0, nt.faith - decay * dt);
      // Rebels burn the god's shrines now and then.
      const mine = this.villages.filter((v) => v.nation === nt.id);
      if (nt.policy === "rebel" && mine.length && Math.random() < 0.03 * dt) this.ignite(this.neighbours[mine[Math.floor(Math.random() * mine.length)].face * 3]);
      nt.recentDeaths *= Math.pow(0.85, dt); // fades over a few seconds
      const wars = this.relation[nt.id].filter((r) => r === "war").length;
      const target =
        (nt.policy === "worship" ? 50 : 40) + Math.min(30, mine.length * 4) + (food - 50) * 0.4 - Math.min(40, nt.recentDeaths * 1.5) - wars * 15 + this.tradePartners(nt.id) * 5;
      nt.stability = Math.max(0, Math.min(100, nt.stability + (target - nt.stability) * 0.15 * dt));
    }
  }

  // Random natural disasters, not caused by the god (though the people may blame them).
  // Rare at first; the more people there are, the more there is to hit.
  private nextDisaster = 40 + Math.random() * 40; // years until the next one

  private maybeDisaster(dt: number) {
    this.nextDisaster -= dt;
    if (this.nextDisaster > 0 || this.people.length < 20) return;
    this.nextDisaster = 35 + Math.random() * 55;
    // Usually aim near people, so the disaster matters.
    const target = this.people.length && Math.random() < 0.75 ? this.people[Math.floor(Math.random() * this.people.length)].face : Math.floor(Math.random() * this.n);
    const roll = Math.random();
    const before = this.people.length;
    let kind: string;
    if (roll < 0.35) {
      kind = "lightning";
      this.ignite(target);
      for (let k = 0; k < 3; k++) this.ignite(this.neighbours[target * 3 + k]);
    } else if (roll < 0.6) {
      kind = "drought";
      for (const [f] of this.tilesNear(target, 0.2)) {
        this.moisture[f] = Math.max(0, this.moisture[f] - 0.15);
        this.food[f] *= 0.4;
        this.classify(f);
      }
    } else if (roll < 0.8) {
      kind = "earthquake";
      for (const [f, w] of this.tilesNear(target, 0.12)) {
        this.elevation[f] = Math.max(-1, Math.min(1, this.elevation[f] + (Math.random() - 0.5) * 0.25 * w));
        this.classify(f);
      }
      this.villages = this.villages.filter((v) => this.angle(v.face, target) > 0.05 || Math.random() < 0.5);
      this.killWhere((p) => isWater(this.terrain[p.face] as T));
    } else if (roll < 0.92) {
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
      const medicine = Math.min(0.8, this.resources.herbs / 200);
      this.killWhere((p) => this.angle(p.face, target) < 0.25 && Math.random() < 0.5 * (1 - medicine));
    }
    const dead = before - this.people.length;
    const hit = this.nationsIn(this.tilesNear(target, 0.2).map(([f]) => f));
    for (const id of hit) this.nations[id].stability -= 8;
    this.version++;
    this.events.push({ kind: "disaster", detail: `A natural ${kind} struck${dead ? `, killing ${dead} people` : ""}. The god did not cause it.`, nation: [...hit][0] });
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
    if (n.faith < 5) return "cult";
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
      needs: this.nationNeeds(nt.id),
      crisis: this.crisis(nt.id),
      relations: this.nations
        .filter((o) => o.id !== nt.id && o.alive)
        .map((o) => ({ id: o.id, relation: this.relation[nt.id][o.id], tension: Math.round(this.tension[nt.id][o.id]) })),
    }));
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
