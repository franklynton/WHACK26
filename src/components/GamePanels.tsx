"use client";

import type { RefObject } from "react";
import type { PlanetSim } from "@/sim/planet";
import { GOAL_YEAR, UPGRADES } from "@/sim/planet";
import { ERAS, RACE } from "@/sim/races";
import type { GalaxyStatus } from "./Galaxy";
import type {
  Crisis,
  NationInfo,
  Needs,
  Policy,
  Relation,
  Resources,
} from "@/types/world";

export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const POLICY_LABEL: Record<Policy, string> = {
  settle: "Settling down",
  expand: "Expanding",
  farm: "Farming",
  worship: "Worshipping you",
  explore: "Exploring",
  hoard: "Hoarding",
  rebel: "Rebelling",
};

const RELATION_STYLE: Record<
  Relation,
  { icon: string; cls: string; label: string }
> = {
  peace: { icon: "·", cls: "text-white/40", label: "at peace" },
  trade: { icon: "🤝", cls: "text-emerald-300", label: "trading" },
  rival: { icon: "😠", cls: "text-amber-300", label: "rivals" },
  war: { icon: "⚔️", cls: "text-rose-300", label: "at war" },
};

export function NationList({
  nations,
  selected,
  expanded,
  onSelect,
  onToggle,
  onFocus,
}: {
  nations: NationInfo[];
  selected: number;
  expanded: number | null;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onFocus: (id: number) => void;
}) {
  const alive = nations.filter((nation) => nation.alive).length;
  const fallen = nations.length - alive;
  return (
    <div>
      <p className="label mb-1.5">
        Nations ({alive})
        {fallen > 0 && (
          <span className="normal-case text-white/40"> · {fallen} fallen</span>
        )}
      </p>
      <ul className="space-y-1">
        {nations
          .filter((nation) => nation.alive)
          .map((nation) => (
            <li key={nation.id}>
              <div
                className={`overflow-hidden rounded-lg transition ${
                  selected === nation.id ? "bg-white/15" : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center">
                  <button
                    onClick={() => {
                      onSelect(nation.id);
                      onFocus(nation.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
                    title={`Focus ${cap(nation.name)}`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: nation.color }}
                    />
                    <span title={RACE[nation.race].name}>
                      {RACE[nation.race].icon}
                    </span>
                    <span className="flex-1 truncate font-medium">
                      {cap(nation.name)}
                    </span>
                    <span className="hidden max-w-16 truncate text-xs text-amber-200/60 sm:block">
                      {ERAS[nation.era]}
                    </span>
                    <span className="text-xs tabular-nums text-white/50">
                      {nation.population}
                    </span>
                  </button>
                  <button
                    onClick={() => onToggle(nation.id)}
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs text-white/45 transition hover:bg-white/10 hover:text-white/80"
                    aria-expanded={expanded === nation.id}
                    aria-label={`${expanded === nation.id ? "Hide" : "Show"} details for ${cap(nation.name)}`}
                  >
                    <span
                      className={`transition-transform ${
                        expanded === nation.id ? "rotate-180" : ""
                      }`}
                    >
                      ▾
                    </span>
                  </button>
                </div>
                {expanded === nation.id && (
                  <div className="mx-2 mb-2 border-t border-white/10 px-1 pt-2 text-xs text-white/60">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {nation.villages}{" "}
                        {nation.villages === 1 ? "village" : "villages"}
                      </span>
                      <span>{POLICY_LABEL[nation.policy]}</span>
                      {!!nation.ships && <span>⚓ {nation.ships} ships</span>}
                      {nation.crisis && (
                        <span className="font-semibold uppercase text-rose-300">
                          {nation.crisis}
                        </span>
                      )}
                    </div>
                    <p className="mt-1">
                      {nation.leader.title} {nation.leader.name}
                    </p>
                    {nation.relations.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {nation.relations.map((relation) => (
                          <span
                            key={relation.id}
                            className={`rounded-md px-1.5 py-0.5 ${
                              RELATION_STYLE[relation.relation].cls
                            }`}
                            title={`${RELATION_STYLE[relation.relation].label}, tension ${relation.tension}`}
                          >
                            {RELATION_STYLE[relation.relation].icon}{" "}
                            {cap(nations[relation.id].name)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function SettingsPopover({
  open,
  onToggle,
  panelRef,
  onClose,
  demo,
  onNewPlanet,
  onGalaxy,
  muted,
  onMute,
  link,
}: {
  open: boolean;
  onToggle: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  demo?: boolean;
  onNewPlanet?: () => void;
  onGalaxy: () => void;
  muted: boolean;
  onMute: () => void;
  link: GalaxyStatus;
}) {
  return (
    <div ref={panelRef} className="relative shrink-0">
      <button
        onClick={onToggle}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
      >
        ⚙️
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-white/10 bg-[#111827]/90 p-2 shadow-2xl backdrop-blur-xl">
          {onNewPlanet && (
            <button
              onClick={() => {
                onClose();
                if (
                  demo ||
                  confirm("Start over on a new planet? This planet will be lost.")
                ) {
                  onNewPlanet();
                }
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <span>🪐</span>
              <span>{demo ? "Exit demo" : "New planet"}</span>
            </button>
          )}
          <button
            onClick={() => {
              onClose();
              onGalaxy();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <span>🌌</span>
            <span>Galaxy</span>
          </button>
          <div className="mx-2 my-1 h-px bg-white/10" />
          <button
            onClick={onMute}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label={muted ? "Turn sound on" : "Mute"}
          >
            <span>{muted ? "🔇" : "🔊"}</span>
            <span>{muted ? "Sound off" : "Mute"}</span>
          </button>
          <div
            className={`mx-2 mt-1 flex items-center gap-2 rounded-lg px-1 py-2 text-xs ${
              link.enabled && link.members ? "text-emerald-200" : "text-white/45"
            }`}
          >
            <span
              className={`ml-0.5 h-2 w-2 rounded-full ${
                link.enabled && link.members
                  ? "bg-emerald-400"
                  : link.enabled
                    ? "bg-white/50"
                    : "bg-white/30"
              }`}
            />
            <span>
              {!link.enabled
                ? "Offline"
                : link.galaxy
                  ? `${link.members}/5 gods online`
                  : link.members
                    ? `${link.members} gods online`
                    : "Solo"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function UpgradeMenu({
  sim,
  resources,
  onUpgrade,
}: {
  sim: PlanetSim;
  resources: Resources;
  onUpgrade: () => void;
}) {
  const icons: Record<keyof Resources, string> = {
    food: "🌾",
    wood: "🪵",
    stone: "🪨",
    metal: "⚙️",
    gold: "🪙",
    herbs: "🌿",
  };
  return (
    <section
      className="glass absolute left-[17.5rem] top-[14.5rem] z-30 w-96 max-w-[calc(100vw-20rem)] p-4 shadow-2xl"
      aria-label="World upgrades"
    >
      <div className="mb-3 flex items-start justify-between border-b border-white/10 pb-3">
        <div>
          <p className="text-lg font-bold">World upgrades</p>
          <p className="text-xs text-white/55">
            Invest your stockpile to shape the planet’s future.
          </p>
        </div>
        <span className="rounded-full bg-amber-300/15 px-2 py-1 text-[10px] font-semibold text-amber-200">
          PERMANENT
        </span>
      </div>
      <div className="space-y-2">
        {UPGRADES.map((upgrade) => {
          const level = sim.upgrades[upgrade.id];
          const cost = upgrade.costs[level];
          const affordable =
            !!cost &&
            Object.entries(cost).every(
              ([resource, amount]) =>
                resources[resource as keyof Resources] >= amount,
            );
          return (
            <div
              key={upgrade.id}
              className={`rounded-xl border p-3 transition ${
                affordable
                  ? "border-emerald-300/40 bg-emerald-300/10"
                  : "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-xl">{upgrade.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{upgrade.name}</p>
                    <span className="text-[11px] text-white/50">
                      Lv {level}/{upgrade.max}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-white/60">
                    {upgrade.description}
                  </p>
                  {cost ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(cost).map(([resource, amount]) => (
                        <span
                          key={resource}
                          className={`rounded bg-black/20 px-1.5 py-0.5 text-[11px] tabular-nums ${
                            resources[resource as keyof Resources] >= amount
                              ? "text-emerald-200"
                              : "text-rose-300"
                          }`}
                        >
                          {icons[resource as keyof Resources]} {amount}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">
                      Fully upgraded
                    </p>
                  )}
                </div>
                {cost && (
                  <button
                    disabled={!affordable}
                    onClick={() => {
                      if (sim.purchaseUpgrade(upgrade.id)) onUpgrade();
                    }}
                    className="shrink-0 rounded-lg bg-emerald-300/20 px-2.5 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-300/35 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
