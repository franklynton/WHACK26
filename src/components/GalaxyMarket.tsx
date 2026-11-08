"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";

export interface MarketOrder {
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

export function GalaxyMarket({
  sim,
  worldId,
  galaxy,
  post,
  sync,
  onMessage,
}: {
  sim: PlanetSim;
  worldId: string;
  galaxy: string | null;
  post: GalaxyPost;
  sync: () => Promise<boolean>;
  onMessage: (message: string) => void;
}) {
  const [orders, setOrders] = useState<MarketOrder[]>([]);
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [resource, setResource] = useState<keyof Resources>("gold");
  const [price, setPrice] = useState(10);
  const [quantity, setQuantity] = useState(10);
  const [credits, setCredits] = useState(1000);
  const [orderPanel, setOrderPanel] = useState<"buy" | "sell" | null>(null);
  const [prices, setPrices] = useState<MarketPrice[]>([]);
  const [history, setHistory] = useState<MarketPricePoint[]>([]);

  const loadMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/galaxy?market=1&worldId=${encodeURIComponent(worldId)}`);
      const data = await res.json();
      if (!res.ok) return;
      setOrders((data.orders ?? []) as MarketOrder[]);
      setTrades((data.trades ?? []) as MarketTrade[]);
      setPrices((data.prices ?? []) as MarketPrice[]);
      const me = data.me as { credits?: number } | null;
      const nextHistory = (data.history ?? []) as MarketPricePoint[];
      setHistory(nextHistory);
      if (me?.credits != null) {
        setCredits(Number(me.credits));
        sim.marketCredits = Math.max(0, Math.floor(Number(me.credits)));
      }
    } catch {}
  }, [worldId, sim]);

  useEffect(() => {
    if (!galaxy) return;
    void loadMarket();
    const timer = window.setInterval(() => void loadMarket(), 5000);
    return () => window.clearInterval(timer);
  }, [galaxy, loadMarket]);

  const placeOrder = async () => {
    if (!galaxy) return onMessage("Join a galaxy before placing an order.");
    await sync();
    const { data } = await post({ action: "place_order", side, resource, price, quantity });
    onMessage(data.error || `Order ${data.status ?? "placed"}${data.remaining != null ? ` (${data.remaining} remaining)` : ""}`);
    await sync();
    if (!data.error) setOrderPanel(null);
    await sync();
    await loadMarket();
  };

  const cancelOrder = async (orderId: number) => {
    const { data } = await post({ action: "cancel_order", orderId });
    onMessage(data.error || "Order cancelled.");
    await sync();
    await loadMarket();
  };

  const values = history.filter((point) => point.resource === resource).map((point) => Number(point.price));
  const base = prices.find((marketPrice) => marketPrice.resource === resource)?.base_price ?? 10;
  const chartValues = values.length ? values : [base];
  const min = Math.max(0, Math.min(base, ...chartValues) - 1);
  const max = Math.max(base, ...chartValues) + 1;
  const range = Math.max(1, max - min);
  const coordinates = chartValues.map((value, index) => {
    const x = chartValues.length === 1 ? 160 : 4 + (index / (chartValues.length - 1)) * 312;
    const y = 92 - ((value - min) / range) * 84;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const current = chartValues[chartValues.length - 1];
  const previous = chartValues.length > 1 ? chartValues[chartValues.length - 2] : base;
  const changePercent = base > 0 ? ((current - previous) / previous) * 100 : 0;
  const style = RESOURCE_STYLE[resource] ?? RESOURCE_STYLE.gold;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          {RESOURCES.map((item) => (
            <button key={item} onClick={() => setResource(item)} className={`rounded-full border px-2.5 py-1 text-xs capitalize transition ${RESOURCE_STYLE[item].button} ${resource === item ? `${RESOURCE_STYLE[item].active} ring-1` : "opacity-50 hover:opacity-100"}`}>
              {item}
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold text-amber-200">{credits.toLocaleString()} credits</span>
      </div>
      <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-white/55">Price history</span>
          <span className={`font-semibold ${style.text}`}>
            {current.toLocaleString()} credits
            <span className="ml-2 text-[10px]">{changePercent >= 0 ? "+" : ""}{changePercent.toFixed(1)}%</span>
          </span>
        </div>
        <svg viewBox="0 0 320 96" className="h-16 w-full" role="img" aria-label={`Current price ${current} credits`}>
          {[0, 46, 92].map((y) => <line key={y} x1="4" x2="316" y1={y} y2={y} className="stroke-white/10" strokeWidth="1" />)}
          <polyline points={coordinates.join(" ")} fill="none" stroke={style.chart} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <div className="rounded-lg border border-emerald-300/10 bg-emerald-400/[0.07] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-emerald-200/60">Best bid</p>
          <p className="mt-0.5 text-sm font-semibold text-emerald-100">
            {Math.max(0, ...orders.filter((order) => order.side === "buy" && order.resource === resource).map((order) => order.price)) || "--"} <span className="text-[11px] font-normal text-white/40">credits</span>
          </p>
        </div>
        <div className="rounded-lg border border-rose-300/10 bg-rose-400/[0.07] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-rose-200/60">Best ask</p>
          <p className="mt-0.5 text-sm font-semibold text-rose-100">
            {orders.filter((order) => order.side === "sell" && order.resource === resource).length ? Math.min(...orders.filter((order) => order.side === "sell" && order.resource === resource).map((order) => order.price)) : "--"} <span className="text-[11px] font-normal text-white/40">credits</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setSide("buy"); setOrderPanel("buy"); }} className="min-w-20 rounded-lg border border-emerald-300/20 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/25">Buy</button>
          <button onClick={() => { setSide("sell"); setOrderPanel("sell"); }} className="min-w-20 rounded-lg border border-rose-300/20 bg-rose-400/15 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/25">Sell</button>
        </div>
      </div>
      {trades.length > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-white/[0.07] pt-2 text-xs text-white/45">
          <span>Last trade</span>
          <span>{trades[0].quantity} {trades[0].resource} at <strong className="text-white/70">{trades[0].price} credits</strong></span>
        </div>
      )}
      {orderPanel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={() => setOrderPanel(null)}>
          <div className="w-[28rem] rounded-2xl border border-white/10 bg-[#111425]/95 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${orderPanel} ${resource} order`}>
            <div className="mb-4 flex items-center justify-between">
              <div><p className="text-base font-semibold capitalize">{orderPanel} {resource}</p><p className="mt-0.5 text-xs text-white/45">{credits.toLocaleString()} credits available</p></div>
              <button onClick={() => setOrderPanel(null)} className="rounded-lg px-2 py-1 text-white/45 hover:bg-white/5 hover:text-white" aria-label="Close order form">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-white/55">Credits / unit
                <input type="number" min={1} max={1000000000} value={price} onChange={(event) => setPrice(Math.max(1, Number(event.target.value) || 1))} className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.07] px-3 py-2 text-sm text-white outline-none focus:border-white/20" />
              </label>
              <label className="text-xs text-white/55">Quantity
                <input type="number" min={1} max={100000} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.07] px-3 py-2 text-sm text-white outline-none focus:border-white/20" />
              </label>
            </div>
            <button onClick={placeOrder} className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold ${orderPanel === "buy" ? "bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30" : "bg-rose-400/20 text-rose-100 hover:bg-rose-400/30"}`}>Place {orderPanel} order</button>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-3 text-xs">
              <div>
                <p className="mb-1 font-semibold text-emerald-200">Bids</p>
                {orders.filter((order) => order.side === "buy" && order.resource === resource).sort((a, b) => b.price - a.price || a.created_at.localeCompare(b.created_at)).slice(0, 6).map((order) => (
                  <div key={order.id} className="flex justify-between border-t border-white/[0.05] py-1.5">
                    <span>{order.remaining} × {order.price}</span>
                    {order.world_id === worldId ? <button onClick={() => cancelOrder(order.id)} className="text-rose-300 hover:text-rose-200">Cancel</button> : <span className="text-white/30">bid</span>}
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 font-semibold text-rose-200">Asks</p>
                {orders.filter((order) => order.side === "sell" && order.resource === resource).sort((a, b) => a.price - b.price || a.created_at.localeCompare(b.created_at)).slice(0, 6).map((order) => (
                  <div key={order.id} className="flex justify-between border-t border-white/[0.05] py-1.5">
                    <span>{order.remaining} × {order.price}</span>
                    {order.world_id === worldId ? <button onClick={() => cancelOrder(order.id)} className="text-rose-300 hover:text-rose-200">Cancel</button> : <span className="text-white/30">ask</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
