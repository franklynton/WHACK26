import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function galaxyError(error: { code?: string; message?: string }, action: string) {
  if (error.code === "PGRST202" || error.message?.includes("Could not find the function")) {
    return NextResponse.json({ error: `Galaxy migration not applied: ${action} is missing` }, { status: 503 });
  }
  return NextResponse.json({ error: error.message || "Galaxy database action failed" }, { status: 400 });
}

// Columns other players may see (never owner_token, which proves who owns a planet).
const PUBLIC_COLUMNS = "world_id, owner_name, planet_name, planet_type, population, villages, output, military, resources, updated_at";
const ONLINE_MS = 2 * 60 * 1000; // planets that synced in the last two minutes are online

// The planets online now, plus the trades and invasions that touched `worldId` since action `since`
// (so the game can apply them). Without `since`, it returns only the latest action id to start from.
export async function GET(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ planets: [], actions: [], enabled: false });

  const params = new URL(req.url).searchParams;
  const worldId = /^[0-9a-f-]{36}$/i.test(params.get("worldId") ?? "") ? params.get("worldId")! : ""; // a UUID, as it goes into a filter
  const since = params.get("since");
  const { data, error } = await supabase
    .from("planets")
    .select(PUBLIC_COLUMNS)
    .gte("updated_at", new Date(Date.now() - ONLINE_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error?.code === "PGRST205" || error?.message?.includes("public.planets")) {
    return NextResponse.json({ error: "Galaxy migration not applied: public.planets is missing", enabled: false }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const planets = (data ?? []).filter((p) => p.world_id !== worldId);

  let actions: unknown[] = [];
  let lastActionId = Number(since) || 0;
  if (since == null) {
    const { data: last } = await supabase.from("planet_actions").select("id").order("id", { ascending: false }).limit(1);
    lastActionId = last?.[0]?.id ?? 0;
  } else if (worldId) {
    const { data: rows } = await supabase
      .from("planet_actions")
      .select("id, source_world_id, target_world_id, action_type, payload, status, message")
      .gt("id", lastActionId)
      .eq("status", "completed")
      .or(`source_world_id.eq.${worldId},target_world_id.eq.${worldId}`)
      .order("id", { ascending: true });
    actions = rows ?? [];
    for (const a of actions as { id: number }[]) lastActionId = Math.max(lastActionId, a.id);
  }
  return NextResponse.json({ planets, actions, lastActionId, enabled: true });
}

export async function POST(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const text = await req.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "Request body is required" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");

  if (action === "sync") {
    const required = ["worldId", "ownerToken", "ownerName", "planetName", "planetType", "population", "villages", "output", "military", "resources"];
    const missing = required.filter((key) => body[key] === undefined || body[key] === null);
    if (missing.length) {
      return NextResponse.json({ error: `Missing sync fields: ${missing.join(", ")}` }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("sync_planet", {
      p_world_id: body.worldId,
      p_owner_token: body.ownerToken,
      p_owner_name: body.ownerName,
      p_planet_name: body.planetName,
      p_planet_type: body.planetType,
      p_population: body.population,
      p_villages: body.villages,
      p_output: body.output,
      p_military: body.military,
      p_resources: body.resources,
      p_position_x: body.positionX ?? 0.5,
      p_position_y: body.positionY ?? 0.5,
    });
    if (error) return galaxyError(error, "sync_planet");
    return NextResponse.json({ planet: data });
  }

  if (action === "trade" || action === "invasion") {
    if (!body.worldId || !body.ownerToken || !body.targetWorldId) {
      return NextResponse.json({ error: "Missing source, owner token, or target planet" }, { status: 400 });
    }
    if (action === "trade") {
      const amount = Number(body.amount);
      if (!["food", "wood", "stone", "metal", "gold", "herbs"].includes(String(body.resource))) {
        return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
      }
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
        return NextResponse.json({ error: "Amount must be an integer between 1 and 10000" }, { status: 400 });
      }
    }
    const rpc = action === "trade" ? "trade_planet" : "invade_planet";
    const params = action === "trade"
      ? {
          p_source_world_id: body.worldId,
          p_owner_token: body.ownerToken,
          p_target_world_id: body.targetWorldId,
          p_resource: body.resource,
          p_amount: Number(body.amount),
        }
      : {
          p_source_world_id: body.worldId,
          p_owner_token: body.ownerToken,
          p_target_world_id: body.targetWorldId,
        };
    const { data, error } = await supabase.rpc(rpc, params);
    if (error) return galaxyError(error, rpc);
    return NextResponse.json({ message: data });
  }

  return NextResponse.json({ error: "Unknown galaxy action" }, { status: 400 });
}
