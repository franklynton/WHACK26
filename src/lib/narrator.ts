// Narrator prompts and response checks (track C). Server-side only.
import type { ChronicleKind, Civ, World } from "@/types/world";
import { population } from "./sim";

const ATTITUDES = ["worship", "fear", "indifferent", "resentful", "hostile"];

// Short, factual summary of the world for the prompt. Keep it compact: free models have small context.
function describe(w: World): string {
  const land = w.regions.map((r) => `${r.id}:${r.terrain}(pop ${r.population})`).join(", ");
  return [
    `Year ${w.year}. Population ${population(w)}.`,
    `Needs (0-100): food ${Math.round(w.needs.food)}, faith ${Math.round(w.needs.faith)}, stability ${Math.round(w.needs.stability)}.`,
    w.crisis ? `CURRENT CRISIS: ${w.crisis}.` : "",
    `Regions: ${land}.`,
    w.civ ? `Civ so far: ${JSON.stringify(w.civ)}` : "",
    `Recent history: ${w.chronicle.slice(-5).map((c) => `[${c.year}] ${c.text}`).join(" ") || "none"}`,
  ].join("\n");
}

const SYSTEM = `You narrate a tiny civilisation on a pocket-sized planet tended by a god (the player).
The people do not know the player; they only see what happens to their world and invent explanations.
Be vivid, specific and a little funny. Use the civ's invented words sometimes. Reply with ONLY a JSON object.`;

export function genesisPrompt(w: World) {
  return {
    system: SYSTEM,
    user: `${describe(w)}

A civilisation has just become self-aware. Invent it. Return JSON:
{"civ":{"name":string,"demonym":string,"language":{"name":string,"words":{"god":string,"water":string,"food":string,"enemy":string,"friend":string}},"religion":{"name":string,"godName":string,"belief":string},"attitude":"indifferent","myths":[string],"laws":[string]},"text":string}
"text" is the first chronicle entry, 1-2 sentences.`,
  };
}

export function reactPrompt(w: World, kind: ChronicleKind, detail: string) {
  return {
    system: SYSTEM,
    user: `${describe(w)}

What just happened: ${kind}. ${detail}
How does the civilisation react? Return JSON:
{"text":string,"attitude":"worship"|"fear"|"indifferent"|"resentful"|"hostile","newMyth":string|null,"newLaw":string|null}
"text" is 1-2 sentences for the chronicle. Add a myth or law only if this event would really create one.`,
  };
}

export interface Genesis {
  civ: Civ;
  text: string;
}
export interface Reaction {
  text: string;
  attitude: Civ["attitude"];
  newMyth: string | null;
  newLaw: string | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

export function isGenesis(x: unknown): x is Genesis {
  if (!isObj(x) || typeof x.text !== "string" || !isObj(x.civ)) return false;
  const c = x.civ;
  return typeof c.name === "string" && isObj(c.religion) && isObj(c.language) && Array.isArray(c.myths) && Array.isArray(c.laws);
}

export function isReaction(x: unknown): x is Reaction {
  return isObj(x) && typeof x.text === "string" && ATTITUDES.includes(x.attitude as string);
}

// Used when there is no API key or every model failed, so the demo never stalls.
export const FALLBACK_CIV: Civ = {
  name: "Oru",
  demonym: "the Oruvai",
  language: { name: "Oruvic", words: { god: "Thal", water: "mii", food: "kesh", enemy: "drak", friend: "ana" } },
  religion: { name: "The Watching Sky", godName: "Thal", belief: "A vast eye above the clouds rearranges the world when bored." },
  attitude: "indifferent",
  myths: ["The first Oruvai climbed out of a puddle the sky forgot to dry."],
  laws: ["No one may build higher than the tallest tree, lest Thal notice."],
};

export function fallbackReaction(w: World, kind: ChronicleKind): Reaction {
  const d = w.civ?.demonym ?? "the people";
  const name = d[0].toUpperCase() + d.slice(1); // starts a sentence
  const lines: Partial<Record<ChronicleKind, string>> = {
    water: `${name} watch the sea swallow a valley and argue about whether it was a gift or a warning.`,
    mountain: `${name} wake to a new mountain and immediately start climbing it to complain.`,
    drought: `${name} ration their food and whisper that the sky is angry.`,
    miracle: `${name} fall to their knees as the fields bloom overnight.`,
    famine: `Hunger spreads. ${name} begin to ask why the sky has stopped caring.`,
    revolution: `${name} tear down the old priests and argue in the streets.`,
    cult: `A new cult preaches that the sky-god is a devourer who must be resisted.`,
  };
  const attitude: Civ["attitude"] = kind === "miracle" ? "worship" : kind === "drought" || kind === "famine" ? "fear" : kind === "cult" ? "hostile" : "indifferent";
  return { text: lines[kind] ?? `${name} carry on as best they can.`, attitude, newMyth: null, newLaw: null };
}
