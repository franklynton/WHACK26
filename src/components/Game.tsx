"use client";
// The game screen: the globe in the middle, the planet and its nations on the left,
// the god powers along the bottom, and the chosen nation's mind on the right.
// Each nation has its own AI mind, religion and chat. This file wires the sim
// (src/sim/planet.ts) to the LLM routes (/api/narrate, /api/mind).
import { useCallback, useEffect, useRef, useState } from "react";
import Globe, { type Tool } from "./Globe";
import { PlanetSim, type SimEvent } from "@/sim/planet";
import { fallbackCiv, fallbackReaction, fallbackThought } from "@/lib/narrator";
import type { ChronicleEntry, ChronicleKind, Civ, Crisis, GodPower, MindMessage, NationInfo, Needs, PlanetStats, Policy, Relation, World } from "@/types/world";

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "hand", label: "Rotate", icon: "✋" },
  { tool: "spawn", label: "People", icon: "🧍" },
  { tool: "raise", label: "Raise", icon: "⛰️" },
  { tool: "lower", label: "Sink", icon: "🌊" },
  { tool: "forest", label: "Forest", icon: "🌲" },
  { tool: "rain", label: "Rain", icon: "🌧️" },
  { tool: "drought", label: "Drought", icon: "☀️" },
  { tool: "miracle", label: "Miracle", icon: "✨" },
  { tool: "peace", label: "Peace", icon: "🕊️" },
  { tool: "discord", label: "Discord", icon: "😈" },
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
const RELATION_STYLE: Record<Relation, { icon: string; cls: string; label: string }> = {
  peace: { icon: "·", cls: "text-white/40", label: "at peace" },
  trade: { icon: "🤝", cls: "text-emerald-300", label: "trading" },
  rival: { icon: "😠", cls: "text-amber-300", label: "rivals" },
  war: { icon: "⚔️", cls: "text-rose-300", label: "at war" },
};
const THINK_EVERY_MS = 45_000; // each nation's mind speaks up on its own this often
const THINK_GAP_MS = 10_000; // but minds take turns, at most one every 10 seconds

type Entry = ChronicleEntry & { nation?: number };
type Item = SimEvent & { nation: number }; // a queued event, pinned to the nation that tells it

interface Hud {
  year: number;
  stats: PlanetStats;
  needs: Needs;
  nations: NationInfo[];
}

export default function Game({ playerName }: { playerName: string }) {
  const [sim] = useState(() => {
    const s = new PlanetSim();
    s.seedNations(); // 2 to 5 nations, far apart
    return s;
  });
  const count = sim.nations.length;
  const [tool, setTool] = useState<Tool>("rain");
  const [brush, setBrush] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [hud, setHud] = useState<Hud>(() => readHud(sim));
  const [civs, setCivs] = useState<(Civ | null)[]>(() => new Array(count).fill(null));
  const [chats, setChats] = useState<MindMessage[][]>(() => Array.from({ length: count }, () => []));
  const [reasons, setReasons] = useState<string[]>(() => new Array(count).fill(""));
  const [chronicle, setChronicle] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0); // the nation the god is looking at and talking to
  const [busy, setBusy] = useState<"" | "narrating" | "thinking">("");
  const [draft, setDraft] = useState("");

  // Refs so timers always see the latest state without re-subscribing.
  const civsRef = useRef(civs);
  civsRef.current = civs;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const chronicleRef = useRef(chronicle);
  chronicleRef.current = chronicle;
  const queue = useRef<Item[]>([]); // events waiting to be narrated
  const genesisDue = useRef<number[]>([]); // nations that just founded their first village
  const inFlight = useRef(false);
  const lastThought = useRef<number[]>(new Array(count).fill(Date.now()));
  const lastAnyThought = useRef(Date.now());
  const answerDue = useRef<number | null>(null); // the god spoke to this nation and it hasn't answered yet
  const stroke = useRef<{ power: GodPower; face: number } | null>(null);
  const lastTold = useRef<Record<string, number>>({}); // year each kind of event was last narrated, per nation

  const setCiv = (id: number, civ: Civ) => {
    const next = [...civsRef.current];
    next[id] = civ;
    civsRef.current = next;
    setCivs(next);
    sim.nations[id].name = civ.name; // sim events now use the name the mind chose
  };
  const addChat = (id: number, m: MindMessage) => {
    const next = chatsRef.current.map((c, i) => (i === id ? [...c, m].slice(-30) : c));
    chatsRef.current = next;
    setChats(next);
  };
  const addEntry = (e: Entry) => setChronicle((c) => [...c, e].slice(-60));

  // What one nation's mind sees: the whole planet, plus its own needs, focus and neighbours.
  const worldFor = useCallback(
    (id: number): World => {
      const info = sim.nationInfo()[id];
      return {
        id: "local",
        year: sim.year,
        stats: sim.stats(),
        needs: info.needs,
        crisis: info.crisis,
        policy: info.policy,
        civ: civsRef.current[id],
        chronicle: chronicleRef.current,
        nation: {
          id,
          name: sim.nationName(id),
          population: info.population,
          villages: info.villages,
          relations: info.relations.map((r) => ({ name: sim.nationName(r.id), relation: r.relation, tension: r.tension })),
        },
      };
    },
    [sim],
  );

  // One LLM call at a time. Order: answer the god, wake up new nations, tell the news,
  // then let the nation that has been quiet longest think out loud.
  const pump = useCallback(async () => {
    if (inFlight.current) return;
    const answer = answerDue.current;
    const genesis = answer == null ? genesisDue.current.shift() : undefined;
    const next = answer == null && genesis == null ? queue.current.shift() : undefined;
    let thinker: number | null = answer;
    if (thinker == null && genesis == null && !next && Date.now() - lastAnyThought.current > THINK_GAP_MS) {
      const ready = sim.nations.filter((n) => n.alive && civsRef.current[n.id] && Date.now() - lastThought.current[n.id] > THINK_EVERY_MS);
      ready.sort((a, b) => lastThought.current[a.id] - lastThought.current[b.id]);
      thinker = ready[0]?.id ?? null;
    }
    if (genesis == null && !next && thinker == null) return;
    answerDue.current = null;
    inFlight.current = true;
    try {
      if (genesis != null) {
        setBusy("narrating");
        const res = await post<{ civ: Civ; entry: ChronicleEntry }>("/api/narrate", { world: worldFor(genesis), kind: "genesis" });
        setCiv(genesis, res.civ);
        addEntry({ ...res.entry, nation: genesis });
        lastThought.current[genesis] = Date.now() - THINK_EVERY_MS + 15_000; // first words soon after waking
      } else if (next) {
        setBusy("narrating");
        const res = await post<{ civ: Civ; entry: ChronicleEntry }>("/api/narrate", { world: worldFor(next.nation), kind: next.kind, detail: next.detail });
        setCiv(next.nation, res.civ);
        addEntry({ ...res.entry, nation: next.nation });
      } else if (thinker != null) {
        await think(thinker);
      }
    } catch (err) {
      console.error(err);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }, [worldFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const think = async (id: number) => {
    setBusy("thinking");
    lastThought.current[id] = lastAnyThought.current = Date.now();
    const w = worldFor(id);
    const res = await post<{ civ: Civ; reply: string; policy: Policy; reason: string; toward: { nation: string; stance: string } | null }>("/api/mind", {
      world: w,
      chat: chatsRef.current[id],
    });
    setCiv(id, res.civ);
    addChat(id, { from: "mind", text: res.reply });
    const nt = sim.nations[id];
    if (res.policy !== nt.policy) addEntry({ year: w.year, kind: "mind", nation: id, text: `${res.civ.name} turn to ${POLICY_LABEL[res.policy].toLowerCase()}: ${res.reason}` });
    nt.policy = res.policy;
    setReasons((r) => r.map((x, i) => (i === id ? res.reason : x)));
    // The mind's stance towards a neighbour nudges the tension between them.
    const other = res.toward && sim.nations.find((o) => o.id !== id && o.alive && o.name.toLowerCase() === res.toward!.nation.toLowerCase());
    if (other) sim.sway(id, other.id, res.toward!.stance === "hostile" ? 6 : -6);
  };

  // Poll the sim for the HUD, collect its events, and keep the LLM pump going.
  useEffect(() => {
    const lastCrisis: (Crisis | null)[] = new Array(count).fill(null);
    const id = setInterval(() => {
      const h = readHud(sim);
      setHud(h);
      for (const e of sim.events.splice(0)) {
        const awake = sim.nations.filter((n) => civsRef.current[n.id]).map((n) => n.id);
        const nation = e.nation ?? awake[Math.floor(Math.random() * awake.length)];
        if (nation == null) continue;
        if (!civsRef.current[nation]) {
          // A nation becomes self-aware when it founds its first village.
          if (e.kind === "village" && !genesisDue.current.includes(nation)) genesisDue.current.push(nation);
          continue;
        }
        // Don't narrate the same kind of thing for the same nation twice in quick succession.
        const big = e.kind === "diplomacy" || e.kind === "captured" || e.kind === "fallen";
        const key = big ? `${e.kind}:${Math.min(nation, e.other ?? nation)}-${Math.max(nation, e.other ?? nation)}` : `${e.kind}:${nation}`;
        if (e.kind !== "milestone" && sim.year - (lastTold.current[key] ?? -99) < (big ? 8 : 25)) continue;
        lastTold.current[key] = sim.year;
        if (e.kind === "village" && h.nations[nation].villages > 3) continue; // routine growth
        queue.current.push({ ...e, nation });
      }
      for (const n of h.nations) {
        if (n.crisis && n.crisis !== lastCrisis[n.id] && civsRef.current[n.id]) queue.current.push({ kind: n.crisis, detail: `A ${n.crisis} has begun in ${n.name}.`, nation: n.id });
        lastCrisis[n.id] = n.crisis;
      }
      queue.current = queue.current.slice(-4); // stay current: drop old news if the LLM falls behind
      pump();
    }, 300);
    return () => clearInterval(id);
  }, [sim, pump, count]);

  // A stroke of a power is narrated once, when the mouse is released, by the nation it touched.
  useEffect(() => {
    const up = () => {
      const s = stroke.current;
      stroke.current = null;
      if (!s || s.power === "spawn") return;
      const nation = sim.owner[s.face] >= 0 ? sim.owner[s.face] : sim.nearestNation(s.face);
      if (civsRef.current[nation]) queue.current.push({ kind: s.power, detail: `The god used ${s.power} near ${sim.nationName(nation)}.`, nation });
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [sim]);

  const paint = (power: GodPower, face: number) => {
    sim.apply(power, face, BRUSHES[brush].radius);
    if (power !== "meteor") stroke.current = { power, face }; // meteors report themselves
  };

  // The god's words go into the chosen nation's chat; its mind answers as soon as it is free.
  const speak = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !civs[sel]) return;
    setDraft("");
    addChat(sel, { from: "god", text });
    sim.nations[sel].faith = Math.min(100, sim.nations[sel].faith + 6); // being spoken to by their god renews their faith
    answerDue.current = sel;
    pump();
  };

  const { stats } = hud;
  const civ = civs[sel];
  const me = hud.nations[sel];
  const chat = chats[sel];
  const awake = civs.filter(Boolean).length;
  return (
    <main className="relative h-dvh w-full overflow-hidden select-none">
      <div className="absolute inset-0">
        <Globe sim={sim} tool={tool} speed={speed} onPaint={paint} />
      </div>

      {/* The planet and its nations */}
      <aside className="glass absolute bottom-4 left-4 top-4 flex w-64 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <p className="label">
            Year {Math.floor(hud.year)} · God: {playerName}
          </p>
          <p className="text-2xl font-semibold">{sim.type.name}</p>
          <p className="text-xs text-white/45">{sim.type.blurb}</p>
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
        <div>
          <p className="label mb-1.5">Nations ({hud.nations.filter((n) => n.alive).length})</p>
          <ul className="space-y-1">
            {hud.nations.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSel(n.id)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${sel === n.id ? "bg-white/15" : "hover:bg-white/5"} ${n.alive ? "" : "opacity-40"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: n.color }} />
                    <span className="flex-1 truncate font-medium">{cap(n.name)}</span>
                    <span className="text-xs tabular-nums text-white/50">{n.alive ? n.population : "fallen"}</span>
                  </div>
                  <div className="ml-4.5 flex flex-wrap gap-x-2 text-xs">
                    {n.crisis && <span className="font-semibold uppercase text-rose-300">{n.crisis}</span>}
                    {n.relations
                      .filter((r) => r.relation !== "peace")
                      .map((r) => (
                        <span key={r.id} className={RELATION_STYLE[r.relation].cls} title={`${RELATION_STYLE[r.relation].label}, tension ${r.tension}`}>
                          {RELATION_STYLE[r.relation].icon} {cap(hud.nations[r.id].name)}
                        </span>
                      ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-auto flex justify-between">
          <Segmented options={BRUSHES.map((b) => b.label)} value={brush} onChange={setBrush} title="Brush" />
          <Segmented options={SPEEDS.map((s) => s.label)} value={SPEEDS.findIndex((s) => s.speed === speed)} onChange={(i) => setSpeed(SPEEDS[i].speed)} title="Speed" />
        </div>
        {!awake && <p className="text-xs text-white/55">Your nations are wandering. Keep them fed and each will found a village, then become aware of you. Keep them from fighting.</p>}
      </aside>

      {/* God powers: centred in the space between the two side panels */}
      <div className="pointer-events-none absolute bottom-4 left-[17.5rem] right-[19.5rem] flex flex-col items-center gap-1.5">
        <p className="text-xs text-white/40">Left-drag to use a power · right-drag to rotate · scroll to zoom</p>
        <div className="glass pointer-events-auto flex flex-wrap justify-center gap-1 p-1.5">
          {TOOLS.map((t) => (
            <button key={t.tool} onClick={() => setTool(t.tool)} className={`tool ${tool === t.tool ? "tool-on" : ""}`} title={t.label}>
              <span className="text-lg leading-none">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* The chosen nation's mind */}
      <aside className="glass absolute bottom-4 right-4 top-4 flex w-72 flex-col p-4">
        <div className="mb-3 space-y-2 border-b border-white/10 pb-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: me.color }} />
            <p className="text-lg font-semibold">{cap(me.name)}</p>
          </div>
          <NeedBars needs={me.needs} crisis={me.crisis} />
          {civ ? (
            <>
              <p>
                <span className="label">Focus</span> <span className={me.policy === "rebel" ? "font-semibold text-rose-300" : "font-semibold"}>{POLICY_LABEL[me.policy]}</span>
                {reasons[sel] && <span className="block text-xs text-white/50">{reasons[sel]}</span>}
              </p>
              <p>
                <span className="label">Faith</span> {civ.religion.name}
              </p>
              <p className="text-white/70">
                They call you <b>{civ.religion.godName}</b>. {civ.religion.belief}
              </p>
              <p>
                <span className="label">They feel</span> <span className={civ.attitude === "hostile" || civ.attitude === "resentful" ? "text-rose-300" : ""}>{civ.attitude}</span>
              </p>
            </>
          ) : (
            <p className="text-white/50">{me.alive ? "They do not know you yet." : "This nation is gone."}</p>
          )}
        </div>

        <p className="label mb-2">Voice of {civ ? civ.demonym : "the people"} {busy === "thinking" && <span className="animate-pulse">· thinking…</span>}</p>
        <ol className="mb-2 max-h-[28%] space-y-2 overflow-y-auto text-sm">
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
            disabled={!civ || !me.alive}
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
              {c.nation != null && <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: sim.nations[c.nation].color }} />}
              <span className="text-white/40">Year {Math.floor(c.year)} · </span>
              {c.text}
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function readHud(sim: PlanetSim): Hud {
  return { year: sim.year, stats: sim.stats(), needs: sim.needs(), nations: sim.nationInfo() };
}

// Calls an LLM route. If the server can't be reached (for example the static demo build,
// which has no API routes), answer with the same canned fallbacks the server would use.
async function post<T>(url: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  } catch {
    return offline(url, body as { world: World; kind?: ChronicleKind; detail?: string; chat?: MindMessage[] }) as T;
  }
}

function offline(url: string, { world, kind, chat = [] }: { world: World; kind?: ChronicleKind; chat?: MindMessage[] }) {
  if (url === "/api/mind") {
    const t = fallbackThought(world, chat);
    return { civ: { ...world.civ, attitude: t.attitude }, reply: t.reply, policy: t.policy, reason: t.reason, toward: t.toward ?? null };
  }
  if (kind === "genesis" || !world.civ) {
    const c = fallbackCiv(world.nation?.id);
    return { civ: c, entry: { year: world.year, kind: "genesis", text: `${cap(c.demonym)} light their first fires and call themselves ${c.name}.` } };
  }
  const r = fallbackReaction(world, kind ?? "milestone");
  return { civ: { ...world.civ, attitude: r.attitude }, entry: { year: world.year, kind, text: r.text } };
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
    <div className="space-y-1.5">
      {bars.map(([name, v]) => (
        <div key={name}>
          <div className="flex justify-between text-xs text-white/70">
            <span>{name}</span>
            <span className="tabular-nums">{Math.round(v)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-all ${v < 25 ? "bg-rose-400" : "bg-sky-300"}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
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
