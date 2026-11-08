"use client";

import { ALERT_MS, CHOICE_LIFE, MIRACLES, PRAYER_LIFE, type MiracleId } from "@/sim/planet";
import type { Hud } from "./Game";
import type { NationInfo } from "@/types/world";

const cap = (value: string) => value[0].toUpperCase() + value.slice(1);

export function Countdown({ left, life }: { left: number; life: number }) {
  const seconds = Math.max(0, Math.ceil(left));
  const urgent = seconds <= 5;
  return (
    <>
      <span className={`w-8 text-right text-xs tabular-nums ${urgent ? "font-bold text-red-400" : "text-white/50"}`} title="Seconds left to decide">
        {seconds}s
      </span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
        <span className={`block h-full transition-[width] duration-300 ease-linear ${urgent ? "bg-red-400" : "bg-amber-300/70"}`} style={{ width: `${Math.max(0, Math.min(1, left / life)) * 100}%` }} />
      </span>
    </>
  );
}

export function GameOverlays({
  hud,
  pace,
  miracle,
  names,
  onMiracle,
  onDecide,
  onShowChoice,
  onAnswerPrayer,
  onShowAlert,
}: {
  hud: Hud;
  pace: number;
  miracle: MiracleId | null;
  names: NationInfo[];
  onMiracle: (id: MiracleId) => void;
  onDecide: (yes: boolean) => void;
  onShowChoice: () => void;
  onAnswerPrayer: (id: number, answer: boolean) => void;
  onShowAlert: () => void;
}) {
  const choice = hud.god.choice;
  return (
    <>
      {hud.alert && Date.now() - (hud.alert.shown ?? 0) < ALERT_MS && (
        <div className="pointer-events-none absolute top-4 left-[17.5rem] right-[19.5rem] z-40 flex justify-center">
          <div key={hud.alert.at} className="glass alert-pop pointer-events-auto flex max-w-lg items-center gap-3 px-5 py-3">
            <span className="text-3xl leading-none">{hud.alert.icon}</span>
            <div className="min-w-0">
              <div className="text-base font-bold">{hud.alert.title}</div>
              <div className="text-sm text-white/75">{hud.alert.text}</div>
            </div>
            <button onClick={onShowAlert} className="ml-2 shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20">
              Show me
            </button>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-4 left-[17.5rem] right-[19.5rem] flex flex-col items-center gap-2">
        {choice && (
          <div className="glass alert-pop pointer-events-auto relative w-[30rem] max-w-full overflow-hidden px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">{choice.title}</span>
              <span className="text-xs text-white/50">
                {choice.nations.map((id) => names[id]?.name).filter(Boolean).map((name) => cap(name!)).join(" and ")}
              </span>
              <button onClick={onShowChoice} className="ml-auto text-xs text-sky-300 hover:underline">Show me</button>
              <Countdown left={CHOICE_LIFE - (hud.year - choice.at) / pace} life={CHOICE_LIFE} />
            </div>
            <p className="mt-0.5 text-sm text-white/75">{choice.text}</p>
            <div className="mt-2 flex gap-2">
              <button
                disabled={hud.god.devotion < choice.cost}
                onClick={() => onDecide(true)}
                className="flex-1 rounded-lg bg-amber-300/20 px-3 py-1.5 text-sm font-semibold transition hover:bg-amber-300/30 disabled:opacity-40"
              >
                {{ disaster: "Turn it aside", war: "Force a peace", revolution: "Calm the people" }[choice.kind]} ✨{choice.cost}
              </button>
              <button onClick={() => onDecide(false)} className="flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-sm transition hover:bg-white/10">
                Let fate decide
              </button>
            </div>
          </div>
        )}
        {hud.god.prayers.slice(-3).map((prayer) => (
          <div key={prayer.id} className="glass pointer-events-auto relative flex w-[30rem] max-w-full items-center gap-3 overflow-hidden px-4 py-2.5 text-sm">
            <span className="text-xl">🙏</span>
            <span className="flex-1">{cap(prayer.text)}</span>
            <Countdown left={PRAYER_LIFE - (hud.year - prayer.at) / pace} life={PRAYER_LIFE} />
            <button
              disabled={hud.god.devotion < prayer.cost}
              onClick={() => onAnswerPrayer(prayer.id, true)}
              className="rounded-lg bg-amber-300/20 px-2.5 py-1 text-xs font-semibold transition hover:bg-amber-300/30 disabled:opacity-40"
            >
              Answer ✨{prayer.cost}
            </button>
            <button onClick={() => onAnswerPrayer(prayer.id, false)} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs transition hover:bg-white/10">
              Ignore
            </button>
          </div>
        ))}
        <div className="glass pointer-events-auto flex gap-1.5 p-1.5">
          {MIRACLES.map((miracleInfo) => {
            const wait = Math.ceil(hud.god.ready[miracleInfo.id] - hud.year);
            const off = wait > 0 || hud.god.devotion < miracleInfo.cost;
            return (
              <button
                key={miracleInfo.id}
                onClick={() => onMiracle(miracleInfo.id)}
                disabled={off && miracle !== miracleInfo.id}
                title={miracleInfo.blurb}
                className={`relative w-24 rounded-lg px-2 py-1.5 text-center transition disabled:opacity-40 ${miracle === miracleInfo.id ? "bg-amber-300/30 ring-1 ring-amber-200" : "bg-white/5 hover:bg-white/10"}`}
              >
                <div className="text-lg leading-none">{miracleInfo.icon}</div>
                <div className="mt-0.5 text-[11px] font-semibold">{miracleInfo.name}</div>
                <div className="text-[10px] text-amber-200/80">
                  {wait > 0 ? `ready in ${wait}s` : `✨ ${miracleInfo.cost}`}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-white/40">
          {miracle ? "Click the land to cast · Esc to cancel" : "Drag to rotate · scroll to zoom · pick a miracle, then click the land"}
        </p>
      </div>
    </>
  );
}
