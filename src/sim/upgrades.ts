// Upgrades the god can buy for the whole planet with stockpiled resources (track 3).
// Each has 3 levels; every level costs 2.5x the last. PlanetSim reads `level(id)` where
// the effect applies, so each upgrade changes a number you can see in the sim.
import type { Resources } from "@/types/world";

export type UpgradeId = "irrigation" | "stone" | "medicine" | "smithing" | "temples" | "markets" | "army";

export interface Upgrade {
  id: UpgradeId;
  name: string;
  icon: string;
  effect: string; // per level, shown in the panel
  cost: Partial<Resources>; // level 1; later levels scale up
}

export const MAX_LEVEL = 3;

export const UPGRADES: Upgrade[] = [
  { id: "irrigation", name: "Irrigation", icon: "💧", effect: "+30% crop regrowth and harvests", cost: { wood: 40 } },
  { id: "stone", name: "Stone houses", icon: "🧱", effect: "+6 stability, quakes and floods destroy less", cost: { stone: 25, wood: 20 } },
  { id: "medicine", name: "Medicine", icon: "🌿", effect: "+8 years of life, half as much plague", cost: { herbs: 25 } },
  { id: "smithing", name: "Smithing", icon: "⚒️", effect: "+30% wood, stone and metal gathered", cost: { metal: 20, wood: 30 } },
  { id: "temples", name: "Temples", icon: "🛕", effect: "Faith fades 25% slower", cost: { gold: 20, stone: 15 } },
  { id: "markets", name: "Markets", icon: "⚖️", effect: "Trade partners produce +15% more, tension eases", cost: { gold: 15, food: 60 } },
  { id: "army", name: "Army", icon: "🛡️", effect: "+10 military strength; wars burn out faster", cost: { metal: 35, food: 80 } },
];

export function upgradeCost(u: Upgrade, level: number): Partial<Resources> {
  const k = Math.pow(2.5, level); // level = how many already bought
  return Object.fromEntries(Object.entries(u.cost).map(([r, n]) => [r, Math.round((n as number) * k)]));
}

export function canAfford(have: Resources, cost: Partial<Resources>) {
  return Object.entries(cost).every(([r, n]) => have[r as keyof Resources] >= (n as number));
}

// How much each resource counts towards the planet's output score.
export const VALUE: Resources = { food: 1, wood: 1, stone: 2, metal: 3, gold: 5, herbs: 3 };
