// Entry point for the static demo build (npm run demo): the same game without Next.js,
// for hosting as a single page. The LLM routes aren't available there, so the people
// speak in the canned fallback lines.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Game from "@/components/Game";
import Landing from "@/components/Landing";

function App() {
  const [player, setPlayer] = useState<{ name: string; planet: string } | null>(null);
  return player ? <Game playerName={player.name} planetName={player.planet} /> : <Landing onStart={(name, planet) => setPlayer({ name, planet })} />;
}

createRoot(document.getElementById("root")!).render(<App />);
