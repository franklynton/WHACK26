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
  const { world, chat } = (await req.json()) as Body;
  const p = leaderPrompt(world, chat);
  const ai = allowAi(visitorId(req));
  const r = (ai ? await askJson(p.system, p.user, isLeaderReply, 400) : null) ?? fallbackLeader(world, chat);
  return NextResponse.json(r);
}
