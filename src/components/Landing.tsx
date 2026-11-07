"use client";
// The front page: what Arda is, how to play, and a button to create your planet.
import { useState } from "react";

const STEPS = [
  { icon: "🌍", title: "Get a planet", text: "Every planet is different. Some are rich in wood, others in metal, gold or rare medicinal herbs." },
  { icon: "🧍", title: "Raise a people", text: "Tiny people wander, farm and build villages. Once they settle, they become aware of you, their god." },
  { icon: "🎲", title: "Fate rules their world", text: "Rain, drought, miracles, fire and meteors fall at random. Your people will think you sent them." },
  { icon: "💬", title: "Talk to them", text: "Your people share one mind, powered by AI. They pray, plead and argue with you. Your words are your only power: use them to keep the nations at peace." },
];

const NAME_KEY = "arda-player-name";

function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function Landing({ onStart }: { onStart: (playerName: string) => void }) {
  const [name, setName] = useState(savedName);

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || "Nameless One";
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
    onStart(n);
  };

  return (
    <main className="starfield relative min-h-dvh w-full overflow-x-hidden">
      <div className="planet-orb" aria-hidden />
      <section className="relative mx-auto flex max-w-5xl flex-col items-center px-6 pt-24 text-center">
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
