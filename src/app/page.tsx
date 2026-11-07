"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Landing from "@/components/Landing";
import { clearGame, loadGame, type Save } from "@/lib/save";
import type { RaceId } from "@/sim/races";

// The game uses WebGL and window APIs, so it only renders in the browser.
const Game = dynamic(() => import("@/components/Game"), { ssr: false });

type Player = { name: string; planet: string; race?: RaceId; world?: number; resume?: Save };

export default function Home() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [checked, setChecked] = useState(false);
  // A saved game in this browser carries straight on, so a refresh doesn't lose your planet.
  useEffect(() => {
    const save = loadGame();
    if (save) setPlayer({ name: save.meta.playerName, planet: save.meta.planetName, race: save.meta.race, resume: save });
    setChecked(true);
  }, []);
  if (!checked) return <main className="starfield min-h-dvh" />;
  const newPlanet = () => {
    clearGame();
    setPlayer(null);
  };
  return player ? (
    <Game key={player.resume?.at ?? "new"} playerName={player.name} planetName={player.planet} race={player.race} worldType={player.world} resume={player.resume} onNewPlanet={newPlanet} />
  ) : (
    <Landing onStart={(name, planet, race, world) => setPlayer({ name, planet, race, world })} />
  );
}
