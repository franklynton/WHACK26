"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import Landing from "@/components/Landing";

// The game uses WebGL and window APIs, so it only renders in the browser.
const Game = dynamic(() => import("@/components/Game"), { ssr: false });

export default function Home() {
  const [player, setPlayer] = useState<{ name: string; planet: string } | null>(null);
  return player ? <Game playerName={player.name} planetName={player.planet} /> : <Landing onStart={(name, planet) => setPlayer({ name, planet })} />;
}
