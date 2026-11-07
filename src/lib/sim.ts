// Simulation: creating a world, needs decay, god actions and crises.
// Pure functions (world in, new world out), so they run anywhere and are easy to test.
// Track B owns this file; the numbers here are first guesses to tune.
import { REGION_COUNT, type Crisis, type GodAction, type Needs, type Region, type Terrain, type World } from "@/types/world";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const START_TERRAIN: Terrain[] = ["ocean", "ocean", "ocean", "ocean", "plains", "plains", "plains", "forest", "forest", "mountain", "desert", "plains"];
const FERTILITY: Record<Terrain, number> = { ocean: 0, plains: 70, forest: 50, mountain: 15, desert: 5 };

export function newWorld(id: string, ownerName: string): World {
  const regions: Region[] = Array.from({ length: REGION_COUNT }, (_, i) => {
    const terrain = START_TERRAIN[i];
    return { id: i, terrain, fertility: FERTILITY[terrain], population: terrain === "plains" ? 40 : 0 };
  });
  return { id, ownerName, year: 0, regions, needs: { food: 70, faith: 50, stability: 70 }, crisis: null, civ: null, chronicle: [] };
}

export const population = (w: World) => w.regions.reduce((n, r) => n + r.population, 0);

// Advance time. Called on a timer by the client (e.g. every 2 seconds = 5 years).
export function tick(w: World, years: number): World {
  const pop = population(w);
  const growable = w.regions.reduce((n, r) => n + (r.population > 0 ? r.fertility : 0), 0);
  const needs: Needs = {
    // Food rises with fertile settled land and falls as the population grows.
    food: clamp(w.needs.food + years * (growable / 100 - pop / 200)),
    // Faith slowly fades unless the god does something.
    faith: clamp(w.needs.faith - years * 0.8),
    // Stability drifts towards the average of food and faith.
    stability: clamp(w.needs.stability + years * ((w.needs.food + w.needs.faith) / 2 - w.needs.stability) * 0.05),
  };
  // People grow where there is food, and spread to neighbouring fertile land.
  const growth = needs.food > 40 ? 1.02 : needs.food < 15 ? 0.95 : 1;
  const regions = w.regions.map((r) => ({
    ...r,
    population: r.fertility > 0 ? Math.round((r.population || (pop > 0 && r.fertility > 40 ? 2 : 0)) * growth ** years) : 0,
  }));
  const next = { ...w, year: w.year + years, needs, regions };
  return { ...next, crisis: detectCrisis(next) };
}

function detectCrisis(w: World): Crisis | null {
  if (w.needs.food < 15) return "famine";
  if (w.needs.stability < 20) return "revolution";
  if (w.needs.faith < 10) return "cult"; // they decide the absent god is evil
  return null;
}

// Apply what the player did. The narrator is then asked how the civ reacts.
export function applyGod(w: World, a: GodAction): World {
  const regions = w.regions.map((r) => {
    if (r.id !== a.regionId) return r;
    switch (a.kind) {
      case "water":
        return { ...r, terrain: "ocean" as const, fertility: 0, population: 0 };
      case "mountain":
        return { ...r, terrain: "mountain" as const, fertility: FERTILITY.mountain };
      case "drought":
        return { ...r, terrain: "desert" as const, fertility: FERTILITY.desert };
      case "miracle":
        return { ...r, terrain: r.terrain === "ocean" ? r.terrain : ("plains" as const), fertility: Math.min(100, r.fertility + 40) };
    }
  });
  const faith = { water: 10, mountain: 10, drought: 15, miracle: 25 }[a.kind];
  const food = a.kind === "miracle" ? 20 : a.kind === "drought" ? -20 : 0;
  const needs = { ...w.needs, faith: clamp(w.needs.faith + faith), food: clamp(w.needs.food + food) };
  return { ...w, regions, needs };
}
