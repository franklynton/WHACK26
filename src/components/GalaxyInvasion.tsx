"use client";

export interface InvasionPlanet {
  world_id: string;
  owner_name: string;
  planet_name: string;
  planet_type: string;
  population: number;
  output: number;
  military: number;
}

export function GalaxyInvasion({
  enabled,
  alone,
  galaxy,
  planets,
  spacefaring,
  onInvade,
}: {
  enabled: boolean | null;
  alone: boolean;
  galaxy: string | null;
  planets: InvasionPlanet[];
  spacefaring: boolean;
  onInvade: (target: string) => Promise<void>;
}) {
  if (enabled && !alone && planets.length === 0) {
    return (
      <p className="text-sm text-white/50">
        You&apos;re the only god here{galaxy ? `. Share the code ${galaxy} so others can join` : ""}.
      </p>
    );
  }
  if (!enabled || alone || planets.length === 0) return null;
  return (
    <>
      {!spacefaring && <p className="mb-2 text-xs text-white/45">Invading unlocks when your people reach the Space Age.</p>}
      <div className="space-y-2">
        {planets.map((planet) => (
          <article key={planet.world_id} className="rounded-lg bg-white/5 p-3">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-semibold">{planet.planet_name}</p>
                <p className="text-xs text-white/50">{planet.planet_type} · god: {planet.owner_name}</p>
              </div>
              <span className="text-xs text-white/50">⚔ {planet.military}</span>
            </div>
            <p className="mt-1 text-xs text-white/60">{planet.population} people · {planet.output}/yr</p>
            <div className="mt-2 flex gap-2">
              <button
                disabled={!spacefaring}
                onClick={() => void onInvade(planet.world_id)}
                className="flex-1 rounded bg-rose-400/15 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-400/25 disabled:opacity-40"
              >
                Invade
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
