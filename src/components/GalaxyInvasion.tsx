"use client";
// The war room: pick a planet in your galaxy, size the fleet, see the odds, launch, and watch it fly.
import { useState } from "react";
import { FLIGHT_SECONDS, fleetSecondsLeft, type Fleet } from "./InvasionFleets";
import { invasionBonus, PLANET_TYPES, type PlanetSim } from "@/sim/planet";

// How much of the army to send: more soldiers hit harder, but fewer stay home to defend.
const SHARES = [
  { share: 0.25, label: "Raid", hint: "25%" },
  { share: 0.5, label: "Assault", hint: "50%" },
  { share: 1, label: "All in", hint: "100%" },
];

export interface InvasionPlanet {
  world_id: string;
  owner_name: string;
  planet_name: string;
  planet_type: string;
  population: number;
  output: number;
  military: number;
}

// Chance that attack beats defence when the database rolls 0.8-1.2 dice on each side (settle_invasions).
function winChance(att: number, def: number) {
  if (def <= 0) return att > 0 ? 1 : 0;
  let wins = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) if (att * (0.8 + (0.4 * (i + 0.5)) / 24) > def * (0.8 + (0.4 * (j + 0.5)) / 24)) wins++;
  return wins / 576;
}

function Orb({ type, size = 64, glow }: { type: string; size?: number; glow?: string }) {
  return (
    <span
      className="relative block shrink-0 rounded-full border border-white/10"
      style={{
        width: size,
        height: size,
        background: planetStyle(type),
        boxShadow: `inset -${size / 6}px -${size / 8}px ${size / 3.5}px rgba(0,0,0,.6), 0 0 ${size / 2.5}px ${glow ?? "rgba(0,0,0,.3)"}`,
      }}
    >
      <span className="absolute rounded-full bg-white/25 blur-[1px]" style={{ left: size * 0.2, top: size * 0.18, width: size * 0.3, height: size * 0.1, transform: "rotate(-15deg)" }} />
    </span>
  );
}

function Matchup({ mine, theirs }: { mine: string; theirs: string }) {
  const b = invasionBonus(mine, theirs);
  if (b > 1) return <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 ring-1 ring-emerald-300/25">▲ Advantage ×1.5</span>;
  if (b < 1) return <span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] font-semibold text-rose-200 ring-1 ring-rose-300/25">▼ Disadvantage ×0.67</span>;
  return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/50 ring-1 ring-white/10">Even match</span>;
}

export function GalaxyInvasion({
  enabled,
  alone,
  planets,
  spacefaring,
  onInvade,
  sim,
  outgoing = [],
}: {
  enabled: boolean | null;
  alone: boolean;
  planets: InvasionPlanet[];
  spacefaring: boolean;
  onInvade: (target: string, share: number) => Promise<string>;
  sim: PlanetSim;
  outgoing?: Fleet[];
}) {
  const [share, setShare] = useState(0.5);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const flying = outgoing.find((f) => fleetSecondsLeft(f) > 0);
  const selected = planets.find((p) => p.world_id === selectedId) ?? null;
  const myType = sim.type.name;
  const army = sim.soldiers();
  const fleet = Math.round(army * share);
  const battle = sim.lastBattle;

  const launch = async () => {
    if (!selected || launching) return;
    setLaunching(true);
    setResult(null);
    try {
      setResult(await onInvade(selected.world_id, share));
    } catch {
      setResult("The invasion could not be launched.");
    }
    setLaunching(false);
  };

  if (!enabled || alone) return null;

  // Rough odds: the database uses the target's reported defence, which is at least their army.
  const attack = sim.invasionAttack(fleet) * (selected ? invasionBonus(myType, selected.planet_type) : 1);
  const chance = selected ? winChance(attack, Math.max(1, selected.military)) : 0;
  const verdict = chance > 0.8 ? ["Likely victory", "text-emerald-300", "bg-emerald-400"] : chance > 0.45 ? ["Coin flip", "text-amber-200", "bg-amber-300"] : ["Long odds", "text-rose-300", "bg-rose-400"];
  const weak = PLANET_TYPES.find((t) => t.name === myType)?.weakTo;

  return (
    <div className="space-y-4">
      {/* Our side */}
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-gradient-to-r from-indigo-500/10 to-transparent p-3">
        <Orb type={myType} size={40} glow="rgba(129,140,248,.35)" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-200/70">Your army</p>
          <p className="text-sm text-white">
            <b className="tabular-nums">{army}</b> soldiers ready <span className="text-white/40">· {myType}</span>
          </p>
        </div>
        {weak && <p className="hidden max-w-[11rem] text-right text-[10px] leading-snug text-white/40 sm:block">Strong against {PLANET_TYPES.find((t) => t.weakTo === myType)?.name}, weak to {weak}</p>}
      </div>
      {!spacefaring && <p className="text-xs text-amber-200/70">Your people have not reached the Space Age yet.</p>}

      {/* Targets */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: Math.max(4, planets.length) }, (_, i) => {
          const p = planets[i];
          if (!p)
            return (
              <div key={`empty-${i}`} className="flex aspect-[4/5] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-[10px] uppercase tracking-widest text-white/25">
                <span className="mb-2 h-10 w-10 rounded-full border border-dashed border-white/15" />
                Empty orbit
              </div>
            );
          const on = p.world_id === selectedId;
          return (
            <button
              key={p.world_id}
              type="button"
              disabled={launching}
              onClick={() => {
                setSelectedId(p.world_id);
                setResult(null);
              }}
              className={`group flex aspect-[4/5] flex-col items-center justify-between rounded-xl border p-3 text-center transition ${
                on ? "border-rose-300/60 bg-rose-500/15 shadow-[0_0_30px_rgba(251,113,133,.2)]" : "border-white/10 bg-white/[0.04] hover:-translate-y-0.5 hover:border-rose-300/30 hover:bg-white/[0.07]"
              }`}
            >
              <span className="transition group-hover:scale-105">
                <Orb type={p.planet_type} size={56} glow={on ? "rgba(251,113,133,.45)" : undefined} />
              </span>
              <span className="w-full min-w-0">
                <span className="block truncate text-sm font-bold text-white">{p.planet_name}</span>
                <span className="block truncate text-[10px] text-white/45">
                  {p.owner_name} · {p.planet_type}
                </span>
                <span className="mt-1.5 flex justify-center gap-2 text-[10px] tabular-nums text-white/60">
                  <span title="Army">⚔️ {p.military}</span>
                  <span title="People">👥 {p.population}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Fleet in flight: a ship crossing from our planet to theirs */}
      {flying && (
        <div className="relative overflow-hidden rounded-xl border border-amber-300/20 bg-[#140f08]/80 p-4">
          <div className="flex items-center justify-between">
            <Orb type={myType} size={34} />
            <div className="relative mx-3 h-px flex-1 border-t border-dashed border-amber-200/30">
              <span
                className="absolute -top-3 text-lg transition-[left] duration-1000 ease-linear"
                style={{ left: `calc(${Math.min(100, ((FLIGHT_SECONDS - fleetSecondsLeft(flying)) / FLIGHT_SECONDS) * 100)}% - 0.6rem)`, filter: "drop-shadow(0 0 6px rgba(251,191,36,.8))" }}
              >
                🚀
              </span>
            </div>
            <Orb type={planets.find((p) => p.world_id === flying.to_world_id)?.planet_type ?? ""} size={34} glow="rgba(251,113,133,.4)" />
          </div>
          <p className="mt-3 text-center text-xs text-amber-100">
            <b>{flying.fleet}</b> soldiers bound for <b>{flying.to_name}</b> · landing in <b className="tabular-nums">{fleetSecondsLeft(flying)}s</b>
          </p>
          {flying.answer !== "fight" && <p className="mt-1 text-center text-[11px] text-sky-200/80">{flying.answer === "shields" ? "🛡️ They raised their shields." : "💰 They chose to pay tribute."}</p>}
        </div>
      )}

      {/* Battle plan */}
      {selected && !flying && (
        <div className="overflow-hidden rounded-xl border border-rose-300/20 bg-[radial-gradient(ellipse_at_top,rgba(251,113,133,.12),transparent_60%),#120d18]">
          <div className="flex items-center justify-between gap-3 px-4 pt-4">
            <div className="flex items-center gap-3">
              <Orb type={selected.planet_type} size={44} glow="rgba(251,113,133,.4)" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-rose-200/70">Target</p>
                <p className="text-base font-bold text-white">{selected.planet_name}</p>
              </div>
            </div>
            <Matchup mine={myType} theirs={selected.planet_type} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 px-4" role="radiogroup" aria-label="Fleet size">
            {SHARES.map((o) => (
              <button
                key={o.share}
                type="button"
                role="radio"
                aria-checked={share === o.share}
                disabled={launching}
                onClick={() => setShare(o.share)}
                className={`rounded-lg px-2 py-2 text-left transition ${share === o.share ? "bg-rose-400/20 ring-1 ring-rose-300/50" : "bg-white/5 hover:bg-white/10"}`}
              >
                <span className="block text-xs font-semibold text-white">{o.label}</span>
                <span className="block text-[10px] tabular-nums text-white/50">
                  {Math.round(army * o.share)} soldiers · {o.hint}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 px-4">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-white/50">
                Your attack <b className="tabular-nums text-white">{Math.round(attack)}</b> vs their army <b className="tabular-nums text-white">{selected.military}</b>
              </span>
              <span className={`font-semibold ${verdict[1]}`}>
                {verdict[0]} · {Math.round(chance * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${verdict[2]} transition-all`} style={{ width: `${Math.max(3, chance * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-[10px] text-white/35">They see you coming: they get {FLIGHT_SECONDS}s to fight, pay tribute or raise shields.</p>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <p className="min-w-0 text-xs text-sky-200/80">{result}</p>
            <button
              type="button"
              disabled={launching || fleet < 1}
              onClick={() => void launch()}
              className="shrink-0 rounded-xl bg-gradient-to-r from-rose-500 to-orange-400 px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(244,63,94,.35)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {launching ? "Launching…" : `🚀 Launch ${fleet}`}
            </button>
          </div>
        </div>
      )}
      {!selected && !flying && planets.length > 0 && <p className="text-center text-xs text-white/40">Pick a planet to plan an invasion.</p>}

      {/* Last battle */}
      {battle && (
        <div className={`flex items-start gap-3 rounded-xl border p-3 ${battle.won ? "border-emerald-300/20 bg-emerald-400/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
          <span className="text-xl">{battle.icon}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">{battle.title}</p>
            <p className="text-[11px] leading-snug text-white/55">{battle.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function planetStyle(type: string) {
  const styles: Record<string, string> = {
    Verdant: "radial-gradient(circle at 30% 30%,#8ee0b5,#1e6654 55%,#0b211d)",
    Timberworld: "radial-gradient(circle at 30% 30%,#a9c787,#365f38 55%,#121d12)",
    Ironworld: "radial-gradient(circle at 30% 30%,#cfc9c4,#595452 55%,#1c1a1d)",
    Gilded: "radial-gradient(circle at 30% 30%,#ffe29a,#9b7431 55%,#36260f)",
    Archipelago: "radial-gradient(circle at 30% 30%,#9fe3e0,#27718a 55%,#0f2638)",
  };
  return styles[type] ?? "radial-gradient(circle at 30% 30%,#b6cde0,#3d596c 55%,#141d24)";
}
