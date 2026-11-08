"use client";

import { useState } from "react";
import { fleetSecondsLeft, type Fleet } from "./InvasionFleets";

// How much of the army to send: more soldiers hit harder, but more can die and fewer stay home to defend.
const SHARES = [
  { share: 0.25, label: "25%" },
  { share: 0.5, label: "50%" },
  { share: 1, label: "All" },
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

export function GalaxyInvasion({
  enabled,
  alone,
  planets,
  spacefaring,
  onInvade,
  military = 0,
  outgoing = [],
}: {
  enabled: boolean | null;
  alone: boolean;
  planets: InvasionPlanet[];
  spacefaring: boolean;
  onInvade: (target: string, share: number) => Promise<string>;
  military?: number;
  outgoing?: Fleet[];
}) {
  const [share, setShare] = useState(0.5);
  const flying = outgoing.find((f) => fleetSecondsLeft(f) > 0);
  const [selected, setSelected] = useState<InvasionPlanet | null>(null);
  const [invasionResult, setInvasionResult] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const launch = async () => {
    if (!selected || launching) return;
    setLaunching(true);
    setInvasionResult(null);
    try {
      const result = await onInvade(selected.world_id, share);
      window.setTimeout(() => {
        setInvasionResult(result);
        setLaunching(false);
      }, 900);
    } catch {
      setInvasionResult("The invasion could not be launched.");
      setLaunching(false);
    }
  };

  if (!enabled || alone) return null;
  return (
    <>
      {!spacefaring && <p className="mb-2 text-xs text-white/45">Invading unlocks when your people reach the Space Age.</p>}
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, index) => {
          const planet = planets[index];
          const active = !!planet && spacefaring;
          const isSelected = planet && selected?.world_id === planet.world_id;
          return (
            <article
              key={planet?.world_id ?? `offline-${index}`}
              className={`relative aspect-square min-w-0 overflow-hidden rounded-xl border p-3 text-left transition ${
                planet
                  ? isSelected
                    ? "border-rose-300/60 bg-rose-400/15 shadow-[0_0_24px_rgba(251,113,133,0.12)]"
                    : "border-white/10 bg-white/[0.04] hover:border-rose-300/30 hover:bg-white/[0.07]"
                  : "border-white/[0.05] bg-black/10 opacity-35"
              }`}
            >
              {planet ? (
                <button
                  type="button"
                  disabled={!active || launching}
                  onClick={() => {
                    setSelected(planet);
                    setInvasionResult(null);
                  }}
                  className="absolute inset-0 flex w-full flex-col items-center justify-between p-3 text-center disabled:cursor-not-allowed"
                >
                  <span className="relative h-16 w-16 shrink-0 rounded-full border border-white/10 shadow-[inset_-10px_-8px_18px_rgba(0,0,0,0.55),0_8px_20px_rgba(0,0,0,0.25)]"
                    style={{ background: planetPlanetStyle(planet.planet_type) }}
                  >
                    <span className="absolute left-3 top-3 h-2 w-5 -rotate-12 rounded-full bg-white/20 blur-[1px]" />
                  </span>
                  <span className="min-w-0 w-full">
                    <span className="block truncate text-sm font-bold text-white">{planet.planet_name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-white/45">{planet.owner_name}</span>
                    <span className="mt-2 flex items-center justify-center gap-2 text-[10px] text-white/55">
                      <span>{planet.military} military</span>
                      <span>{planet.population} ppl</span>
                    </span>
                  </span>
                </button>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="mb-2 h-12 w-12 rounded-full border border-dashed border-white/15" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-white/35">Offline</span>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {selected && (
        <div className="mt-4 overflow-hidden rounded-xl border border-rose-300/15 bg-[#120d18]/80">
          <div className="relative h-32 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_65%,rgba(251,113,133,0.16),transparent_32%)]" />
            <div className={`absolute left-[18%] top-[42%] h-3 w-3 rounded-full ${launching ? "animate-pulse" : ""}`}
              style={{ background: "#f8fafc", boxShadow: "0 0 18px rgba(248,250,252,.8)" }}
            />
            <div className={`absolute right-[18%] top-[34%] h-12 w-12 rounded-full border border-white/10 shadow-[inset_-8px_-5px_14px_rgba(0,0,0,.55),0_0_20px_rgba(251,113,133,.12)] ${launching ? "animate-pulse" : ""}`}
              style={{ background: planetPlanetStyle(selected.planet_type) }}
            />
            {launching && (
              <>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 pt-3">
            <span className="text-xs text-white/50">Send</span>
            <div className="flex flex-1 gap-1" role="radiogroup" aria-label="Fleet size">
              {SHARES.map((o) => (
                <button
                  key={o.share}
                  type="button"
                  role="radio"
                  aria-checked={share === o.share}
                  disabled={launching}
                  onClick={() => setShare(o.share)}
                  className={`flex-1 rounded-md px-2 py-1 text-xs transition ${share === o.share ? "bg-rose-400/25 text-rose-50 ring-1 ring-rose-300/50" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
                >
                  {o.label} <span className="tabular-nums text-white/45">({Math.round(military * o.share)})</span>
                </button>
              ))}
            </div>
          </div>
          {flying && (
            <p className="px-4 pt-2 text-xs text-amber-200">
              🚀 {flying.fleet} soldiers on their way to {flying.to_name}: landing in <span className="tabular-nums">{fleetSecondsLeft(flying)}s</span>
            </p>
          )}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs text-white/40">Target</p>
              <p className="truncate text-sm font-semibold text-white">{selected.planet_name}</p>
              {invasionResult && <p className="mt-1 text-xs text-sky-200/80">{invasionResult}</p>}
            </div>
            <button
              type="button"
              disabled={launching || !spacefaring || !!flying}
              onClick={() => void launch()}
              className="shrink-0 rounded-lg border border-rose-300/25 bg-rose-400/20 px-4 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-400/30 disabled:cursor-wait disabled:opacity-50"
            >
              {launching ? "Fleet in flight…" : invasionResult ? "Invade again" : "Launch invasion"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function planetPlanetStyle(type: string) {
  const styles: Record<string, string> = {
    Verdant: "linear-gradient(135deg,#6cc49b,#1e6654 58%,#102e28)",
    Timberworld: "linear-gradient(135deg,#88a86a,#365f38 58%,#182718)",
    Ironworld: "linear-gradient(135deg,#a8a29e,#595452 58%,#282629)",
    Gilded: "linear-gradient(135deg,#f3ce75,#9b7431 58%,#4a3517)",
    Archipelago: "linear-gradient(135deg,#74c4c1,#27718a 58%,#18364d)",
  };
  return styles[type] ?? "linear-gradient(135deg,#8fb0c9,#3d596c 58%,#1d2933)";
}
