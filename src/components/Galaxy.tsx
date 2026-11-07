"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";
import { CODE_RULE, GALAXY_MAX, cleanCode, joinError, setWantedGalaxy, shareLink, typeCode, wantedGalaxy } from "@/lib/galaxyCode";

// Multiplayer: every planet syncs a snapshot to Supabase (through /api/galaxy) every few seconds.
// Galaxies are temporary rooms of up to 5 gods, named by a code: the first god to use a code creates it,
// others join until it's full, anyone can leave at any time, and an empty galaxy is deleted (migration 003).
// Once your nation reaches the Space Age you can send resources to, or invade, the other planets in your
// galaxy. Those are settled by SQL functions and applied to each sim, so they stay done after you leave.

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

// A POST to /api/galaxy; the body carries our planet's id and owner token.
async function postGalaxy(body: Record<string, unknown>) {
  const res = await fetch("/api/galaxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, data: await res.json().catch(() => ({})) };
}

export interface GalaxyStatus {
  enabled: boolean | null; // null until the first answer from the server
  galaxy: string | null; // the galaxy we're in, or null
  members: number; // gods in it, counting us
}

export default function Galaxy({
  sim, ownerName, planetName, demo, spacefaring, open, onClose, onStatus,
}: { sim: PlanetSim; ownerName: string; planetName: string; demo?: boolean; spacefaring: boolean; open: boolean; onClose: () => void; onStatus?: (s: GalaxyStatus) => void }) {
  const since = useRef<number | null>(null);
  const names = useRef(new Map<string, string>());
  const wanted = useRef<string | null>(null); // the galaxy we mean to be in (kept in the browser, so a refresh rejoins it)
  const joining = useRef(false);
  const seen = useRef<{ galaxy: string | null; gods: Map<string, PlanetRow> } | null>(null); // to announce arrivals and departures
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rooms, setRooms] = useState(true); // false until migration 003 is run: then everyone online shares one galaxy
  const [galaxy, setGalaxy] = useState<string | null>(null);
  const [planets, setPlanets] = useState<PlanetRow[]>([]);
  const [draft, setDraft] = useState("");
  const [switching, setSwitching] = useState(false); // the "Switch galaxy" code box is open
  const [aloneLocal, setAloneLocal] = useState(false); // before migration 003 there are no rooms, so "Play alone" is kept here
  const [error, setError] = useState(""); // a join that failed, shown under the code box like a form error
  const [resource, setResource] = useState<keyof Resources>("gold");
  const [amount, setAmount] = useState(10);
  const [message, setMessage] = useState("");

  // This planet's id and the secret token that owns its row. The demo is a separate planet, so it gets its own.
  const [ids] = useState(() => ({ world: stored(`arda-world-id${demo ? "-demo" : ""}`), token: stored(`arda-owner-token${demo ? "-demo" : ""}`) }));
  const post = useCallback((body: Record<string, unknown>) => postGalaxy({ ...body, worldId: ids.world, ownerToken: ids.token }), [ids]);

  // Trades and invasions that involve us land in our sim (the other side's game applies its half).
  const apply = useCallback(
    (a: Action) => {
      const mine = a.source_world_id === ids.world;
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
    [sim, ids],
  );

  // Joins the galaxy with this code, or creates it if nobody is using it. `auto` is a rejoin we
  // started ourselves (after a refresh, or after being away too long), so a failure is a pop-up too.
  const join = useCallback(
    async (code: string, auto = false): Promise<boolean> => {
      const c = cleanCode(code);
      if (!c) {
        setError(CODE_RULE);
        return false;
      }
      if (joining.current) return false;
      joining.current = true;
      try {
        const { data } = await post({ action: "join", code: c });
        if (data.ok) {
          wanted.current = c;
          setWantedGalaxy(c);
          setGalaxy(c);
          setError("");
          setDraft("");
          setSwitching(false);
          setMessage(data.created ? `You created galaxy ${c}. Share the code so others can join.` : `You joined galaxy ${c}.`);
          if (!auto) sim.galaxyNews("🌌", data.created ? "A new galaxy" : "You joined a galaxy", data.created ? `You created galaxy ${c}. Up to ${GALAXY_MAX} gods can join.` : `You joined galaxy ${c} (${data.members}/${GALAXY_MAX} gods).`);
          return true;
        }
        const why = joinError(data.reason, c, data.members);
        setError(why);
        if (auto) {
          // Our place went while we were away (or the galaxy filled up before we arrived): stop retrying.
          wanted.current = null;
          setWantedGalaxy(null);
          sim.galaxyNews("🌌", "Couldn't rejoin the galaxy", why);
        }
        return false;
      } catch {
        setError(joinError(undefined, c));
        return false;
      } finally {
        joining.current = false;
      }
    },
    [sim, post],
  );

  const load = useCallback(async () => {
    try {
      const q = `worldId=${encodeURIComponent(ids.world)}${since.current != null ? `&since=${since.current}` : ""}`;
      const res = await fetch(`/api/galaxy?${q}`);
      const data = await res.json();
      setEnabled(Boolean(data.enabled) && res.ok);
      if (!res.ok) return setMessage(data.error || "Galaxy database setup failed");
      const rows = data.planets as PlanetRow[];
      const here: string | null = data.galaxy ?? null;
      for (const p of rows) names.current.set(p.world_id, p.planet_name);
      setRooms(data.rooms !== false);
      setGalaxy(here);
      setPlanets(rows);
      // Announce gods who arrive or leave after we're in (not the ones already here when we joined).
      const now = new Map(rows.map((p) => [p.world_id, p]));
      if (seen.current && seen.current.galaxy === here) {
        for (const p of rows) if (!seen.current.gods.has(p.world_id)) sim.galaxyNews("🛸", "A new god appears", `${p.owner_name} and the planet ${p.planet_name} have joined the galaxy.`, false);
        for (const [id, p] of seen.current.gods) if (!now.has(id)) sim.galaxyNews("👋", "A god has left", `${p.owner_name} and ${p.planet_name} left the galaxy.`);
      }
      seen.current = { galaxy: here, gods: now };
      if (since.current != null) (data.actions as Action[]).forEach(apply);
      since.current = data.lastActionId ?? since.current;
      // We mean to be in a galaxy but aren't (a fresh tab, or we were away too long): rejoin it.
      if (data.rooms !== false && wanted.current && here !== wanted.current) join(wanted.current, true);
    } catch {
      setEnabled(false);
    }
  }, [apply, join, sim, ids]);

  const sync = useCallback(async () => {
    const s = sim.stats();
    const hash = [...ids.world].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
    try {
      const { res } = await post({
        action: "sync", ownerName, planetName, planetType: s.planetType,
        population: s.population, villages: s.villages, output: Math.round(sim.output), military: sim.military(), resources: s.resources,
        positionX: (hash & 0xffff) / 0xffff, positionY: ((hash >>> 16) & 0xffff) / 0xffff,
      });
      if (res.status === 503) return setEnabled(false);
      await load();
    } catch {
      setEnabled(false);
    }
  }, [sim, ownerName, planetName, load, post, ids]);

  useEffect(() => {
    wanted.current = wantedGalaxy(); // from the landing page, a shared link, or last time
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => window.clearInterval(timer);
  }, [sync]);

  // The HUD shows whether we're connected, which galaxy we're in and how full it is.
  useEffect(() => {
    const solo = rooms ? !galaxy : aloneLocal;
    onStatus?.({ enabled, galaxy: rooms ? galaxy : null, members: solo ? 0 : planets.length + 1 });
  }, [enabled, rooms, galaxy, aloneLocal, planets.length, onStatus]);

  const leave = async () => {
    const was = galaxy;
    wanted.current = null;
    setWantedGalaxy(null);
    setGalaxy(null);
    setPlanets([]);
    seen.current = null;
    try {
      await post({ action: "leave" });
    } catch {}
    setSwitching(false);
    setMessage(`You left galaxy ${was} and are playing alone. Your planet keeps everything it traded, won or lost.`);
  };

  const copyLink = async () => {
    if (!galaxy) return;
    try {
      await navigator.clipboard.writeText(shareLink(galaxy));
      setMessage("Link copied.");
    } catch {
      setMessage(shareLink(galaxy));
    }
  };

  const act = async (action: "trade" | "invasion", target: string) => {
    if (alone) return setMessage("You're playing alone. Join a galaxy to trade or invade.");
    if (action === "trade" && sim.resources[resource] < amount) return setMessage(`You only have ${Math.floor(sim.resources[resource])} ${resource}.`);
    setMessage("Your ships set off...");
    await sync(); // so the galaxy knows what we hold right now
    const { data } = await post({ action, targetWorldId: target, resource, amount });
    setMessage(data.message || data.error || "Galaxy action failed");
    await load(); // picks up the completed action and applies our half of it
  };

  // Playing alone: in no galaxy (or, before migration 003, opted out of the shared list). No trading or invading.
  const alone = rooms ? !galaxy : aloneLocal;
  const shown = alone ? [] : planets;
  if (!open) return null;
  const members = planets.length + 1;

  // The code box, used both to join from alone and to switch to another galaxy.
  const codeForm = (label: string, hint: string, onCancel?: () => void) => (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        join(draft);
      }}
    >
      <label htmlFor="galaxy-code" className="text-sm font-semibold">
        {label}
      </label>
      <p className="mb-2 text-xs text-white/55">{hint}</p>
      <div className="flex gap-2">
        <input
          id="galaxy-code"
          autoFocus={!!onCancel}
          value={draft}
          onChange={(e) => {
            setDraft(typeCode(e.target.value));
            setError("");
          }}
          placeholder="NOTTS"
          aria-invalid={!!error}
          aria-describedby={error ? "galaxy-error" : undefined}
          className={`min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-1.5 font-mono text-sm uppercase outline-none placeholder:text-white/30 ${error ? "ring-1 ring-rose-400" : "focus:ring-1 focus:ring-indigo-300"}`}
        />
        <button className="rounded-lg bg-indigo-400/25 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-400/40">Join or create</button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p id="galaxy-error" role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      )}
    </form>
  );
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass max-h-[80vh] w-[28rem] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xl font-bold">🌌 The galaxy</p>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mb-3 text-sm text-white/65">
          {spacefaring
            ? <>Your people have left {planetName}. Send resources to other gods&apos; planets in your galaxy, or invade them for gold.</>
            : <>Gather with other gods now. Once your people reach the Space Age, you can trade with or invade the planets in your galaxy.</>}
        </p>

        {enabled === false && <p className="mb-3 text-sm text-amber-200">{message || "The galaxy is offline: Supabase isn't configured yet."}</p>}
        {enabled && !rooms && <p className="mb-3 text-xs text-amber-200">Galaxy rooms aren&apos;t set up yet (run migration 003 in Supabase). Until then, every god online shares one galaxy.</p>}

        {/* Playing alone (in no galaxy): join one by its code, or create it with a new code */}
        {enabled && rooms && !galaxy && (
          <div className="mb-3 rounded-lg bg-white/5 p-3">
            <p className="mb-2 text-xs text-white/60">🧘 You&apos;re playing alone, so trading and invading are off.</p>
            {codeForm("Join a galaxy", `Enter a friend's code to join their galaxy, or a new code to create one. Up to ${GALAXY_MAX} gods per galaxy.`)}
            {message && !error && <p className="mt-2 text-xs text-sky-200">{message}</p>}
          </div>
        )}

        {/* In a galaxy: who's here, how full it is, and a way out */}
        {enabled && rooms && galaxy && (
          <div className="mb-3 rounded-lg bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                Galaxy <span className="font-mono font-bold text-indigo-200">{galaxy}</span>
                <span className="text-white/50">
                  {" "}· {members}/{GALAXY_MAX} gods
                </span>
              </p>
              <div className="flex gap-3">
                <button onClick={copyLink} className="text-xs text-sky-300 hover:text-sky-200">
                  Copy link
                </button>
                <button
                  onClick={() => {
                    setSwitching((v) => !v);
                    setDraft("");
                    setError("");
                  }}
                  className="text-xs text-indigo-200 hover:text-white"
                  title="Leave this galaxy and join or create another"
                >
                  Switch
                </button>
                <button onClick={leave} className="text-xs text-rose-300 hover:text-rose-200" title="Leave the galaxy and play on your own (no trading or invading)">
                  Play alone
                </button>
              </div>
            </div>
            <div className="mt-2 flex gap-1" aria-hidden>
              {Array.from({ length: GALAXY_MAX }, (_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i < members ? "bg-indigo-300" : "bg-white/10"}`} />
              ))}
            </div>
            {switching && (
              <div className="mt-3 border-t border-white/10 pt-3">
                {codeForm("Switch galaxy", `You'll leave ${galaxy} and join this one. If it's full, you stay in ${galaxy}.`, () => {
                  setSwitching(false);
                  setError("");
                })}
              </div>
            )}
            {message && !error && <p className="mt-2 text-xs text-sky-200">{message}</p>}
          </div>
        )}

        {/* Before migration 003 there are no rooms: everyone online is listed, so "Play alone" hides them here */}
        {enabled && !rooms && (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-white/5 p-3 text-xs">
            <span className="text-white/60">{aloneLocal ? "🧘 Playing alone: trading and invading are off." : "Every god online is here."}</span>
            <button onClick={() => setAloneLocal((v) => !v)} className={aloneLocal ? "text-indigo-200 hover:text-white" : "text-rose-300 hover:text-rose-200"}>
              {aloneLocal ? "Meet other gods" : "Play alone"}
            </button>
          </div>
        )}

        {enabled && !alone && planets.length === 0 && (
          <p className="text-sm text-white/50">You&apos;re the only god here{galaxy ? `. Share the code ${galaxy} (or the link) so others can join` : ""}.</p>
        )}
        {enabled && !spacefaring && shown.length > 0 && <p className="mb-2 text-xs text-white/45">🔒 Trading and invading unlock when your people reach the Space Age.</p>}
        {enabled && shown.length > 0 && (
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
              {shown.map((p) => (
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
                    <button disabled={!spacefaring} onClick={() => act("trade", p.world_id)} className="flex-1 rounded bg-emerald-400/15 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-40">
                      Send {amount} {resource}
                    </button>
                    <button disabled={!spacefaring} onClick={() => act("invasion", p.world_id)} className="flex-1 rounded bg-rose-400/15 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-400/25 disabled:opacity-40">
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
