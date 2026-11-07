"use client";
// Trade offers between gods in the same galaxy: "I'll give you 50 metal for 40 of your food".
// The offered goods are held by the database as soon as the offer is made; the other god has
// 30 seconds to accept or decline, and anything but an accept gives them back (migration 009).
// The new totals reach each game with its next sync (migration 008), so this file only asks and shows.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanetSim } from "@/sim/planet";
import type { Resources } from "@/types/world";

type Resource = keyof Resources;
const RESOURCES: Resource[] = ["food", "wood", "stone", "metal", "gold", "herbs"];
export const ICON: Record<Resource, string> = { food: "🌾", wood: "🪵", stone: "🪨", metal: "⚙️", gold: "💰", herbs: "🌿" };
const SECONDS = 30;

export interface Offer {
  id: number;
  from_world_id: string;
  to_world_id: string;
  from_name: string;
  to_name: string;
  give_resource: Resource;
  give_amount: number;
  want_resource: Resource;
  want_amount: number;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  reason: string | null;
  seconds_left: number;
  seen_at: number; // when we fetched it, to count down locally between polls
}

type Post = (body: Record<string, unknown>) => Promise<{ res: Response; data: Record<string, unknown> }>;
const goods = (n: number, r: Resource) => `${n} ${r}`;

// Why an offer couldn't be made or accepted, worded like a form error.
function offerError(reason: unknown, have?: unknown, r?: Resource) {
  switch (reason) {
    case "not_enough":
      return `You only have ${Number(have) || 0} ${r ?? ""}.`.replace(" .", ".");
    case "same_resource":
      return "Pick two different resources.";
    case "too_many":
      return "You already have 3 offers waiting. Wait for an answer or take one back.";
    case "not_in_galaxy":
      return "That god isn't in your galaxy any more.";
    case "gone":
      return "That offer has already ended.";
    case "not_migrated":
      return "Trade offers aren't set up yet: run migration 009 in Supabase.";
    case "invalid":
      return "Amounts must be between 1 and 100,000.";
    default:
      return "Couldn't reach the galaxy. Try again.";
  }
}

// Polls offers to and from this planet every 2 seconds while we're in a galaxy, and tells the
// player how their own offers ended.
export function useTradeOffers({ worldId, post, sync, sim, active }: { worldId: string; post: Post; sync: () => Promise<boolean>; sim: PlanetSim; active: boolean }) {
  const [incoming, setIncoming] = useState<Offer[]>([]);
  const [outgoing, setOutgoing] = useState<Offer[]>([]);
  const [ready, setReady] = useState(true); // false when migration 009 hasn't been run
  const [, setTick] = useState(0);
  const told = useRef<Set<number> | null>(null); // our offers whose ending we've already announced

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/galaxy?offers=1&worldId=${encodeURIComponent(worldId)}`);
      const data = await res.json();
      if (!res.ok) return;
      setReady(data.offers !== false);
      const now = Date.now();
      const stamp = (list: Offer[]) => (list ?? []).map((o) => ({ ...o, seen_at: now }));
      setIncoming(stamp(data.incoming));
      const mine = stamp(data.outgoing) as Offer[];
      setOutgoing(mine);
      // Announce how our offers ended (not the ones that had already ended when the game opened).
      const ended = mine.filter((o) => o.status !== "pending");
      if (!told.current) told.current = new Set(ended.map((o) => o.id));
      else
        for (const o of ended) {
          if (told.current.has(o.id)) continue;
          told.current.add(o.id);
          if (o.status === "accepted") sim.galaxyNews("🤝", "Trade accepted", `${o.to_name} took your ${goods(o.give_amount, o.give_resource)} for ${goods(o.want_amount, o.want_resource)}.`, false);
          else if (o.status !== "cancelled" || o.reason !== "Taken back")
            sim.galaxyNews("↩️", o.status === "declined" ? "Offer declined" : "Offer ended", `${o.to_name} ${o.status === "declined" ? "said no" : o.status === "expired" ? "didn't answer in time" : "left the galaxy"}. Your ${goods(o.give_amount, o.give_resource)} came back.`);
          void sync(); // the swap or refund reaches the game now rather than in a few seconds
        }
    } catch {}
  }, [worldId, sim, sync]);

  useEffect(() => {
    if (!active) {
      setIncoming([]);
      setOutgoing([]);
      return;
    }
    void load();
    const poll = window.setInterval(() => void load(), 2000);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000); // the countdowns
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [active, load]);

  // Makes an offer; returns an error message, or "" when it was sent.
  const make = async (target: string, give: Resource, giveAmount: number, want: Resource, wantAmount: number) => {
    if (give === want) return offerError("same_resource");
    if (giveAmount < 1 || wantAmount < 1) return offerError("invalid");
    if (Math.floor(sim.resources[give]) < giveAmount) return offerError("not_enough", Math.floor(sim.resources[give]), give);
    await sync(); // so the database knows what we hold right now
    const { data } = await post({ action: "offer", targetWorldId: target, giveResource: give, giveAmount, wantResource: want, wantAmount });
    if (!data.ok) return offerError(data.reason, data.have, give);
    await sync(); // the offered goods leave the stockpile straight away
    await load();
    return "";
  };

  const answer = async (o: Offer, accept: boolean) => {
    if (accept) await sync(); // so the database knows what we hold right now
    const { data } = await post({ action: "answer_offer", offerId: o.id, accept });
    if (accept && data.ok) sim.galaxyNews("🤝", "Trade done", `You gave ${o.from_name} ${goods(o.want_amount, o.want_resource)} for ${goods(o.give_amount, o.give_resource)}.`, false);
    await sync();
    await load();
    return data.ok ? "" : offerError(data.reason, data.have, o.want_resource);
  };

  const cancel = async (o: Offer) => {
    await post({ action: "cancel_offer", offerId: o.id });
    await sync();
    await load();
  };

  return { incoming, outgoing, ready, make, answer, cancel };
}
export type TradeOffersState = ReturnType<typeof useTradeOffers>;

const secondsLeft = (o: Offer) => Math.max(0, o.seconds_left - Math.floor((Date.now() - o.seen_at) / 1000));

function Countdown({ o }: { o: Offer }) {
  const left = secondsLeft(o);
  return (
    <div className="mt-2 flex items-center gap-2" aria-label={`${left} seconds left`}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${left <= 10 ? "bg-rose-400" : "bg-amber-300"}`} style={{ width: `${(left / SECONDS) * 100}%` }} />
      </div>
      <span className={`w-7 text-right text-xs tabular-nums ${left <= 10 ? "text-rose-300" : "text-white/60"}`}>{left}s</span>
    </div>
  );
}

// Picks one of the six resources, showing how much of each the player holds (or the other god, for "want").
function ResourcePicker({ value, onChange, holdings, id }: { value: Resource; onChange: (r: Resource) => void; holdings?: Resources; id: string }) {
  return (
    <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-labelledby={id}>
      {RESOURCES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={`rounded-md px-2 py-1 text-left text-xs transition ${value === r ? "bg-sky-400/25 ring-1 ring-sky-300" : "bg-white/5 hover:bg-white/10"}`}
        >
          <span className="capitalize">
            {ICON[r]} {r}
          </span>
          {holdings && <span className="block tabular-nums text-white/45">{Math.floor(holdings[r])}</span>}
        </button>
      ))}
    </div>
  );
}

// The form for one planet: what we give, what we want back.
function OfferForm({ target, sim, offers, onDone }: { target: { world_id: string; planet_name: string }; sim: PlanetSim; offers: TradeOffersState; onDone: () => void }) {
  const [give, setGive] = useState<Resource>("metal");
  const [giveAmount, setGiveAmount] = useState(20);
  const [want, setWant] = useState<Resource>("food");
  const [wantAmount, setWantAmount] = useState(20);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const amountBox = "w-24 rounded-lg bg-white/10 px-3 py-1.5 text-sm tabular-nums outline-none focus:ring-1 focus:ring-sky-300";
  const num = (v: string) => Math.max(0, Math.min(100000, Math.floor(Number(v)) || 0));
  return (
    <form
      className="mt-3 space-y-3 border-t border-white/10 pt-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const why = await offers.make(target.world_id, give, giveAmount, want, wantAmount);
        setBusy(false);
        setError(why);
        if (!why) onDone();
      }}
    >
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label id={`give-${target.world_id}`} className="text-xs font-semibold text-white/70">You give</label>
          <input aria-label="Amount to give" type="number" min={1} value={giveAmount || ""} onChange={(e) => { setGiveAmount(num(e.target.value)); setError(""); }} className={amountBox} />
        </div>
        <ResourcePicker id={`give-${target.world_id}`} value={give} onChange={(r) => { setGive(r); setError(""); }} holdings={sim.resources} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label id={`want-${target.world_id}`} className="text-xs font-semibold text-white/70">You want from {target.planet_name}</label>
          <input aria-label="Amount wanted" type="number" min={1} value={wantAmount || ""} onChange={(e) => { setWantAmount(num(e.target.value)); setError(""); }} className={amountBox} />
        </div>
        <ResourcePicker id={`want-${target.world_id}`} value={want} onChange={(r) => { setWant(r); setError(""); }} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button disabled={busy} className="flex-1 rounded-lg bg-amber-400/25 px-3 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-400/35 disabled:opacity-50">
          {busy ? "Sending…" : `Offer ${giveAmount || 0} ${give} for ${wantAmount || 0} ${want}`}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-white/45">Your {give} is held while they decide. They have {SECONDS} seconds; if they say no or don&apos;t answer, it comes back.</p>
    </form>
  );
}

const STATUS: Record<Offer["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "bg-amber-400/15 text-amber-200" },
  accepted: { label: "Accepted", cls: "bg-emerald-400/15 text-emerald-200" },
  declined: { label: "Declined", cls: "bg-rose-400/15 text-rose-200" },
  expired: { label: "No answer", cls: "bg-white/10 text-white/60" },
  cancelled: { label: "Cancelled", cls: "bg-white/10 text-white/60" },
};

// The Offers tab of the Galaxy panel: the other gods to offer to, and our recent offers.
export function OffersTab({ planets, sim, spacefaring, offers }: { planets: { world_id: string; planet_name: string; planet_type: string; owner_name: string }[]; sim: PlanetSim; spacefaring: boolean; offers: TradeOffersState }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!offers.ready) return <p className="text-sm text-amber-200">Trade offers aren&apos;t set up yet: run migration 009 in Supabase.</p>;
  return (
    <div className="space-y-3">
      {!spacefaring && <p className="text-xs text-white/45">🔒 Trading unlocks when your people reach the Space Age.</p>}
      {planets.length === 0 && <p className="text-sm text-white/50">No other gods here yet. Share your galaxy code so someone can join.</p>}
      {planets.map((p) => (
        <article key={p.world_id} className="rounded-lg bg-white/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.planet_name}</p>
              <p className="text-xs text-white/50">
                {p.planet_type} · god: {p.owner_name}
              </p>
            </div>
            {open !== p.world_id && (
              <button disabled={!spacefaring} onClick={() => setOpen(p.world_id)} className="shrink-0 rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/25 disabled:opacity-40">
                Make an offer
              </button>
            )}
          </div>
          {open === p.world_id && <OfferForm target={p} sim={sim} offers={offers} onDone={() => setOpen(null)} />}
        </article>
      ))}
      {offers.outgoing.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">Your offers</p>
          <ul className="space-y-1.5">
            {offers.outgoing.map((o) => (
              <li key={o.id} className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    {ICON[o.give_resource]} {goods(o.give_amount, o.give_resource)} → {o.to_name} for {ICON[o.want_resource]} {goods(o.want_amount, o.want_resource)}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                </div>
                {o.status === "pending" && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Countdown o={o} />
                    </div>
                    <button onClick={() => offers.cancel(o)} className="mt-2 text-[11px] text-rose-300 hover:text-rose-200">
                      Take back
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Offers sent to us: cards over the game (the Galaxy panel needn't be open), each with a 30s countdown.
export function IncomingOffers({ sim, offers }: { sim: PlanetSim; offers: TradeOffersState }) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const live = offers.incoming.filter((o) => secondsLeft(o) > 0).slice(0, 3);
  if (live.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-40 flex w-[22rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {live.map((o) => {
        const have = Math.floor(sim.resources[o.want_resource]);
        const short = have < o.want_amount;
        const answer = async (accept: boolean) => {
          setBusy(o.id);
          const why = await offers.answer(o, accept);
          setBusy(null);
          setErrors((e) => ({ ...e, [o.id]: why }));
        };
        return (
          <section key={o.id} className="glass pointer-events-auto p-4 shadow-2xl" aria-label={`Trade offer from ${o.from_name}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">🤝 Trade offer from {o.from_name}</p>
            <p className="mt-1.5 text-sm leading-snug">
              They give <b>{ICON[o.give_resource]} {goods(o.give_amount, o.give_resource)}</b>
              <br />
              and want <b>{ICON[o.want_resource]} {goods(o.want_amount, o.want_resource)}</b> <span className={short ? "text-rose-300" : "text-white/45"}>(you have {have})</span>
            </p>
            <Countdown o={o} />
            {errors[o.id] && (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                {errors[o.id]}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                disabled={short || busy === o.id}
                onClick={() => answer(true)}
                title={short ? `You need ${o.want_amount} ${o.want_resource}` : "Accept the trade"}
                className="flex-1 rounded-lg bg-emerald-400/25 px-3 py-1.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-400/35 disabled:opacity-40"
              >
                Accept
              </button>
              <button disabled={busy === o.id} onClick={() => answer(false)} className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15 disabled:opacity-40">
                Decline
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
