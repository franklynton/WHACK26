"use client";
// The game screen: the globe in the middle, the planet and its nations on the left,
// the god powers along the bottom, and the chosen nation's mind on the right.
// Each nation has its own AI mind, religion and chat. This file wires the sim
// (src/sim/planet.ts) to the LLM routes (/api/narrate, /api/mind).
import { useCallback, useEffect, useRef, useState } from "react";
import Globe from "./Globe";
import LeaderDialog from "./LeaderDialog";
import Portrait, { type Mood } from "./Portrait";
import { ERAS, RACE, type RaceId } from "@/sim/races";
import { CHOICE_LIFE, GOAL_YEAR, MIRACLES, PRAYER_LIFE, PLANET_TYPES, PlanetSim, SECONDS_PER_YEAR, type MiracleId, type SimEvent } from "@/sim/planet";
import { sound } from "@/lib/sound";
import { fallbackCiv, fallbackLeader, fallbackReaction, fallbackThought, type LeaderReply } from "@/lib/narrator";
import type { ChronicleEntry, ChronicleKind, Civ, Crisis, LeaderMessage, MindMessage, NationInfo, Needs, PlanetStats, Policy, Relation, World } from "@/types/world";

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
const THINK_EVERY_MS = 75_000; // each nation's mind speaks up on its own this often
const THINK_GAP_MS = 20_000; // but minds take turns, at most one every 20 seconds
const NEWS_GAP_MS = 20_000; // the chronicle tells at most one piece of news every 20 seconds

type Entry = ChronicleEntry & { nation?: number };
type Item = SimEvent & { nation: number }; // a queued event, pinned to the nation that tells it

interface Hud {
  year: number;
  stats: PlanetStats;
  needs: Needs;
  nations: NationInfo[];
  fate: PlanetSim["fate"];
  alert: PlanetSim["alert"];
  output: number;
  military: number;
  god: { devotion: number; ready: PlanetSim["ready"]; prayers: PlanetSim["prayers"]; spacefaring: boolean; choice: PlanetSim["choice"]; outcome: PlanetSim["outcome"]; avgLove: number };
}

export default function Game({ playerName, planetName = "Arda", race, worldType }: { playerName: string; planetName?: string; race?: RaceId; worldType?: number }) {
  const [sim] = useState(() => {
    // The planet type comes from the seed (seed % 5), so a chosen world just picks a matching seed.
    const seed = worldType == null ? undefined : Math.floor(Math.random() * 2e5) * PLANET_TYPES.length + worldType;
    const s = new PlanetSim(seed);
    s.seedNations(undefined, 10, race); // 3 to 5 nations, far apart; the first is the god's chosen race
    return s;
  });
  const count = sim.nations.length;
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("arda-muted") === "1";
    } catch {
      return false;
    }
  });
  // Sound starts with the game (the click that created the planet allows it), or else on the next click.
  useEffect(() => {
    sound.setMuted(muted);
    try {
      localStorage.setItem("arda-muted", muted ? "1" : "0");
    } catch {}
  }, [muted]);
  useEffect(() => {
    const go = () => sound.start();
    go();
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, []);
  const [hud, setHud] = useState<Hud>(() => readHud(sim));
  const [miracle, setMiracle] = useState<MiracleId | null>(null); // picked from the bar; click the land to cast
  const [seenOutcome, setSeenOutcome] = useState(false);
  const [galaxy, setGalaxy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMiracle(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const cast = (face: number) => {
    if (miracle && sim.cast(miracle, face)) {
      setMiracle(null);
      setHud(readHud(sim));
    }
  };
  const [civs, setCivs] = useState<(Civ | null)[]>(() => new Array(count).fill(null));
  const [chats, setChats] = useState<MindMessage[][]>(() => Array.from({ length: count }, () => []));
  const [reasons, setReasons] = useState<string[]>(() => new Array(count).fill(""));
  const [chronicle, setChronicle] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0); // the nation the god is looking at and talking to
  const [busy, setBusy] = useState<"" | "narrating" | "thinking">("");
  const [draft, setDraft] = useState("");
  const [focus, setFocus] = useState<{ face: number; key: number } | null>(null); // where the camera flies to
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null); // nation under the mouse
  // Audiences with each nation's leader (separate from the people's shared mind).
  const [talkTo, setTalkTo] = useState<number | null>(null);
  const [leaderChats, setLeaderChats] = useState<LeaderMessage[][]>(() => Array.from({ length: count }, () => []));
  const [moods, setMoods] = useState<Mood[]>(() => new Array(count).fill("pleased"));
  const [leaderBusy, setLeaderBusy] = useState(false);
  const leaderChatsRef = useRef(leaderChats);
  leaderChatsRef.current = leaderChats;

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
  const lastNews = useRef(0);
  const lastAlert = useRef(sim.alert);
  const leaderSeeds = useRef<number[]>([]);
  const lastTold = useRef<Record<string, number>>({}); // year each kind of event was last narrated, per nation

  const setCiv = (id: number, civ: Civ) => {
    const next = [...civsRef.current];
    next[id] = civ;
    civsRef.current = next;
    setCivs(next);
    sim.nations[id].name = civ.name; // sim events now use the name the mind chose
  };
  // New nations can appear mid-game (breakaways, newcomers): grow every per-nation list to match.
  const growTo = (k: number) => {
    const pad = <T,>(a: T[], fill: () => T) => [...a, ...Array.from({ length: Math.max(0, k - a.length) }, fill)];
    civsRef.current = pad(civsRef.current, () => null);
    setCivs(civsRef.current);
    chatsRef.current = pad(chatsRef.current, () => []);
    setChats(chatsRef.current);
    leaderChatsRef.current = pad(leaderChatsRef.current, () => []);
    setLeaderChats(leaderChatsRef.current);
    setReasons((r) => pad(r, () => ""));
    setMoods((m) => pad(m, () => "pleased" as Mood));
    lastThought.current = pad(lastThought.current, () => Date.now());
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
        year: sim.calendar,
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
          race: info.race,
          era: info.era,
          leader: info.leader,
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
    const next = answer == null && genesis == null && Date.now() - lastNews.current > NEWS_GAP_MS ? queue.current.shift() : undefined;
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
        lastNews.current = Date.now();
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
      if (civsRef.current.length < sim.nations.length) growTo(sim.nations.length);
      const h = readHud(sim);
      setHud(h);
      // A new ruler (after a revolution) doesn't remember the old one's audiences.
      h.nations.forEach((n) => {
        const was = leaderSeeds.current[n.id];
        leaderSeeds.current[n.id] = n.leader.seed;
        if (was == null || was === n.leader.seed) return;
        leaderChatsRef.current = leaderChatsRef.current.map((c, i) => (i === n.id ? [] : c));
        setLeaderChats(leaderChatsRef.current);
        setMoods((m) => m.map((x, i) => (i === n.id ? "pleased" : x)));
      });
      if (h.alert && h.alert !== lastAlert.current) sound.forIcon(h.alert.icon); // each new pop-up has its own sound
      lastAlert.current = h.alert;
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
        if (e.kind !== "milestone" && sim.year - (lastTold.current[key] ?? -999) < (big ? 25 : 90)) continue;
        lastTold.current[key] = sim.year;
        if (e.kind === "village" && h.nations[nation].villages > 1) continue; // routine growth
        queue.current.push({ ...e, nation });
      }
      for (const n of h.nations) {
        if (n.crisis && n.crisis !== lastCrisis[n.id] && civsRef.current[n.id]) queue.current.push({ kind: n.crisis, detail: `A ${n.crisis} has begun in ${n.name}.`, nation: n.id });
        lastCrisis[n.id] = n.crisis;
      }
      queue.current = queue.current.slice(-2); // stay current: drop old news if the LLM falls behind
      pump();
    }, 300);
    return () => clearInterval(id);
  }, [sim, pump, count]);

  // Which nation is under the mouse: the land it owns, or else its nearest village or people.
  const hoverAt = (face: number | null, x: number, y: number) => {
    let id = face == null ? -1 : sim.owner[face];
    if (face != null && id < 0) {
      const near = (f: number) => sim.angle(f, face) < 0.05;
      id = sim.villages.find((v) => near(v.face))?.nation ?? sim.people.find((p) => near(p.face))?.nation ?? -1;
    }
    setHover(id >= 0 ? { id, x, y } : null);
  };

  // The god's words go into the chosen nation's chat; its mind answers as soon as it is free.
  const speak = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !civs[sel]) return;
    setDraft("");
    addChat(sel, { from: "god", text });
    answerDue.current = sel;
    pump();
  };

  // An audience with a leader. They speak first when you arrive, then answer each thing you say.
  // What they decide changes the sim: a new focus for their people, or friendship or hostility to a neighbour.
  const askLeader = async (id: number, history: LeaderMessage[]) => {
    setLeaderBusy(true);
    try {
      const r = await post<LeaderReply>("/api/leader", { world: worldFor(id), chat: history });
      const next = leaderChatsRef.current.map((c, i) => (i === id ? [...history, { from: "leader" as const, text: r.reply }].slice(-30) : c));
      leaderChatsRef.current = next;
      setLeaderChats(next);
      setMoods((m) => m.map((x, i) => (i === id ? r.mood : x)));
      const nt = sim.nations[id];
      const who = `${nt.leader.title} ${nt.leader.name}`;
      if (r.policy && r.policy !== nt.policy) {
        nt.policy = r.policy;
        addEntry({ year: sim.calendar, kind: "mind", nation: id, text: `${who} orders ${cap(nt.name)} to turn to ${POLICY_LABEL[r.policy].toLowerCase()}.` });
      }
      const other = r.toward && sim.nations.find((o) => o.id !== id && o.alive && o.name.toLowerCase() === r.toward!.nation.toLowerCase());
      if (other) {
        sim.sway(id, other.id, r.toward!.stance === "hostile" ? 12 : -12); // a ruler's word counts for more than the mind's
        addEntry({ year: sim.calendar, kind: "diplomacy", nation: id, text: `${who} ${r.toward!.stance === "hostile" ? "swears vengeance on" : "sends gifts to"} ${cap(other.name)}.` });
      }
    } finally {
      setLeaderBusy(false);
    }
  };
  const openLeader = (id: number) => {
    if (!sim.nations[id].alive) return;
    setTalkTo(id);
    if (!leaderChatsRef.current[id].length) askLeader(id, []);
  };
  const sayToLeader = (text: string) => {
    if (talkTo == null) return;
    const id = talkTo;
    const history = [...leaderChatsRef.current[id], { from: "god" as const, text }];
    const next = leaderChatsRef.current.map((c, i) => (i === id ? history : c));
    leaderChatsRef.current = next;
    setLeaderChats(next);
    askLeader(id, history);
  };

  const { stats } = hud;
  const civ = civs[sel];
  const me = hud.nations[sel];
  const chat = chats[sel];
  const awake = civs.filter(Boolean).length;
  return (
    <main className="relative h-dvh w-full overflow-hidden select-none">
      <div className="absolute inset-0 isolate">
        <Globe sim={sim} tool={miracle ? MIRACLES.find((m) => m.id === miracle)!.tool : "hand"} speed={1} onPaint={(_, face) => cast(face)} onHover={hoverAt} focus={focus} />
      </div>

      {/* The planet and its nations */}
      <aside className="glass absolute bottom-4 left-4 top-4 flex w-64 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <p className="label">
            Year {Math.floor(hud.year / SECONDS_PER_YEAR)} · God: {playerName}
          </p>
          <p className="truncate text-2xl font-semibold" title={planetName}>{planetName}</p>
          <p className="text-xs text-white/55">
            {sim.type.name} world · prone to {sim.type.hazard}s
          </p>
          <p className="text-[11px] text-white/40" title="Between planets: armies from this kind of world beat yours">
            Weak to {sim.type.weakTo} ({sim.type.weakWhy})
          </p>
          <div className="my-2 flex gap-2">
            <div className="flex-1 rounded-lg bg-sky-400/15 px-2.5 py-1.5" title="Resources produced per year, weighted by value. Peace and trade raise it.">
              <p className="text-[10px] uppercase tracking-wider text-sky-200/70">Output / yr</p>
              <p className="text-xl font-bold tabular-nums">{hud.output.toLocaleString()}</p>
            </div>
            <div className="flex-1 rounded-lg bg-white/5 px-2.5 py-1.5" title="Military strength: one in five of your people can fight.">
              <p className="text-[10px] uppercase tracking-wider text-white/50">Military</p>
              <p className="text-xl font-bold tabular-nums">{hud.military}</p>
            </div>
          </div>
          <div className="mb-2 rounded-lg bg-amber-300/10 px-2.5 py-1.5" title="Your power. Nations earn it for you by worshipping; it grows faster when they love you. Spend it on miracles, prayers and interventions.">
            <p className="text-[10px] uppercase tracking-wider text-amber-200/70">Devotion</p>
            <p className="text-xl font-bold tabular-nums">✨ {Math.floor(hud.god.devotion)}</p>
          </div>
          <Goal hud={hud} />
          <p className="text-xs text-white/45">{sim.type.blurb}</p>
          <p className="text-sm text-white/60">
            {stats.population.toLocaleString()} people · {stats.villages} {stats.villages === 1 ? "village" : "villages"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stock align="left" icon="🌾" label="Food" info="Harvested by well-fed people from the land around their homes. Worth 1 point of Output." value={stats.resources.food} />
          <Stock icon="🪵" label="Wood" info="Cut from forests, which slowly get cleared around towns. Worth 1 point of Output." value={stats.resources.wood} />
          <Stock align="right" icon="🪨" label="Stone" info="Quarried from rocky mountainsides. Worth 2 points of Output." value={stats.resources.stone} />
          <Stock align="left" icon="⚙️" label="Metal" info="Mined from ore in the mountains. Worth 3 points of Output." value={stats.resources.metal} />
          <Stock icon="🪙" label="Gold" info="Mined only at gold deposits, the yellow specks on the map. The most valuable: worth 5 points of Output." value={stats.resources.gold} />
          <Stock align="right" icon="🌿" label="Herbs" info="Medicinal plants gathered in forests. A stockpile helps people live longer and resist plague. Worth 3 points of Output." value={stats.resources.herbs} />
        </div>
        {/* Map key for the coloured specks on the globe (see DEPOSIT in Globe.tsx) */}
        <div className="-mt-2 flex justify-between text-[11px] text-white/50">
          {[["#ffd447", "Gold"]].map(([c, label]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: c }} />
              {label} deposits
            </span>
          ))}
        </div>
        <div>
          <p className="label mb-1.5">
            Nations ({hud.nations.filter((n) => n.alive).length})
            {hud.nations.some((n) => !n.alive) && <span className="normal-case text-white/40"> · {hud.nations.filter((n) => !n.alive).length} fallen</span>}
          </p>
          <ul className="space-y-1">
            {hud.nations.filter((n) => n.alive).map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setSel(n.id);
                    const face = sim.nationHome(n.id);
                    if (face != null) setFocus({ face, key: Date.now() });
                  }}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${sel === n.id ? "bg-white/15" : "hover:bg-white/5"} ${n.alive ? "" : "opacity-40"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: n.color }} />
                    <span title={RACE[n.race].name}>{RACE[n.race].icon}</span>
                    <span className="flex-1 truncate font-medium">{cap(n.name)}</span>
                    <span className="text-xs tabular-nums text-white/50">{n.alive ? n.population : "fallen"}</span>
                  </div>
                  <div className="ml-4.5 flex flex-wrap gap-x-2 text-xs">
                    {n.alive && <span className="text-amber-200/70">{ERAS[n.era]}</span>}
                    {!!n.ships && <span className="text-sky-200/80" title={`Navy: ${n.ships} warship${n.ships === 1 ? "" : "s"}`}>⚓ {n.ships}</span>}
                    {n.crisis && <span className="font-semibold uppercase text-rose-300">{n.crisis}</span>}
                    {n.relations
                      .filter((r) => n.alive && r.relation !== "peace")
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
        <div className="mt-auto flex items-end justify-center gap-2">
          <button
            onClick={() => setGalaxy(true)}
            disabled={!hud.god.spacefaring}
            className={`rounded-lg px-2.5 py-1 text-sm transition ${hud.god.spacefaring ? "bg-indigo-400/25 font-semibold hover:bg-indigo-400/40" : "bg-white/5 opacity-50"}`}
            title={hud.god.spacefaring ? "Travel to other players' planets" : `Locked: your nation must reach the Space Age (now in the ${ERAS[hud.nations[0]?.era ?? 0]})`}
          >
            {hud.god.spacefaring ? "🌌 Galaxy" : "🔒 Galaxy"}
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            className="rounded-lg bg-white/5 px-2.5 py-1 text-sm transition hover:bg-white/10"
            title={muted ? "Turn sound on" : "Mute"}
            aria-label={muted ? "Turn sound on" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
        {!awake && <p className="text-xs text-white/55">Your nations are wandering. When each founds a village it will become aware of you. Once they worship you, you earn devotion to spend on miracles.</p>}
      </aside>

      {/* Pop-up: what is happening on the planet right now (disasters, weather, fate) */}
      {hud.alert && hud.year - hud.alert.at < 7 && (
        <div className="pointer-events-none absolute top-4 left-[17.5rem] right-[19.5rem] flex justify-center">
          <div key={hud.alert.at} className="glass alert-pop pointer-events-auto flex max-w-lg items-center gap-3 px-5 py-3">
            <span className="text-3xl leading-none">{hud.alert.icon}</span>
            <div className="min-w-0">
              <div className="text-base font-bold">{hud.alert.title}</div>
              <div className="text-sm text-white/75">{hud.alert.text}</div>
            </div>
            <button onClick={() => setFocus({ face: hud.alert!.face, key: Date.now() })} className="ml-2 shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20">
              Show me
            </button>
          </div>
        </div>
      )}

      {/* Fate: the latest thing the heavens did, and the controls hint */}
      <div className="pointer-events-none absolute bottom-4 left-[17.5rem] right-[19.5rem] flex flex-col items-center gap-2">
        {hud.god.choice && (
          <ChoiceCard
            choice={hud.god.choice}
            left={CHOICE_LIFE - (hud.year - hud.god.choice.at)}
            devotion={hud.god.devotion}
            names={hud.nations}
            onPick={(yes) => {
              sim.decide(yes);
              setHud(readHud(sim));
            }}
            onShow={() => setFocus({ face: hud.god.choice!.face, key: Date.now() })}
          />
        )}
        {hud.god.prayers.slice(-3).map((p) => (
          <div key={p.id} className="glass pointer-events-auto relative flex w-[30rem] max-w-full items-center gap-3 overflow-hidden px-4 py-2.5 text-sm">
            <span className="text-xl">🙏</span>
            <span className="flex-1">{cap(p.text)}</span>
            <Countdown left={PRAYER_LIFE - (hud.year - p.at)} life={PRAYER_LIFE} />
            <button
              disabled={hud.god.devotion < p.cost}
              onClick={() => {
                sim.answerPrayer(p.id, true);
                setHud(readHud(sim));
              }}
              className="rounded-lg bg-amber-300/20 px-2.5 py-1 text-xs font-semibold transition hover:bg-amber-300/30 disabled:opacity-40"
            >
              Answer ✨{p.cost}
            </button>
            <button
              onClick={() => {
                sim.answerPrayer(p.id, false);
                setHud(readHud(sim));
              }}
              className="rounded-lg bg-white/5 px-2.5 py-1 text-xs transition hover:bg-white/10"
            >
              Ignore
            </button>
          </div>
        ))}
        <div className="glass pointer-events-auto flex gap-1.5 p-1.5">
          {MIRACLES.map((m) => {
            const wait = Math.ceil(hud.god.ready[m.id] - hud.year);
            const off = wait > 0 || hud.god.devotion < m.cost;
            return (
              <button
                key={m.id}
                onClick={() => setMiracle((x) => (x === m.id ? null : m.id))}
                disabled={off && miracle !== m.id}
                title={m.blurb}
                className={`relative w-24 rounded-lg px-2 py-1.5 text-center transition disabled:opacity-40 ${miracle === m.id ? "bg-amber-300/30 ring-1 ring-amber-200" : "bg-white/5 hover:bg-white/10"}`}
              >
                <div className="text-lg leading-none">{m.icon}</div>
                <div className="mt-0.5 text-[11px] font-semibold">{m.name}</div>
                <div className="text-[10px] text-amber-200/80">{wait > 0 ? `ready in ${wait}s` : `✨ ${m.cost}`}</div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-white/40">{miracle ? "Click the land to cast · Esc to cancel" : "Drag to rotate · scroll to zoom · pick a miracle, then click the land"}</p>
      </div>

      {talkTo != null && hud.nations[talkTo] && (
        <LeaderDialog nation={hud.nations[talkTo]} civ={civs[talkTo]} chat={leaderChats[talkTo]} mood={moods[talkTo]} busy={leaderBusy} onSay={sayToLeader} onClose={() => setTalkTo(null)} />
      )}

      {hover && hud.nations[hover.id] && <NationCard n={hud.nations[hover.id]} civ={civs[hover.id]} all={hud.nations} x={hover.x} y={hover.y} />}

      {/* The chosen nation's mind */}
      <aside className="glass absolute bottom-4 right-4 top-4 flex w-72 flex-col p-4">
        <div className="mb-3 space-y-2 border-b border-white/10 pb-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: me.color }} />
            <p className="text-lg font-semibold">{cap(me.name)}</p>
          </div>
          <button
            onClick={() => openLeader(sel)}
            disabled={!me.alive}
            className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2 text-left transition hover:bg-white/10 disabled:opacity-40"
            title="Hold an audience with their leader"
          >
            <span className="shrink-0 overflow-hidden rounded-lg">
              <Portrait race={me.race} seed={me.leader.seed} color={me.color} mood={moods[sel]} size={52} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {me.leader.title} {me.leader.name}
              </span>
              <span className="block text-xs text-white/55">
                {RACE[me.race].icon} {RACE[me.race].name} · {ERAS[me.era]}
              </span>
              <span className="block text-xs text-sky-300">🗣️ Talk to the leader</span>
            </span>
          </button>
          <NeedBars needs={me.needs} crisis={me.crisis} love={me.love} />
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
      {hud.god.outcome && !seenOutcome && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass w-[26rem] p-6 text-center">
            <div className="text-5xl">{hud.god.outcome.won ? "🏆" : "🌑"}</div>
            <h2 className="mt-3 text-2xl font-bold">{hud.god.outcome.title}</h2>
            <p className="mt-2 text-sm text-white/75">{hud.god.outcome.text}</p>
            <div className="mt-5 flex justify-center gap-2">
              <button onClick={() => setSeenOutcome(true)} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
                Keep watching
              </button>
              <button onClick={() => location.reload()} className="rounded-lg bg-sky-400/30 px-4 py-2 text-sm font-semibold hover:bg-sky-400/40">
                New planet
              </button>
            </div>
          </div>
        </div>
      )}
      {/* The galaxy: unlocked when your nation reaches the Space Age. Multiplayer (other players' planets) plugs in here. */}
      {galaxy && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setGalaxy(false)}>
          <div className="glass w-[26rem] p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl">🌌</div>
            <h2 className="mt-3 text-2xl font-bold">The galaxy</h2>
            <p className="mt-2 text-sm text-white/75">
              {cap(hud.nations[0]?.name ?? "your people")} have left {planetName}. Other gods&apos; planets will appear here, to trade with, start trade wars with, or invade.
            </p>
            <button onClick={() => setGalaxy(false)} className="mt-5 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
              Back to {planetName}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function readHud(sim: PlanetSim): Hud {
  return { year: sim.year, stats: sim.stats(), needs: sim.needs(), nations: sim.nationInfo(), fate: sim.fate, alert: sim.alert, output: Math.round(sim.output), military: sim.military(),
    god: { devotion: sim.devotion, ready: { ...sim.ready }, prayers: [...sim.prayers], spacefaring: sim.spacefaring, choice: sim.choice, outcome: sim.outcome, avgLove: sim.avgLove() } };
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
  if (url === "/api/leader") return fallbackLeader(world, chat as unknown as LeaderMessage[]);
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

// The card that follows the mouse when hovering over a nation on the globe.
function NationCard({ n, civ, all, x, y }: { n: NationInfo; civ: Civ | null; all: NationInfo[]; x: number; y: number }) {
  const left = Math.min(x + 16, window.innerWidth - 260);
  const top = Math.min(y + 16, window.innerHeight - 260);
  return (
    <div className="glass pointer-events-none fixed z-10 w-60 space-y-2 p-3 text-sm" style={{ left, top }}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: n.color }} />
        <p className="font-semibold">{cap(n.name)}</p>
        {n.crisis && <span className="ml-auto text-xs font-semibold uppercase text-rose-300">{n.crisis}</span>}
      </div>
      <p className="text-xs text-white/60">
        {RACE[n.race].icon} {RACE[n.race].name} · {ERAS[n.era]} · led by {n.leader.title} {n.leader.name}
      </p>
      {civ && <p className="text-xs text-white/60">{cap(civ.demonym)} · worship {civ.religion.godName} ({civ.religion.name}) · feel {civ.attitude}</p>}
      <p className="text-xs text-white/70">
        {n.alive ? `${n.population} people · ${n.villages} ${n.villages === 1 ? "village" : "villages"} · ${POLICY_LABEL[n.policy].toLowerCase()}` : "Fallen"}
      </p>
      <NeedBars needs={n.needs} crisis={null} />
      {n.relations.length > 0 && (
        <div className="flex flex-wrap gap-x-2 text-xs">
          {n.relations.map((r) => (
            <span key={r.id} className={RELATION_STYLE[r.relation].cls}>
              {RELATION_STYLE[r.relation].icon} {RELATION_STYLE[r.relation].label} with {cap(all[r.id].name)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// One resource tile; hovering shows what it is and where it comes from.
// The tooltip lines up with the tile's outer edge in the side columns, so it never runs off the panel.
const TIP_ALIGN = { left: "left-0", center: "left-1/2 -translate-x-1/2", right: "right-0" };
function Stock({ icon, label, info, value, align = "center" }: { icon: string; label: string; info: string; value: number; align?: keyof typeof TIP_ALIGN }) {
  return (
    <div className="group relative cursor-help rounded-lg bg-white/5 py-1.5" aria-label={`${label}: ${info}`}>
      <div>{icon}</div>
      <div className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className={`pointer-events-none absolute top-full z-50 mt-1.5 w-44 ${TIP_ALIGN[align]} rounded-lg border border-white/15 bg-[#0d1424] px-2.5 py-2 text-left opacity-0 shadow-xl transition-opacity group-hover:opacity-100`}>
        <p className="text-xs font-semibold">
          {icon} {label}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/70">{info}</p>
      </div>
    </div>
  );
}

function NeedBars({ needs, crisis, love }: { needs: Needs; crisis: Crisis | null; love?: number }) {
  const bars: [string, number][] = [
    ["Food", needs.food],
    ["Stability", needs.stability],
    ...(love != null ? [["Love for you", love] as [string, number]] : []),
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


// The goal, and how close the god is to it.
function Goal({ hud }: { hud: Hud }) {
  const mine = hud.nations[0];
  const year = Math.floor(hud.year / SECONDS_PER_YEAR);
  const love = Math.round(hud.god.avgLove);
  return (
    <div className="mb-2 rounded-lg border border-white/10 px-2.5 py-2 text-xs" title="Lose if your people fall, or if every nation comes to hate you.">
      <p className="text-[10px] uppercase tracking-wider text-white/50">Goal</p>
      <p className="text-white/80">
        Keep {mine ? cap(mine.name) : "your people"} alive to Year {GOAL_YEAR}, loved by the nations.
      </p>
      <div className="mt-1.5 flex justify-between text-white/60">
        <span>
          Year {Math.min(year, GOAL_YEAR)}/{GOAL_YEAR}
        </span>
        <span className={love >= 50 ? "text-emerald-300" : love < 25 ? "text-rose-300" : "text-amber-200"}>Love {love}/50</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-sky-300" style={{ width: `${Math.min(100, (year / GOAL_YEAR) * 100)}%` }} />
      </div>
    </div>
  );
}

// A disaster, war or revolution has begun: step in (for devotion) or let fate decide.
// Seconds left to answer, as a number plus a bar along the card's bottom edge that drains and turns red near the end.
function Countdown({ left, life }: { left: number; life: number }) {
  const s = Math.max(0, Math.ceil(left)), urgent = s <= 5;
  return (
    <>
      <span className={`w-8 text-right text-xs tabular-nums ${urgent ? "font-bold text-red-400" : "text-white/50"}`} title="Seconds left to decide">
        {s}s
      </span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
        <span className={`block h-full transition-[width] duration-300 ease-linear ${urgent ? "bg-red-400" : "bg-amber-300/70"}`} style={{ width: `${Math.max(0, Math.min(1, left / life)) * 100}%` }} />
      </span>
    </>
  );
}

function ChoiceCard({ choice, left, devotion, names, onPick, onShow }: { choice: NonNullable<Hud["god"]["choice"]>; left: number; devotion: number; names: NationInfo[]; onPick: (intervene: boolean) => void; onShow: () => void }) {
  const what = { disaster: "Turn it aside", war: "Force a peace", revolution: "Calm the people" }[choice.kind];
  const who = choice.nations.map((n) => names[n]?.name).filter(Boolean).map((n) => cap(n!)).join(" and ");
  return (
    <div className="glass alert-pop pointer-events-auto relative w-[30rem] max-w-full overflow-hidden px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold">{choice.title}</span>
        <span className="text-xs text-white/50">{who}</span>
        <button onClick={onShow} className="ml-auto text-xs text-sky-300 hover:underline">
          Show me
        </button>
        <Countdown left={left} life={CHOICE_LIFE} />
      </div>
      <p className="mt-0.5 text-sm text-white/75">{choice.text}</p>
      <div className="mt-2 flex gap-2">
        <button disabled={devotion < choice.cost} onClick={() => onPick(true)} className="flex-1 rounded-lg bg-amber-300/20 px-3 py-1.5 text-sm font-semibold transition hover:bg-amber-300/30 disabled:opacity-40">
          {what} ✨{choice.cost}
        </button>
        <button onClick={() => onPick(false)} className="flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-sm transition hover:bg-white/10">
          Let fate decide
        </button>
      </div>
    </div>
  );
}
