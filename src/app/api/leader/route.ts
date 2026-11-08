import { NextResponse } from "next/server";
import type { LeaderMessage, World } from "@/types/world";
import { askJson } from "@/lib/openrouter";
import { fallbackLeader, isLeaderReply, leaderPrompt } from "@/lib/narrator";
import { allowAi, visitorId } from "@/lib/rateLimit";

interface Body {
  world: World; // world.nation carries the leader and race
  chat: LeaderMessage[]; // newest last; if the last one is the god's, the leader answers it
}

// A nation's leader speaks to the god, in their race's voice. Never fails: falls back to canned lines.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.world || typeof body.world !== "object") {
    return NextResponse.json({ error: "World is required" }, { status: 400 });
  }

  const { world, chat = [] } = body;
  const p = leaderPrompt(world, chat);
  const ai = allowAi(visitorId(req));
  const r = (ai ? await askJson(p.system, p.user, isLeaderReply, 400) : null) ?? fallbackLeader(world, chat);
  return NextResponse.json(r);
}
