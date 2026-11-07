// The game is saved in this browser (localStorage), so a refresh or closed tab picks up where you left off.
import type { Mood } from "@/components/Portrait";
import type { RaceId } from "@/sim/races";
import type { ChronicleEntry, Civ, LeaderMessage, MindMessage } from "@/types/world";

// Demo mode has its own save, so a presentation never touches the real planet.
// sessionStorage remembers that this tab is running the demo, so a refresh resumes the demo.
const KEY = "arda-save-v1";
const DEMO_KEY = "arda-demo-v1";
const DEMO_TAB = "arda-demo-tab";

export interface SaveMeta {
  playerName: string;
  planetName: string;
  race?: RaceId;
  demo?: boolean;
}

// Everything the HUD knows that the sim doesn't: the minds, their chats and the chronicle.
export interface SaveUi {
  civs: (Civ | null)[];
  chats: MindMessage[][];
  reasons: string[];
  chronicle: (ChronicleEntry & { nation?: number })[];
  leaderChats: LeaderMessage[][];
  moods: Mood[];
  sel: number;
}

export interface Save {
  meta: SaveMeta;
  ui: SaveUi;
  sim: string; // PlanetSim.toSave()
  at: number;
}

export function inDemo() {
  try {
    return sessionStorage.getItem(DEMO_TAB) === "1";
  } catch {
    return false;
  }
}

export function setDemo(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DEMO_TAB, "1");
    else sessionStorage.removeItem(DEMO_TAB);
  } catch {}
}

export function loadGame(demo = inDemo()): Save | null {
  try {
    const raw = localStorage.getItem(demo ? DEMO_KEY : KEY);
    return raw ? (JSON.parse(raw) as Save) : null;
  } catch {
    return null;
  }
}

export function saveGame(save: Save) {
  try {
    localStorage.setItem(save.meta.demo ? DEMO_KEY : KEY, JSON.stringify(save));
  } catch (err) {
    console.warn("Could not save the game", err); // e.g. storage full or blocked
  }
}

export function clearGame(demo = false) {
  try {
    localStorage.removeItem(demo ? DEMO_KEY : KEY);
  } catch {}
}
