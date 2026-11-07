"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Resources } from "@/types/world";

interface GalaxyProps {
  ownerName: string;
  planetName: string;
  planetType: string;
  population: number;
  villages: number;
  output: number;
  military: number;
  resources: Resources;
}

interface PlanetRow {
  world_id: string;
  owner_name: string;
  planet_name: string;
  planet_type: string;
  population: number;
  villages: number;
  output: number;
  military: number;
  resources: Resources;
  updated_at: string;
}

const WORLD_KEY = "arda-world-id";
const TOKEN_KEY = "arda-owner-token";

function stored(key: string, create = false) {
  const current = localStorage.getItem(key);
  if (current) return current;
  if (!create) return "";
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

export default function Galaxy(props: GalaxyProps) {
  const worldId = useRef(stored(WORLD_KEY, true));
  const ownerToken = useRef(stored(TOKEN_KEY, true));
  const propsRef = useRef(props);
  propsRef.current = props;
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [planets, setPlanets] = useState<PlanetRow[]>([]);
  const [resource, setResource] = useState<keyof Resources>("gold");
  const [amount, setAmount] = useState(10);
  const [message, setMessage] = useState("");
  const setupFailed = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/galaxy?worldId=${encodeURIComponent(worldId.current)}`);
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      if (!res.ok) {
        setupFailed.current = true;
        setMessage(data.error || "Galaxy database setup failed");
      } else {
        setupFailed.current = false;
      }
      if (data.planets) setPlanets(data.planets);
    } catch {
      setEnabled(false);
      setupFailed.current = true;
    }
  }, []);

  const sync = useCallback(async () => {
    if (setupFailed.current) return;
    const current = propsRef.current;
    const hash = [...worldId.current].reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
    const payload = {
      action: "sync",
      worldId: worldId.current,
      ownerToken: ownerToken.current,
      ownerName: current.ownerName,
      planetName: current.planetName,
      planetType: current.planetType,
      population: current.population,
      villages: current.villages,
      output: current.output,
      military: current.military,
      resources: current.resources,
      positionX: Math.abs((hash & 0xffff) / 0xffff),
      positionY: Math.abs(((hash >>> 16) & 0xffff) / 0xffff),
    };
    try {
      await fetch("/api/galaxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await load();
    } catch {
      setEnabled(false);
    }
  }, [load]);

  useEffect(() => {
    sync();
    const timer = window.setInterval(sync, 5000);
    const supabase = getSupabase();
    const channel = supabase?.channel("galaxy-planets").on("postgres_changes", { event: "*", schema: "public", table: "planets" }, load).subscribe();
    return () => {
      window.clearInterval(timer);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [sync, load]);

  const act = async (action: "trade" | "invasion", targetWorldId: string) => {
    setMessage("Resolving...");
    const res = await fetch("/api/galaxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        worldId: worldId.current,
        ownerToken: ownerToken.current,
        targetWorldId,
        resource,
        amount,
      }),
    });
    const data = await res.json();
    setMessage(data.message || data.error || "Galaxy action failed");
    await sync();
  };

  return (
    <>
      <button onClick={() => setOpen((x) => !x)} className="glass pointer-events-auto fixed bottom-4 left-[17.5rem] z-20 px-4 py-2 text-sm font-semibold transition hover:bg-white/10">
        🌐 Galaxy
      </button>
      {open && (
        <aside className="glass absolute bottom-16 left-[17.5rem] z-30 max-h-[65vh] w-[22rem] overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-semibold">Other gods&apos; planets</p>
            <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white">✕</button>
          </div>
          {enabled === false && <p className="text-sm text-amber-200">Supabase is not configured. Add the environment variables and run the migration.</p>}
          {enabled && planets.length === 0 && <p className="text-sm text-white/50">No other planets yet. Open this app in another browser to create one.</p>}
          <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
            <select value={resource} onChange={(e) => setResource(e.target.value as keyof Resources)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm">
              {(["food", "wood", "stone", "metal", "gold", "herbs"] as const).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-24 rounded-lg bg-white/10 px-3 py-2 text-sm" />
          </div>
          {message && <p className="mb-3 text-xs text-sky-200">{message}</p>}
          <div className="space-y-2">
            {planets.map((planet) => (
              <article key={planet.world_id} className="rounded-lg bg-white/5 p-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-semibold">{planet.planet_name}</p>
                    <p className="text-xs text-white/50">{planet.planet_type} · ruled by {planet.owner_name}</p>
                  </div>
                  <span className="text-xs text-white/50">⚔ {planet.military}</span>
                </div>
                <p className="mt-1 text-xs text-white/60">{planet.population} people · {planet.output}/yr</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => act("trade", planet.world_id)} className="flex-1 rounded bg-emerald-400/15 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-400/25">Trade {amount}</button>
                  <button onClick={() => act("invasion", planet.world_id)} className="flex-1 rounded bg-rose-400/15 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-400/25">Invade</button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
