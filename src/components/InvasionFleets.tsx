"use client";
// Invasions between planets (migration 011). A fleet takes 30 seconds to arrive, and the defender
// sees it coming: they can fight, pay tribute, or spend devotion on shields. The database settles the
// battle and moves the loot; each game then applies its own half (Galaxy.tsx `apply`).
import { useCallback, useEffect, useState } from "react";
import { SHIELD_COST, type PlanetSim } from "@/sim/planet";

export interface Fleet {
  id: number;
  from_world_id: string;
  to_world_id: string;
  from_name: string;
  to_name: string;
  fleet: number;
  answer: "fight" | "tribute" | "shields";
  seconds_left: number;
  seen_at: number; // when we fetched it, to count down locally between polls
}

type Post = (body: Record<string, unknown>) => Promise<{ res: Response; data: Record<string, unknown> }>;
export const FLIGHT_SECONDS = 30;
export const fleetSecondsLeft = (f: Fleet) => Math.max(0, f.seconds_left - Math.floor((Date.now() - f.seen_at) / 1000));

function launchError(reason: unknown, seconds?: unknown) {
  switch (reason) {
    case "flying":
      return "Your fleet is still in flight.";
    case "cooldown":
      return `Your fleet is resting. Try again in ${Number(seconds) || 0}s.`;
    case "no_army":
      return "You have no soldiers to send.";
    case "not_in_galaxy":
      return "That god isn't in your galaxy any more.";
    default:
      return "The fleet couldn't launch. Try again.";
  }
}

// Polls fleets to and from this planet every 2 seconds while we're in a galaxy. Each poll also
// settles fleets that have arrived, so results come in even if the other god's tab is closed.
export function useFleets({ worldId, post, sync, sim, active, onSettled }: { worldId: string; post: Post; sync: () => Promise<boolean>; sim: PlanetSim; active: boolean; onSettled: () => void }) {
  const [incoming, setIncoming] = useState<Fleet[]>([]);
  const [outgoing, setOutgoing] = useState<Fleet[]>([]);
  const [ready, setReady] = useState(true); // false until migration 011 is run (then the old instant invasion is used)
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/galaxy?fleets=1&worldId=${encodeURIComponent(worldId)}`);
      const data = await res.json();
      if (!res.ok) return;
      setReady(data.fleets !== false);
      const now = Date.now();
      setIncoming((data.incoming ?? []).map((f: Fleet) => ({ ...f, seen_at: now })));
      setOutgoing((data.outgoing ?? []).map((f: Fleet) => ({ ...f, seen_at: now })));
      if (data.settled > 0) onSettled(); // a battle just happened: pick up its result now
    } catch {}
  }, [worldId, onSettled]);

  useEffect(() => {
    if (!active) {
      setIncoming([]);
      setOutgoing([]);
      return;
    }
    void load();
    const poll = window.setInterval(() => void load(), 2000);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [active, load]);

  // Sends `share` of our army at a planet. Returns a message for the player, or null when
  // migration 011 isn't run yet (the caller then uses the old instant invasion).
  const launch = async (target: string, share: number): Promise<string | null> => {
    const fleet = Math.round(sim.soldiers() * share);
    if (fleet < 1) return launchError("no_army");
    await sync(); // so the database knows our defence right now
    const { data } = await post({ action: "launch_invasion", targetWorldId: target, fleet, attack: sim.invasionAttack(fleet) });
    if (data.reason === "not_migrated") {
      setReady(false);
      return null;
    }
    if (!data.ok) return launchError(data.reason, data.seconds);
    const sent = sim.launchSpaceFleet(Number(data.fleet) || fleet);
    await load();
    return `${sent} soldiers are on their way. They land in ${FLIGHT_SECONDS} seconds.`;
  };

  const answer = async (f: Fleet, choice: Fleet["answer"]): Promise<string> => {
    if (choice === "shields" && !sim.raiseShields()) return `Shields cost ${SHIELD_COST} devotion.`;
    if (choice === "tribute") await sync(); // so the tribute comes out of what we hold right now
    const { data } = await post({ action: "answer_invasion", fleetId: f.id, answer: choice });
    if (!data.ok) {
      if (choice === "shields") sim.devotion += SHIELD_COST; // the fleet had already landed: refund
      return data.reason === "gone" ? "Too late: the fleet has landed." : "Couldn't answer. Try again.";
    }
    if (choice === "tribute") {
      sim.galaxyNews("💰", "Tribute paid", `You paid ${f.from_name} ${data.gold ?? 0} gold and ${data.food ?? 0} food. Their fleet turned back.`, false);
      await sync();
    }
    await load();
    return "";
  };

  return { incoming, outgoing, ready, launch, answer };
}
export type FleetsState = ReturnType<typeof useFleets>;

// A fleet coming at us: a card over the game with a countdown ring, the odds, and three answers.
export function IncomingFleets({ sim, fleets }: { sim: PlanetSim; fleets: FleetsState }) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [fighting, setFighting] = useState<Record<number, boolean>>({});
  const live = fleets.incoming.filter((f) => fleetSecondsLeft(f) > 0).slice(0, 2);
  if (live.length === 0) return null;
  const defence = sim.defenceStrength();
  return (
    <div className="pointer-events-none absolute right-4 top-20 z-40 flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col gap-3" aria-live="assertive">
      {live.map((f) => {
        const left = fleetSecondsLeft(f);
        const decided = f.answer !== "fight" || fighting[f.id];
        const urgent = left <= 10;
        const R = 22, C = 2 * Math.PI * R;
        const pick = async (choice: Fleet["answer"]) => {
          setBusy(f.id);
          const why = await fleets.answer(f, choice);
          setBusy(null);
          setErrors((e) => ({ ...e, [f.id]: why }));
          if (!why && choice === "fight") setFighting((x) => ({ ...x, [f.id]: true }));
        };
        const options: { id: Fleet["answer"]; icon: string; title: string; sub: string; tone: string; off?: boolean }[] = [
          { id: "fight", icon: "⚔️", title: "Fight", sub: "Meet them on the shore", tone: "from-rose-500/30 to-rose-500/10 ring-rose-300/30 hover:from-rose-500/45" },
          { id: "tribute", icon: "💰", title: "Tribute", sub: "15% gold & food, no deaths", tone: "from-amber-400/25 to-amber-400/5 ring-amber-200/25 hover:from-amber-400/40" },
          { id: "shields", icon: "🛡️", title: "Shields", sub: `${SHIELD_COST} devotion · defence ×1.5`, tone: "from-sky-400/25 to-sky-400/5 ring-sky-200/25 hover:from-sky-400/40", off: sim.devotion < SHIELD_COST },
        ];
        return (
          <section
            key={f.id}
            className={`glass pointer-events-auto overflow-hidden border shadow-2xl ${urgent && !decided ? "border-rose-400/60 shadow-[0_0_40px_rgba(244,63,94,.35)]" : "border-rose-400/30"}`}
            aria-label={`Fleet from ${f.from_name}`}
          >
            <div className="flex items-center gap-3 bg-gradient-to-r from-rose-600/30 via-rose-500/10 to-transparent p-4">
              <div className="relative h-14 w-14 shrink-0">
                <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
                  <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
                  <circle
                    cx="28" cy="28" r={R} fill="none" stroke={urgent ? "#fb7185" : "#fda4af"} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C * (1 - left / FLIGHT_SECONDS)}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums ${urgent ? "animate-pulse text-rose-200" : "text-white"}`}>{left}</span>
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-rose-200">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-rose-400" /> Invasion incoming
                </p>
                <p className="mt-0.5 text-sm leading-snug text-white">
                  <b>{f.fleet} soldiers</b> from <b>{f.from_name}</b>
                </p>
                <p className="text-[11px] text-white/50">
                  Your defence <b className="tabular-nums text-white/80">{defence}</b>
                  {f.answer === "shields" && <span className="text-sky-200"> → {Math.round(defence * 1.5)} with shields</span>}
                </p>
              </div>
            </div>
            <div className="px-4 pb-4">
              {fighting[f.id] && f.answer === "fight" && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-100">⚔️ Your army is waiting on the shore.</p>}
              {f.answer === "shields" && <p className="mt-3 rounded-lg bg-sky-400/10 px-3 py-2 text-xs text-sky-100">🛡️ Shields up: your defence is half as strong again.</p>}
              {errors[f.id] && (
                <p role="alert" className="mt-3 text-xs text-rose-300">
                  {errors[f.id]}
                </p>
              )}
              {!decided && (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {options.map((o) => (
                      <button
                        key={o.id}
                        disabled={busy === f.id || o.off}
                        onClick={() => pick(o.id)}
                        className={`flex flex-col items-center rounded-xl bg-gradient-to-b px-2 py-2.5 text-center ring-1 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${o.tone}`}
                      >
                        <span className="text-xl">{o.icon}</span>
                        <span className="mt-1 text-xs font-bold text-white">{o.title}</span>
                        <span className="mt-0.5 text-[9.5px] leading-tight text-white/55">{o.sub}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-center text-[10.5px] text-white/40">
                    No answer means your people fight · you have {Math.floor(sim.devotion)} devotion
                  </p>
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
