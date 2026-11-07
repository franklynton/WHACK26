"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Landing from "@/components/Landing";
import { clearGame, loadGame, setDemo, type Save } from "@/lib/save";
import type { RaceId } from "@/sim/races";

// The game uses WebGL and window APIs, so it only renders in the browser.
const Game = dynamic(() => import("@/components/Game"), { ssr: false });

type Player = { name: string; planet: string; race?: RaceId; world?: number; demo?: boolean; resume?: Save };

const fromSave = (save: Save | null): Player | null =>
  save ? { name: save.meta.playerName, planet: save.meta.planetName, race: save.meta.race, demo: save.meta.demo, resume: save } : null;

export default function Home() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [checked, setChecked] = useState(false);
  // A saved game in this browser carries straight on, so a refresh doesn't lose your planet.
  useEffect(() => {
    // A tab running the demo resumes the demo; otherwise the real planet.
    setPlayer(fromSave(loadGame()));
    setChecked(true);
  }, []);
  if (!checked) return <main className="starfield min-h-dvh" />;
  const newPlanet = () => {
    clearGame();
    setPlayer(null);
  };
  // Leaving the demo throws the demo away and goes back to your real planet, if you have one.
  const exitDemo = () => {
    clearGame(true);
    setDemo(false);
    setPlayer(fromSave(loadGame(false)));
  };
  return player ? (
    <Game key={player.resume?.at ?? (player.demo ? "demo" : "new")} playerName={player.name} planetName={player.planet} race={player.race} worldType={player.world} demo={player.demo} resume={player.resume} onNewPlanet={player.demo ? exitDemo : newPlanet} />
  ) : (
    <Landing
      onStart={(name, planet, race, world, demo) => {
        setDemo(demo);
        setPlayer({ name, planet, race, world, demo });
      }}
    />
  );
}
