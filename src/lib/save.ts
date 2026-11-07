// The game is saved in this browser (localStorage), so a refresh or closed tab picks up where you left off.
import type { Mood } from "@/components/Portrait";
import type { RaceId } from "@/sim/races";
import type { ChronicleEntry, Civ, LeaderMessage, MindMessage } from "@/types/world";

const KEY = "arda-save-v1";

export interface SaveMeta {
  playerName: string;
  planetName: string;
  race?: RaceId;
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

export function loadGame(): Save | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Save) : null;
  } catch {
    return null;
  }
}

export function saveGame(save: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch (err) {
    console.warn("Could not save the game", err); // e.g. storage full or blocked
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
