"use client";
// The game screen: the globe in the middle, the planet and its nations on the left,
// the god powers along the bottom, and the chosen nation's mind on the right.
// Each nation has its own AI mind and religion. This file wires the sim
// (src/sim/planet.ts) to the LLM routes (/api/narrate, /api/mind).
import { useCallback, useEffect, useRef, useState } from "react";
import Globe from "./Globe";
import Galaxy, { type GalaxyStatus } from "./Galaxy";
import type { Mood } from "./Portrait";
import { NationList } from "./GamePanels";
import {
  OutcomeDialog,
  PlanetSummary,
  ResourcePanel,
} from "./GameHud";
import { GameRightPanel } from "./GameRightPanel";
import ChronicleBook from "./ChronicleBook";
import { GameOverlays } from "./GameOverlays";
import { NationHoverCard } from "./GameHoverCards";
import { type RaceId } from "@/sim/races";
import {
  MIRACLES,
  PLANET_TYPES,
  PlanetSim,
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
const THINK_EVERY_MS = 75_000; // each nation's mind speaks up on its own this often
const THINK_GAP_MS = 20_000; // but minds take turns, at most one every 20 seconds
const NEWS_GAP_MS = 20_000; // the chronicle tells at most one piece of news every 20 seconds
const DEMO_GAPS = 0.4; // demo mode: the AI speaks 2.5x as often, to fit a 3-minute pitch

type Entry = ChronicleEntry & { nation?: number };
type Item = SimEvent & { nation: number }; // a queued event, pinned to the nation that tells it

export interface Hud {
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);
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
  const [expandedNation, setExpandedNation] = useState<number | null>(null);
  const [chronicleOpen, setChronicleOpen] = useState(false);
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
  const [leaderChats, setLeaderChats] = useState<LeaderMessage[][]>(
    () => ui?.leaderChats ?? Array.from({ length: count }, () => []),
  );
  const [moods, setMoods] = useState<Mood[]>(
    () => ui?.moods ?? new Array(count).fill("pleased"),
  );
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
        <PlanetSummary
          hud={hud}
          sim={sim}
          playerName={playerName}
          planetName={planetName}
          demo={demo}
        />
        <NationList
          nations={hud.nations}
          selected={sel}
          expanded={expandedNation}
          onSelect={setSel}
          onToggle={(id) =>
            setExpandedNation((current) => (current === id ? null : id))
          }
          onFocus={(id) => {
            const face = sim.nationHome(id);
            if (face != null) setFocus({ face, key: Date.now() });
          }}
        />
        {demo && !hud.god.spacefaring && (
          <div className="mt-auto flex justify-center">
            <button
              onClick={() => sim.skipToSpace()}
              className="rounded-lg bg-indigo-400/15 px-2.5 py-1 text-xs text-indigo-200 transition hover:bg-indigo-400/30"
              title="Demo shortcut: your nation reaches the Space Age now"
            >
              🚀 Go to space
            </button>
          </div>
        )}
        {!awake && (
          <p className="text-xs text-white/55">
            Your nations are wandering. When each founds a village it will
            become aware of you. Once they worship you, you earn devotion to
            spend on miracles.
          </p>
        )}
      </aside>

      <ResourcePanel
        resources={stats.resources}
        sim={sim}
        open={upgradesOpen}
        panelRef={resourcesPanelRef}
        menuRef={upgradesMenuRef}
        onToggle={() => setUpgradesOpen((open) => !open)}
        onRefresh={() => setHud(readHud(sim))}
        availableUpgrades={availableUpgrades}
      />

      <GameOverlays
        hud={hud}
        pace={sim.pace}
        miracle={miracle}
        names={hud.nations}
        onMiracle={(id) => setMiracle((current) => (current === id ? null : id))}
        onDecide={(yes) => {
          sim.decide(yes);
          setHud(readHud(sim));
        }}
        onShowChoice={() => setFocus({ face: hud.god.choice!.face, key: Date.now() })}
        onAnswerPrayer={(id, answer) => {
          sim.answerPrayer(id, answer);
          setHud(readHud(sim));
        }}
        onShowAlert={() => setFocus({ face: hud.alert!.face, key: Date.now() })}
      />


      {hover && hud.nations[hover.id] && (
        <NationHoverCard
          nation={hud.nations[hover.id]}
          civ={civs[hover.id]}
          all={hud.nations}
          x={hover.x}
          y={hover.y}
        />
      )}

      {/* The chosen nation's mind */}
      <GameRightPanel
        nation={me}
        civ={civ}
        mood={moods[sel]}
        reason={reasons[sel]}
        settingsOpen={settingsOpen}
        settingsRef={settingsRef}
        onSettingsToggle={() => setSettingsOpen((value) => !value)}
        onSettingsClose={() => setSettingsOpen(false)}
        demo={demo}
        onNewPlanet={onNewPlanet}
        onGalaxy={() => {
          setSettingsOpen(false);
          setGalaxy("join");
        }}
        muted={muted}
        onMute={() => setMuted((value) => !value)}
        link={link}
        spacefaring={hud.god.spacefaring}
        onOpenGalaxy={setGalaxy}
        chronicle={chronicle}
        busy={busy}
        nationColors={sim.nations}
        onOpenChronicle={() => setChronicleOpen(true)}
      />
      {chronicleOpen && (
        <ChronicleBook
          entries={chronicle}
          busy={busy}
          nationColors={sim.nations}
          onClose={() => setChronicleOpen(false)}
        />
      )}
      {hud.god.outcome && !seenOutcome && (
        <OutcomeDialog
          outcome={hud.god.outcome}
          onKeepWatching={() => setSeenOutcome(true)}
          onNewPlanet={onNewPlanet}
        />
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
