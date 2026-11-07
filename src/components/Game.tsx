"use client";
// The game screen: the globe in the middle, the planet and its nations on the left,
// the god powers along the bottom, and the chosen nation's mind on the right.
// Each nation has its own AI mind and religion. This file wires the sim
// (src/sim/planet.ts) to the LLM routes (/api/narrate, /api/mind).
import { useCallback, useEffect, useRef, useState } from "react";
import Globe from "./Globe";
import Galaxy, { type GalaxyStatus } from "./Galaxy";
import LeaderDialog from "./LeaderDialog";
import Portrait, { type Mood } from "./Portrait";
import { ERAS, RACE, type RaceId } from "@/sim/races";
import {
  CHOICE_LIFE,
  GOAL_YEAR,
  MIRACLES,
  PRAYER_LIFE,
  PLANET_TYPES,
  PlanetSim,
  SECONDS_PER_YEAR,
  UPGRADES,
  type MiracleId,
  type SimEvent,
} from "@/sim/planet";
import { sound } from "@/lib/sound";
import { saveGame, type Save } from "@/lib/save";
import {
  fallbackCiv,
  fallbackLeader,
  fallbackReaction,
  fallbackThought,
  type LeaderReply,
} from "@/lib/narrator";
import type {
  ChronicleEntry,
  ChronicleKind,
  Civ,
  Crisis,
  LeaderMessage,
  MindMessage,
  NationInfo,
  Needs,
  PlanetStats,
  Policy,
  Relation,
  Resources,
  World,
} from "@/types/world";

const POLICY_LABEL: Record<Policy, string> = {
  settle: "Settling down",
  expand: "Expanding",
  farm: "Farming",
  worship: "Worshipping you",
  explore: "Exploring",
  hoard: "Hoarding",
  rebel: "Rebelling",
};
const RELATION_STYLE: Record<
  Relation,
  { icon: string; cls: string; label: string }
> = {
  peace: { icon: "·", cls: "text-white/40", label: "at peace" },
  trade: { icon: "🤝", cls: "text-emerald-300", label: "trading" },
  rival: { icon: "😠", cls: "text-amber-300", label: "rivals" },
  war: { icon: "⚔️", cls: "text-rose-300", label: "at war" },
};
const THINK_EVERY_MS = 75_000; // each nation's mind speaks up on its own this often
const THINK_GAP_MS = 20_000; // but minds take turns, at most one every 20 seconds
const NEWS_GAP_MS = 20_000; // the chronicle tells at most one piece of news every 20 seconds
const DEMO_GAPS = 0.4; // demo mode: the AI speaks 2.5x as often, to fit a 3-minute pitch

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
  god: {
    devotion: number;
    ready: PlanetSim["ready"];
    prayers: PlanetSim["prayers"];
    spacefaring: boolean;
    choice: PlanetSim["choice"];
    outcome: PlanetSim["outcome"];
    avgLove: number;
  };
}

export default function Game({
  playerName,
  planetName = "Arda",
  race,
  worldType,
  demo,
  resume,
  onNewPlanet,
}: {
  playerName: string;
  planetName?: string;
  race?: RaceId;
  worldType?: number;
  demo?: boolean;
  resume?: Save;
  onNewPlanet?: () => void;
}) {
  const [sim] = useState(() => {
    if (resume) {
      try {
        return PlanetSim.fromSave(resume.sim);
      } catch (err) {
        console.warn("Saved game could not be loaded; starting a new one", err);
      }
    }
    // The planet type comes from the seed (seed % 5), so a chosen world just picks a matching seed.
    const seed =
      worldType == null
        ? undefined
        : Math.floor(Math.random() * 2e5) * PLANET_TYPES.length + worldType;
    const s = new PlanetSim(seed);
    s.seedNations(undefined, 10, race); // 3 to 5 nations, far apart; the first is the god's chosen race
    if (demo) s.startDemo();
    return s;
  });
  const count = sim.nations.length;
  const [ui] = useState(() =>
    resume?.ui && resume.ui.civs.length === sim.nations.length
      ? resume.ui
      : null,
  ); // what the HUD had when the game was saved
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
  const [galaxy, setGalaxy] = useState<"market" | "invade" | "offers" | "join" | null>(null);
  const [upgradesOpen, setUpgradesOpen] = useState(false);
  const resourcesPanelRef = useRef<HTMLDivElement>(null);
  const upgradesMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!upgradesOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !resourcesPanelRef.current?.contains(target) &&
        !upgradesMenuRef.current?.contains(target)
      ) {
        setUpgradesOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [upgradesOpen]);
  const [link, setLink] = useState<GalaxyStatus>({
    enabled: null,
    galaxy: null,
    members: 0,
  }); // the galaxy connection, for the HUD
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
  const [civs, setCivs] = useState<(Civ | null)[]>(
    () => ui?.civs ?? new Array(count).fill(null),
  );
  const [chats, setChats] = useState<MindMessage[][]>(
    () => ui?.chats ?? Array.from({ length: count }, () => []),
  );
  const [reasons, setReasons] = useState<string[]>(
    () => ui?.reasons ?? new Array(count).fill(""),
  );
  const [chronicle, setChronicle] = useState<Entry[]>(
    () => ui?.chronicle ?? [],
  );
  const [sel, setSel] = useState(() => ui?.sel ?? 0); // the nation the god is looking at and talking to
  const [busy, setBusy] = useState<"" | "narrating" | "thinking">("");
  const [focus, setFocus] = useState<{ face: number; key: number } | null>(
    null,
  ); // where the camera flies to
  const [hover, setHover] = useState<{
    id: number;
    x: number;
    y: number;
  } | null>(null); // nation under the mouse
  // Audiences with each nation's leader (separate from the people's shared mind).
  const [talkTo, setTalkTo] = useState<number | null>(null);
  const [leaderChats, setLeaderChats] = useState<LeaderMessage[][]>(
    () => ui?.leaderChats ?? Array.from({ length: count }, () => []),
  );
  const [moods, setMoods] = useState<Mood[]>(
    () => ui?.moods ?? new Array(count).fill("pleased"),
  );
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
  // Nations that just founded their first village (on a reload, any settled nation whose mind hadn't woken yet).
  const genesisDue = useRef<number[]>(
    ui
      ? sim.nations
          .filter(
            (n) =>
              n.alive &&
              !ui.civs[n.id] &&
              sim.villages.some((v) => v.nation === n.id),
          )
          .map((n) => n.id)
      : [],
  );
  const inFlight = useRef(false);
  const lastThought = useRef<number[]>(new Array(count).fill(Date.now()));
  const lastAnyThought = useRef(Date.now());
  const answerDue = useRef<number | null>(null); // the god spoke to this nation and it hasn't answered yet
  const lastNews = useRef(0);
  const lastAlert = useRef(sim.alert);
  const leaderSeeds = useRef<number[]>([]);
  const lastTold = useRef<Record<string, number>>({}); // year each kind of event was last narrated, per nation

  // Save the whole game to this browser every few seconds and when the tab is closed or refreshed.
  const latest = useRef({ reasons, moods, sel });
  latest.current = { reasons, moods, sel };
  useEffect(() => {
    const save = () =>
      saveGame({
        meta: { playerName, planetName, race, demo },
        ui: {
          civs: civsRef.current,
          chats: chatsRef.current,
          leaderChats: leaderChatsRef.current,
          chronicle: chronicleRef.current,
          ...latest.current,
        },
        sim: sim.toSave(),
        at: Date.now(),
      });
    const id = setInterval(save, 5000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", save);
    };
  }, [sim, playerName, planetName, race, demo]);

  const setCiv = (id: number, civ: Civ) => {
    const next = [...civsRef.current];
    next[id] = civ;
    civsRef.current = next;
    setCivs(next);
    sim.nations[id].name = civ.name; // sim events now use the name the mind chose
  };
  // New nations can appear mid-game (breakaways, newcomers): grow every per-nation list to match.
  const growTo = (k: number) => {
    const pad = <T,>(a: T[], fill: () => T) => [
      ...a,
      ...Array.from({ length: Math.max(0, k - a.length) }, fill),
    ];
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
    const next = chatsRef.current.map((c, i) =>
      i === id ? [...c, m].slice(-30) : c,
    );
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
          relations: info.relations.map((r) => ({
            name: sim.nationName(r.id),
            relation: r.relation,
            tension: r.tension,
          })),
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
    const gap = sim.demo ? DEMO_GAPS : 1;
    const next =
      answer == null &&
      genesis == null &&
      Date.now() - lastNews.current > NEWS_GAP_MS * gap
        ? queue.current.shift()
        : undefined;
    let thinker: number | null = answer;
    if (
      thinker == null &&
      genesis == null &&
      !next &&
      Date.now() - lastAnyThought.current > THINK_GAP_MS * gap
    ) {
      const ready = sim.nations.filter(
        (n) =>
          n.alive &&
          civsRef.current[n.id] &&
          Date.now() - lastThought.current[n.id] > THINK_EVERY_MS * gap,
      );
      ready.sort(
        (a, b) => lastThought.current[a.id] - lastThought.current[b.id],
      );
      thinker = ready[0]?.id ?? null;
    }
    if (genesis == null && !next && thinker == null) return;
    answerDue.current = null;
    inFlight.current = true;
    try {
      if (genesis != null) {
        setBusy("narrating");
        const res = await post<{ civ: Civ; entry: ChronicleEntry }>(
          "/api/narrate",
          { world: worldFor(genesis), kind: "genesis" },
        );
        setCiv(genesis, res.civ);
        addEntry({ ...res.entry, nation: genesis });
        lastThought.current[genesis] =
          Date.now() - THINK_EVERY_MS * gap + 15_000 * gap; // first words soon after waking
      } else if (next) {
        setBusy("narrating");
        lastNews.current = Date.now();
        const res = await post<{ civ: Civ; entry: ChronicleEntry }>(
          "/api/narrate",
          {
            world: worldFor(next.nation),
            kind: next.kind,
            detail: next.detail,
          },
        );
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
    const res = await post<{
      civ: Civ;
      reply: string;
      policy: Policy;
      reason: string;
      toward: { nation: string; stance: string } | null;
    }>("/api/mind", {
      world: w,
      chat: chatsRef.current[id],
    });
    setCiv(id, res.civ);
    addChat(id, { from: "mind", text: res.reply });
    const nt = sim.nations[id];
    if (res.policy !== nt.policy)
      addEntry({
        year: w.year,
        kind: "mind",
        nation: id,
        text: `${res.civ.name} turn to ${POLICY_LABEL[res.policy].toLowerCase()}: ${res.reason}`,
      });
    nt.policy = res.policy;
    setReasons((r) => r.map((x, i) => (i === id ? res.reason : x)));
    // The mind's stance towards a neighbour nudges the tension between them.
    const other =
      res.toward &&
      sim.nations.find(
        (o) =>
          o.id !== id &&
          o.alive &&
          o.name.toLowerCase() === res.toward!.nation.toLowerCase(),
      );
    if (other)
      sim.sway(id, other.id, res.toward!.stance === "hostile" ? 6 : -6);
  };

  // Poll the sim for the HUD, collect its events, and keep the LLM pump going.
  useEffect(() => {
    const lastCrisis: (Crisis | null)[] = new Array(count).fill(null);
    const id = setInterval(() => {
      if (civsRef.current.length < sim.nations.length)
        growTo(sim.nations.length);
      const h = readHud(sim);
      setHud(h);
      // A new ruler (after a revolution) doesn't remember the old one's audiences.
      h.nations.forEach((n) => {
        const was = leaderSeeds.current[n.id];
        leaderSeeds.current[n.id] = n.leader.seed;
        if (was == null || was === n.leader.seed) return;
        leaderChatsRef.current = leaderChatsRef.current.map((c, i) =>
          i === n.id ? [] : c,
        );
        setLeaderChats(leaderChatsRef.current);
        setMoods((m) => m.map((x, i) => (i === n.id ? "pleased" : x)));
      });
      if (h.alert && h.alert !== lastAlert.current) sound.forIcon(h.alert.icon); // each new pop-up has its own sound
      lastAlert.current = h.alert;
      for (const e of sim.events.splice(0)) {
        const awake = sim.nations
          .filter((n) => civsRef.current[n.id])
          .map((n) => n.id);
        const nation =
          e.nation ?? awake[Math.floor(Math.random() * awake.length)];
        if (nation == null) continue;
        if (!civsRef.current[nation]) {
          // A nation becomes self-aware when it founds its first village.
          if (e.kind === "village" && !genesisDue.current.includes(nation)) {
            genesisDue.current.push(nation);
            genesisDue.current.sort((a, b) => a - b); // your own people (nation 0) wake first
          }
          continue;
        }
        // Don't narrate the same kind of thing for the same nation twice in quick succession.
        const big =
          e.kind === "diplomacy" ||
          e.kind === "captured" ||
          e.kind === "fallen";
        const key = big
          ? `${e.kind}:${Math.min(nation, e.other ?? nation)}-${Math.max(nation, e.other ?? nation)}`
          : `${e.kind}:${nation}`;
        if (
          e.kind !== "milestone" &&
          sim.year - (lastTold.current[key] ?? -999) < (big ? 25 : 90)
        )
          continue;
        lastTold.current[key] = sim.year;
        if (e.kind === "village" && h.nations[nation].villages > 1) continue; // routine growth
        queue.current.push({ ...e, nation });
      }
      for (const n of h.nations) {
        if (n.crisis && n.crisis !== lastCrisis[n.id] && civsRef.current[n.id])
          queue.current.push({
            kind: n.crisis,
            detail: `A ${n.crisis} has begun in ${n.name}.`,
            nation: n.id,
          });
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
      id =
        sim.villages.find((v) => near(v.face))?.nation ??
        sim.people.find((p) => near(p.face))?.nation ??
        -1;
    }
    setHover(id >= 0 ? { id, x, y } : null);
  };

  // An audience with a leader. They speak first when you arrive, then answer each thing you say.
  // What they decide changes the sim: a new focus for their people, or friendship or hostility to a neighbour.
  const askLeader = async (id: number, history: LeaderMessage[]) => {
    setLeaderBusy(true);
    try {
      const r = await post<LeaderReply>("/api/leader", {
        world: worldFor(id),
        chat: history,
      });
      const next = leaderChatsRef.current.map((c, i) =>
        i === id
          ? [...history, { from: "leader" as const, text: r.reply }].slice(-30)
          : c,
      );
      leaderChatsRef.current = next;
      setLeaderChats(next);
      setMoods((m) => m.map((x, i) => (i === id ? r.mood : x)));
      const nt = sim.nations[id];
      const who = `${nt.leader.title} ${nt.leader.name}`;
      if (r.policy && r.policy !== nt.policy) {
        nt.policy = r.policy;
        addEntry({
          year: sim.calendar,
          kind: "mind",
          nation: id,
          text: `${who} orders ${cap(nt.name)} to turn to ${POLICY_LABEL[r.policy].toLowerCase()}.`,
        });
      }
      const other =
        r.toward &&
        sim.nations.find(
          (o) =>
            o.id !== id &&
            o.alive &&
            o.name.toLowerCase() === r.toward!.nation.toLowerCase(),
        );
      if (other) {
        sim.sway(id, other.id, r.toward!.stance === "hostile" ? 12 : -12); // a ruler's word counts for more than the mind's
        addEntry({
          year: sim.calendar,
          kind: "diplomacy",
          nation: id,
          text: `${who} ${r.toward!.stance === "hostile" ? "swears vengeance on" : "sends gifts to"} ${cap(other.name)}.`,
        });
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
    const history = [
      ...leaderChatsRef.current[id],
      { from: "god" as const, text },
    ];
    const next = leaderChatsRef.current.map((c, i) => (i === id ? history : c));
    leaderChatsRef.current = next;
    setLeaderChats(next);
    askLeader(id, history);
  };

  const { stats } = hud;
  const civ = civs[sel];
  const me = hud.nations[sel];
  const awake = civs.filter(Boolean).length;
  const availableUpgrades = UPGRADES.filter((upgrade) => {
    const cost = upgrade.costs[sim.upgrades[upgrade.id]];
    return (
      cost &&
      Object.entries(cost).every(
        ([resource, amount]) =>
          stats.resources[resource as keyof typeof stats.resources] >= amount,
      )
    );
  }).length;
  return (
    <main className="relative h-dvh w-full overflow-hidden select-none">
      <div className="absolute inset-0 isolate">
        <Globe
          sim={sim}
          tool={miracle ? MIRACLES.find((m) => m.id === miracle)!.tool : "hand"}
          speed={sim.pace}
          onPaint={(_, face) => cast(face)}
          onHover={hoverAt}
          focus={focus}
        />
      </div>

      {/* The planet and its nations */}
      <aside className="glass subtle-scrollbar absolute bottom-4 left-4 top-4 flex w-64 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <p className="label">
            Year {Math.floor(hud.year / SECONDS_PER_YEAR)} · God: {playerName}
            {demo && (
              <span className="ml-1.5 rounded bg-indigo-400/25 px-1.5 py-0.5 text-[10px] font-bold text-indigo-100">
                DEMO {sim.pace}x
              </span>
            )}
          </p>
          <p className="truncate text-2xl font-semibold" title={planetName}>
            {planetName}
          </p>
          <p className="text-xs text-white/55">
            {sim.type.name} world · prone to {sim.type.hazard}s
          </p>
          <p
            className="text-[11px] text-white/40"
            title="Between planets: armies from this kind of world beat yours"
          >
            Weak to {sim.type.weakTo} ({sim.type.weakWhy})
          </p>
          <div className="my-2 flex gap-2">
            <div
              className="flex-1 rounded-lg bg-sky-400/15 px-2.5 py-1.5"
              title="Resources produced per year, weighted by value. Peace and trade raise it."
            >
              <p className="text-[10px] uppercase tracking-wider text-sky-200/70">
                Output / yr
              </p>
              <p className="text-xl font-bold tabular-nums">
                {hud.output.toLocaleString()}
              </p>
            </div>
            <div
              className="flex-1 rounded-lg bg-white/5 px-2.5 py-1.5"
              title="Military strength: one in five of your people can fight."
            >
              <p className="text-[10px] uppercase tracking-wider text-white/50">
                Military
              </p>
              <p className="text-xl font-bold tabular-nums">{hud.military}</p>
            </div>
          </div>
          <div
            className="mb-2 rounded-lg bg-amber-300/10 px-2.5 py-1.5"
            title="Your power. Nations earn it for you by worshipping; it grows faster when they love you. Spend it on miracles, prayers and interventions."
          >
            <p className="text-[10px] uppercase tracking-wider text-amber-200/70">
              Devotion
            </p>
            <p className="text-xl font-bold tabular-nums">
              ✨ {Math.floor(hud.god.devotion)}
            </p>
          </div>
          <Goal hud={hud} />
          <p className="text-xs text-white/45">{sim.type.blurb}</p>
          <p className="text-sm text-white/60">
            {stats.population.toLocaleString()} people · {stats.villages}{" "}
            {stats.villages === 1 ? "village" : "villages"}
          </p>
        </div>
        <div>
          <p className="label mb-1.5">
            Nations ({hud.nations.filter((n) => n.alive).length})
            {hud.nations.some((n) => !n.alive) && (
              <span className="normal-case text-white/40">
                {" "}
                · {hud.nations.filter((n) => !n.alive).length} fallen
              </span>
            )}
          </p>
          <ul className="space-y-1">
            {hud.nations
              .filter((n) => n.alive)
              .map((n) => (
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
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: n.color }}
                      />
                      <span title={RACE[n.race].name}>{RACE[n.race].icon}</span>
                      <span className="flex-1 truncate font-medium">
                        {cap(n.name)}
                      </span>
                      <span className="text-xs tabular-nums text-white/50">
                        {n.alive ? n.population : "fallen"}
                      </span>
                    </div>
                    <div className="ml-4.5 flex flex-wrap gap-x-2 text-xs">
                      {n.alive && (
                        <span className="text-amber-200/70">{ERAS[n.era]}</span>
                      )}
                      {!!n.ships && (
                        <span
                          className="text-sky-200/80"
                          title={`Navy: ${n.ships} warship${n.ships === 1 ? "" : "s"}`}
                        >
                          ⚓ {n.ships}
                        </span>
                      )}
                      {n.crisis && (
                        <span className="font-semibold uppercase text-rose-300">
                          {n.crisis}
                        </span>
                      )}
                      {n.relations
                        .filter((r) => n.alive && r.relation !== "peace")
                        .map((r) => (
                          <span
                            key={r.id}
                            className={RELATION_STYLE[r.relation].cls}
                            title={`${RELATION_STYLE[r.relation].label}, tension ${r.tension}`}
                          >
                            {RELATION_STYLE[r.relation].icon}{" "}
                            {cap(hud.nations[r.id].name)}
                          </span>
                        ))}
                    </div>
                  </button>
                </li>
              ))}
          </ul>
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-center gap-2 whitespace-nowrap">
          {onNewPlanet && (
            <button
              onClick={() =>
                (demo ||
                  confirm(
                    "Start over on a new planet? This planet will be lost.",
                  )) &&
                onNewPlanet()
              }
              className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
              title={
                demo
                  ? "Leave the demo and go back to your own planet"
                  : "Your planet saves automatically in this browser"
              }
            >
              {demo ? "Exit demo" : "New planet"}
            </button>
          )}
          {demo && !hud.god.spacefaring && (
            <button
              onClick={() => sim.skipToSpace()}
              className="rounded-lg bg-indigo-400/15 px-2.5 py-1 text-xs text-indigo-200 transition hover:bg-indigo-400/30"
              title="Demo shortcut: your nation reaches the Space Age now"
            >
              🚀 Go to space
            </button>
          )}
          <button
            onClick={() => setGalaxy("join")}
            className={`rounded-lg px-2.5 py-1 text-sm transition ${hud.god.spacefaring ? "bg-indigo-400/25 font-semibold hover:bg-indigo-400/40" : "bg-white/5 hover:bg-white/10"}`}
            title={
              hud.god.spacefaring
                ? "Trade with or invade the planets in your galaxy"
                : `Join or leave a galaxy. Trading and invading unlock at the Space Age (your nation is in the ${ERAS[hud.nations[0]?.era ?? 0]})`
            }
          >
            🌌 Galaxy
          </button>
          {/* Connection pill: green with how full your galaxy is, "solo" when you're in none, grey when offline */}
          <span
            className={`flex shrink-0 items-center gap-1 self-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${link.enabled && link.members ? "bg-emerald-400/15 text-emerald-200" : "bg-white/5 text-white/40"}`}
            title={
              !link.enabled
                ? "Galaxy offline"
                : link.galaxy
                  ? `In galaxy ${link.galaxy}: ${link.members}/5 gods`
                  : link.members
                    ? `${link.members} gods online`
                    : "Not in a galaxy"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${link.enabled ? (link.members ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-white/50") : "bg-white/30"}`}
            />
            {!link.enabled
              ? "off"
              : link.galaxy
                ? `${link.members}/5`
                : link.members
                  ? link.members
                  : "solo"}
          </span>
          <button
            onClick={() => setMuted((m) => !m)}
            className="rounded-lg bg-white/5 px-2.5 py-1 text-sm transition hover:bg-white/10"
            title={muted ? "Turn sound on" : "Mute"}
            aria-label={muted ? "Turn sound on" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
        {!awake && (
          <p className="text-xs text-white/55">
            Your nations are wandering. When each founds a village it will
            become aware of you. Once they worship you, you earn devotion to
            spend on miracles.
          </p>
        )}
      </aside>

      <div
        ref={resourcesPanelRef}
        className="glass absolute left-[17.5rem] top-4 z-20 w-72 p-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="label">Resources</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stock
            align="left"
            icon="🌾"
            label="Food"
            info="Harvested by well-fed people from the land around their homes."
            value={stats.resources.food}
          />
          <Stock
            icon="🪵"
            label="Wood"
            info="Cut from forests around towns."
            value={stats.resources.wood}
          />
          <Stock
            align="right"
            icon="🪨"
            label="Stone"
            info="Quarried from rocky mountainsides."
            value={stats.resources.stone}
          />
          <Stock
            align="left"
            icon="⚙️"
            label="Metal"
            info="Mined from ore in the mountains."
            value={stats.resources.metal}
          />
          <Stock
            icon="🪙"
            label="Gold"
            info="Mined at gold deposits."
            value={stats.resources.gold}
          />
          <Stock
            align="right"
            icon="🌿"
            label="Herbs"
            info="Medicinal plants gathered in forests."
            value={stats.resources.herbs}
          />
        </div>
        <button
          onClick={() => setUpgradesOpen((open) => !open)}
          className={`mt-3 flex w-full items-center border-t border-white/10 pt-2 text-left text-xs font-semibold transition hover:text-white ${upgradesOpen ? "text-amber-100" : "text-sky-200/90"}`}
          aria-expanded={upgradesOpen}
          title="Spend resources on permanent upgrades"
        >
          <span className="flex items-center gap-2">
            <span
              className={`transition-transform ${upgradesOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
            <span>Upgrades</span>
            {availableUpgrades > 0 && (
              <span
                className="upgrade-available-dot h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]"
                aria-label={`${availableUpgrades} upgrades available`}
              />
            )}
          </span>
        </button>
      </div>
      {upgradesOpen && (
        <div ref={upgradesMenuRef}>
          <UpgradeMenu
            sim={sim}
            resources={stats.resources}
            onUpgrade={() => setHud(readHud(sim))}
          />
        </div>
      )}

      {/* Pop-up: what is happening on the planet right now (disasters, weather, fate) */}
      {hud.alert && hud.year - hud.alert.at < 7 && (
        <div className="pointer-events-none absolute top-4 left-[17.5rem] right-[19.5rem] z-40 flex justify-center">
          <div
            key={hud.alert.at}
            className="glass alert-pop pointer-events-auto flex max-w-lg items-center gap-3 px-5 py-3"
          >
            <span className="text-3xl leading-none">{hud.alert.icon}</span>
            <div className="min-w-0">
              <div className="text-base font-bold">{hud.alert.title}</div>
              <div className="text-sm text-white/75">{hud.alert.text}</div>
            </div>
            <button
              onClick={() =>
                setFocus({ face: hud.alert!.face, key: Date.now() })
              }
              className="ml-2 shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20"
            >
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
            left={CHOICE_LIFE - (hud.year - hud.god.choice.at) / sim.pace}
            devotion={hud.god.devotion}
            names={hud.nations}
            onPick={(yes) => {
              sim.decide(yes);
              setHud(readHud(sim));
            }}
            onShow={() =>
              setFocus({ face: hud.god.choice!.face, key: Date.now() })
            }
          />
        )}
        {hud.god.prayers.slice(-3).map((p) => (
          <div
            key={p.id}
            className="glass pointer-events-auto relative flex w-[30rem] max-w-full items-center gap-3 overflow-hidden px-4 py-2.5 text-sm"
          >
            <span className="text-xl">🙏</span>
            <span className="flex-1">{cap(p.text)}</span>
            <Countdown
              left={PRAYER_LIFE - (hud.year - p.at) / sim.pace}
              life={PRAYER_LIFE}
            />
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
                <div className="text-[10px] text-amber-200/80">
                  {wait > 0 ? `ready in ${wait}s` : `✨ ${m.cost}`}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-white/40">
          {miracle
            ? "Click the land to cast · Esc to cancel"
            : "Drag to rotate · scroll to zoom · pick a miracle, then click the land"}
        </p>
      </div>

      {talkTo != null && hud.nations[talkTo] && (
        <LeaderDialog
          nation={hud.nations[talkTo]}
          civ={civs[talkTo]}
          chat={leaderChats[talkTo]}
          mood={moods[talkTo]}
          busy={leaderBusy}
          onSay={sayToLeader}
          onClose={() => setTalkTo(null)}
        />
      )}

      {hover && hud.nations[hover.id] && (
        <NationCard
          n={hud.nations[hover.id]}
          civ={civs[hover.id]}
          all={hud.nations}
          x={hover.x}
          y={hover.y}
        />
      )}

      {/* The chosen nation's mind */}
      <aside className="glass subtle-scrollbar absolute bottom-4 right-4 top-4 flex w-72 flex-col p-4">
        <div className="mb-3 space-y-2 border-b border-white/10 pb-3 text-sm">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: me.color }}
            />
            <p className="text-lg font-semibold">{cap(me.name)}</p>
          </div>
          <button
            onClick={() => openLeader(sel)}
            disabled={!me.alive}
            className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2 text-left transition hover:bg-white/10 disabled:opacity-40"
            title="Hold an audience with their leader"
          >
            <span className="shrink-0 overflow-hidden rounded-lg">
              <Portrait
                race={me.race}
                seed={me.leader.seed}
                color={me.color}
                mood={moods[sel]}
                size={52}
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {me.leader.title} {me.leader.name}
              </span>
              <span className="block text-xs text-white/55">
                {RACE[me.race].icon} {RACE[me.race].name} · {ERAS[me.era]}
              </span>
              <span className="block text-xs text-sky-300">
                🗣️ Talk to the leader
              </span>
            </span>
          </button>
          <NeedBars needs={me.needs} crisis={me.crisis} love={me.love} />
          {civ ? (
            <>
              <p>
                <span className="label">Focus</span>{" "}
                <span
                  className={
                    me.policy === "rebel"
                      ? "font-semibold text-rose-300"
                      : "font-semibold"
                  }
                >
                  {POLICY_LABEL[me.policy]}
                </span>
                {reasons[sel] && (
                  <span className="block text-xs text-white/50">
                    {reasons[sel]}
                  </span>
                )}
              </p>
              <p>
                <span className="label">Faith</span> {civ.religion.name}
              </p>
              <p className="text-white/70">
                They call you <b>{civ.religion.godName}</b>.{" "}
                {civ.religion.belief}
              </p>
              <p>
                <span className="label">They feel</span>{" "}
                <span
                  className={
                    civ.attitude === "hostile" || civ.attitude === "resentful"
                      ? "text-rose-300"
                      : ""
                  }
                >
                  {civ.attitude}
                </span>
              </p>
            </>
          ) : (
            <p className="text-white/50">
              {me.alive ? "They do not know you yet." : "This nation is gone."}
            </p>
          )}
        </div>

        {/* Nation chat is temporarily hidden while the galaxy controls take the spotlight. */}
        <div className="mb-4 border-b border-white/10 pb-4">
          <p className="label mb-2">Galaxy</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              disabled={!link.galaxy || !hud.god.spacefaring}
              onClick={() => setGalaxy("invade")}
              className="group rounded-lg border border-rose-300/15 bg-rose-400/10 px-3 py-3 text-left transition hover:border-rose-300/30 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/30"
              title={!link.galaxy ? "Join a galaxy to invade" : !hud.god.spacefaring ? "Reach the Space Age to invade" : "Choose a planet to invade"}
            >
              <span className="block text-lg">⚔️</span>
              <span className="mt-1 block text-sm font-semibold">Invade</span>
              <span className="block text-[10px] text-current opacity-60">
                {!link.galaxy ? "Join a galaxy first" : !hud.god.spacefaring ? "Space Age required" : "Launch an attack"}
              </span>
            </button>
            <button
              disabled={!link.galaxy}
              onClick={() => setGalaxy("market")}
              className="group rounded-lg border border-amber-300/15 bg-amber-400/10 px-3 py-3 text-left transition hover:border-amber-300/30 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/30"
              title={!link.galaxy ? "Join a galaxy to use the market" : "Open the galaxy market"}
            >
              <span className="block text-lg">⚖️</span>
              <span className="mt-1 block text-sm font-semibold">Market</span>
              <span className="block text-[10px] text-current opacity-60">
                {!link.galaxy ? "Join a galaxy first" : "Trade resources"}
              </span>
            </button>
            <button
              disabled={!link.galaxy}
              onClick={() => setGalaxy("offers")}
              className="group rounded-lg border border-sky-300/15 bg-sky-400/10 px-3 py-3 text-left transition hover:border-sky-300/30 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/30"
              title={!link.galaxy ? "Join a galaxy to trade with other gods" : "Offer a swap to another god"}
            >
              <span className="block text-lg">🤝</span>
              <span className="mt-1 block text-sm font-semibold">Offers</span>
              <span className="block text-[10px] text-current opacity-60">
                {!link.galaxy ? "Join a galaxy first" : "Swap with a god"}
              </span>
            </button>
          </div>
          <button
            onClick={() => setGalaxy("join")}
            className={`mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
              link.galaxy
                ? "bg-indigo-400/15 text-indigo-100 hover:bg-indigo-400/25"
                : "bg-indigo-400/30 text-white hover:bg-indigo-400/40"
            }`}
          >
            {link.galaxy ? `Galaxy ${link.galaxy} · Manage` : "🌌 Join a galaxy"}
          </button>
        </div>

        <p className="label mb-2">
          Chronicle{" "}
          {busy === "narrating" && (
            <span className="animate-pulse">· writing…</span>
          )}
        </p>
        <ol className="subtle-scrollbar flex-1 space-y-3 overflow-y-auto text-sm">
          {[...chronicle].reverse().map((c, i) => (
            <li key={chronicle.length - i}>
              {c.nation != null && (
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ background: sim.nations[c.nation].color }}
                />
              )}
              <span className="text-white/40">
                Year {Math.floor(c.year)} ·{" "}
              </span>
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
              <button
                onClick={() => setSeenOutcome(true)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
              >
                Keep watching
              </button>
              <button
                onClick={() =>
                  onNewPlanet ? onNewPlanet() : location.reload()
                }
                className="rounded-lg bg-sky-400/30 px-4 py-2 text-sm font-semibold hover:bg-sky-400/40"
              >
                New planet
              </button>
            </div>
          </div>
        </div>
      )}
      {/* The galaxy (multiplayer): always syncing; join or leave any time, trade and invade from the Space Age */}
      <Galaxy
        sim={sim}
        ownerName={playerName}
        planetName={planetName}
        demo={demo}
        spacefaring={hud.god.spacefaring}
        open={galaxy !== null}
        view={galaxy}
        onClose={() => setGalaxy(null)}
        onStatus={setLink}
      />
    </main>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function readHud(sim: PlanetSim): Hud {
  return {
    year: sim.year,
    stats: sim.stats(),
    needs: sim.needs(),
    nations: sim.nationInfo(),
    fate: sim.fate,
    alert: sim.alert,
    output: Math.round(sim.output),
    military: sim.military(),
    god: {
      devotion: sim.devotion,
      ready: { ...sim.ready },
      prayers: [...sim.prayers],
      spacefaring: sim.spacefaring,
      choice: sim.choice,
      outcome: sim.outcome,
      avgLove: sim.avgLove(),
    },
  };
}

// Calls an LLM route. If the server can't be reached (for example the static demo build,
// which has no API routes), answer with the same canned fallbacks the server would use.
async function post<T>(url: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  } catch {
    return offline(
      url,
      body as {
        world: World;
        kind?: ChronicleKind;
        detail?: string;
        chat?: MindMessage[];
      },
    ) as T;
  }
}

function offline(
  url: string,
  {
    world,
    kind,
    chat = [],
  }: { world: World; kind?: ChronicleKind; chat?: MindMessage[] },
) {
  if (url === "/api/leader")
    return fallbackLeader(world, chat as unknown as LeaderMessage[]);
  if (url === "/api/mind") {
    const t = fallbackThought(world, chat);
    return {
      civ: { ...world.civ, attitude: t.attitude },
      reply: t.reply,
      policy: t.policy,
      reason: t.reason,
      toward: t.toward ?? null,
    };
  }
  if (kind === "genesis" || !world.civ) {
    const c = fallbackCiv(world.nation?.id);
    return {
      civ: c,
      entry: {
        year: world.year,
        kind: "genesis",
        text: `${cap(c.demonym)} light their first fires and call themselves ${c.name}.`,
      },
    };
  }
  const r = fallbackReaction(world, kind ?? "milestone");
  return {
    civ: { ...world.civ, attitude: r.attitude },
    entry: { year: world.year, kind, text: r.text },
  };
}

function UpgradeMenu({
  sim,
  resources,
  onUpgrade,
}: {
  sim: PlanetSim;
  resources: Resources;
  onUpgrade: () => void;
}) {
  const resourceIcons: Record<keyof Resources, string> = {
    food: "🌾",
    wood: "🪵",
    stone: "🪨",
    metal: "⚙️",
    gold: "🪙",
    herbs: "🌿",
  };
  return (
    <section
      className="glass absolute left-[17.5rem] top-[14.5rem] z-30 w-96 max-w-[calc(100vw-20rem)] p-4 shadow-2xl"
      aria-label="World upgrades"
    >
      <div className="mb-3 flex items-start justify-between border-b border-white/10 pb-3">
        <div>
          <p className="text-lg font-bold">World upgrades</p>
          <p className="text-xs text-white/55">
            Invest your stockpile to shape the planet’s future.
          </p>
        </div>
        <span className="rounded-full bg-amber-300/15 px-2 py-1 text-[10px] font-semibold text-amber-200">
          PERMANENT
        </span>
      </div>
      <div className="space-y-2">
        {UPGRADES.map((upgrade) => {
          const level = sim.upgrades[upgrade.id];
          const cost = upgrade.costs[level];
          const affordable =
            !!cost &&
            Object.entries(cost).every(
              ([resource, amount]) =>
                resources[resource as keyof Resources] >= amount,
            );
          return (
            <div
              key={upgrade.id}
              className={`rounded-xl border p-3 transition ${affordable ? "border-emerald-300/40 bg-emerald-300/10" : "border-white/10 bg-white/5"}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-xl">{upgrade.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{upgrade.name}</p>
                    <span className="text-[11px] text-white/50">
                      Lv {level}/{upgrade.max}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-white/60">
                    {upgrade.description}
                  </p>
                  {cost ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(cost).map(([resource, amount]) => (
                        <span
                          key={resource}
                          className={`rounded bg-black/20 px-1.5 py-0.5 text-[11px] tabular-nums ${resources[resource as keyof Resources] >= amount ? "text-emerald-200" : "text-rose-300"}`}
                        >
                          {resourceIcons[resource as keyof Resources]} {amount}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">
                      Fully upgraded
                    </p>
                  )}
                </div>
                {cost && (
                  <button
                    disabled={!affordable}
                    onClick={() => {
                      if (sim.purchaseUpgrade(upgrade.id)) onUpgrade();
                    }}
                    className="shrink-0 rounded-lg bg-emerald-300/20 px-2.5 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-300/35 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The card that follows the mouse when hovering over a nation on the globe.
function NationCard({
  n,
  civ,
  all,
  x,
  y,
}: {
  n: NationInfo;
  civ: Civ | null;
  all: NationInfo[];
  x: number;
  y: number;
}) {
  const left = Math.min(x + 16, window.innerWidth - 260);
  const top = Math.min(y + 16, window.innerHeight - 260);
  return (
    <div
      className="glass pointer-events-none fixed z-10 w-60 space-y-2 p-3 text-sm"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: n.color }}
        />
        <p className="font-semibold">{cap(n.name)}</p>
        {n.crisis && (
          <span className="ml-auto text-xs font-semibold uppercase text-rose-300">
            {n.crisis}
          </span>
        )}
      </div>
      <p className="text-xs text-white/60">
        {RACE[n.race].icon} {RACE[n.race].name} · {ERAS[n.era]} · led by{" "}
        {n.leader.title} {n.leader.name}
      </p>
      {civ && (
        <p className="text-xs text-white/60">
          {cap(civ.demonym)} · worship {civ.religion.godName} (
          {civ.religion.name}) · feel {civ.attitude}
        </p>
      )}
      <p className="text-xs text-white/70">
        {n.alive
          ? `${n.population} people · ${n.villages} ${n.villages === 1 ? "village" : "villages"} · ${POLICY_LABEL[n.policy].toLowerCase()}`
          : "Fallen"}
      </p>
      <NeedBars needs={n.needs} crisis={null} />
      {n.relations.length > 0 && (
        <div className="flex flex-wrap gap-x-2 text-xs">
          {n.relations.map((r) => (
            <span key={r.id} className={RELATION_STYLE[r.relation].cls}>
              {RELATION_STYLE[r.relation].icon}{" "}
              {RELATION_STYLE[r.relation].label} with {cap(all[r.id].name)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// One resource tile; hovering shows what it is and where it comes from.
// The tooltip lines up with the tile's outer edge in the side columns, so it never runs off the panel.
const TIP_ALIGN = {
  left: "left-0",
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};
function Stock({
  icon,
  label,
  info,
  value,
  align = "center",
}: {
  icon: string;
  label: string;
  info: string;
  value: number;
  align?: keyof typeof TIP_ALIGN;
}) {
  return (
    <div
      className="group relative cursor-help rounded-lg bg-white/5 py-1.5"
      aria-label={`${label}: ${info}`}
    >
      <div>{icon}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div
        className={`pointer-events-none absolute top-full z-50 mt-1.5 w-44 ${TIP_ALIGN[align]} rounded-lg border border-white/15 bg-[#0d1424] px-2.5 py-2 text-left opacity-0 shadow-xl transition-opacity group-hover:opacity-100`}
      >
        <p className="text-xs font-semibold">
          {icon} {label}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/70">{info}</p>
      </div>
    </div>
  );
}

function NeedBars({
  needs,
  crisis,
  love,
}: {
  needs: Needs;
  crisis: Crisis | null;
  love?: number;
}) {
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
            <div
              className={`h-full rounded-full transition-all ${v < 25 ? "bg-rose-400" : "bg-sky-300"}`}
              style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
            />
          </div>
        </div>
      ))}
      {crisis && (
        <p className="text-sm font-semibold uppercase tracking-wide text-rose-300">
          {crisis}
        </p>
      )}
    </div>
  );
}

// The goal, and how close the god is to it.
function Goal({ hud }: { hud: Hud }) {
  const mine = hud.nations[0];
  const year = Math.floor(hud.year / SECONDS_PER_YEAR);
  const love = Math.round(hud.god.avgLove);
  return (
    <div
      className="mb-2 rounded-lg border border-white/10 px-2.5 py-2 text-xs"
      title="Lose if your people fall, or if every nation comes to hate you."
    >
      <p className="text-[10px] uppercase tracking-wider text-white/50">Goal</p>
      <p className="text-white/80">
        Keep {mine ? cap(mine.name) : "your people"} alive to Year {GOAL_YEAR},
        loved by the nations.
      </p>
      <div className="mt-1.5 flex justify-between text-white/60">
        <span>
          Year {Math.min(year, GOAL_YEAR)}/{GOAL_YEAR}
        </span>
        <span
          className={
            love >= 50
              ? "text-emerald-300"
              : love < 25
                ? "text-rose-300"
                : "text-amber-200"
          }
        >
          Love {love}/50
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-sky-300"
          style={{ width: `${Math.min(100, (year / GOAL_YEAR) * 100)}%` }}
        />
      </div>
    </div>
  );
}

// A disaster, war or revolution has begun: step in (for devotion) or let fate decide.
// Seconds left to answer, as a number plus a bar along the card's bottom edge that drains and turns red near the end.
function Countdown({ left, life }: { left: number; life: number }) {
  const s = Math.max(0, Math.ceil(left)),
    urgent = s <= 5;
  return (
    <>
      <span
        className={`w-8 text-right text-xs tabular-nums ${urgent ? "font-bold text-red-400" : "text-white/50"}`}
        title="Seconds left to decide"
      >
        {s}s
      </span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
        <span
          className={`block h-full transition-[width] duration-300 ease-linear ${urgent ? "bg-red-400" : "bg-amber-300/70"}`}
          style={{ width: `${Math.max(0, Math.min(1, left / life)) * 100}%` }}
        />
      </span>
    </>
  );
}

function ChoiceCard({
  choice,
  left,
  devotion,
  names,
  onPick,
  onShow,
}: {
  choice: NonNullable<Hud["god"]["choice"]>;
  left: number;
  devotion: number;
  names: NationInfo[];
  onPick: (intervene: boolean) => void;
  onShow: () => void;
}) {
  const what = {
    disaster: "Turn it aside",
    war: "Force a peace",
    revolution: "Calm the people",
  }[choice.kind];
  const who = choice.nations
    .map((n) => names[n]?.name)
    .filter(Boolean)
    .map((n) => cap(n!))
    .join(" and ");
  return (
    <div className="glass alert-pop pointer-events-auto relative w-[30rem] max-w-full overflow-hidden px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold">{choice.title}</span>
        <span className="text-xs text-white/50">{who}</span>
        <button
          onClick={onShow}
          className="ml-auto text-xs text-sky-300 hover:underline"
        >
          Show me
        </button>
        <Countdown left={left} life={CHOICE_LIFE} />
      </div>
      <p className="mt-0.5 text-sm text-white/75">{choice.text}</p>
      <div className="mt-2 flex gap-2">
        <button
          disabled={devotion < choice.cost}
          onClick={() => onPick(true)}
          className="flex-1 rounded-lg bg-amber-300/20 px-3 py-1.5 text-sm font-semibold transition hover:bg-amber-300/30 disabled:opacity-40"
        >
          {what} ✨{choice.cost}
        </button>
        <button
          onClick={() => onPick(false)}
          className="flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-sm transition hover:bg-white/10"
        >
          Let fate decide
        </button>
      </div>
    </div>
  );
}
