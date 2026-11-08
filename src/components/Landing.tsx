"use client";
// The front page: what Arda is, how to play, and a button to create your planet.
import { useEffect, useState } from "react";
import Portrait from "./Portrait";
import RaceStats from "./RaceStats";
import { RACES, type RaceId } from "@/sim/races";
import { PLANET_TYPES } from "@/sim/planet";
import { CODE_RULE, GALAXY_MAX, cleanCode, joinError, setWantedGalaxy, typeCode } from "@/lib/galaxyCode";

const STEPS = [
  { icon: "🌍", title: "Get a planet", text: "Every planet is different. Some are rich in wood, others in metal, gold or rare medicinal herbs." },
  { icon: "🧍", title: "Raise a people", text: "Tiny people wander, farm and build villages. Once they settle, they become aware of you, their god." },
  { icon: "🎲", title: "Fate rules their world", text: "Rain, drought, miracles, fire and meteors fall at random. Your people will think you sent them." },
  { icon: "💬", title: "Talk to them", text: "Your people share one mind, powered by AI. They pray, plead and argue with you. Answer their prayers, work miracles, or smite them." },
];

const NAME_KEY = "arda-player-name";
const PLANET_KEY = "arda-planet-name";

function saved(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export default function Landing({ onStart }: { onStart: (playerName: string, planetName: string, race: RaceId, worldType: number | undefined, demo: boolean) => void }) {
  const [name, setName] = useState(() => saved(NAME_KEY));
  const [planet, setPlanet] = useState(() => saved(PLANET_KEY));
  const [race, setRace] = useState<RaceId>("human");
  const [world, setWorld] = useState<number | undefined>(undefined); // undefined = random
  const [demo, setDemo] = useState(false); // a speedrun of the real game, for presentations
  const [code, setCode] = useState(""); // galaxy name must be entered explicitly; empty is playing alone
  // What the galaxy with this code looks like right now, checked as you type (null: not checked).
  const [peek, setPeek] = useState<{ code: string; members: number; exists: boolean } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [nameError, setNameError] = useState("");
  useEffect(() => {
    const c = cleanCode(code);
    if (!c) return;
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const data = await (await fetch(`/api/galaxy?peek=${c}`)).json();
        if (live && data.rooms && typeof data.members === "number") setPeek({ code: c, members: data.members, exists: data.exists });
      } catch {}
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [code]);
  const checked = peek && peek.code === cleanCode(code) ? peek : null;
  const full = !!checked && checked.members >= GALAXY_MAX;

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || "Nameless One";
    const pl = planet.trim() || "Arda";
    if (n.length < 4) return setNameError("Your name must be at least 4 characters.");
    if (pl.length < 4) return setNameError("Your planet name must be at least 4 characters.");
    setNameError("");
    if (code && !cleanCode(code)) return setCodeError(CODE_RULE);
    if (checked && !checked.exists) return setCodeError(`Galaxy ${checked.code} does not exist yet.`);
    if (full) return setCodeError(joinError("full", checked!.code, checked!.members));
    try {
      localStorage.setItem(NAME_KEY, n);
      localStorage.setItem(PLANET_KEY, pl);
    } catch {}
    setWantedGalaxy(cleanCode(code)); // the game joins the named existing galaxy once your planet exists
    onStart(n, pl, race, world, demo);
  };

  return (
    <main className="starfield relative min-h-dvh w-full overflow-x-hidden">
      <div className="planet-orb" aria-hidden />
      <section className="relative mx-auto flex max-w-[1600px] flex-col items-center px-6 pb-4 pt-4 text-center sm:pt-5">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/arda-logo.svg" alt="" className="h-16 w-16 sm:h-20 sm:w-20" />
          <h1 className="text-6xl font-bold tracking-tight sm:text-7xl">Arda</h1>
        </div>

        <div className="relative mx-auto mt-4 w-full text-left">
        <form onSubmit={start} className="glass mx-auto flex w-full max-w-[520px] flex-col gap-3 p-4 text-left">
          <label htmlFor="name" className="label">
            Your name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError("");
            }}
            minLength={4}
            maxLength={24}
            aria-invalid={!!nameError && name.trim().length < 4}
            placeholder="What do mortals call you?"
            className="rounded-lg bg-white/10 px-4 py-2.5 outline-none placeholder:text-white/30 focus:bg-white/15"
          />
          <label htmlFor="planet" className="label">
            Your planet
          </label>
          <input
            id="planet"
            value={planet}
            onChange={(e) => {
              setPlanet(e.target.value);
              setNameError("");
            }}
            minLength={4}
            maxLength={24}
            aria-invalid={!!nameError && planet.trim().length < 4}
            placeholder="Name your world"
            className="rounded-lg bg-white/10 px-4 py-2.5 outline-none placeholder:text-white/30 focus:bg-white/15"
          />
          {nameError && <p role="alert" className="text-xs text-rose-300">{nameError}</p>}
          <p className="label">Your people</p>
          <div className="grid grid-cols-5 gap-1.5">
            {RACES.map((r, i) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setRace(r.id)}
                className={`flex flex-col items-center rounded-lg px-1 py-1 text-[10px] transition ${race === r.id ? "bg-sky-400/25 ring-1 ring-sky-300" : "bg-white/5 hover:bg-white/10"}`}
              >
                <Portrait race={r.id} seed={i * 97 + 5} color="#5fd4ff" size={40} />
                <span className="mt-0.5 font-medium">{r.name}</span>
              </button>
            ))}
          </div>
          {RACES.filter((r) => r.id === race).map((r) => (
            <div key={r.id} className="rounded-lg bg-white/5 px-3 py-2 text-xs">
              <div className="mb-1 flex items-start justify-between gap-3">
                <p className="text-xs text-white/80">{r.blurb}</p>
                <span className="shrink-0 text-[10px] text-white/40">Home: {r.home}</span>
              </div>
              <RaceStats race={r.id} compact />
            </div>
          ))}
          <p className="label">Your world</p>
          <div className="flex flex-wrap gap-1.5">
            {[undefined, ...PLANET_TYPES.map((_, i) => i)].map((i) => (
              <button
                type="button"
                key={i ?? "random"}
                onClick={() => setWorld(i)}
                className={`rounded-lg px-2.5 py-1 text-xs transition ${world === i ? "bg-sky-400/25 ring-1 ring-sky-300" : "bg-white/5 hover:bg-white/10"}`}
              >
                {i == null ? "🎲 Random" : PLANET_TYPES[i].name}
              </button>
            ))}
          </div>
          <p className="label">Mode</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[false, true].map((d) => (
              <button
                type="button"
                key={String(d)}
                onClick={() => setDemo(d)}
                className={`rounded-lg px-3 py-2 text-left transition ${demo === d ? "bg-sky-400/25 ring-1 ring-sky-300" : "bg-white/5 hover:bg-white/10"}`}
              >
                <span className="block text-sm font-semibold">{d ? "🎬 Demo" : "🌍 Full game"}</span>
                <span className="block text-xs text-white/55">{d ? "3-minute, 4x-speed speedrun" : "Real pace, saved in this browser"}</span>
              </button>
            ))}
          </div>
          {demo && <p className="text-xs text-white/55">For presentations. Saves separately from your real planet.</p>}
          <label htmlFor="galaxy" className="label">
            Galaxy code <span className="normal-case text-white/40">(optional)</span>
          </label>
          <input
            id="galaxy"
            value={code}
            onChange={(e) => {
              setCode(typeCode(e.target.value));
              setCodeError("");
            }}
            placeholder="Leave empty to play alone"
            aria-invalid={!!codeError || full}
            aria-describedby="galaxy-hint"
            className={`rounded-lg bg-white/10 px-4 py-2.5 font-mono uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-white/30 focus:bg-white/15 ${codeError || full ? "ring-1 ring-rose-400" : ""}`}
          />
          <p id="galaxy-hint" role={codeError || full ? "alert" : undefined} className={`text-xs ${codeError || full ? "text-rose-300" : "text-white/40"}`}>
            {codeError ||
              (full && joinError("full", checked!.code, checked!.members)) ||
              (code && !cleanCode(code) && CODE_RULE) ||
              (checked && !checked.exists && `Galaxy ${checked.code} does not exist. Ask its creator for a galaxy name or leave this blank to play alone.`) ||
              (checked && `${checked.members}/${GALAXY_MAX} gods are in ${checked.code}. You'll join them.`) ||
              `Gods with the same code share a galaxy (up to ${GALAXY_MAX}). You can join or leave any time.`}
          </p>
          {world != null && (
            <p className="text-xs text-white/55">
              {PLANET_TYPES[world].blurb}. Prone to {PLANET_TYPES[world].hazard}s. Weak to {PLANET_TYPES[world].weakTo}: {PLANET_TYPES[world].weakWhy}.
            </p>
          )}
          <button className="mt-1 rounded-lg bg-sky-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-sky-300">{demo ? "Start the demo" : "Create your planet"}</button>
        </form>

        <aside className="mx-auto mt-5 grid w-full max-w-[144px] grid-cols-1 gap-2 lg:absolute lg:left-[calc(50%+274px)] lg:top-0 lg:mt-0 lg:max-w-none lg:w-36">
          {STEPS.map((s) => (
            <div key={s.title} className="glass aspect-square p-3">
              <div className="text-3xl">{s.icon}</div>
              <h2 className="mt-2 font-semibold">{s.title}</h2>
              <p className="mt-1 text-[11px] leading-4 text-white/60">{s.text}</p>
            </div>
          ))}
        </aside>
        </div>
      </section>
    </main>
  );
}
