import { NextResponse } from "next/server";
import type { ChronicleEntry, ChronicleKind, Civ, World } from "@/types/world";
import { askJson } from "@/lib/openrouter";
import { FALLBACK_CIV, fallbackReaction, genesisPrompt, isGenesis, isReaction, reactPrompt } from "@/lib/narrator";
import { allowAi, visitorId } from "@/lib/rateLimit";

interface Body {
  world: World;
  kind: ChronicleKind; // "genesis" to invent the civ, otherwise the event to react to
  detail?: string; // e.g. "The god raised a mountain in region 4."
}

// Returns the updated civ and a new chronicle entry. Never fails: falls back to canned text.
export async function POST(req: Request) {
  const { world, kind, detail = "" } = (await req.json()) as Body;
  const ai = allowAi(visitorId(req));

  if (kind === "genesis" || !world.civ) {
    const p = genesisPrompt(world);
    const g = ai ? await askJson(p.system, p.user, isGenesis, 700) : null;
    const civ: Civ = g ? { ...FALLBACK_CIV, ...g.civ, attitude: "indifferent" } : FALLBACK_CIV;
    const entry: ChronicleEntry = { year: world.year, kind: "genesis", text: g?.text ?? `${civ.demonym[0].toUpperCase()}${civ.demonym.slice(1)} light their first fires and name their world ${civ.name}.` };
    return NextResponse.json({ civ, entry });
  }

  const p = reactPrompt(world, kind, detail);
  const r = (ai ? await askJson(p.system, p.user, isReaction, 400) : null) ?? fallbackReaction(world, kind);
  const civ: Civ = {
    ...world.civ,
    attitude: r.attitude,
    myths: r.newMyth ? [...world.civ.myths, r.newMyth].slice(-8) : world.civ.myths,
    laws: r.newLaw ? [...world.civ.laws, r.newLaw].slice(-8) : world.civ.laws,
  };
  const entry: ChronicleEntry = { year: world.year, kind, text: r.text };
  return NextResponse.json({ civ, entry });
}
