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

// A fleet coming at us: a card over the game with a countdown and three answers.
export function IncomingFleets({ sim, fleets }: { sim: PlanetSim; fleets: FleetsState }) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [fighting, setFighting] = useState<Record<number, boolean>>({});
  const live = fleets.incoming.filter((f) => fleetSecondsLeft(f) > 0).slice(0, 2);
  if (live.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-20 z-40 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="assertive">
      {live.map((f) => {
        const left = fleetSecondsLeft(f);
        const decided = f.answer !== "fight" || fighting[f.id];
        const pick = async (choice: Fleet["answer"]) => {
          setBusy(f.id);
          const why = await fleets.answer(f, choice);
          setBusy(null);
          setErrors((e) => ({ ...e, [f.id]: why }));
          if (!why && choice === "fight") setFighting((x) => ({ ...x, [f.id]: true }));
        };
        return (
          <section key={f.id} className="glass pointer-events-auto border border-rose-400/30 p-4 shadow-2xl" aria-label={`Fleet from ${f.from_name}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-200">🛸 Invasion fleet incoming</p>
            <p className="mt-1.5 text-sm leading-snug">
              <b>{f.fleet} soldiers</b> from <b>{f.from_name}</b> land in <b className="tabular-nums">{left}s</b>.
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-rose-400 transition-[width] duration-1000 ease-linear" style={{ width: `${(left / FLIGHT_SECONDS) * 100}%` }} />
            </div>
            {fighting[f.id] && f.answer === "fight" && <p className="mt-2 text-xs text-rose-200">⚔️ Your army is waiting on the shore.</p>}
            {f.answer === "shields" && <p className="mt-2 text-xs text-sky-200">🛡️ Shields up: your defence is half as strong again.</p>}
            {errors[f.id] && (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                {errors[f.id]}
              </p>
            )}
            {!decided && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button disabled={busy === f.id} onClick={() => pick("fight")} title="Your army meets them where they land" className="rounded-lg bg-rose-400/25 px-2 py-1.5 text-xs font-semibold text-rose-50 hover:bg-rose-400/35 disabled:opacity-40">
                  ⚔️ Fight
                </button>
                <button disabled={busy === f.id} onClick={() => pick("tribute")} title="Give 15% of your gold and food; nobody dies" className="rounded-lg bg-amber-400/20 px-2 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-400/30 disabled:opacity-40">
                  💰 Tribute
                </button>
                <button
                  disabled={busy === f.id || sim.devotion < SHIELD_COST}
                  onClick={() => pick("shields")}
                  title={`Spend ${SHIELD_COST} devotion: defence x1.5`}
                  className="rounded-lg bg-sky-400/20 px-2 py-1.5 text-xs font-semibold text-sky-50 hover:bg-sky-400/30 disabled:opacity-40"
                >
                  🛡️ Shields
                </button>
              </div>
            )}
            {!decided && <p className="mt-2 text-[11px] text-white/45">No answer means your people fight. Shields cost {SHIELD_COST} devotion (you have {Math.floor(sim.devotion)}).</p>}
          </section>
        );
      })}
    </div>
  );
}
