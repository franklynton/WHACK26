"use client";
// The main game screen: planet in the middle, god tools and needs on the left,
// the civ and its chronicle on the right. Integration point for all four tracks.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChronicleKind, Civ, GodActionKind, World } from "@/types/world";
import { applyGod, newWorld, population, tick } from "@/lib/sim";

const Planet = dynamic(() => import("@/components/Planet"), { ssr: false });

const TOOLS: { kind: GodActionKind; label: string; icon: string }[] = [
  { kind: "water", label: "Flood", icon: "🌊" },
  { kind: "mountain", label: "Raise mountain", icon: "⛰️" },
  { kind: "drought", label: "Drought", icon: "☀️" },
  { kind: "miracle", label: "Miracle", icon: "✨" },
];

const TICK_MS = 2000;
const YEARS_PER_TICK = 5;

export default function Home() {
  const [world, setWorld] = useState<World>(() => newWorld(crypto.randomUUID(), "You"));
  const [tool, setTool] = useState<GodActionKind>("miracle");
  const [thinking, setThinking] = useState(false);
  const worldRef = useRef(world);
  worldRef.current = world;

  // Ask the narrator how the civ reacts, then merge in the new civ and chronicle entry.
  const narrate = useCallback(async (w: World, kind: ChronicleKind, detail = "") => {
    setThinking(true);
    try {
      const res = await fetch("/api/narrate", { method: "POST", body: JSON.stringify({ world: w, kind, detail }) });
      const { civ, entry } = (await res.json()) as { civ: Civ; entry: World["chronicle"][number] };
      setWorld((cur) => ({ ...cur, civ, chronicle: [...cur.chronicle, entry].slice(-40) }));
    } finally {
      setThinking(false);
    }
  }, []);

  // Genesis once, on load.
  useEffect(() => {
    narrate(worldRef.current, "genesis");
  }, [narrate]);

  // Time passes. A new crisis gets narrated once when it starts.
  useEffect(() => {
    const id = setInterval(() => {
      const before = worldRef.current;
      const after = tick(before, YEARS_PER_TICK);
      setWorld((cur) => ({ ...after, civ: cur.civ, chronicle: cur.chronicle }));
      if (after.crisis && after.crisis !== before.crisis) narrate(after, after.crisis);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [narrate]);

  const act = (regionId: number) => {
    if (thinking) return;
    const next = applyGod(world, { kind: tool, regionId });
    setWorld(next);
    narrate(next, tool, `The god used "${tool}" on region ${regionId} (now ${next.regions[regionId].terrain}).`);
  };

  const civ = world.civ;
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        <Planet regions={world.regions} onPick={act} />
      </div>

      <aside className="glass absolute left-4 top-4 w-64 space-y-4 p-4">
        <div>
          <p className="label">Year {world.year}</p>
          <p className="text-2xl font-semibold">{civ?.name ?? "…"}</p>
          <p className="text-sm text-white/60">Population {population(world).toLocaleString()}</p>
        </div>
        <Needs world={world} />
        <div className="grid grid-cols-2 gap-2">
          {TOOLS.map((t) => (
            <button key={t.kind} onClick={() => setTool(t.kind)} className={`tool ${tool === t.kind ? "tool-on" : ""}`}>
              <span className="text-lg">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/50">Pick a power, then click the planet.</p>
      </aside>

      <aside className="glass absolute bottom-4 right-4 top-4 flex w-80 flex-col p-4">
        {civ && (
          <div className="mb-3 space-y-1 border-b border-white/10 pb-3 text-sm">
            <p>
              <span className="label">Religion</span> {civ.religion.name}
            </p>
            <p className="text-white/70">
              They call you <b>{civ.religion.godName}</b>. {civ.religion.belief}
            </p>
            <p>
              <span className="label">Attitude</span> {civ.attitude}
            </p>
          </div>
        )}
        <p className="label mb-2">Chronicle {thinking && <span className="animate-pulse">· writing…</span>}</p>
        <ol className="flex-1 space-y-3 overflow-y-auto text-sm">
          {[...world.chronicle].reverse().map((c, i) => (
            <li key={world.chronicle.length - i}>
              <span className="text-white/40">Year {c.year} · </span>
              {c.text}
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}

function Needs({ world }: { world: World }) {
  const bars: [string, number][] = [
    ["Food", world.needs.food],
    ["Faith", world.needs.faith],
    ["Stability", world.needs.stability],
  ];
  return (
    <div className="space-y-2">
      {bars.map(([name, v]) => (
        <div key={name}>
          <div className="flex justify-between text-xs text-white/70">
            <span>{name}</span>
            <span>{Math.round(v)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10">
            <div className={`h-full rounded-full ${v < 25 ? "bg-rose-400" : "bg-sky-300"}`} style={{ width: `${v}%` }} />
          </div>
        </div>
      ))}
      {world.crisis && <p className="text-sm font-semibold uppercase tracking-wide text-rose-300">{world.crisis}</p>}
    </div>
  );
}
