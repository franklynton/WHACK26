"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import Landing from "@/components/Landing";
import type { RaceId } from "@/sim/races";

// The game uses WebGL and window APIs, so it only renders in the browser.
const Game = dynamic(() => import("@/components/Game"), { ssr: false });

export default function Home() {
  const [player, setPlayer] = useState<{ name: string; planet: string; race: RaceId; world?: number } | null>(null);
  return player ? (
    <Game playerName={player.name} planetName={player.planet} race={player.race} worldType={player.world} />
  ) : (
    <Landing onStart={(name, planet, race, world) => setPlayer({ name, planet, race, world })} />
  );
}
