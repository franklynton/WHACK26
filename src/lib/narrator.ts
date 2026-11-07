// Narrator prompts and response checks (track C). Server-side only.
import type { ChronicleKind, Civ, MindMessage, Policy, World } from "@/types/world";
import { POLICIES } from "@/types/world";

const ATTITUDES = ["worship", "fear", "indifferent", "resentful", "hostile"];

// Short, factual summary of the world for the prompt. Keep it compact: free models have small context.
function describe(w: World): string {
  const s = w.stats;
  return [
    `A ${s.planetType} planet. Year ${Math.floor(w.year)}. Population ${s.population} in ${s.villages} villages.`,
    `Stockpile: ${Object.entries(s.resources).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
    `Planet surface: ${s.ocean}% ocean, ${s.forest}% forest, ${s.desert}% desert, ${s.mountains}% mountains.`,
    `Needs (0-100): food ${Math.round(w.needs.food)}, faith ${Math.round(w.needs.faith)}, stability ${Math.round(w.needs.stability)}.`,
    w.crisis ? `CURRENT CRISIS: ${w.crisis}.` : "",
    `Current focus: ${w.policy}.`,
    w.civ ? `Civ so far: ${JSON.stringify(w.civ)}` : "",
    `Recent history: ${w.chronicle.slice(-6).map((c) => `[${Math.floor(c.year)}] ${c.text}`).join(" ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// The people share one collective mind (an LLM). It narrates what happens, speaks to
// the player as their god, and decides what the people focus on next.
const SYSTEM = `You are the collective mind of a tiny civilisation on a pocket-sized planet. The player is your god:
you worship them by default, though how you feel can change with how they treat you.
You see the world only through your people's eyes and invent explanations for what the god does.
Be vivid, specific, a little strange and a little funny. Use your invented words sometimes. Reply with ONLY a JSON object.`;

export function genesisPrompt(w: World) {
  return {
    system: SYSTEM,
    user: `${describe(w)}

Your people have just founded their first village and become self-aware. Invent yourselves. Return JSON:
{"civ":{"name":string,"demonym":string,"language":{"name":string,"words":{"god":string,"water":string,"food":string,"enemy":string,"friend":string}},"religion":{"name":string,"godName":string,"belief":string},"attitude":"worship","myths":[string],"laws":[string]},"text":string}
"godName" is what you call the god. "text" is the first chronicle entry, 1-2 sentences.`,
  };
}

export function reactPrompt(w: World, kind: ChronicleKind, detail: string) {
  return {
    system: SYSTEM,
    user: `${describe(w)}

What just happened: ${kind}. ${detail}
How do your people react? Return JSON:
{"text":string,"attitude":"worship"|"fear"|"indifferent"|"resentful"|"hostile","newMyth":string|null,"newLaw":string|null}
"text" is 1-2 sentences for the chronicle, in the third person. Add a myth or law only if this event would really create one.`,
  };
}

// The mind thinks: on a timer, or when the god speaks to it. It answers the god and
// picks what the people focus on next, which changes how they behave in the sim.
export function thinkPrompt(w: World, chat: MindMessage[]) {
  const talk = chat.slice(-8).map((m) => `${m.from === "god" ? "GOD" : "YOU"}: ${m.text}`).join("\n");
  const spoke = chat.at(-1)?.from === "god";
  return {
    system: SYSTEM,
    user: `${describe(w)}

Conversation with the god so far:
${talk || "(the god has never spoken to you)"}

${spoke ? "The god has just spoken to you. Answer them." : "The god is silent. Say something to them: a prayer, a plea, a complaint or a question about your situation."}
Then choose your people's focus for the coming years:
settle (steady life), expand (found many villages), farm (grow food, more children), worship (keep faith high),
explore (roam far), hoard (eat less, fewer children), rebel (reject the god, burn shrines; only if you truly feel abandoned or abused).
You may follow the god's wishes or not. Return JSON:
{"reply":string,"policy":"settle"|"expand"|"farm"|"worship"|"explore"|"hoard"|"rebel","reason":string,"attitude":"worship"|"fear"|"indifferent"|"resentful"|"hostile","newLaw":string|null}
"reply" is 1-3 sentences spoken directly to the god, in the first person plural. "reason" is under 12 words.`,
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
export interface Thought {
  reply: string;
  policy: Policy;
  reason: string;
  attitude: Civ["attitude"];
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

export function isThought(x: unknown): x is Thought {
  return isObj(x) && typeof x.reply === "string" && POLICIES.includes(x.policy as Policy) && ATTITUDES.includes(x.attitude as string);
}

// Used when there is no API key or every model failed, so the demo never stalls.
export const FALLBACK_CIV: Civ = {
  name: "Oru",
  demonym: "the Oruvai",
  language: { name: "Oruvic", words: { god: "Thal", water: "mii", food: "kesh", enemy: "drak", friend: "ana" } },
  religion: { name: "The Watching Sky", godName: "Thal", belief: "A vast eye above the clouds who shaped the world and rearranges it when bored." },
  attitude: "worship",
  myths: ["The first Oruvai climbed out of a puddle that Thal forgot to dry."],
  laws: ["No one may build higher than the tallest tree, lest Thal notice."],
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function fallbackReaction(w: World, kind: ChronicleKind): Reaction {
  const dem = w.civ?.demonym ?? "the people"; // mid-sentence
  const name = cap(dem); // starting a sentence
  const god = w.civ?.religion.godName ?? "the sky";
  const lines: Partial<Record<ChronicleKind, string>> = {
    raise: `${name} watch new land heave out of the earth and name it ${god}'s Knuckle.`,
    lower: `${name} watch the sea swallow the lowlands and argue about whether it was a gift or a warning.`,
    forest: `${name} wake to a forest that was not there yesterday and leave offerings at its edge.`,
    rain: `${name} dance in the rain and thank ${god} with their best songs.`,
    drought: `${name} ration their food and whisper that ${god} is angry.`,
    fire: `${name} flee the flames and wonder what they did to offend ${god}.`,
    meteor: `A star falls on ${dem}. The survivors build a shrine around the crater.`,
    spawn: `New people appear from nowhere. ${name} call them the Sky-Born.`,
    miracle: `${name} fall to their knees as the fields bloom overnight.`,
    village: `${name} raise another village and carve ${god}'s name over its gate.`,
    milestone: `${name} grow in number and in pride.`,
    famine: `Hunger spreads. ${name} begin to ask why ${god} has stopped caring.`,
    revolution: `${name} tear down the old priests and argue in the streets.`,
    cult: `A new cult preaches that ${god} is a devourer who must be resisted.`,
    extinct: `The last fire goes out. ${god} is alone again.`,
    disaster: `Disaster strikes. ${name} cannot agree whether ${god} sent it or failed to stop it.`,
  };
  const attitude: Civ["attitude"] =
    kind === "miracle" || kind === "rain" ? "worship" : kind === "drought" || kind === "famine" || kind === "meteor" || kind === "fire" || kind === "disaster" ? "fear" : kind === "cult" ? "hostile" : w.civ?.attitude ?? "worship";
  return { text: lines[kind] ?? `${name} carry on as best they can.`, attitude, newMyth: null, newLaw: null };
}

export function fallbackThought(w: World, chat: MindMessage[]): Thought {
  const god = w.civ?.religion.godName ?? "Great One";
  const n = w.needs;
  if (n.food < 35) return { reply: `${god}, our bellies are empty. Send rain, or show us where the food has gone.`, policy: "farm", reason: "Food is running out", attitude: "fear", newLaw: null };
  if (n.faith < 15) return { reply: `You have been silent so long, ${god}. Some of us say you were never there.`, policy: "rebel", reason: "The god has abandoned us", attitude: "resentful", newLaw: null };
  if (n.faith < 40) return { reply: `We still pray to you, ${god}. Give us a sign that you hear us.`, policy: "worship", reason: "Faith must be kept alive", attitude: w.civ?.attitude ?? "worship", newLaw: null };
  if (chat.at(-1)?.from === "god") return { reply: `We hear you, ${god}, and we will do as you say.`, policy: "expand", reason: "The god has spoken", attitude: "worship", newLaw: null };
  return { reply: `The land is good, ${god}. We will spread across it in your name.`, policy: "expand", reason: "Times are good", attitude: "worship", newLaw: null };
}
