import { NextResponse } from "next/server";
import type { Civ, MindMessage, World } from "@/types/world";
import { askJson } from "@/lib/openrouter";
import { fallbackThought, isThought, thinkPrompt } from "@/lib/narrator";
import { allowAi, visitorId } from "@/lib/rateLimit";

interface Body {
  world: World; // must have a civ
  chat: MindMessage[]; // newest last; if the last one is the god's, the mind answers it
}

// The people's shared mind thinks: answers the god and picks the people's next focus.
// Never fails: falls back to a canned thought.
export async function POST(req: Request) {
  const { world, chat } = (await req.json()) as Body;
  if (!world.civ) return NextResponse.json({ error: "no civ yet" }, { status: 400 });
  const p = thinkPrompt(world, chat);
  const ai = allowAi(visitorId(req));
  const t = (ai ? await askJson(p.system, p.user, isThought, 500) : null) ?? fallbackThought(world, chat);
  const civ: Civ = { ...world.civ, attitude: t.attitude, laws: t.newLaw ? [...world.civ.laws, t.newLaw].slice(-8) : world.civ.laws };
  return NextResponse.json({ civ, reply: t.reply, policy: t.policy, reason: t.reason });
}
