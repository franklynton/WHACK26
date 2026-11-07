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

// True when Postgres says a function or column doesn't exist yet: migration 003 (galaxy rooms)
// hasn't been run, so we fall back to 002's single shared galaxy of everyone online.
function notMigrated(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "PGRST202" || error.code === "42703" || error.code === "42883" || /does not exist|Could not find/.test(error.message ?? ""));
}

// Columns other players may see (never owner_token, which proves who owns a planet).
const PUBLIC_COLUMNS = "world_id, owner_name, planet_name, planet_type, population, villages, output, military, resources, updated_at";
const ONLINE_MS = 30 * 1000; // a god that hasn't synced for 30s is gone (the database drops them from their galaxy too)
const isUuid = (x: string | null) => /^[0-9a-f-]{36}$/i.test(x ?? "");

// GET ?peek=CODE: how full a galaxy is, without joining (for the landing page).
// GET ?worldId=...: the galaxy this planet is in, the other gods in it, plus the trades and invasions
// that touched this planet since action `since` (so the game can apply them; it gets them even after
// leaving a galaxy). Without `since`, it returns only the latest action id to start from.
export async function GET(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ planets: [], actions: [], enabled: false });

  const params = new URL(req.url).searchParams;
  if (params.has("peek")) {
    const { data, error } = await supabase.rpc("peek_galaxy", { p_code: params.get("peek") });
    if (error) return NextResponse.json({ enabled: true, rooms: !notMigrated(error) });
    return NextResponse.json({ enabled: true, rooms: true, ...data });
  }

  const worldId = isUuid(params.get("worldId")) ? params.get("worldId")! : ""; // a UUID, as it goes into a filter
  const since = params.get("since");
  const onlineSince = new Date(Date.now() - ONLINE_MS).toISOString();

  // Which galaxy are we in? (null: none yet)
  let rooms = true;
  let galaxy: string | null = null;
  let me: { galaxy?: string | null; credits?: number; resources?: Record<string, number> } | null = null;
  if (worldId) {
    const { data: planetData, error } = await supabase.from("planets").select("galaxy, credits, resources").eq("world_id", worldId).maybeSingle();
    if (notMigrated(error)) rooms = false;
    else if (error?.code === "PGRST205" || error?.message?.includes("public.planets")) {
      return NextResponse.json({ error: "Galaxy migration not applied: public.planets is missing", enabled: false }, { status: 503 });
    } else {
      me = planetData as { galaxy?: string | null; credits?: number; resources?: Record<string, number> } | null;
      galaxy = me?.galaxy ?? null;
    }
  }

  if (params.has("market")) {
    if (!rooms || !galaxy) {
      return NextResponse.json({ enabled: true, me: me ?? null, orders: [], trades: [] });
    }
    const { data: orders, error: ordersError } = await supabase
      .from("market_orders")
      .select("id, galaxy, world_id, side, resource, price, quantity, remaining, status, created_at")
      .eq("galaxy", galaxy)
      .in("status", ["open", "partial"])
      .order("price", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(200);
    if (notMigrated(ordersError)) return NextResponse.json({ error: "Galaxy migration not applied: market tables are missing", enabled: false }, { status: 503 });
    if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });
    const { data: trades } = await supabase
      .from("market_trades")
      .select("id, resource, price, quantity, buyer_world_id, seller_world_id, created_at")
      .eq("galaxy", galaxy)
      .order("created_at", { ascending: false })
      .limit(30);
    const { data: prices } = await supabase
      .from("market_prices")
      .select("resource, base_price, current_price")
      .eq("galaxy", galaxy)
      .order("resource", { ascending: true });
    const { data: history } = await supabase
      .from("market_price_history")
      .select("resource, price, created_at")
      .eq("galaxy", galaxy)
      .order("created_at", { ascending: true })
      .limit(300);
    return NextResponse.json({ enabled: true, me: me ?? null, orders: orders ?? [], trades: trades ?? [], prices: prices ?? [], history: history ?? [] });
  }

  let planets: { world_id: string }[] = [];
  if (!rooms || galaxy) {
    let list = supabase.from("planets").select(PUBLIC_COLUMNS).gte("updated_at", onlineSince).order("updated_at", { ascending: false }).limit(50);
    if (rooms) list = list.eq("galaxy", galaxy!);
    const { data, error } = await list;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    planets = (data ?? []).filter((p) => p.world_id !== worldId);
  }

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
  return NextResponse.json({ planets, actions, lastActionId, enabled: true, rooms, galaxy, max: 5 });
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

  if (action === "place_order" || action === "cancel_order") {
    if (!isUuid(String(body.worldId ?? "")) || !body.ownerToken) {
      return NextResponse.json({ error: "Missing planet or owner token" }, { status: 400 });
    }
    if (action === "place_order") {
      const side = String(body.side ?? "");
      const resource = String(body.resource ?? "");
      const price = Number(body.price);
      const quantity = Number(body.quantity);
      if (!["buy", "sell"].includes(side)) return NextResponse.json({ error: "Side must be buy or sell" }, { status: 400 });
      if (!["food", "wood", "stone", "metal", "gold", "herbs"].includes(resource)) return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
      if (!Number.isInteger(price) || price < 1 || price > 1000000000) return NextResponse.json({ error: "Invalid price" }, { status: 400 });
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
      const { data, error } = await supabase.rpc("place_market_order", {
        p_world_id: body.worldId,
        p_owner_token: body.ownerToken,
        p_side: side,
        p_resource: resource,
        p_price: price,
        p_quantity: quantity,
      });
      if (notMigrated(error)) return NextResponse.json({ error: "Galaxy migration not applied: order book tables are missing", enabled: false }, { status: 503 });
      if (error) return galaxyError(error, "place_market_order");
      return NextResponse.json(data);
    }
    const orderId = Number(body.orderId);
    if (!Number.isInteger(orderId) || orderId < 1) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    const { data, error } = await supabase.rpc("cancel_market_order", {
      p_world_id: body.worldId,
      p_owner_token: body.ownerToken,
      p_order_id: orderId,
    });
    if (notMigrated(error)) return NextResponse.json({ error: "Galaxy migration not applied: order book tables are missing", enabled: false }, { status: 503 });
    if (error) return galaxyError(error, "cancel_market_order");
    return NextResponse.json(data);
  }

  if (action === "sync") {
    const required = ["worldId", "ownerToken", "ownerName", "planetName", "planetType", "population", "villages", "output", "military", "resources"];
    const missing = required.filter((key) => body[key] === undefined || body[key] === null);
    if (missing.length) {
      return NextResponse.json({ error: `Missing sync fields: ${missing.join(", ")}` }, { status: 400 });
    }
    const args = {
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
    };
    const { data, error } = await supabase.rpc("sync_planet", args);
    if (error) return galaxyError(error, "sync_planet");
    return NextResponse.json({ planet: data });
  }

  if (action === "random_join") {
    if (!isUuid(String(body.worldId ?? "")) || !body.ownerToken) {
      return NextResponse.json({ error: "Missing planet or owner token" }, { status: 400 });
    }

    await supabase.rpc("galaxy_tidy");
    const { data: galaxies, error: galaxiesError } = await supabase.from("galaxies").select("code");
    if (galaxiesError) return galaxyError(galaxiesError, "random_join");

    let chosen: string | null = null;
    if (galaxies?.length) {
      const { data: members, error: membersError } = await supabase
        .from("planets")
        .select("galaxy")
        .in("galaxy", galaxies.map((galaxy) => galaxy.code));
      if (membersError) return galaxyError(membersError, "random_join");

      const counts = new Map<string, number>();
      for (const member of members ?? []) {
        if (!member.galaxy) continue;
        counts.set(member.galaxy, (counts.get(member.galaxy) ?? 0) + 1);
      }
      const available = galaxies
        .map((galaxy) => galaxy.code)
        .filter((code) => (counts.get(code) ?? 0) < 5);
      if (available.length) {
        chosen = available[Math.floor(Math.random() * available.length)];
      }
    }

    // When no room exists, generate a fresh five-digit code and create one.
    if (!chosen) {
      const existingCodes = new Set((galaxies ?? []).map((galaxy) => galaxy.code));
      do {
        chosen = String(10000 + Math.floor(Math.random() * 90000));
      } while (existingCodes.has(chosen));
    }

    const { data, error } = await supabase.rpc("join_galaxy", {
      p_world_id: body.worldId,
      p_owner_token: body.ownerToken,
      p_code: chosen,
    });
    if (notMigrated(error)) return NextResponse.json({ ok: false, reason: "not_migrated" }, { status: 503 });
    if (error) return galaxyError(error, "join_galaxy");
    return NextResponse.json(data);
  }

  // Join (or create, if nobody is using the code) a galaxy, or leave the one you're in.
  if (action === "join" || action === "leave") {
    if (!isUuid(String(body.worldId ?? "")) || !body.ownerToken) {
      return NextResponse.json({ error: "Missing planet or owner token" }, { status: 400 });
    }
    const { data, error } = action === "join"
      ? await supabase.rpc("join_galaxy", { p_world_id: body.worldId, p_owner_token: body.ownerToken, p_code: String(body.code ?? "") })
      : await supabase.rpc("leave_galaxy", { p_world_id: body.worldId, p_owner_token: body.ownerToken });
    if (notMigrated(error)) return NextResponse.json({ ok: false, reason: "not_migrated" }, { status: 503 });
    if (error) return galaxyError(error, action === "join" ? "join_galaxy" : "leave_galaxy");
    return NextResponse.json(data);
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
    // The galaxy_* versions (migration 003) also check both planets are in the same galaxy.
    let rpc = action === "trade" ? "galaxy_trade" : "galaxy_invade";
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
    let { data, error } = await supabase.rpc(rpc, params);
    if (notMigrated(error)) {
      rpc = action === "trade" ? "trade_planet" : "invade_planet";
      ({ data, error } = await supabase.rpc(rpc, params));
    }
    if (error) return galaxyError(error, rpc);
    return NextResponse.json({ message: data });
  }

  return NextResponse.json({ error: "Unknown galaxy action" }, { status: 400 });
}
