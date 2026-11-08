"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";
import { IncomingOffers, OffersTab, useTradeOffers } from "./TradeOffers";
import { CODE_RULE, GALAXY_MAX, cleanCode, joinError, setWantedGalaxy, typeCode, wantedGalaxy } from "@/lib/galaxyCode";
import { GalaxyMarket } from "./GalaxyMarket";
import { GalaxyInvasion } from "./GalaxyInvasion";
import { IncomingFleets, useFleets } from "./InvasionFleets";

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
  payload: {
    resource?: keyof Resources; amount?: number; won?: boolean;
    // Fleets (migration 011): how the invasion ended, and what each side lost or gained
    result?: "won" | "repelled" | "tribute" | "recalled"; fleet?: number; attacker_lost?: number; defender_lost?: number;
    loot?: Partial<Resources>; shields?: boolean;
  };
  message: string;
}


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
  sim, ownerName, planetName, demo, spacefaring, open, view = null, onClose, onStatus,
}: { sim: PlanetSim; ownerName: string; planetName: string; demo?: boolean; spacefaring: boolean; open: boolean; view?: "market" | "invade" | "offers" | "join" | null; onClose: () => void; onStatus?: (s: GalaxyStatus) => void }) {
  const since = useRef<number | null>(null);
  const names = useRef(new Map<string, string>());
  const wanted = useRef<string | null>(null); // the galaxy we mean to be in (kept in the browser, so a refresh rejoins it)
  const joining = useRef(false);
  const syncInFlight = useRef<Promise<boolean> | null>(null);
  const deltas = useRef(true); // false while the database is older than migration 008 (then its totals mustn't be adopted)
  const seen = useRef<{ galaxy: string | null; gods: Map<string, PlanetRow> } | null>(null); // to announce arrivals and departures
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rooms, setRooms] = useState(true); // false until migration 003 is run: then everyone online shares one galaxy
  const [galaxy, setGalaxy] = useState<string | null>(null);
  const [planets, setPlanets] = useState<PlanetRow[]>([]);
  const [draft, setDraft] = useState("");
  const [switching, setSwitching] = useState(false); // the "Switch galaxy" code box is open
  const [joinFormOpen, setJoinFormOpen] = useState(false);
  const [aloneLocal, setAloneLocal] = useState(false); // before migration 003 there are no rooms, so "Play alone" is kept here
  const [error, setError] = useState(""); // a join that failed, shown under the code box like a form error
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"invade" | "market" | "offers">("invade");
  const marketOpen = tab === "market";

  useEffect(() => {
    if (!open) return;
    if (view === "market" || view === "invade" || view === "offers") setTab(view);
  }, [open, view]);


  // This planet's id and the secret token that owns its row. The demo is a separate planet, so it gets its own.
  const [ids] = useState(() => ({ world: stored(`arda-world-id${demo ? "-demo" : ""}`), token: stored(`arda-owner-token${demo ? "-demo" : ""}`) }));
  const post = useCallback((body: Record<string, unknown>) => postGalaxy({ ...body, worldId: ids.world, ownerToken: ids.token }), [ids]);

  // Trades and invasions that involve us land in our sim (the other side's game applies its half).
  const apply = useCallback(
    (a: Action) => {
      const mine = a.source_world_id === ids.world;
      const other = names.current.get(mine ? a.target_world_id : a.source_world_id) ?? "another planet";
      if (a.action_type === "trade" && a.payload.resource && a.payload.amount) sim.galaxyTrade(a.payload.resource, mine ? -a.payload.amount : a.payload.amount, other);
      if (a.action_type === "invasion" && a.payload.result) {
        const p = a.payload;
        if (mine) sim.fleetHome(other, p.result!, p.fleet ?? 0, p.attacker_lost ?? 0, p.loot ?? {});
        else if (p.result === "won" || p.result === "repelled") sim.raidedFromSpace(other, p.result === "won", p.defender_lost ?? 0, p.loot ?? {}, !!p.shields);
      } else if (a.action_type === "invasion") {
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
        // Ensure this planet row exists before the join RPC. This prevents a fast click after opening
        // the landing/game from racing the first five-second database sync.
        const stats = sim.stats();
        const hash = [...ids.world].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
        const synced = await post({
          action: "sync",
          ownerName,
          planetName,
          planetType: stats.planetType,
          population: stats.population,
          villages: stats.villages,
          output: Math.round(sim.output),
          military: sim.military(),
          resources: sim.galaxySnapshot().sent,
          positionX: (hash & 0xffff) / 0xffff,
          positionY: ((hash >>> 16) & 0xffff) / 0xffff,
        });
        if (!synced.res.ok) {
          throw new Error(synced.data.error || "Couldn't register this planet");
        }
        const { data } = await post({ action: "join", code: c });
        if (data.ok) {
          wanted.current = c;
          setWantedGalaxy(c);
          setGalaxy(c);
          setError("");
          setDraft("");
          setSwitching(false);
          setMessage(data.created ? `You created galaxy ${c}. Share the code so others can join.` : `You joined galaxy ${c}.`);
          if (!auto) sim.galaxyNews("", data.created ? "A new galaxy" : "You joined a galaxy", data.created ? `You created galaxy ${c}. Up to ${GALAXY_MAX} gods can join.` : `You joined galaxy ${c} (${data.members}/${GALAXY_MAX} gods).`);
          return true;
        }
        const why = joinError(data.reason, c, data.members);
        setError(why);
        if (auto) {
          // Our place went while we were away (or the galaxy filled up before we arrived): stop retrying.
          wanted.current = null;
          setWantedGalaxy(null);
          sim.galaxyNews("", "Couldn't rejoin the galaxy", why);
        }
        return false;
      } catch (caught) {
        setError(caught instanceof Error && caught.message ? caught.message : joinError(undefined, c));
        return false;
      } finally {
        joining.current = false;
      }
    },
    [sim, post, ids, ownerName, planetName],
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
        for (const p of rows) if (!seen.current.gods.has(p.world_id)) sim.galaxyNews("", "A new god appears", `${p.owner_name} and the planet ${p.planet_name} have joined the galaxy.`, false);
        for (const [id, p] of seen.current.gods) if (!now.has(id)) sim.galaxyNews("", "A god has left", `${p.owner_name} and ${p.planet_name} left the galaxy.`);
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

  const sync = useCallback(() => {
    if (syncInFlight.current) return syncInFlight.current;
    const request = (async () => {
      const s = sim.stats();
      const hash = [...ids.world].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
      // Send what changed since the database last confirmed our totals; it sends back the true totals,
      // which include market fills, trade offers and invasion loot settled there.
      const snap = sim.galaxySnapshot();
      try {
        const { res, data } = await post({
          action: "sync", ownerName, planetName, planetType: s.planetType,
          population: s.population, villages: s.villages, output: Math.round(sim.output), military: sim.military(), defence: sim.defenceStrength(),
          resources: snap.sent, delta: deltas.current ? snap.delta : null,
          positionX: (hash & 0xffff) / 0xffff, positionY: ((hash >>> 16) & 0xffff) / 0xffff,
        });
        if (res.status === 503) {
          setEnabled(false);
          return false;
        }
        deltas.current = data.deltas !== false;
        if (res.ok && deltas.current && data.planet?.resources) {
          sim.galaxyAdopt(data.planet.resources, snap.sent, data.planet.credits);
        }
        await load();
        return res.ok;
      } catch {
        setEnabled(false);
        return false;
      }
    })();
    syncInFlight.current = request;
    request.then(
      () => { if (syncInFlight.current === request) syncInFlight.current = null; },
      () => { if (syncInFlight.current === request) syncInFlight.current = null; },
    );
    return request;
  }, [sim, ownerName, planetName, load, post, ids]);

  // Trade offers with the other gods in our galaxy (TradeOffers.tsx).
  const offers = useTradeOffers({ worldId: ids.world, post, sync, sim, active: !!(enabled && rooms && galaxy) });
  // Invasion fleets in flight, to and from us (InvasionFleets.tsx).
  const fleets = useFleets({ worldId: ids.world, post, sync, sim, active: !!(enabled && rooms && galaxy), onSettled: load });

  useEffect(() => {
    wanted.current = wantedGalaxy(); // from the landing page, a shared link, or last time
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => window.clearInterval(timer);
  }, [sync]);

  useEffect(() => {
    if (!open) setTab("invade");
  }, [open]);

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
    setTab("invade");
    seen.current = null;
    try {
      await post({ action: "leave" });
    } catch {}
    setSwitching(false);
    setMessage(`You left galaxy ${was} and are playing alone. Your planet keeps everything it traded, won or lost.`);
  };

  const createRandomGalaxy = async () => {
    await randomGalaxy("random_create");
  };

  const joinRandomGalaxy = async () => {
    await randomGalaxy("random_join");
  };

  const randomGalaxy = async (action: "random_join" | "random_create") => {
    if (joining.current) return;
    joining.current = true;
    try {
      const stats = sim.stats();
      const hash = [...ids.world].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
      const synced = await post({
        action: "sync",
        ownerName,
        planetName,
        planetType: stats.planetType,
        population: stats.population,
        villages: stats.villages,
        output: Math.round(sim.output),
        military: sim.military(),
        resources: sim.galaxySnapshot().sent,
        positionX: (hash & 0xffff) / 0xffff,
        positionY: ((hash >>> 16) & 0xffff) / 0xffff,
      });
      if (!synced.res.ok) {
        throw new Error(synced.data.error || "Couldn't register this planet");
      }
      const { data } = await post({ action });
      if (data.ok) {
        setGalaxy(data.galaxy);
        setError("");
        setDraft("");
        setSwitching(false);
        setWantedGalaxy(data.galaxy);
        wanted.current = data.galaxy;
        setMessage(data.created ? `You created galaxy ${data.galaxy}.` : `You joined galaxy ${data.galaxy}.`);
        sim.galaxyNews(
          "",
          data.created ? "A new galaxy" : "A random galaxy",
          data.created ? `You created galaxy ${data.galaxy}.` : `You joined galaxy ${data.galaxy} (${data.members}/${GALAXY_MAX} gods).`,
        );
        await load();
      } else {
        setError(data.error || joinError(data.reason, data.galaxy ?? "", data.members));
      }
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "Couldn't connect to the galaxy server. Try again.");
    } finally {
      joining.current = false;
    }
  };


  const invade = async (target: string, share = 0.5): Promise<string> => {
    if (alone) {
      const text = "You're playing alone. Join a galaxy to invade.";
      setMessage(text);
      return text;
    }
    // Migration 011: a real fleet that flies for 30 seconds. Before it's run, the old instant invasion.
    const text = fleets.ready ? await fleets.launch(target, share) : null;
    if (text != null) {
      setMessage(text);
      return text;
    }
    setMessage("Your ships set off...");
    await sync(); // so the galaxy knows our strength right now
    const { data } = await post({ action: "invasion", targetWorldId: target });
    const result = data.message || data.error || "Galaxy action failed";
    setMessage(result);
    await load(); // picks up the completed action and applies our half of it
    return result;
  };

  // Playing alone: in no galaxy (or, before migration 003, opted out of the shared list). No trading or invading.
  const alone = rooms ? !galaxy : aloneLocal;
  const shown = alone ? [] : planets;
  // Offers sent to us show over the game even while this panel is closed.
  const incoming = (
    <>
      <IncomingOffers sim={sim} offers={offers} />
      <IncomingFleets sim={sim} fleets={fleets} />
    </>
  );
  if (!open) return incoming;
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
          placeholder="ORBIT"
          aria-invalid={!!error}
          aria-describedby={error ? "galaxy-error" : undefined}
          className={`min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-1.5 font-mono text-sm uppercase outline-none placeholder:text-white/30 ${error ? "ring-1 ring-rose-400" : "focus:ring-1 focus:ring-indigo-300"}`}
        />
        <button className="rounded-lg bg-indigo-400/25 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-400/40">Join galaxy</button>
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
    <>
    {incoming}
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass subtle-scrollbar relative max-h-[82vh] w-[44rem] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <p className="text-lg font-bold">Galaxy</p>
            {galaxy && (
              <p className="mt-0.5 font-mono text-xs text-indigo-200">
                {galaxy} <span className="text-white/40">· {members}/{GALAXY_MAX} gods</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {galaxy && (
              <>
                <button
                  onClick={() => setSwitching((v) => !v)}
                  className="rounded-lg border border-indigo-300/20 bg-indigo-400/10 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/20"
                >
                  Switch galaxy
                </button>
                <button onClick={leave} className="rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/20">
                  Leave galaxy
                </button>
              </>
            )}
            <button onClick={onClose} className="ml-1 rounded-lg px-2 py-1.5 text-white/50 hover:bg-white/5 hover:text-white" aria-label="Close">
              Close
            </button>
          </div>
        </div>

        {enabled === false && <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{message || "Galaxy connection unavailable."}</p>}
        {enabled && !rooms && <p className="mb-3 text-xs text-amber-200">Galaxy rooms aren&apos;t set up yet. Everyone online currently shares the galaxy.</p>}

        {switching && galaxy && (
          <div className="mb-4 rounded-lg bg-white/5 p-3">
            {codeForm("Switch galaxy", `Leave ${galaxy} and join another galaxy. If the new galaxy is full, you stay in ${galaxy}.`, () => {
              setSwitching(false);
              setError("");
            })}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={createRandomGalaxy} className="rounded-lg border border-indigo-300/20 bg-indigo-400/15 px-3 py-2 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/25">
                + Create random galaxy
              </button>
              <button onClick={joinRandomGalaxy} className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20">
                Join random galaxy
              </button>
            </div>
          </div>
        )}

        {enabled && rooms && !galaxy && (
          <div className="rounded-lg bg-white/[0.035] p-4">
            <p className="mb-3 text-sm text-white/60">Join a galaxy to trade or invade other planets.</p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <button
                onClick={() => {
                  setJoinFormOpen((value) => !value);
                  setError("");
                }}
                className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${joinFormOpen ? "border-indigo-300/40 bg-indigo-400/25 text-indigo-100" : "border-indigo-300/20 bg-indigo-400/15 text-indigo-100 hover:bg-indigo-400/25"}`}
              >
                {joinFormOpen ? "Close code field" : "Join galaxy"}
                <span className="block text-[10px] font-normal text-indigo-200/60">Enter an existing galaxy code</span>
              </button>
              <button onClick={createRandomGalaxy} className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-3 py-2.5 text-sm font-semibold text-violet-100 hover:bg-violet-400/20">
                Create galaxy
                <span className="block text-[10px] font-normal text-violet-200/60">Generate a new galaxy code</span>
              </button>
              <button onClick={joinRandomGalaxy} className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20">
                Join random galaxy
                <span className="block text-[10px] font-normal text-emerald-200/60">Join an available galaxy</span>
              </button>
            </div>
            {joinFormOpen && (
              <div className="mb-3 rounded-lg border border-white/[0.07] bg-black/10 p-3">
                {codeForm("Galaxy code", "Enter the code of an existing galaxy.")}
              </div>
            )}
            {message && !error && <p className="mt-3 text-xs text-sky-200">{message}</p>}
          </div>
        )}

        {enabled && rooms && galaxy && (
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => setTab("invade")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === "invade" ? "bg-rose-400/20 text-rose-100 ring-1 ring-rose-300/20" : "bg-white/5 text-white/55 hover:text-white"}`}
            >
              Invade
            </button>
            <button
              onClick={() => setTab("market")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${marketOpen ? "bg-amber-400/20 text-amber-100 ring-1 ring-amber-300/20" : "bg-white/5 text-white/55 hover:text-white"}`}
            >
              Market
            </button>
            <button
              onClick={() => setTab("offers")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === "offers" ? "bg-sky-400/20 text-sky-100 ring-1 ring-sky-300/20" : "bg-white/5 text-white/55 hover:text-white"}`}
            >
              Offers{offers.outgoing.some((o) => o.status === "pending") ? " ·" : ""}
            </button>
          </div>
        )}

        {enabled && rooms && galaxy && tab === "offers" && <OffersTab planets={shown} sim={sim} spacefaring={spacefaring} offers={offers} />}

        {enabled && rooms && galaxy && marketOpen && (
          <GalaxyMarket sim={sim} worldId={ids.world} galaxy={galaxy} post={post} sync={sync} onMessage={setMessage} />
        )}

        {/* Before migration 003 there are no rooms: everyone online is listed, so "Play alone" hides them here */}
        {enabled && !rooms && (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-white/5 p-3 text-xs">
            <button onClick={() => setAloneLocal((v) => !v)} className={aloneLocal ? "text-indigo-200 hover:text-white" : "text-rose-300 hover:text-rose-200"}>
              {aloneLocal ? "Meet other gods" : "Play alone"}
            </button>
          </div>
        )}

        {tab === "invade" && (
          <GalaxyInvasion
            enabled={enabled}
            alone={alone}
            planets={shown}
            spacefaring={spacefaring}
            onInvade={invade}
            sim={sim}
            outgoing={fleets.ready ? fleets.outgoing : []}
          />
        )}
      </div>
    </div>
    </>
  );
}
