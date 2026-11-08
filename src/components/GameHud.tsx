"use client";

import type { RefObject } from "react";
import type { PlanetSim } from "@/sim/planet";
import { GOAL_YEAR, SECONDS_PER_YEAR } from "@/sim/planet";
import type { Resources } from "@/types/world";
import type { Hud } from "./Game";
import { UpgradeMenu } from "./GamePanels";

const cap = (value: string) => value[0].toUpperCase() + value.slice(1);

export function PlanetSummary({
  hud,
  sim,
  playerName,
  planetName,
  demo,
}: {
  hud: Hud;
  sim: PlanetSim;
  playerName: string;
  planetName: string;
  demo?: boolean;
}) {
  const year = Math.floor(hud.year / SECONDS_PER_YEAR);
  const love = Math.round(hud.god.avgLove);
  const mine = hud.nations[0];

  return (
    <div>
      <p className="label">
        Year {year} · God: {playerName}
        {demo && (
          <span className="ml-1.5 rounded bg-indigo-400/25 px-1.5 py-0.5 text-[10px] font-bold text-indigo-100">
            DEMO {sim.pace}x
          </span>
        )}
      </p>
      <p className="truncate text-2xl font-semibold" title={planetName}>
        {planetName}
      </p>
      <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-sky-200/90">
            {sim.type.name} world
          </span>
          <span className="text-[10px] uppercase tracking-wider text-amber-200/60">
            {sim.type.hazard} risk
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-white/55">
          {sim.type.blurb}
        </p>
        <p
          className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] leading-snug text-white/45"
          title="Between planets: armies from this kind of world beat yours"
        >
          <span className="font-semibold text-white/60">
            Weak to {sim.type.weakTo}.
          </span>{" "}
          {sim.type.weakWhy}
        </p>
      </div>
      <div className="my-2 flex gap-2">
        <div
          className="flex-1 rounded-lg bg-sky-400/15 px-2.5 py-1.5"
          title="Resources produced per year, weighted by value. Peace and trade raise it."
        >
          <p className="text-[10px] uppercase tracking-wider text-sky-200/70">
            Output / yr
          </p>
          <p className="text-xl font-bold tabular-nums">
            {hud.output.toLocaleString()}
          </p>
        </div>
        <div
          className="flex-1 rounded-lg bg-white/5 px-2.5 py-1.5"
          title="Military strength: one in five of your people can fight."
        >
          <p className="text-[10px] uppercase tracking-wider text-white/50">
            Military
          </p>
          <p className="text-xl font-bold tabular-nums">{hud.military}</p>
        </div>
      </div>
      <div
        className="mb-2 rounded-lg bg-amber-300/10 px-2.5 py-1.5"
        title="Nations earn devotion through worship and love."
      >
        <p className="text-[10px] uppercase tracking-wider text-amber-200/70">
          Devotion
        </p>
        <p className="text-xl font-bold tabular-nums">
          ✨ {Math.floor(hud.god.devotion)}
        </p>
      </div>
      <div
        className="mb-2 rounded-lg border border-white/10 px-2.5 py-2 text-xs"
        title="Lose if your people fall, or if every nation comes to hate you."
      >
        <p className="text-[10px] uppercase tracking-wider text-white/50">Goal</p>
        <p className="text-white/80">
          Keep {mine ? cap(mine.name) : "your people"} alive to Year {GOAL_YEAR},
          loved by the nations.
        </p>
        <div className="mt-1.5 flex justify-between text-white/60">
          <span>Year {Math.min(year, GOAL_YEAR)}/{GOAL_YEAR}</span>
          <span
            className={
              love >= 50 ? "text-emerald-300" : love < 25 ? "text-rose-300" : "text-amber-200"
            }
          >
            Love {love}/50
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-sky-300"
            style={{ width: `${Math.min(100, (year / GOAL_YEAR) * 100)}%` }}
          />
        </div>
      </div>
      <p className="text-sm text-white/60">
        {hud.stats.population.toLocaleString()} people · {hud.stats.villages}{" "}
        {hud.stats.villages === 1 ? "village" : "villages"}
      </p>
    </div>
  );
}

const TIP_ALIGN = {
  left: "left-0",
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};

function Stock({
  icon,
  label,
  info,
  value,
  align = "center",
}: {
  icon: string;
  label: string;
  info: string;
  value: number;
  align?: keyof typeof TIP_ALIGN;
}) {
  return (
    <div className="group relative cursor-help rounded-lg bg-white/5 py-1.5" aria-label={`${label}: ${info}`}>
      <div>{icon}</div>
      <div className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className={`pointer-events-none absolute top-full z-50 mt-1.5 w-44 ${TIP_ALIGN[align]} rounded-lg border border-white/15 bg-[#0d1424] px-2.5 py-2 text-left opacity-0 shadow-xl transition-opacity group-hover:opacity-100`}>
        <p className="text-xs font-semibold">{icon} {label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/70">{info}</p>
      </div>
    </div>
  );
}

export function ResourcePanel({
  resources,
  sim,
  open,
  panelRef,
  menuRef,
  onToggle,
  onRefresh,
  availableUpgrades,
}: {
  resources: Resources;
  sim: PlanetSim;
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onRefresh: () => void;
  availableUpgrades: number;
}) {
  return (
    <div ref={panelRef} className="glass absolute left-[17.5rem] top-4 z-20 w-72 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="label">Resources</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stock align="left" icon="🌾" label="Food" info="Harvested by well-fed people from nearby land." value={resources.food} />
        <Stock icon="🪵" label="Wood" info="Cut from forests around towns." value={resources.wood} />
        <Stock align="right" icon="🪨" label="Stone" info="Quarried from rocky mountainsides." value={resources.stone} />
        <Stock align="left" icon="⚙️" label="Metal" info="Mined from ore in the mountains." value={resources.metal} />
        <Stock icon="🪙" label="Gold" info="Mined at gold deposits." value={resources.gold} />
        <Stock align="right" icon="🌿" label="Herbs" info="Medicinal plants gathered in forests." value={resources.herbs} />
      </div>
      <button
        onClick={onToggle}
        className={`mt-3 flex w-full items-center border-t border-white/10 pt-2 text-left text-xs font-semibold transition hover:text-white ${open ? "text-amber-100" : "text-sky-200/90"}`}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          <span>Upgrades</span>
          {availableUpgrades > 0 && (
            <span className="upgrade-available-dot h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" aria-label={`${availableUpgrades} upgrades available`} />
          )}
        </span>
      </button>
      {open && (
        <div ref={menuRef}>
          <UpgradeMenu sim={sim} resources={resources} onUpgrade={onRefresh} />
        </div>
      )}
    </div>
  );
}

export function OutcomeDialog({
  outcome,
  onKeepWatching,
  onNewPlanet,
}: {
  outcome: NonNullable<Hud["god"]["outcome"]>;
  onKeepWatching: () => void;
  onNewPlanet?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-[26rem] p-6 text-center">
        <div className="text-5xl">{outcome.won ? "🏆" : "🌑"}</div>
        <h2 className="mt-3 text-2xl font-bold">{outcome.title}</h2>
        <p className="mt-2 text-sm text-white/75">{outcome.text}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onKeepWatching} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
            Keep watching
          </button>
          <button onClick={() => onNewPlanet ? onNewPlanet() : location.reload()} className="rounded-lg bg-sky-400/30 px-4 py-2 text-sm font-semibold hover:bg-sky-400/40">
            New planet
          </button>
        </div>
      </div>
    </div>
  );
}
