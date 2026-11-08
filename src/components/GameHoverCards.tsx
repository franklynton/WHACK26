"use client";

import { ERAS, RACE } from "@/sim/races";
import type { Civ, NationInfo, Needs, Policy, Relation } from "@/types/world";

const cap = (value: string) => value[0].toUpperCase() + value.slice(1);

const POLICY_LABEL: Record<Policy, string> = {
  settle: "Settling down",
  expand: "Expanding",
  farm: "Farming",
  worship: "Worshipping you",
  explore: "Exploring",
  hoard: "Hoarding",
  rebel: "Rebelling",
};

const RELATION_STYLE: Record<Relation, { icon: string; cls: string; label: string }> = {
  peace: { icon: "·", cls: "text-white/40", label: "at peace" },
  trade: { icon: "🤝", cls: "text-emerald-300", label: "trading" },
  rival: { icon: "😠", cls: "text-amber-300", label: "rivals" },
  war: { icon: "⚔️", cls: "text-rose-300", label: "at war" },
};

function NeedBars({ needs, love }: { needs: Needs; love?: number }) {
  const bars: [string, number][] = [
    ["Food", needs.food],
    ["Stability", needs.stability],
    ...(love != null ? [["Love for you", love] as [string, number]] : []),
  ];
  return (
    <div className="mt-1 mb-4 space-y-2.5 border-t border-white/10 pt-2">
      {bars.map(([name, value]) => (
        <div key={name}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="hud-meta-label text-white/65">{name}</span>
            <span className="text-[11px] font-semibold tabular-nums text-white/65">
              {Math.round(value)}
            </span>
          </div>
          <div className="h-1 rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all ${value < 25 ? "bg-rose-400" : "bg-sky-300"}`}
              style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NationHoverCard({
  nation,
  civ,
  all,
  x,
  y,
}: {
  nation: NationInfo;
  civ: Civ | null;
  all: NationInfo[];
  x: number;
  y: number;
}) {
  const left = Math.min(x + 16, window.innerWidth - 260);
  const top = Math.min(y + 16, window.innerHeight - 260);
  return (
    <div className="glass pointer-events-none fixed z-10 w-60 space-y-2 p-3 text-sm" style={{ left, top }}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: nation.color }} />
        <p className="font-semibold">{cap(nation.name)}</p>
        {nation.crisis && (
          <span className="ml-auto text-xs font-semibold uppercase text-rose-300">{nation.crisis}</span>
        )}
      </div>
      <p className="text-xs text-white/60">
        {RACE[nation.race].icon} {RACE[nation.race].name} · {ERAS[nation.era]} · led by {nation.leader.title} {nation.leader.name}
      </p>
      {civ && (
        <p className="text-xs text-white/60">
          {cap(civ.demonym)} · worship {civ.religion.godName} ({civ.religion.name}) · feel {civ.attitude}
        </p>
      )}
      <p className="text-xs text-white/70">
        {nation.alive
          ? `${nation.population} people · ${nation.villages} ${nation.villages === 1 ? "village" : "villages"} · ${POLICY_LABEL[nation.policy].toLowerCase()}`
          : "Fallen"}
      </p>
      <NeedBars needs={nation.needs} />
      {nation.relations.length > 0 && (
        <div className="flex flex-wrap gap-x-2 text-xs">
          {nation.relations.map((relation) => (
            <span key={relation.id} className={RELATION_STYLE[relation.relation].cls}>
              {RELATION_STYLE[relation.relation].icon} {RELATION_STYLE[relation.relation].label} with {cap(all[relation.id].name)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
