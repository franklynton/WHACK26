"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";
import { PUBLIC, cleanGalaxy, getGalaxy, setGalaxy, shareLink } from "@/lib/galaxyCode";

// Multiplayer: every planet syncs a snapshot to the shared galaxy (Supabase, through /api/galaxy) every few
// seconds. Once your nation reaches the Space Age you can send resources to, or invade, other gods' planets.
// Trades and invasions are settled by SQL functions; each game then applies the result to its own sim.
// Planets only meet planets with the same galaxy code (lib/galaxyCode.ts).

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

export interface GalaxyStatus {
  enabled: boolean | null; // null until the first answer from the server
  online: number; // other planets online in this galaxy
  galaxy: string;
}

export default function Galaxy({
  sim, ownerName, planetName, demo, open, onClose, onStatus,
}: { sim: PlanetSim; ownerName: string; planetName: string; demo?: boolean; open: boolean; onClose: () => void; onStatus?: (s: GalaxyStatus) => void }) {
  const ids = useRef<{ world: string; token: string } | null>(null);
  const since = useRef<number | null>(null);
  const names = useRef(new Map<string, string>());
  const seen = useRef<Set<string> | null>(null); // planets met so far, to announce newcomers
  const [galaxy, setGalaxyCode] = useState(getGalaxy);
  const [codes, setCodes] = useState(true); // false until migration 003 is run: everyone shares one galaxy
  const [draft, setDraft] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [planets, setPlanets] = useState<PlanetRow[]>([]);
  const [resource, setResource] = useState<keyof Resources>("gold");
  const [amount, setAmount] = useState(10);
  const [message, setMessage] = useState("");

  // The demo is a separate planet, so it gets its own row in the galaxy.
  const tag = useRef(demo ? "-demo" : "");
  const me = () => (ids.current ??= { world: stored(`arda-world-id${tag.current}`), token: stored(`arda-owner-token${tag.current}`) });

  // Trades and invasions that involve us land in our sim (the other side's game applies its half).
  const apply = useCallback(
    (a: Action) => {
      const mine = a.source_world_id === me().world;
      const other = names.current.get(mine ? a.target_world_id : a.source_world_id) ?? "another planet";
      if (a.action_type === "trade" && a.payload.resource && a.payload.amount) sim.galaxyTrade(a.payload.resource, mine ? -a.payload.amount : a.payload.amount, other);
      if (a.action_type === "invasion") {
        if (a.payload.won) {
          if (mine) sim.galaxyLoot(20, other);
          else sim.invadedFromSpace(other, 20);
        } else if (mine) sim.galaxyNews("🛡️", "Repelled", `${other}'s defenders drove your fleet back.`);
        else sim.galaxyNews("🛡️", "Invasion repelled", `A fleet from ${other} attacked, and your people drove it off.`);
      }
    },
    [sim],
  );

  const load = useCallback(async () => {
    try {
      const q = `worldId=${encodeURIComponent(me().world)}&galaxy=${galaxy}${since.current != null ? `&since=${since.current}` : ""}`;
      const res = await fetch(`/api/galaxy?${q}`);
      const data = await res.json();
      setEnabled(Boolean(data.enabled) && res.ok);
      if (!res.ok) return setMessage(data.error || "Galaxy database setup failed");
      const rows = data.planets as PlanetRow[];
      for (const p of rows) names.current.set(p.world_id, p.planet_name);
      // Announce gods who arrive after we do (not the ones already here when we joined).
      if (seen.current) for (const p of rows) if (!seen.current.has(p.world_id)) sim.galaxyNews("🛸", "A new god appears", `${p.owner_name} and the planet ${p.planet_name} have joined the galaxy.`, false);
      seen.current = new Set([...(seen.current ?? []), ...rows.map((p) => p.world_id)]);
      setPlanets(rows);
      setCodes(data.codes !== false);
      if (since.current != null) (data.actions as Action[]).forEach(apply);
      since.current = data.lastActionId ?? since.current;
    } catch {
      setEnabled(false);
    }
  }, [apply, galaxy, sim]);

  const sync = useCallback(async () => {
    const s = sim.stats();
    const { world, token } = me();
    const hash = [...world].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
    try {
      const res = await fetch("/api/galaxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync", worldId: world, ownerToken: token, ownerName, planetName, planetType: s.planetType, galaxy,
          population: s.population, villages: s.villages, output: Math.round(sim.output), military: sim.military(), resources: s.resources,
          positionX: (hash & 0xffff) / 0xffff, positionY: ((hash >>> 16) & 0xffff) / 0xffff,
        }),
      });
      if (res.status === 503) return setEnabled(false);
      await load();
    } catch {
      setEnabled(false);
    }
  }, [sim, ownerName, planetName, galaxy, load]);

  useEffect(() => {
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => window.clearInterval(timer);
  }, [sync]);

  // The HUD shows whether we're connected and how many gods are online.
  useEffect(() => {
    onStatus?.({ enabled, online: enabled ? planets.length : 0, galaxy: codes ? galaxy : PUBLIC });
  }, [enabled, planets.length, galaxy, codes, onStatus]);

  const join = (code: string) => {
    const g = setGalaxy(code);
    seen.current = null; // a new galaxy: the gods already there aren't newcomers
    setPlanets([]);
    setGalaxyCode(g);
    setDraft("");
    setMessage(g === PUBLIC ? "You're in the open galaxy." : `You're in galaxy ${g}. Share the code so others can join.`);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(galaxy));
      setMessage("Link copied.");
    } catch {
      setMessage(shareLink(galaxy));
    }
  };

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
        {enabled && (
          <div className="mb-3 rounded-lg bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                Galaxy <span className="font-mono font-bold text-indigo-200">{galaxy === PUBLIC ? "open" : galaxy}</span>
                <span className="text-white/50"> · {planets.length} other {planets.length === 1 ? "god" : "gods"} online</span>
              </p>
              {galaxy !== PUBLIC && (
                <button onClick={copyLink} className="text-xs text-sky-300 hover:text-sky-200">
                  Copy link
                </button>
              )}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                join(draft);
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
                placeholder="Galaxy code, e.g. NOTTS"
                className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 font-mono text-sm uppercase placeholder:normal-case placeholder:font-sans"
              />
              <button disabled={!draft || cleanGalaxy(draft) === galaxy} className="rounded-lg bg-indigo-400/25 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-400/40 disabled:opacity-40">
                Join
              </button>
              {galaxy !== PUBLIC && (
                <button type="button" onClick={() => join(PUBLIC)} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
                  Leave
                </button>
              )}
            </form>
            {message && <p className="mt-2 text-xs text-sky-200">{message}</p>}
            {!codes && galaxy !== PUBLIC && <p className="mt-2 text-xs text-amber-200">Galaxy codes need migration 003 in Supabase. Until then, everyone shares the open galaxy.</p>}
          </div>
        )}
        {enabled === false && <p className="mb-3 text-sm text-amber-200">{message || "The galaxy is offline: Supabase isn't configured yet."}</p>}
        {enabled && planets.length === 0 && <p className="text-sm text-white/50">No other gods are online{galaxy === PUBLIC ? "" : ` in galaxy ${galaxy}`}. Open Arda in another browser (or a private window){galaxy === PUBLIC ? "" : " with the same code"} to make one.</p>}
        {enabled && planets.length > 0 && (
          <>
            <div className="mb-3 flex gap-2">
              {/* Buttons, not a native <select>: the HUD re-renders a few times a second as stocks change, which made an open dropdown flicker and close. */}
              <div className="grid flex-1 grid-cols-3 gap-1">
                {RESOURCES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setResource(r)}
                    className={`rounded-lg px-2 py-1 text-left text-xs transition ${resource === r ? "bg-sky-400/25 ring-1 ring-sky-300" : "bg-white/5 hover:bg-white/10"}`}
                  >
                    <span className="block capitalize">{r}</span>
                    <span className="block tabular-nums text-white/50">{Math.floor(sim.resources[r])}</span>
                  </button>
                ))}
              </div>
              <input type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value)) || 1))} className="w-20 self-start rounded-lg bg-white/10 px-3 py-2 text-sm" />
            </div>
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
