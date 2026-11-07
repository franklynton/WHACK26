// The shared galaxy (track D), ported from Millennium Bug's lobby (src/lib/realtime.ts).
// With Supabase configured it is the `galaxy` Realtime channel: presence says which
// planets are online, broadcast carries first-contact events. Without Supabase, a
// BroadcastChannel stands in, so two tabs on one computer can still meet for testing.
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GalaxyEvent, GalaxyPlanet } from "@/types/world";
import { getSupabase } from "./supabase/client";

export interface GalaxyRoom {
  online: boolean; // true = Supabase (everyone), false = this computer only
  update: (me: GalaxyPlanet) => void; // our civ changed (name, attitude, needs)
  send: (event: GalaxyEvent) => void;
  leave: () => void;
}

export interface GalaxyHandlers {
  onPlanets: (planets: GalaxyPlanet[]) => void; // everyone else online
  onEvent: (event: GalaxyEvent) => void; // includes our own events, so both sides render the same way
}

const TOPIC = "galaxy";
const RECONNECT_MS = 1500;

// A stable spot on the map for each world, so every client draws it in the same place.
export function positionFor(worldId: string) {
  let h = 2166136261;
  for (const ch of worldId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const x = ((h >>> 0) % 1000) / 1000;
  const y = ((Math.imul(h, 2654435761) >>> 0) % 1000) / 1000;
  return { x: 0.1 + x * 0.8, y: 0.15 + y * 0.7 };
}

// supabase.channel() hands back an existing channel for the same topic while it is
// still being removed, so each join waits for the previous one to finish leaving
// (the same fix as the Millennium Bug lobby; React's double mount in dev triggers it).
let channelFreed: Promise<unknown> = Promise.resolve();

export function joinGalaxy(me: GalaxyPlanet, handlers: GalaxyHandlers): GalaxyRoom {
  const supabase = getSupabase();
  if (!supabase) return joinLocal(me, handlers);

  let identity = me;
  let channel: RealtimeChannel | null = null;
  let left = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const outbox: GalaxyEvent[] = []; // sent before the channel had joined

  // Always rebuild the whole list from presence state, so a missed join or leave can't stick.
  const syncPlanets = () => {
    const state = channel?.presenceState<GalaxyPlanet>() ?? {};
    handlers.onPlanets(
      Object.values(state)
        .map((entries) => entries[entries.length - 1])
        .filter((p) => p?.worldId && p.worldId !== identity.worldId)
        .map((p) => ({ worldId: p.worldId, ownerName: p.ownerName, civ: p.civ, position: p.position })),
    );
  };

  const connect = () => {
    channelFreed = channelFreed
      .catch(() => {})
      .then(() => {
        if (left) return;
        // self: true echoes our own broadcasts back, so the starter renders a contact
        // through exactly the same code path as the other player.
        const ch = supabase.channel(TOPIC, { config: { presence: { key: identity.worldId }, broadcast: { self: true } } });
        channel = ch;
        ch.on("presence", { event: "sync" }, syncPlanets)
          .on("presence", { event: "join" }, syncPlanets)
          .on("presence", { event: "leave" }, syncPlanets)
          .on("broadcast", { event: "galaxy" }, ({ payload }) => handlers.onEvent(payload as GalaxyEvent))
          .subscribe((status) => {
            if (channel !== ch) return;
            if (status === "SUBSCRIBED") {
              ch.track(identity);
              syncPlanets();
              outbox.splice(0).forEach((e) => ch.send({ type: "broadcast", event: "galaxy", payload: e }));
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              reconnect();
            }
          });
      })
      .catch(reconnect);
  };

  const reconnect = () => {
    if (left || retry) return;
    retry = setTimeout(() => {
      retry = null;
      if (left) return;
      const old = channel;
      channel = null;
      if (old) channelFreed = supabase.removeChannel(old);
      connect();
    }, RECONNECT_MS);
  };

  // A backgrounded tab's socket often dies quietly; check on the way back.
  const onVisible = () => {
    if (left || document.visibilityState !== "visible" || !channel) return;
    if (channel.state === "joined" && supabase.realtime.isConnected()) channel.track(identity);
    else if (channel.state !== "joining") reconnect();
  };
  document.addEventListener("visibilitychange", onVisible);

  connect();

  return {
    online: true,
    update: (planet) => {
      identity = planet;
      if (channel?.state === "joined") channel.track(identity);
    },
    send: (event) => {
      if (channel?.state === "joined") channel.send({ type: "broadcast", event: "galaxy", payload: event });
      else outbox.push(event);
    },
    leave: () => {
      left = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      const old = channel;
      channel = null;
      if (old) channelFreed = supabase.removeChannel(old);
    },
  };
}

// Same-computer fallback: tabs say hello on a heartbeat and forget tabs that go quiet.
const BEAT_MS = 2000;
const STALE_MS = 6000;

function joinLocal(me: GalaxyPlanet, handlers: GalaxyHandlers): GalaxyRoom {
  const bc = new BroadcastChannel("petri-galaxy");
  const planets = new Map<string, { planet: GalaxyPlanet; seen: number }>();
  let identity = me;
  const emit = () => handlers.onPlanets([...planets.values()].map((p) => p.planet));

  bc.onmessage = ({ data }) => {
    if (data.kind === "presence") {
      if (data.planet.worldId === identity.worldId) return;
      const isNew = !planets.has(data.planet.worldId);
      planets.set(data.planet.worldId, { planet: data.planet, seen: Date.now() });
      if (isNew) bc.postMessage({ kind: "presence", planet: identity }); // say hi back
      emit();
    } else if (data.kind === "leave") {
      planets.delete(data.worldId);
      emit();
    } else if (data.kind === "event") {
      handlers.onEvent(data.event);
    }
  };

  const timer = setInterval(() => {
    bc.postMessage({ kind: "presence", planet: identity });
    for (const [id, p] of planets) if (Date.now() - p.seen > STALE_MS) planets.delete(id);
    emit();
  }, BEAT_MS);
  bc.postMessage({ kind: "presence", planet: identity });

  return {
    online: false,
    update: (planet) => {
      identity = planet;
      bc.postMessage({ kind: "presence", planet });
    },
    send: (event) => {
      bc.postMessage({ kind: "event", event });
      handlers.onEvent(event); // BroadcastChannel doesn't echo to the sender
    },
    leave: () => {
      clearInterval(timer);
      bc.postMessage({ kind: "leave", worldId: identity.worldId });
      bc.close();
    },
  };
}
