"use client";
// The game screen: the globe in the middle, the planet's vital signs on the left,
// the god powers along the bottom, and the people's shared mind on the right.
// This file wires the sim (src/sim/planet.ts) to the LLM routes (/api/narrate, /api/mind).
import { useCallback, useEffect, useRef, useState } from "react";
import Globe, { type Tool } from "./Globe";
import { PlanetSim, type SimEvent } from "@/sim/planet";
import type { ChronicleEntry, ChronicleKind, Civ, Crisis, GodPower, MindMessage, Needs, PlanetStats, Policy, World } from "@/types/world";

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "hand", label: "Rotate", icon: "✋" },
  { tool: "spawn", label: "People", icon: "🧍" },
  { tool: "raise", label: "Raise", icon: "⛰️" },
  { tool: "lower", label: "Sink", icon: "🌊" },
  { tool: "forest", label: "Forest", icon: "🌲" },
  { tool: "rain", label: "Rain", icon: "🌧️" },
  { tool: "drought", label: "Drought", icon: "☀️" },
  { tool: "miracle", label: "Miracle", icon: "✨" },
  { tool: "fire", label: "Fire", icon: "🔥" },
  { tool: "meteor", label: "Meteor", icon: "☄️" },
];
const BRUSHES = [
  { label: "S", radius: 0.04 },
  { label: "M", radius: 0.08 },
  { label: "L", radius: 0.15 },
];
const SPEEDS = [
  { label: "⏸", speed: 0 },
  { label: "1×", speed: 1 },
  { label: "3×", speed: 3 },
];
const POLICY_LABEL: Record<Policy, string> = {
  settle: "Settling down",
  expand: "Expanding",
  farm: "Farming",
  worship: "Worshipping you",
  explore: "Exploring",
  hoard: "Hoarding",
  rebel: "Rebelling",
};
const THINK_EVERY_MS = 35_000; // the mind speaks up on its own this often
const START_PEOPLE = 14;

interface Hud {
  year: number;
  stats: PlanetStats;
  needs: Needs;
  crisis: Crisis | null;
  policy: Policy;
}

export default function Game({ playerName }: { playerName: string }) {
  const [sim] = useState(() => {
    const s = new PlanetSim();
    const start = s.bestStart();
    for (let i = 0; i < START_PEOPLE; i++) s.spawnNear(start);
    return s;
  });
  const [tool, setTool] = useState<Tool>("rain");
  const [brush, setBrush] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [hud, setHud] = useState<Hud>(() => readHud(sim));
  const [civ, setCiv] = useState<Civ | null>(null);
  const [chronicle, setChronicle] = useState<ChronicleEntry[]>([]);
  const [chat, setChat] = useState<MindMessage[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"" | "narrating" | "thinking">("");
  const [draft, setDraft] = useState("");

  // Refs so timers always see the latest state without re-subscribing.
  const civRef = useRef(civ);
  civRef.current = civ;
  const chronicleRef = useRef(chronicle);
  chronicleRef.current = chronicle;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const queue = useRef<SimEvent[]>([]); // events waiting to be narrated
  const inFlight = useRef(false);
  const lastThought = useRef(Date.now());
  const answerDue = useRef(false); // the god spoke and the mind hasn't answered yet
  const stroke = useRef<GodPower | null>(null);
  const lastTold = useRef<Record<string, number>>({}); // year each kind of event was last narrated

  const world = useCallback(
    (): World => ({ id: "local", ...readHud(sim), civ: civRef.current, chronicle: chronicleRef.current }),
    [sim],
  );
  const addEntry = (e: ChronicleEntry) => setChronicle((c) => [...c, e].slice(-50));

  // One LLM call at a time: narrate the next queued event, or let the mind think.
  const pump = useCallback(async () => {
    if (inFlight.current) return;
    const w = world();
    // Answering the god comes first, then news, then thinking out loud.
    const answer = answerDue.current && civRef.current;
    const next = answer ? undefined : queue.current.shift();
    const timeToThink = civRef.current && Date.now() - lastThought.current > THINK_EVERY_MS;
    if (!answer && !next && !timeToThink) return;
    answerDue.current = false;
    inFlight.current = true;
    try {
      if (next) {
        setBusy("narrating");
        // The people become self-aware when they found their first village.
        const kind: ChronicleKind = civRef.current ? next.kind : "genesis";
        const res = await post<{ civ: Civ; entry: ChronicleEntry }>("/api/narrate", { world: w, kind, detail: next.detail });
        setCiv(res.civ);
        addEntry(res.entry);
      } else {
        await think(w);
      }
    } catch (err) {
      console.error(err);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

  const think = async (w: World) => {
    setBusy("thinking");
    lastThought.current = Date.now();
    const res = await post<{ civ: Civ; reply: string; policy: Policy; reason: string }>("/api/mind", { world: w, chat: chatRef.current });
    setCiv(res.civ);
    setChat((c) => [...c, { from: "mind" as const, text: res.reply }].slice(-30));
    if (res.policy !== sim.policy) addEntry({ year: w.year, kind: "mind", text: `The people turn to ${POLICY_LABEL[res.policy].toLowerCase()}: ${res.reason}` });
    sim.policy = res.policy;
    setReason(res.reason);
  };

  // Poll the sim for the HUD, collect its events, and keep the LLM pump going.
  useEffect(() => {
    let lastCrisis: Crisis | null = null;
    const id = setInterval(() => {
      setHud(readHud(sim));
      for (const e of sim.events.splice(0)) {
        // Don't narrate the same kind of thing twice in quick succession.
        if (e.kind !== "milestone" && sim.year - (lastTold.current[e.kind] ?? -99) < 25) continue;
        lastTold.current[e.kind] = sim.year;
        // Before genesis only the first village matters; after it, skip routine village news.
        if (!civRef.current ? e.kind === "village" : e.kind !== "village" || sim.villages.length <= 3) queue.current.push(e);
      }
      const crisis = sim.crisis();
      if (crisis && crisis !== lastCrisis && civRef.current) queue.current.push({ kind: crisis, detail: `A ${crisis} has begun.` });
      lastCrisis = crisis;
      queue.current = queue.current.slice(-3); // stay current: drop old news if the LLM falls behind
      pump();
    }, 300);
    return () => clearInterval(id);
  }, [sim, pump]);

  // A stroke of a power is narrated once, when the mouse is released.
  useEffect(() => {
    const up = () => {
      const p = stroke.current;
      stroke.current = null;
      if (p && civRef.current && p !== "spawn") queue.current.push({ kind: p, detail: `The god used ${p} on the planet.` });
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const paint = (power: GodPower, face: number) => {
    sim.apply(power, face, BRUSHES[brush].radius);
    if (power !== "meteor") stroke.current = power; // meteors report themselves
  };

  // The god's words go into the chat straight away; the mind answers as soon as it is free.
  const speak = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !civ) return;
    setDraft("");
    const next = [...chatRef.current, { from: "god" as const, text }];
    chatRef.current = next;
    setChat(next);
    answerDue.current = true;
    pump();
  };

  const { stats, needs } = hud;
  return (
    <main className="relative h-dvh w-full overflow-hidden select-none">
      <div className="absolute inset-0">
        <Globe sim={sim} tool={tool} speed={speed} onPaint={paint} />
      </div>

      {/* Vital signs */}
      <aside className="glass absolute left-4 top-4 w-64 space-y-4 p-4">
        <div>
          <p className="label">
            Year {Math.floor(hud.year)} · God: {playerName}
          </p>
          <p className="text-2xl font-semibold">{civ?.name ?? "An unnamed world"}</p>
          <p className="text-xs text-white/45" title={sim.type.blurb}>
            {sim.type.name} · {sim.type.blurb}
          </p>
          <p className="text-sm text-white/60">
            {stats.population.toLocaleString()} people · {stats.villages} {stats.villages === 1 ? "village" : "villages"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stock icon="🌾" label="Food" value={stats.resources.food} />
          <Stock icon="🪵" label="Wood" value={stats.resources.wood} />
          <Stock icon="🪨" label="Stone" value={stats.resources.stone} />
          <Stock icon="⚙️" label="Metal" value={stats.resources.metal} />
          <Stock icon="🪙" label="Gold" value={stats.resources.gold} />
          <Stock icon="🌿" label="Herbs (medicine)" value={stats.resources.herbs} />
        </div>
        <NeedBars needs={needs} crisis={hud.crisis} />
        {civ && (
          <div className="text-sm">
            <p className="label">Focus</p>
            <p className={hud.policy === "rebel" ? "font-semibold text-rose-300" : "font-semibold"}>{POLICY_LABEL[hud.policy]}</p>
            {reason && <p className="text-xs text-white/50">{reason}</p>}
          </div>
        )}
        {!civ && <p className="text-xs text-white/55">Your people are wandering. Keep them fed and they will found a village, then become aware of you.</p>}
      </aside>

      {/* God powers */}
      <div className="glass absolute bottom-4 left-[calc(50%-1.5rem)] flex -translate-x-1/2 items-center gap-1 p-1.5">
        {TOOLS.map((t) => (
          <button key={t.tool} onClick={() => setTool(t.tool)} className={`tool ${tool === t.tool ? "tool-on" : ""}`} title={t.label}>
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
        <div className="mx-2 h-10 w-px bg-white/10" />
        <Segmented options={BRUSHES.map((b) => b.label)} value={brush} onChange={setBrush} title="Brush" />
        <Segmented options={SPEEDS.map((s) => s.label)} value={SPEEDS.findIndex((s) => s.speed === speed)} onChange={(i) => setSpeed(SPEEDS[i].speed)} title="Speed" />
      </div>
      <p className="pointer-events-none absolute bottom-[5.5rem] left-[calc(50%-1.5rem)] -translate-x-1/2 text-xs text-white/40">Left-drag to use a power · right-drag to rotate · scroll to zoom</p>

      {/* The people's shared mind */}
      <aside className="glass absolute bottom-4 right-4 top-4 flex w-72 flex-col p-4">
        {civ ? (
          <div className="mb-3 space-y-1 border-b border-white/10 pb-3 text-sm">
            <p>
              <span className="label">Faith</span> {civ.religion.name}
            </p>
            <p className="text-white/70">
              They call you <b>{civ.religion.godName}</b>. {civ.religion.belief}
            </p>
            <p>
              <span className="label">They feel</span> <span className={civ.attitude === "hostile" || civ.attitude === "resentful" ? "text-rose-300" : ""}>{civ.attitude}</span>
            </p>
          </div>
        ) : (
          <p className="mb-3 border-b border-white/10 pb-3 text-sm text-white/50">They do not know you yet.</p>
        )}

        <p className="label mb-2">Voice of the people {busy === "thinking" && <span className="animate-pulse">· thinking…</span>}</p>
        <ol className="mb-2 max-h-[38%] space-y-2 overflow-y-auto text-sm">
          {chat.map((m, i) => (
            <li key={i} className={m.from === "god" ? "text-right text-sky-200" : "italic text-amber-100"}>
              {m.text}
            </li>
          ))}
          {!chat.length && <li className="text-white/40">{civ ? "They will speak to you soon." : "…"}</li>}
        </ol>
        <form onSubmit={speak} className="mb-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!civ}
            placeholder={civ ? `Speak to ${civ.demonym}…` : "No one to hear you yet"}
            className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm outline-none placeholder:text-white/30 focus:bg-white/15"
          />
          <button disabled={!civ || !draft.trim()} className="rounded-lg bg-sky-400/20 px-3 text-sm disabled:opacity-30">
            Speak
          </button>
        </form>

        <p className="label mb-2">Chronicle {busy === "narrating" && <span className="animate-pulse">· writing…</span>}</p>
        <ol className="flex-1 space-y-3 overflow-y-auto text-sm">
          {[...chronicle].reverse().map((c, i) => (
            <li key={chronicle.length - i}>
              <span className="text-white/40">Year {Math.floor(c.year)} · </span>
              {c.text}
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}

function readHud(sim: PlanetSim): Hud {
  return { year: sim.year, stats: sim.stats(), needs: sim.needs(), crisis: sim.crisis(), policy: sim.policy };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function Stock({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/5 py-1.5" title={label}>
      <div>{icon}</div>
      <div className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function NeedBars({ needs, crisis }: { needs: Needs; crisis: Crisis | null }) {
  const bars: [string, number][] = [
    ["Food", needs.food],
    ["Faith", needs.faith],
    ["Stability", needs.stability],
  ];
  return (
    <div className="space-y-2">
      {bars.map(([name, v]) => (
        <div key={name}>
          <div className="flex justify-between text-xs text-white/70">
            <span>{name}</span>
            <span className="tabular-nums">{Math.round(v)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-all ${v < 25 ? "bg-rose-400" : "bg-sky-300"}`} style={{ width: `${v}%` }} />
          </div>
        </div>
      ))}
      {crisis && <p className="text-sm font-semibold uppercase tracking-wide text-rose-300">{crisis}</p>}
    </div>
  );
}

function Segmented({ options, value, onChange, title }: { options: string[]; value: number; onChange: (i: number) => void; title: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{title}</span>
      <div className="flex rounded-lg bg-white/5 p-0.5">
        {options.map((o, i) => (
          <button key={o} onClick={() => onChange(i)} className={`rounded-md px-2 py-0.5 text-xs ${i === value ? "bg-sky-300/25" : ""}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
