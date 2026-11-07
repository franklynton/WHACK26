"use client";
// The front page: what Arda is, how to play, and a button to create your planet.
import { useState } from "react";
import Portrait from "./Portrait";
import RaceStats from "./RaceStats";
import { RACES, type RaceId } from "@/sim/races";
import { PLANET_TYPES } from "@/sim/planet";

const STEPS = [
  { icon: "🌍", title: "Get a planet", text: "Every planet is different. Some are rich in wood, others in metal, gold or rare medicinal herbs." },
  { icon: "🧍", title: "Raise a people", text: "Tiny people wander, farm and build villages. Once they settle, they become aware of you, their god." },
  { icon: "🎲", title: "Fate rules their world", text: "Rain, drought, miracles, fire and meteors fall at random. Your people will think you sent them." },
  { icon: "💬", title: "Talk to them", text: "Your people share one mind, powered by AI. They pray, plead and argue with you. Your words are your only power: use them to keep the nations at peace." },
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

export default function Landing({ onStart }: { onStart: (playerName: string, planetName: string, race: RaceId, worldType: number | undefined) => void }) {
  const [name, setName] = useState(() => saved(NAME_KEY));
  const [planet, setPlanet] = useState(() => saved(PLANET_KEY));
  const [race, setRace] = useState<RaceId>("human");
  const [world, setWorld] = useState<number | undefined>(undefined); // undefined = random

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || "Nameless One";
    const pl = planet.trim() || "Arda";
    try {
      localStorage.setItem(NAME_KEY, n);
      localStorage.setItem(PLANET_KEY, pl);
    } catch {}
    onStart(n, pl, race, world);
  };

  return (
    <main className="starfield relative min-h-dvh w-full overflow-x-hidden">
      <div className="planet-orb" aria-hidden />
      <section className="relative mx-auto flex max-w-5xl flex-col items-center px-6 pt-24 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arda-logo.svg" alt="" className="mb-6 h-24 w-24 drop-shadow-[0_0_30px_rgba(95,212,255,0.45)]" />
        <p className="label mb-4">A god game for one tiny world</p>
        <h1 className="text-7xl font-bold tracking-tight sm:text-8xl">Arda</h1>
        <p className="mt-5 max-w-xl text-lg text-white/70">
          You are given a pocket-sized planet and the little people who live on it. They will worship you, fear you, or decide you are evil. It depends on what kind of god you are.
        </p>

        <form onSubmit={start} className="glass mt-10 flex w-full max-w-md flex-col gap-3 p-5 text-left">
          <label htmlFor="name" className="label">
            Your name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="What do mortals call you?"
            className="rounded-lg bg-white/10 px-4 py-2.5 outline-none placeholder:text-white/30 focus:bg-white/15"
          />
          <label htmlFor="planet" className="label mt-1">
            Your planet
          </label>
          <input
            id="planet"
            value={planet}
            onChange={(e) => setPlanet(e.target.value)}
            maxLength={24}
            placeholder="Name your world"
            className="rounded-lg bg-white/10 px-4 py-2.5 outline-none placeholder:text-white/30 focus:bg-white/15"
          />
          <p className="label mt-1">Your people</p>
          <div className="grid grid-cols-5 gap-1.5">
            {RACES.map((r, i) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setRace(r.id)}
                className={`flex flex-col items-center rounded-lg p-1 text-xs transition ${race === r.id ? "bg-sky-400/25 ring-1 ring-sky-300" : "bg-white/5 hover:bg-white/10"}`}
              >
                <Portrait race={r.id} seed={i * 97 + 5} color="#5fd4ff" size={56} />
                <span className="mt-0.5 font-medium">{r.name}</span>
              </button>
            ))}
          </div>
          {RACES.filter((r) => r.id === race).map((r) => (
            <div key={r.id} className="rounded-lg bg-white/5 p-3 text-xs">
              <p className="mb-1.5 text-sm text-white/80">{r.blurb}</p>
              <RaceStats race={r.id} />
              <p className="mt-1.5 text-white/45">Thrives on {r.home} worlds. The other nations on your planet will be other races.</p>
            </div>
          ))}
          <p className="label mt-1">Your world</p>
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
          {world != null && (
            <p className="text-xs text-white/55">
              {PLANET_TYPES[world].blurb}. Prone to {PLANET_TYPES[world].hazard}s. Weak to {PLANET_TYPES[world].weakTo}: {PLANET_TYPES[world].weakWhy}.
            </p>
          )}
          <button className="mt-1 rounded-lg bg-sky-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-sky-300">Create your planet</button>
          <p className="text-xs text-white/40">Coming soon: other gods&apos; planets in your universe, to trade with or invade.</p>
        </form>
      </section>

      <section className="relative mx-auto grid max-w-5xl gap-4 px-6 py-20 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.title} className="glass p-5">
            <div className="text-3xl">{s.icon}</div>
            <h2 className="mt-3 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-white/60">{s.text}</p>
          </div>
        ))}
      </section>

      <footer className="relative pb-10 text-center text-xs text-white/30">Built in 24 hours for WHACK26</footer>
    </main>
  );
}
