// Entry point for the static demo build (npm run demo): the same game without Next.js,
// for hosting as a single page. The LLM routes aren't available there, so the people
// speak in the canned fallback lines.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Game from "@/components/Game";
import Landing from "@/components/Landing";
import type { RaceId } from "@/sim/races";

function App() {
  const [player, setPlayer] = useState<{ name: string; planet: string; race: RaceId; world?: number } | null>(null);
  return player ? (
    <Game playerName={player.name} planetName={player.planet} race={player.race} worldType={player.world} />
  ) : (
    <Landing onStart={(name, planet, race, world) => setPlayer({ name, planet, race, world })} />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
