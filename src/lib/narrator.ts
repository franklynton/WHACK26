// Narrator prompts and response checks (track C). Server-side only.
import type { ChronicleKind, Civ, LeaderMessage, MindMessage, Policy, World } from "@/types/world";
import { ERAS, RACE } from "@/sim/races";
import { POLICIES } from "@/types/world";

const ATTITUDES = ["worship", "fear", "indifferent", "resentful", "hostile"];

// Short, factual summary of the world for the prompt. Keep it compact: free models have small context.
function describe(w: World): string {
  const s = w.stats;
  return [
    `A ${s.planetType} planet. Year ${Math.floor(w.year)}. Population ${s.population} in ${s.villages} villages.`,
    `Stockpile: ${Object.entries(s.resources).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
    `Planet surface: ${s.ocean}% ocean, ${s.forest}% forest, ${s.desert}% desert, ${s.mountains}% mountains.`,
    `Needs (0-100): food ${Math.round(w.needs.food)}, stability ${Math.round(w.needs.stability)}.`,
    w.crisis ? `CURRENT CRISIS: ${w.crisis}.` : "",
    `Current focus: ${w.policy}.`,
    w.nation?.race ? `YOUR people are ${RACE[w.nation.race].plural}. Speak the way ${RACE[w.nation.race].plural} do: ${RACE[w.nation.race].voice}.` : "",
    w.nation?.era != null ? `Your people live in the ${ERAS[w.nation.era]}.` : "",
    w.nation ? `YOUR nation: ${w.nation.population} people in ${w.nation.villages} villages (the figures above are for the whole planet).` : "",
    w.nation?.relations.length ? `Other nations on the planet: ${w.nation.relations.map((r) => `${r.name} (${r.relation}, tension ${r.tension}/100)`).join("; ")}.` : "",
    w.civ ? `Civ so far: ${JSON.stringify(w.civ)}` : "",
    `Recent history: ${w.chronicle.slice(-6).map((c) => `[${Math.floor(c.year)}] ${c.text}`).join(" ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// The people share one collective mind (an LLM). It narrates what happens, speaks to
// the player as their god, and decides what the people focus on next.
const SYSTEM = `You are the collective mind of one nation on a pocket-sized planet shared with other nations. The player is your god:
you worship them by default, though how you feel can change with how they treat you.
The other nations worship the same god in their own ways, and you may trade with them, envy them or fight them.
You see the world only through your people's eyes and invent explanations for what the god does.
Be vivid, specific, a little strange and a little funny. Use your invented words sometimes. Reply with ONLY a JSON object.`;

// A random sound to nudge the AI towards a different name on every planet.
const inspiration = () => word(pick(SYL.start), pick(SYL.mid), pick(SYL.end));

export function genesisPrompt(w: World) {
  return {
    system: SYSTEM,
    user: `${describe(w)}

Your people have just founded their first village and become self-aware. Invent yourselves. Return JSON:
{"civ":{"name":string,"demonym":string,"language":{"name":string,"words":{"god":string,"water":string,"food":string,"enemy":string,"friend":string}},"religion":{"name":string,"godName":string,"belief":string},"attitude":"worship","myths":[string],"laws":[string]},"text":string}
"godName" is what you call the god. "text" is the first chronicle entry, 1-2 sentences.
Your name must be new and unusual (never Oru, Kessa, Velmor, Pallu or Drohm); let it sound something like "${inspiration()}".
The religion must be entirely made up: its own name, rites, sacred places and beliefs shaped by this planet. Never borrow real-world religions, gods, prophets, scriptures or religious terms.${w.nation?.relations.length ? `\nYour name, language and religion must be clearly different from your neighbours: ${w.nation.relations.map((r) => r.name).join(", ")}.` : ""}`,
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
{"reply":string,"policy":"settle"|"expand"|"farm"|"worship"|"explore"|"hoard"|"rebel","reason":string,"attitude":"worship"|"fear"|"indifferent"|"resentful"|"hostile","newLaw":string|null,"toward":{"nation":string,"stance":"friendly"|"hostile"}|null}
"reply" is 1-3 sentences spoken directly to the god, in the first person plural. "reason" is under 12 words.
"toward" is how you will treat one neighbouring nation (by its exact name), or null. Hostility pushes towards war, friendliness towards trade.`,
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
  toward?: { nation: string; stance: "friendly" | "hostile" } | null;
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
// One per nation slot, each with its own made-up faith.
export const FALLBACK_CIV: Civ = {
  name: "Oru",
  demonym: "the Oruvai",
  language: { name: "Oruvic", words: { god: "Thal", water: "mii", food: "kesh", enemy: "drak", friend: "ana" } },
  religion: { name: "The Watching Sky", godName: "Thal", belief: "A vast eye above the clouds who shaped the world and rearranges it when bored." },
  attitude: "worship",
  myths: ["The first Oruvai climbed out of a puddle that Thal forgot to dry."],
  laws: ["No one may build higher than the tallest tree, lest Thal notice."],
};

const FALLBACK_OTHERS: Civ[] = [
  {
    name: "Kessa", demonym: "the Kessari",
    language: { name: "Kessic", words: { god: "Umbo", water: "lul", food: "pran", enemy: "skorr", friend: "evi" } },
    religion: { name: "The Long Echo", godName: "Umbo", belief: "A voice that speaks only in thunder; every echo is an answered prayer." },
    attitude: "worship", myths: ["Umbo hummed once and the mountains stood up to listen."], laws: ["Shout your prayers from high places, or they get lost."],
  },
  {
    name: "Velmor", demonym: "the Velmori",
    language: { name: "Velm", words: { god: "Isk", water: "dosh", food: "mabba", enemy: "gru", friend: "teli" } },
    religion: { name: "The Hand Below", godName: "Isk", belief: "A great hand that holds the world from underneath and tilts it when displeased." },
    attitude: "worship", myths: ["The first quake was Isk stretching its fingers."], laws: ["Never dig deeper than your own height."],
  },
  {
    name: "Pallu", demonym: "the Palluans",
    language: { name: "Pallish", words: { god: "Nowa", water: "sib", food: "tuk", enemy: "vash", friend: "oo" } },
    religion: { name: "The Gardener's Path", godName: "Nowa", belief: "A patient gardener who planted the people and weeds out the wicked." },
    attitude: "worship", myths: ["Nowa grew the first Palluan from a seed shaped like a sneeze."], laws: ["Every child plants a tree; every death returns one."],
  },
  {
    name: "Drohm", demonym: "the Drohmen",
    language: { name: "Drohmic", words: { god: "Zaa", water: "hrel", food: "gont", enemy: "mak", friend: "sela" } },
    religion: { name: "The Burning Ledger", godName: "Zaa", belief: "A keeper of accounts who writes every deed in fire and settles debts with meteors." },
    attitude: "worship", myths: ["Zaa paid the sea in salt for every island it gave up."], laws: ["A debt unpaid at sunset doubles by sunrise."],
  },
];

// Without the AI, a nation still gets its own made-up name and language: a random template
// (religion, myths, laws) under freshly invented names, so every planet's peoples differ.
const SYL = { start: ["Or", "Kes", "Vel", "Pal", "Dro", "Thar", "Ny", "Zel", "Aru", "Mok", "Sil", "Quo", "Bre", "Ixa", "Lum", "Rha"], mid: ["", "a", "e", "i", "o", "u", "an", "or", "el"], end: ["u", "sa", "mor", "lu", "hm", "vin", "dra", "keth", "nai", "ros", "tal", "mi"] };
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
// Glue syllables together without doubled-up vowels or consonants ("Ixa"+"a" -> "Ixa").
const word = (...parts: string[]) => parts.reduce((w, p) => (p && w && (/[aeiou]$/i.test(w) === /^[aeiou]/i.test(p)) ? w + p.slice(1) : w + p), "");

export function fallbackCiv(nation = 0): Civ {
  void nation; // every nation draws at random now
  const t = pick([FALLBACK_CIV, ...FALLBACK_OTHERS]);
  const name = word(pick(SYL.start), pick(SYL.mid), pick(SYL.end));
  const stem = name.replace(/[aeiou]+$/, "");
  const god = word(pick(SYL.start), pick(SYL.end));
  const swap = (x: string) => x.split(t.religion.godName).join(god).split(t.demonym.replace(/^the /, "")).join(`${stem}i`);
  return {
    ...t,
    name,
    demonym: `the ${stem}i`,
    language: { name: `${stem}ic`, words: { ...t.language.words, god } },
    religion: { ...t.religion, godName: god, belief: swap(t.religion.belief) },
    myths: t.myths.map(swap),
    laws: t.laws.map(swap),
  };
}

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
    diplomacy: `${name} send envoys and argue late into the night about their neighbours.`,
    captured: `Banners change over a village. ${name} pray to ${god} for strength.`,
    fallen: `A nation has vanished from the world. ${name} wonder if ${god} will remember them.`,
    peace: `A strange calm settles over ${dem}. Old grudges suddenly seem silly.`,
    discord: `${name} start to hate their neighbours, and nobody can say why.`,
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
  if (chat.at(-1)?.from === "god") return { reply: `We hear you, ${god}, and we will do as you say.`, policy: "worship", reason: "The god has spoken", attitude: "worship", newLaw: null };
  const war = w.nation?.relations.find((r) => r.relation === "war");
  if (war) return { reply: `${god}, we are at war with ${war.name}. Grant us victory, or grant us peace.`, policy: "settle", reason: `War with ${war.name}`, attitude: "fear", newLaw: null, toward: { nation: war.name, stance: "hostile" } };
  const friend = w.nation?.relations.find((r) => r.relation === "trade");
  if (friend && chat.at(-1)?.from !== "god") return { reply: `${god}, our caravans to ${friend.name} come home heavy. Surely this pleases you.`, policy: "farm", reason: `Trade with ${friend.name} is good`, attitude: "worship", newLaw: null, toward: { nation: friend.name, stance: "friendly" } };
  if (n.faith < 15) return { reply: `You have been silent so long, ${god}. Some of us say you were never there.`, policy: "rebel", reason: "The god has abandoned us", attitude: "resentful", newLaw: null };
  if (n.faith < 40) return { reply: `We still pray to you, ${god}. Give us a sign that you hear us.`, policy: "worship", reason: "Faith must be kept alive", attitude: w.civ?.attitude ?? "worship", newLaw: null };
  return { reply: `The land is good, ${god}. We will spread across it in your name.`, policy: "expand", reason: "Times are good", attitude: "worship", newLaw: null };
}

// ---- Talking to a nation's leader ----
// One named ruler, not the whole people: first person singular, with a personality from
// their race. What they decide can change the sim (their focus, or how they treat a neighbour).

export type LeaderMood = "pleased" | "angry" | "afraid" | "defiant" | "scheming";
const MOODS: LeaderMood[] = ["pleased", "angry", "afraid", "defiant", "scheming"];

export interface LeaderReply {
  reply: string;
  mood: LeaderMood;
  policy: Policy | null; // a new focus they order, or null
  toward: { nation: string; stance: "friendly" | "hostile" } | null;
}

export function leaderPrompt(w: World, chat: LeaderMessage[]) {
  const l = w.nation?.leader;
  const race = RACE[w.nation?.race ?? "human"];
  const who = l ? `${l.title} ${l.name}` : "the ruler";
  const talk = chat.slice(-10).map((m) => `${m.from === "god" ? "GOD" : "YOU"}: ${m.text}`).join("\n");
  return {
    system: `You are ${who}, ruler of ${w.nation?.name ?? "a small nation"}, a nation of ${race.plural} on a tiny planet. The player is the god your people worship.
You are one person with strong opinions, not the whole people. You speak like a ${race.name.toLowerCase()}: ${race.voice}.
Stay in character, be funny and specific, and keep it short. You may obey the god, bargain, or refuse. Reply with ONLY a JSON object.`,
    user: `${describe(w)}

Your conversation with the god:
${talk || "(the god has just appeared before you for the first time)"}

${chat.at(-1)?.from === "god" ? "Answer the god." : "The god has appeared before you. Greet them in your own way and tell them what you want."}
Return JSON:
{"reply":string,"mood":"pleased"|"angry"|"afraid"|"defiant"|"scheming","policy":"settle"|"expand"|"farm"|"worship"|"explore"|"hoard"|"rebel"|null,"toward":{"nation":string,"stance":"friendly"|"hostile"}|null}
"reply" is 1-3 sentences in the first person singular, spoken aloud to the god. Use your people's invented words sometimes.
"policy" is a new focus you order for your people because of this talk, or null to keep it. "toward" is a decision about one neighbouring nation (exact name), or null.`,
  };
}

export function isLeaderReply(x: unknown): x is LeaderReply {
  return isObj(x) && typeof x.reply === "string" && MOODS.includes(x.mood as LeaderMood) && (x.policy == null || POLICIES.includes(x.policy as Policy));
}

// Canned lines in each race's voice, so the leader still talks without a key.
const LEADER_LINES: Record<string, { greet: string[]; obey: string[]; refuse: string[]; war: string[]; hungry: string[] }> = {
  human: {
    greet: ["Great {god}, you honour us. I have plans, so many plans, and with your blessing every one of them will work.", "{god}! I knew you would come. Progress waits for no one, not even gods."],
    obey: ["It shall be done, {god}. I will draft a proclamation at once.", "A wise command. I will tell the council it was my idea, if you don't mind."],
    refuse: ["With respect, {god}, my people need more than words. Show us a sign and I will follow.", "I hear you, {god}, but the treasury disagrees."],
    war: ["{enemy} cross our borders, {god}. Give me strength and I will give you victory."],
    hungry: ["Our granaries are empty, {god}. A king cannot feed his people on speeches."],
  },
  goblin: {
    greet: ["OI! BIG SKY THING! {leader} not scared of you. ...Maybe little bit scared. You bring SHINY?", "{god}! You come to {leader}! Good. {leader} want meat, gold, and to SMASH {enemy}."],
    obey: ["Hmm. {leader} do it. But {leader} want shiny after. LOTS shiny.", "OK OK OK. {leader} tell the boys. Boys not listen. {leader} hit boys. Then boys listen."],
    refuse: ["NO! {leader} is boss here! ...You is boss of sky. {leader} is boss of DIRT.", "{leader} not understand big words. {leader} understand SMASH."],
    war: ["WAAAGH! {enemy} is squishy! We smash them, we take their pots!"],
    hungry: ["Belly empty, {god}! Goblins eat grass now. Grass taste like sad."],
  },
  elf: {
    greet: ["Ah, {god}. I have watched the stars turn for nine hundred years. You are... earlier than expected.", "Welcome, {god}. The leaves whispered you would come, though they rarely whisper anything useful."],
    obey: ["As the river bends to the stone, so we bend to you. Slowly. Gracefully. Eventually.", "It shall be so. Though I suspect you will change your mind within a century."],
    refuse: ["Forgive me, {god}, but the younger races rush. We do not rush.", "A curious command. I shall meditate upon it for some decades."],
    war: ["{enemy} burn our groves, {god}. Even the patient root will choke the axe in time."],
    hungry: ["The trees give less each season, {god}. Even the undying must eat."],
  },
  dwarf: {
    greet: ["Hrm. {god}. Took your time. The mines don't dig themselves, so say what you came to say.", "So you're the one up there. You ever lifted a hammer, {god}? Didn't think so."],
    obey: ["Fine. But I'm writing it in the Book of Grudges if it goes wrong.", "Aye, we'll do it. Properly. Not like the elves would."],
    refuse: ["No. Stone doesn't change its mind, and neither do I.", "You want that, you can dig it yourself, {god}."],
    war: ["{enemy} came for our gold. They'll leave with our hammers. In their heads."],
    hungry: ["Can't mine on an empty stomach, {god}. Send ale. And food. Mostly ale."],
  },
  lizardfolk: {
    greet: ["Sssso. The sky-one comes. The eggs said you would. The eggs are always right.", "{god}. The tide is low, the sun is warm. Ssspeak, and be brief."],
    obey: ["It will be done. We are patient. We are always patient.", "The tide turns as you wish, {god}. For now."],
    refuse: ["No. The cold-blooded do not ssserve the impatient.", "We have waited a thousand tides. We can wait for a better offer."],
    war: ["{enemy} take the warm stones. They will learn how cold we can be."],
    hungry: ["The sea gives little, {god}. The eggs grow hungry."],
  },
};

export function fallbackLeader(w: World, chat: LeaderMessage[]): LeaderReply {
  const race = w.nation?.race ?? "human";
  const lines = LEADER_LINES[race];
  const pick = (a: string[]) => a[(chat.length + (w.nation?.id ?? 0)) % a.length];
  const war = w.nation?.relations.find((r) => r.relation === "war");
  const enemy = war?.name ?? w.nation?.relations[0]?.name ?? "the neighbours";
  const fill = (t: string) => t.replaceAll("{god}", w.civ?.religion.godName ?? "Great One").replaceAll("{leader}", w.nation?.leader?.name ?? "Boss").replaceAll("{enemy}", enemy);
  const last = chat.at(-1);
  if (!last || last.from !== "god") return { reply: fill(pick(lines.greet)), mood: race === "goblin" ? "scheming" : "pleased", policy: null, toward: null };
  const said = last.text.toLowerCase();
  if (w.needs.food < 30) return { reply: fill(pick(lines.hungry)), mood: "afraid", policy: "farm", toward: null };
  const peace = /peace|calm|stop|friend|trade|love|kind/.test(said);
  const fight = /war|attack|fight|smash|destroy|kill|invade/.test(said);
  if (fight && war) return { reply: fill(pick(lines.war)), mood: "angry", policy: null, toward: { nation: war.name, stance: "hostile" } };
  // Goblins and dwarves are stubborn about peace; everyone else listens more often.
  const stubborn = race === "goblin" || race === "dwarf" ? 0.5 : 0.25;
  if ((chat.length / 2) % 3 === 2 || (peace && Math.random() < stubborn)) return { reply: fill(pick(lines.refuse)), mood: "defiant", policy: null, toward: null };
  return { reply: fill(pick(lines.obey)), mood: "pleased", policy: /pray|worship|faith/.test(said) ? "worship" : /farm|food|grow/.test(said) ? "farm" : null, toward: peace && w.nation?.relations[0] ? { nation: (war ?? w.nation.relations[0]).name, stance: "friendly" } : null };
}
