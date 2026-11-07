"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";
import { IncomingOffers, OffersTab, useTradeOffers } from "./TradeOffers";
import { CODE_RULE, GALAXY_MAX, cleanCode, joinError, setWantedGalaxy, typeCode, wantedGalaxy } from "@/lib/galaxyCode";

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

interface MarketOrder {
  id: number;
  world_id: string;
  side: "buy" | "sell";
  resource: keyof Resources;
  price: number;
  quantity: number;
  remaining: number;
  status: string;
  created_at: string;
}

interface MarketTrade {
  id: number;
  resource: keyof Resources;
  price: number;
  quantity: number;
  buyer_world_id: string;
  seller_world_id: string;
  created_at: string;
}

interface MarketPrice {
  resource: keyof Resources;
  base_price: number;
  current_price: number;
}

interface MarketPricePoint {
  resource: keyof Resources;
  price: number;
  created_at: string;
}

const RESOURCES = ["food", "wood", "stone", "metal", "gold", "herbs"] as const;

function MarketChart({ base, points }: { base: number; points: MarketPricePoint[] }) {
  const values = points.length ? points.map((point) => Number(point.price)) : [base];
  const min = Math.max(0, Math.min(base, ...values) - 1);
  const max = Math.max(base, ...values) + 1;
  const range = Math.max(1, max - min);
  const coordinates = values.map((value, index) => {
    const x = values.length === 1 ? 160 : 4 + (index / (values.length - 1)) * 312;
    const y = 92 - ((value - min) / range) * 84;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const current = values[values.length - 1];

  return (
    <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-white/55">Price history</span>
        <span className="font-semibold text-amber-200">{current.toLocaleString()} credits</span>
      </div>
      <svg viewBox="0 0 320 96" className="h-16 w-full" role="img" aria-label={`Current price ${current} credits`}>
        {[0, 46, 92].map((y) => <line key={y} x1="4" x2="316" y1={y} y2={y} className="stroke-white/10" strokeWidth="1" />)}
        <polyline points={coordinates.join(" ")} fill="none" className="stroke-amber-300" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
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
  const [aloneLocal, setAloneLocal] = useState(false); // before migration 003 there are no rooms, so "Play alone" is kept here
  const [error, setError] = useState(""); // a join that failed, shown under the code box like a form error
  const [message, setMessage] = useState("");
  const [marketOrders, setMarketOrders] = useState<MarketOrder[]>([]);
  const [marketTrades, setMarketTrades] = useState<MarketTrade[]>([]);
  const [marketSide, setMarketSide] = useState<"buy" | "sell">("buy");
  const [marketResource, setMarketResource] = useState<keyof Resources>("gold");
  const [marketPrice, setMarketPrice] = useState(10);
  const [marketQuantity, setMarketQuantity] = useState(10);
  const [credits, setCredits] = useState(1000);
  const [tab, setTab] = useState<"invade" | "market" | "offers">("invade");
  const marketOpen = tab === "market";
  const [marketPrices, setMarketPrices] = useState<MarketPrice[]>([]);
  const [marketHistory, setMarketHistory] = useState<MarketPricePoint[]>([]);

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

  const loadMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/galaxy?market=1&worldId=${encodeURIComponent(ids.world)}`);
      const data = await res.json();
      if (!res.ok) return;
      setMarketOrders((data.orders ?? []) as MarketOrder[]);
      setMarketTrades((data.trades ?? []) as MarketTrade[]);
      setMarketPrices((data.prices ?? []) as MarketPrice[]);
      setMarketHistory((data.history ?? []) as MarketPricePoint[]);
      // Credits live only in the database. Resources reach the game through the sync (migration 008),
      // so the market never overwrites what the planet has produced since.
      const me = data.me as { credits?: number } | null;
      if (me?.credits != null) {
        setCredits(Number(me.credits));
        sim.marketCredits = Math.max(0, Math.floor(Number(me.credits)));
      }
    } catch {}
  }, [ids, sim]);

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
          population: s.population, villages: s.villages, output: Math.round(sim.output), military: sim.military(),
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
          if (data.planet.credits != null) setCredits(Number(data.planet.credits));
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

  useEffect(() => {
    wanted.current = wantedGalaxy(); // from the landing page, a shared link, or last time
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => window.clearInterval(timer);
  }, [sync]);

  useEffect(() => {
    if (!marketOpen || !galaxy) return;
    void loadMarket();
    const timer = window.setInterval(() => void loadMarket(), 5000);
    return () => window.clearInterval(timer);
  }, [marketOpen, galaxy, loadMarket]);

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

  const placeMarketOrder = async () => {
    if (!galaxy) return setMessage("Join a galaxy before placing an order.");
    await sync(); // so the database knows what we hold right now
    const { data } = await post({
      action: "place_order",
      side: marketSide,
      resource: marketResource,
      price: marketPrice,
      quantity: marketQuantity,
    });
    setMessage(data.error || `Order ${data.status ?? "placed"}${data.remaining != null ? ` (${data.remaining} remaining)` : ""}`);
    await sync(); // brings the held goods and any fill into the game
    await loadMarket();
  };

  const cancelMarketOrder = async (orderId: number) => {
    const { data } = await post({ action: "cancel_order", orderId });
    setMessage(data.error || "Order cancelled.");
    await sync(); // the refund
    await loadMarket();
  };

  const createRandomGalaxy = async () => {
    const code = String(10000 + Math.floor(Math.random() * 90000));
    await join(code);
  };

  const joinRandomGalaxy = async () => {
    if (joining.current) return;
    joining.current = true;
    try {
      const { data } = await post({ action: "random_join" });
      if (data.ok) {
        setGalaxy(data.galaxy);
        setError("");
        setDraft("");
        setSwitching(false);
        setWantedGalaxy(data.galaxy);
        wanted.current = data.galaxy;
        setMessage(data.created ? `You created galaxy ${data.galaxy}.` : `You joined galaxy ${data.galaxy}.`);
        sim.galaxyNews(
          "🌌",
          data.created ? "A new galaxy" : "A random galaxy",
          data.created ? `You created galaxy ${data.galaxy}.` : `You joined galaxy ${data.galaxy} (${data.members}/${GALAXY_MAX} gods).`,
        );
      } else {
        setError(joinError(data.reason, data.galaxy ?? "", data.members));
      }
    } catch {
      setError("Couldn't find a galaxy. Try again.");
    } finally {
      joining.current = false;
    }
  };


  const invade = async (target: string) => {
    if (alone) return setMessage("You're playing alone. Join a galaxy to invade.");
    setMessage("Your ships set off...");
    await sync(); // so the galaxy knows our strength right now
    const { data } = await post({ action: "invasion", targetWorldId: target });
    setMessage(data.message || data.error || "Galaxy action failed");
    await load(); // picks up the completed action and applies our half of it
  };

  // Playing alone: in no galaxy (or, before migration 003, opted out of the shared list). No trading or invading.
  const alone = rooms ? !galaxy : aloneLocal;
  const shown = alone ? [] : planets;
  // Offers sent to us show over the game even while this panel is closed.
  const incoming = <IncomingOffers sim={sim} offers={offers} />;
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
    <>
    {incoming}
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass subtle-scrollbar max-h-[82vh] w-[44rem] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <p className="text-lg font-bold">🌌 Galaxy</p>
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
                  ⇄ Switch galaxy
                </button>
                <button onClick={leave} className="rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/20">
                  ✕ Leave galaxy
                </button>
              </>
            )}
            <button onClick={onClose} className="ml-1 rounded-lg px-2 py-1.5 text-white/50 hover:bg-white/5 hover:text-white" aria-label="Close">
              ✕
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
                🎲 Join random galaxy
              </button>
            </div>
          </div>
        )}

        {enabled && rooms && !galaxy && (
          <div className="rounded-lg bg-white/[0.035] p-4">
            <p className="mb-3 text-sm text-white/60">Join a galaxy to trade or invade other planets.</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={createRandomGalaxy} className="rounded-lg border border-indigo-300/20 bg-indigo-400/15 px-3 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-indigo-400/25">
                + Create galaxy
                <span className="block text-[10px] font-normal text-indigo-200/60">Generates a 5-digit code</span>
              </button>
              <button onClick={joinRandomGalaxy} className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20">
                🎲 Join random
                <span className="block text-[10px] font-normal text-emerald-200/60">Join an available galaxy</span>
              </button>
            </div>
            {codeForm("Galaxy code", "Use a friend's code, or enter a new one to create a galaxy.")}
            {message && !error && <p className="mt-3 text-xs text-sky-200">{message}</p>}
          </div>
        )}

        {enabled && rooms && galaxy && (
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => setTab("invade")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === "invade" ? "bg-rose-400/20 text-rose-100 ring-1 ring-rose-300/20" : "bg-white/5 text-white/55 hover:text-white"}`}
            >
              ⚔ Invade
            </button>
            <button
              onClick={() => setTab("market")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${marketOpen ? "bg-amber-400/20 text-amber-100 ring-1 ring-amber-300/20" : "bg-white/5 text-white/55 hover:text-white"}`}
            >
              ⚖ Market
            </button>
            <button
              onClick={() => setTab("offers")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === "offers" ? "bg-sky-400/20 text-sky-100 ring-1 ring-sky-300/20" : "bg-white/5 text-white/55 hover:text-white"}`}
            >
              🤝 Offers{offers.outgoing.some((o) => o.status === "pending") ? " ·" : ""}
            </button>
          </div>
        )}

        {enabled && rooms && galaxy && tab === "offers" && <OffersTab planets={shown} sim={sim} spacefaring={spacefaring} offers={offers} />}

        {enabled && rooms && galaxy && marketOpen && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-1">
                {RESOURCES.map((item) => (
                  <button
                    key={item}
                    onClick={() => setMarketResource(item)}
                    className={`rounded-full px-2.5 py-1 text-xs capitalize transition ${marketResource === item ? "bg-amber-400/20 text-amber-100" : "text-white/45 hover:bg-white/5 hover:text-white"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <span className="text-xs font-semibold text-amber-200">{credits.toLocaleString()} credits</span>
            </div>
            <MarketChart
              base={marketPrices.find((price) => price.resource === marketResource)?.base_price ?? 10}
              points={marketHistory.filter((point) => point.resource === marketResource)}
            />
            <div className="mt-3 grid grid-cols-[8rem_1fr_1fr] items-end gap-2">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
                {(["buy", "sell"] as const).map((side) => (
                  <button key={side} onClick={() => setMarketSide(side)} className={`rounded-md px-2 py-1.5 text-xs capitalize ${marketSide === side ? (side === "buy" ? "bg-emerald-400/20 text-emerald-100" : "bg-rose-400/20 text-rose-100") : "text-white/45"}`}>
                    {side}
                  </button>
                ))}
              </div>
              <label className="text-xs text-white/45">Credits / unit
                <input type="number" min={1} max={1000000000} value={marketPrice} onChange={(e) => setMarketPrice(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded bg-white/10 px-2 py-1 text-white" />
              </label>
              <label className="text-xs text-white/60">Quantity
                <input type="number" min={1} max={100000} value={marketQuantity} onChange={(e) => setMarketQuantity(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded bg-white/10 px-2 py-1 text-white" />
              </label>
            </div>
            <button onClick={placeMarketOrder} className="mt-2 w-full rounded bg-indigo-400/25 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/35">
              Place {marketSide} order
            </button>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="mb-1 font-semibold text-emerald-200">Bids</p>
                {marketOrders.filter((o) => o.side === "buy" && o.resource === marketResource).sort((a, b) => b.price - a.price || a.created_at.localeCompare(b.created_at)).slice(0, 8).map((o) => (
                  <div key={o.id} className="flex justify-between border-t border-white/5 py-1">
                    <span>{o.remaining} × {o.price}</span>
                    {o.world_id === ids.world ? <button onClick={() => cancelMarketOrder(o.id)} className="text-rose-300">Cancel</button> : <span className="text-white/35">bid</span>}
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 font-semibold text-rose-200">Asks</p>
                {marketOrders.filter((o) => o.side === "sell" && o.resource === marketResource).sort((a, b) => a.price - b.price || a.created_at.localeCompare(b.created_at)).slice(0, 8).map((o) => (
                  <div key={o.id} className="flex justify-between border-t border-white/5 py-1">
                    <span>{o.remaining} × {o.price}</span>
                    {o.world_id === ids.world ? <button onClick={() => cancelMarketOrder(o.id)} className="text-rose-300">Cancel</button> : <span className="text-white/35">ask</span>}
                  </div>
                ))}
              </div>
            </div>
            {marketTrades.length > 0 && (
              <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/55">
                Last: {marketTrades[0].quantity} {marketTrades[0].resource} at {marketTrades[0].price} credits
              </p>
            )}
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

        {tab === "invade" && enabled && !alone && planets.length === 0 && (
          <p className="text-sm text-white/50">You&apos;re the only god here{galaxy ? `. Share the code ${galaxy} so others can join` : ""}.</p>
        )}
        {tab === "invade" && enabled && !spacefaring && shown.length > 0 && <p className="mb-2 text-xs text-white/45">Invading unlocks when your people reach the Space Age.</p>}
        {tab === "invade" && enabled && shown.length > 0 && (
          <>
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
                    <button disabled={!spacefaring} onClick={() => invade(p.world_id)} className="flex-1 rounded bg-rose-400/15 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-400/25 disabled:opacity-40">
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
    </>
  );
}
