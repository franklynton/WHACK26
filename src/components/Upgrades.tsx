"use client";
// The upgrades drawer (track 3): spend the planet's stockpile on upgrades for every nation.
import { useState } from "react";
import {
  MAX_LEVEL,
  UPGRADES,
  VALUE,
  canAfford,
  upgradeCost,
  type UpgradeId,
} from "@/sim/upgrades";
import type { Resources } from "@/types/world";

export const RESOURCE_ICON: Record<keyof Resources, string> = {
  food: "🌾",
  wood: "🪵",
  stone: "🪨",
  metal: "⚙️",
  gold: "🪙",
  herbs: "🌿",
};

export function affordableCount(
  resources: Resources,
  levels: Record<UpgradeId, number>,
) {
  return UPGRADES.filter(
    (u) =>
      levels[u.id] < MAX_LEVEL &&
      canAfford(resources, upgradeCost(u, levels[u.id])),
  ).length;
}

const KINDS = Object.keys(RESOURCE_ICON) as (keyof Resources)[];

export default function Upgrades({
  resources,
  levels,
  onBuy,
  onBarter,
}: {
  resources: Resources;
  levels: Record<UpgradeId, number>;
  onBuy: (id: UpgradeId) => void;
  onBarter: (
    from: keyof Resources,
    to: keyof Resources,
    amount: number,
  ) => void;
}) {
  const [from, setFrom] = useState<keyof Resources>("wood");
  const [to, setTo] = useState<keyof Resources>("metal");
  const amount = Math.max(10, Math.round((VALUE[to] * 20) / VALUE[from]) * 2); // enough to get ~20 value
  const get = Math.floor((amount * VALUE[from] * 0.5) / VALUE[to]);
  return (
    <div className="glass pointer-events-auto w-full max-w-3xl p-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {UPGRADES.map((u) => {
          const level = levels[u.id];
          const maxed = level >= MAX_LEVEL;
          const cost = upgradeCost(u, level);
          const ok = !maxed && canAfford(resources, cost);
          return (
            <div key={u.id} className="rounded-lg bg-white/5 p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{u.icon}</span>
                <span className="font-semibold">{u.name}</span>
                <span className="ml-auto text-xs tracking-widest text-sky-300">
                  {"●".repeat(level) + "○".repeat(MAX_LEVEL - level)}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/55">{u.effect}</p>
              <div className="mt-2 flex items-center gap-2">
                {maxed ? (
                  <span className="text-xs text-white/40">Fully built</span>
                ) : (
                  <span className="flex flex-wrap gap-x-2 text-xs tabular-nums">
                    {Object.entries(cost).map(([r, n]) => (
                      <span
                        key={r}
                        className={
                          resources[r as keyof Resources] >= (n as number)
                            ? "text-white/80"
                            : "text-rose-300"
                        }
                      >
                        {RESOURCE_ICON[r as keyof Resources]} {n}
                      </span>
                    ))}
                  </span>
                )}
                <button
                  disabled={!ok}
                  onClick={() => onBuy(u.id)}
                  className="ml-auto rounded-md bg-sky-400 px-2.5 py-0.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-300 disabled:bg-white/10 disabled:text-white/30"
                >
                  {maxed ? "Max" : "Build"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {/* Merchants: a poor exchange rate, so trading with other planets is worth it */}
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/5 p-2.5 text-sm">
        <span className="font-semibold">🐪 Merchants</span>
        <span className="text-xs text-white/50">swap at half value</span>
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value as keyof Resources)}
          className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-xs"
        >
          {KINDS.map((k) => (
            <option key={k} value={k} className="bg-slate-900">
              {RESOURCE_ICON[k]} {k}
            </option>
          ))}
        </select>
        <span className="text-xs">→</span>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value as keyof Resources)}
          className="rounded bg-white/10 px-1.5 py-0.5 text-xs"
        >
          {KINDS.map((k) => (
            <option key={k} value={k} className="bg-slate-900">
              {RESOURCE_ICON[k]} {k}
            </option>
          ))}
        </select>
        <button
          disabled={from === to || resources[from] < amount || get <= 0}
          onClick={() => onBarter(from, to, amount)}
          className="rounded-md bg-amber-300 px-2.5 py-0.5 text-xs font-semibold text-slate-950 hover:bg-amber-200 disabled:bg-white/10 disabled:text-white/30"
        >
          Give {amount} {RESOURCE_ICON[from]} for {get} {RESOURCE_ICON[to]}
        </button>
      </div>
    </div>
  );
}
