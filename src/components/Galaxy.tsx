"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";

// Multiplayer: every planet syncs a snapshot to the shared galaxy (Supabase, through /api/galaxy) every few
// seconds. Once your nation reaches the Space Age you can send resources to, or invade, other gods' planets.
// Trades and invasions are settled by SQL functions; each game then applies the result to its own sim.

interface PlanetRow {
  world_id: string;
  owner_name: string;
  planet_name: string;
  planet_type: string;
  population: number;
  output: number;
  military: number;
}

interface Action {
  id: number;
  source_world_id: string;
  target_world_id: string;
  action_type: "trade" | "invasion";
  payload: { resource?: keyof Resources; amount?: number; won?: boolean };
  message: string;
}

const RESOURCES = ["food", "wood", "stone", "metal", "gold", "herbs"] as const;

// A random id kept in this browser, so a player keeps one planet row (and the secret token that owns it).
function stored(key: string) {
  try {
    const current = localStorage.getItem(key);
    if (current) return current;
    const value = crypto.randomUUID();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

export default function Galaxy({ sim, ownerName, planetName, open, onClose }: { sim: PlanetSim; ownerName: string; planetName: string; open: boolean; onClose: () => void }) {
  const ids = useRef<{ world: string; token: string } | null>(null);
  const since = useRef<number | null>(null);
  const names = useRef(new Map<string, string>());
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [planets, setPlanets] = useState<PlanetRow[]>([]);
  const [resource, setResource] = useState<keyof Resources>("gold");
  const [amount, setAmount] = useState(10);
  const [message, setMessage] = useState("");

  const me = () => (ids.current ??= { world: stored("arda-world-id"), token: stored("arda-owner-token") });

  // Trades and invasions that involve us land in our sim (the other side's game applies its half).
  const apply = useCallback(
    (a: Action) => {
      const mine = a.source_world_id === me().world;
      const other = names.current.get(mine ? a.target_world_id : a.source_world_id) ?? "another planet";
      if (a.action_type === "trade" && a.payload.resource && a.payload.amount) sim.galaxyTrade(a.payload.resource, mine ? -a.payload.amount : a.payload.amount, other);
      if (a.action_type === "invasion" && a.payload.won) {
        if (mine) sim.galaxyTrade("gold", 20, other);
        else sim.invadedFromSpace(other, 20);
      }
    },
    [sim],
  );

  const load = useCallback(async () => {
    try {
      const q = `worldId=${encodeURIComponent(me().world)}${since.current != null ? `&since=${since.current}` : ""}`;
      const res = await fetch(`/api/galaxy?${q}`);
      const data = await res.json();
      setEnabled(Boolean(data.enabled) && res.ok);
      if (!res.ok) return setMessage(data.error || "Galaxy database setup failed");
      for (const p of data.planets as PlanetRow[]) names.current.set(p.world_id, p.planet_name);
      setPlanets(data.planets);
      if (since.current != null) (data.actions as Action[]).forEach(apply);
      since.current = data.lastActionId ?? since.current;
    } catch {
      setEnabled(false);
    }
  }, [apply]);

  const sync = useCallback(async () => {
    const s = sim.stats();
    const { world, token } = me();
    const hash = [...world].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
    try {
      const res = await fetch("/api/galaxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync", worldId: world, ownerToken: token, ownerName, planetName, planetType: s.planetType,
          population: s.population, villages: s.villages, output: Math.round(sim.output), military: sim.military(), resources: s.resources,
          positionX: (hash & 0xffff) / 0xffff, positionY: ((hash >>> 16) & 0xffff) / 0xffff,
        }),
      });
      if (res.status === 503) return setEnabled(false);
      await load();
    } catch {
      setEnabled(false);
    }
  }, [sim, ownerName, planetName, load]);

  useEffect(() => {
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => window.clearInterval(timer);
  }, [sync]);

  const act = async (action: "trade" | "invasion", target: string) => {
    if (action === "trade" && sim.resources[resource] < amount) return setMessage(`You only have ${Math.floor(sim.resources[resource])} ${resource}.`);
    setMessage("Your ships set off...");
    await sync(); // so the galaxy knows what we hold right now
    const { world, token } = me();
    const res = await fetch("/api/galaxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, worldId: world, ownerToken: token, targetWorldId: target, resource, amount }),
    });
    const data = await res.json();
    setMessage(data.message || data.error || "Galaxy action failed");
    await load(); // picks up the completed action and applies our half of it
  };

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass max-h-[80vh] w-[28rem] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xl font-bold">🌌 The galaxy</p>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mb-3 text-sm text-white/65">Your people have left {planetName}. Send resources to other gods&apos; planets, or invade them for gold.</p>
        {enabled === false && <p className="mb-3 text-sm text-amber-200">{message || "The galaxy is offline: Supabase isn't configured yet."}</p>}
        {enabled && planets.length === 0 && <p className="text-sm text-white/50">No other planets are online. Open Arda in another browser to make one.</p>}
        {enabled && planets.length > 0 && (
          <>
            <div className="mb-3 flex gap-2">
              <select value={resource} onChange={(e) => setResource(e.target.value as keyof Resources)} className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm">
                {RESOURCES.map((r) => (
                  <option key={r} value={r} className="bg-slate-900">
                    {r} (you have {Math.floor(sim.resources[r])})
                  </option>
                ))}
              </select>
              <input type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value)) || 1))} className="w-24 rounded-lg bg-white/10 px-3 py-2 text-sm" />
            </div>
            {message && <p className="mb-3 text-xs text-sky-200">{message}</p>}
            <div className="space-y-2">
              {planets.map((p) => (
                <article key={p.world_id} className="rounded-lg bg-white/5 p-3">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-semibold">{p.planet_name}</p>
                      <p className="text-xs text-white/50">
                        {p.planet_type} · god: {p.owner_name}
                      </p>
                    </div>
                    <span className="text-xs text-white/50">⚔ {p.military}</span>
                  </div>
                  <p className="mt-1 text-xs text-white/60">
                    {p.population} people · {p.output}/yr
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => act("trade", p.world_id)} className="flex-1 rounded bg-emerald-400/15 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-400/25">
                      Send {amount} {resource}
                    </button>
                    <button onClick={() => act("invasion", p.world_id)} className="flex-1 rounded bg-rose-400/15 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-400/25">
                      Invade
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
