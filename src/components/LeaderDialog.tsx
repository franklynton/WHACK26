"use client";
// Talking to a nation's leader: their portrait on the left, the conversation on the right.
// The leader answers in their race's voice (see leaderPrompt in narrator.ts) and their
// decisions feed back into the sim (their focus, or how they treat a neighbour).
import { useEffect, useRef, useState } from "react";
import Portrait, { type Mood } from "./Portrait";
import RaceStats from "./RaceStats";
import { ERAS, RACE, eraProgress } from "@/sim/races";
import type { Civ, LeaderMessage, NationInfo } from "@/types/world";

export default function LeaderDialog({
  nation,
  civ,
  chat,
  mood,
  busy,
  onSay,
  onClose,
}: {
  nation: NationInfo;
  civ: Civ | null;
  chat: LeaderMessage[];
  mood: Mood;
  busy: boolean;
  onSay: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const race = RACE[nation.race];
  const l = nation.leader;
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" }); // braces: newer browsers return a Promise here, which React would treat as a cleanup
  }, [chat.length, busy]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const say = (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    onSay(t);
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="glass alert-pop flex h-[min(620px,90vh)] w-[min(920px,100%)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* The leader */}
        <div className="flex w-72 shrink-0 flex-col items-center gap-3 border-r border-white/10 bg-white/[0.03] p-5 text-center">
          <Portrait race={nation.race} seed={l.seed} color={nation.color} mood={mood} size={220} />
          <div>
            <p className="text-xs uppercase tracking-wider text-white/50">{l.title}</p>
            <p className="text-2xl font-bold">{l.name}</p>
            <p className="text-sm text-white/60">
              {race.icon} {race.name} ruler of {civ?.name ?? nation.name}
            </p>
            <p className="mt-1 text-xs capitalize text-white/45">Feeling {mood}</p>
          </div>
          <div className="w-full text-left">
            <div className="flex justify-between text-xs text-white/60">
              <span>{ERAS[nation.era]}</span>
              <span>{nation.era < ERAS.length - 1 ? `→ ${ERAS[nation.era + 1]}` : "🚀"}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-300" style={{ width: `${Math.round(eraProgress(nation.tech) * 100)}%` }} />
            </div>
          </div>
          <div className="w-full text-left">
            <RaceStats race={nation.race} compact />
          </div>
        </div>

        {/* The conversation */}
        <div className="flex min-w-0 flex-1 flex-col p-5">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <p className="label">An audience with</p>
              <p className="text-lg font-semibold">
                {l.title} {l.name}
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1 text-sm hover:bg-white/20" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {chat.map((m, i) =>
              m.from === "leader" ? (
                <div key={i} className="max-w-[85%]">
                  <p className="mb-0.5 text-xs font-semibold" style={{ color: nation.color }}>
                    {l.name}
                  </p>
                  <p className="rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2.5 font-serif text-lg leading-snug">&ldquo;{m.text}&rdquo;</p>
                </div>
              ) : (
                <div key={i} className="ml-auto max-w-[75%] text-right">
                  <p className="mb-0.5 text-xs font-semibold text-sky-200">You</p>
                  <p className="inline-block rounded-2xl rounded-tr-sm bg-sky-400/20 px-4 py-2 text-left text-sky-50">{m.text}</p>
                </div>
              ),
            )}
            {busy && <p className="animate-pulse text-sm text-white/50">{l.name} is thinking…</p>}
            <div ref={end} />
          </div>
          <form onSubmit={say} className="mt-3 flex gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Speak to ${l.name}… (ask for peace, war, food, worship)`}
              className="min-w-0 flex-1 rounded-lg bg-white/10 px-4 py-2.5 outline-none placeholder:text-white/30 focus:bg-white/15"
            />
            <button disabled={busy || !draft.trim()} className="rounded-lg bg-sky-400 px-5 font-semibold text-slate-950 disabled:opacity-30">
              Speak
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
