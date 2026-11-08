"use client";
// The market: one shared order book for every god in every galaxy (migration 012). Buy and sell
// orders match by price inside the database; your goods or credits are held while an order is open.
// Before 012 the database only has per-galaxy books, and this shows the book of your galaxy.

import { useCallback, useEffect, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";

export interface MarketOrder {
  id: number;
  world_id: string;
  planet_name?: string;
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
  buyer_name?: string;
  seller_name?: string;
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
const BASE_PRICE: Record<keyof Resources, number> = { food: 8, wood: 12, stone: 15, metal: 20, gold: 30, herbs: 25 };

const RESOURCE_STYLE: Record<keyof Resources, { button: string; active: string; chart: string; text: string }> = {
  food: { button: "border-lime-300/20 bg-lime-400/10 text-lime-100", active: "bg-lime-400/25 ring-lime-300/50", chart: "#a3e635", text: "text-lime-200" },
  wood: { button: "border-amber-300/20 bg-amber-400/10 text-amber-100", active: "bg-amber-400/25 ring-amber-300/50", chart: "#fbbf24", text: "text-amber-200" },
  stone: { button: "border-slate-300/20 bg-slate-300/10 text-slate-100", active: "bg-slate-300/25 ring-slate-300/50", chart: "#cbd5e1", text: "text-slate-200" },
  metal: { button: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100", active: "bg-cyan-400/25 ring-cyan-300/50", chart: "#22d3ee", text: "text-cyan-200" },
  gold: { button: "border-yellow-300/20 bg-yellow-400/10 text-yellow-100", active: "bg-yellow-400/25 ring-yellow-300/50", chart: "#facc15", text: "text-yellow-200" },
  herbs: { button: "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100", active: "bg-fuchsia-400/25 ring-fuchsia-300/50", chart: "#e879f9", text: "text-fuchsia-200" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON from /api/galaxy
type GalaxyPost = (body: Record<string, unknown>) => Promise<{ res: Response; data: Record<string, any> }>;

// The price chart: the last trades of one resource as a line with a soft fill. With only one point
// (no trades yet) it draws a flat line at that price instead of nothing.
function PriceChart({ values, color }: { values: number[]; color: string }) {
  const W = 320;
  const H = 96;
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const min = Math.max(0, lo - pad);
  const range = Math.max(1, hi + pad - min);
  const xy = pts.map((v, i) => [4 + (i / (pts.length - 1)) * (W - 8), H - 6 - ((v - min) / range) * (H - 12)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  // The SVG stretches to the box's width; the dot and labels are HTML so they don't stretch with it.
  return (
    <div className="relative h-20 w-full" role="img" aria-label={`Price chart, latest ${pts[pts.length - 1]} credits`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {[H * 0.25, H * 0.5, H * 0.75].map((y) => (
          <line key={y} x1="0" x2={W} y1={y} y2={y} className="stroke-white/[0.07]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={`4,${H} ${line} ${W - 4},${H}`} fill={color} opacity="0.12" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${(lx / W) * 100}%`, top: `${(ly / H) * 100}%`, background: color }} />
      <span className="absolute right-1 top-0 text-[9px] tabular-nums text-white/35">{Math.round(hi)}</span>
      <span className="absolute bottom-0 right-1 text-[9px] tabular-nums text-white/35">{Math.round(lo)}</span>
    </div>
  );
}

export function GalaxyMarket({
  sim,
  worldId,
  post,
  sync,
  onMessage,
}: {
  sim: PlanetSim;
  worldId: string;
  galaxy?: string | null;
  post: GalaxyPost;
  sync: () => Promise<boolean>;
  onMessage?: (message: string) => void;
}) {
  const [orders, setOrders] = useState<MarketOrder[]>([]);
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [prices, setPrices] = useState<MarketPrice[]>([]);
  const [history, setHistory] = useState<MarketPricePoint[]>([]);
  const [shared, setShared] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [resource, setResource] = useState<keyof Resources>("metal");
  const [side, setSide] = useState<"buy" | "sell" | null>(null); // the order form, open for buying or selling
  const [price, setPrice] = useState(BASE_PRICE.metal);
  const [quantity, setQuantity] = useState(10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [, setTick] = useState(0); // re-render so "you have" stays current

  const tell = (text: string, bad = false) => {
    setNote({ text, bad });
    onMessage?.(text);
  };

  const loadMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/galaxy?market=1&worldId=${encodeURIComponent(worldId)}`);
      const data = await res.json();
      if (!res.ok) return;
      setOrders((data.orders ?? []) as MarketOrder[]);
      setTrades((data.trades ?? []) as MarketTrade[]);
      setPrices((data.prices ?? []) as MarketPrice[]);
      setHistory((data.history ?? []) as MarketPricePoint[]);
      setShared(data.global !== false);
      setLoaded(true);
      const me = data.me as { credits?: number } | null;
      if (me?.credits != null) {
        setCredits(Number(me.credits));
        sim.marketCredits = Math.max(0, Math.floor(Number(me.credits)));
      }
    } catch {}
  }, [worldId, sim]);

  useEffect(() => {
    void loadMarket();
    const poll = window.setInterval(() => void loadMarket(), 4000);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [loadMarket]);

  const style = RESOURCE_STYLE[resource];
  const current = Number(prices.find((p) => p.resource === resource)?.current_price ?? BASE_PRICE[resource]);
  const points = history.filter((p) => p.resource === resource).map((p) => Number(p.price)).slice(-60);
  const chart = points.length ? points : [current];
  const first = chart[0];
  const change = first > 0 ? ((chart[chart.length - 1] - first) / first) * 100 : 0;
  const bids = orders.filter((o) => o.side === "buy" && o.resource === resource).sort((a, b) => b.price - a.price || a.created_at.localeCompare(b.created_at));
  const asks = orders.filter((o) => o.side === "sell" && o.resource === resource).sort((a, b) => a.price - b.price || a.created_at.localeCompare(b.created_at));
  const mine = orders.filter((o) => o.world_id === worldId);
  const recent = trades.filter((t) => t.resource === resource).slice(0, 4);
  const have = Math.floor(sim.resources[resource]);
  const total = price * quantity;

  const pick = (r: keyof Resources) => {
    setResource(r);
    const p = Number(prices.find((x) => x.resource === r)?.current_price ?? BASE_PRICE[r]);
    setPrice(p);
    setNote(null);
  };

  const open = (s: "buy" | "sell") => {
    setSide(s);
    // Start at a price that trades straight away if anyone is on the other side.
    setPrice(s === "buy" ? (asks[0]?.price ?? current) : (bids[0]?.price ?? current));
    setQuantity(s === "sell" ? Math.max(1, Math.min(10, have)) : 10);
    setNote(null);
  };

  const placeOrder = async () => {
    if (!side) return;
    if (side === "buy" && credits != null && total > credits) return tell(`Not enough credits: you have ${credits.toLocaleString()}, this order needs ${total.toLocaleString()}.`, true);
    if (side === "sell" && have < quantity) return tell(`Not enough ${resource}: you have ${have}.`, true);
    setBusy(true);
    await sync(); // so the database knows what we hold right now
    const { data } = await post({ action: "place_order", side, resource, price, quantity });
    setBusy(false);
    if (data.error) return tell(String(data.error).replace(/^Galaxy database action failed$/, "Couldn't reach the market. Try again."), true);
    const filled = Number(data.filled ?? quantity - Number(data.remaining ?? quantity));
    const left = Number(data.remaining ?? 0);
    const verb = side === "buy" ? "Bought" : "Sold";
    tell(
      filled > 0 && left === 0
        ? `${verb} ${filled} ${resource}.`
        : filled > 0
          ? `${verb} ${filled} ${resource}; ${left} more waiting in the book.`
          : `Order placed: ${quantity} ${resource} at ${price} credits each, waiting for a ${side === "buy" ? "seller" : "buyer"}.`,
    );
    setSide(null);
    await sync(); // brings the held goods and any fill into the game
    await loadMarket();
  };

  const cancelOrder = async (orderId: number) => {
    const { data } = await post({ action: "cancel_order", orderId });
    tell(data.error ? String(data.error) : "Order cancelled. What it held is back in your stockpile.", !!data.error);
    await sync(); // the refund
    await loadMarket();
  };

  const row = (o: MarketOrder, kind: "bid" | "ask") => (
    <div key={o.id} className="flex items-center justify-between gap-2 border-t border-white/[0.05] py-1.5">
      <span className="tabular-nums">
        {o.remaining} × <span className={kind === "bid" ? "text-emerald-200" : "text-rose-200"}>{o.price}</span>
      </span>
      {o.world_id === worldId ? (
        <button onClick={() => cancelOrder(o.id)} className="text-[11px] text-rose-300 hover:text-rose-200">
          You · cancel
        </button>
      ) : (
        <span className="min-w-0 truncate text-[11px] text-white/40">{o.planet_name}</span>
      )}
    </div>
  );

  const field = "mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.07] px-3 py-2 text-sm tabular-nums text-white outline-none focus:border-white/25";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Resource">
          {RESOURCES.map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={resource === item}
              onClick={() => pick(item)}
              className={`rounded-full border px-2.5 py-1 text-xs capitalize transition ${RESOURCE_STYLE[item].button} ${resource === item ? `${RESOURCE_STYLE[item].active} ring-1` : "opacity-50 hover:opacity-100"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold text-amber-200 tabular-nums">{credits == null ? "…" : credits.toLocaleString()} credits</span>
      </div>

      <p className="text-[11px] text-white/40">
        {shared ? "One market for every god in every galaxy." : "Your galaxy's market. (Run migration 012 to open one market for everyone.)"}
      </p>

      <div className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-white/55">{points.length > 1 ? `Last ${points.length} trades` : "No trades yet: starting price"}</span>
          <span className={`font-semibold tabular-nums ${style.text}`}>
            {current.toLocaleString()} credits
            {points.length > 1 && (
              <span className="ml-2 text-[10px]">
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
        <PriceChart values={chart} color={style.chart} />
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <div className="rounded-lg border border-emerald-300/10 bg-emerald-400/[0.07] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-emerald-200/60">Best bid</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-100">
            {bids[0]?.price ?? "--"} <span className="text-[11px] font-normal text-white/40">credits</span>
          </p>
        </div>
        <div className="rounded-lg border border-rose-300/10 bg-rose-400/[0.07] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-rose-200/60">Best ask</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-rose-100">
            {asks[0]?.price ?? "--"} <span className="text-[11px] font-normal text-white/40">credits</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => open("buy")} className={`min-w-20 rounded-lg border border-emerald-300/20 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/25 ${side === "buy" ? "bg-emerald-400/30 ring-1 ring-emerald-300/40" : "bg-emerald-400/15"}`}>
            Buy
          </button>
          <button onClick={() => open("sell")} className={`min-w-20 rounded-lg border border-rose-300/20 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/25 ${side === "sell" ? "bg-rose-400/30 ring-1 ring-rose-300/40" : "bg-rose-400/15"}`}>
            Sell
          </button>
        </div>
      </div>

      {side && (
        <form
          className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void placeOrder();
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold capitalize">
              {side} {resource}
            </p>
            <p className="text-xs text-white/45 tabular-nums">
              You have {have} {resource} · {credits == null ? "…" : credits.toLocaleString()} credits
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-white/55">
              Credits each
              <input id="market-price" type="number" min={1} max={1000000000} value={price} onChange={(e) => { setPrice(Math.max(1, Math.floor(Number(e.target.value)) || 1)); setNote(null); }} className={field} />
            </label>
            <label className="text-xs text-white/55">
              Quantity
              <input id="market-quantity" type="number" min={1} max={100000} value={quantity} onChange={(e) => { setQuantity(Math.max(1, Math.floor(Number(e.target.value)) || 1)); setNote(null); }} className={field} />
            </label>
          </div>
          <p className="mt-2 text-xs text-white/50 tabular-nums">
            {side === "buy" ? `Costs up to ${total.toLocaleString()} credits, held until it fills.` : `Earns ${total.toLocaleString()} credits. Your ${quantity} ${resource} are held until it fills.`}{" "}
            {side === "buy" && asks[0] && price >= asks[0].price ? "Fills now." : side === "sell" && bids[0] && price <= bids[0].price ? "Fills now." : `Waits for a ${side === "buy" ? "seller" : "buyer"}.`}
          </p>
          {note?.bad && (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {note.text}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button disabled={busy} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${side === "buy" ? "bg-emerald-400/25 text-emerald-50 hover:bg-emerald-400/35" : "bg-rose-400/25 text-rose-50 hover:bg-rose-400/35"}`}>
              {busy ? "Placing…" : `Place ${side} order`}
            </button>
            <button type="button" onClick={() => { setSide(null); setNote(null); }} className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
              Cancel
            </button>
          </div>
        </form>
      )}

      {note && !(side && note.bad) && (
        <p role={note.bad ? "alert" : "status"} className={`text-xs ${note.bad ? "text-rose-300" : "text-sky-200"}`}>
          {note.text}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-semibold text-emerald-200">Buying (bids)</p>
          {bids.length ? bids.slice(0, 6).map((o) => row(o, "bid")) : <p className="border-t border-white/[0.05] py-1.5 text-white/35">{loaded ? "No one is buying yet." : "Loading…"}</p>}
        </div>
        <div>
          <p className="mb-1 font-semibold text-rose-200">Selling (asks)</p>
          {asks.length ? asks.slice(0, 6).map((o) => row(o, "ask")) : <p className="border-t border-white/[0.05] py-1.5 text-white/35">{loaded ? "No one is selling yet." : "Loading…"}</p>}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="border-t border-white/[0.07] pt-2 text-xs">
          <p className="mb-1 text-white/45">Recent trades</p>
          {recent.map((t) => (
            <p key={t.id} className="flex justify-between gap-2 py-0.5 text-white/60">
              <span className="min-w-0 truncate">
                {t.seller_world_id === worldId ? "You" : t.seller_name} → {t.buyer_world_id === worldId ? "you" : t.buyer_name}
              </span>
              <span className="shrink-0 tabular-nums">
                {t.quantity} at <strong className="text-white/80">{t.price}</strong>
              </span>
            </p>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <p className="text-[11px] text-white/40">
          You have {mine.length} open order{mine.length === 1 ? "" : "s"} ({[...new Set(mine.map((o) => o.resource))].join(", ")}). Open orders stay in the market until they fill or you cancel them.
        </p>
      )}
    </div>
  );
}
