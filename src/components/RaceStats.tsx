// A race's strengths and weaknesses as stat bars, read straight from the numbers the
// sim uses (src/sim/races.ts), so the bars always match how the race really plays.
// Every number compares to humans: multipliers like ×1.3 mean 30% more than a human, and the
// score over each bar is 50 × that multiplier (out of 100), so humans are 50. Green is better than human, red is worse.
import { RACE, type Race, type RaceId } from "@/sim/races";
import type { Resources } from "@/types/world";

interface Stat {
  icon: string;
  label: string;
  score: number; // 0..100, humans are 50
  better: number; // > 0 better than human, < 0 worse, 0 the same
  value: string; // e.g. "×2" or "43 yrs"
}

const times = (x: number) => `×${+x.toFixed(2)}`;
const HUMAN = 50; // humans score 50/100 on every stat

// Proportional to humans: score = 50 × (race ÷ human), capped at 100. So ×2 is 100, ×0.1 is 5.
// For appetite, where eating less is better, the ratio is flipped first.
// (No faith bar: faith no longer decays in the sim, so the race's faith multiplier has no effect.)
const score = (ratio: number) => Math.max(0, Math.min(100, Math.round(HUMAN * ratio + 1e-9)));

const HUMAN_LIFE = 55 + 12; // average human lifespan in years (the sim adds 0-24 at random)

export function raceStats(r: Race): Stat[] {
  const life = HUMAN_LIFE + r.lifespan;
  const stability = 50 + r.stability; // a nation's stability target starts near 50
  return [
    { icon: "⚔️", label: "War", score: score(r.fight), better: r.fight - 1, value: times(r.fight) },
    { icon: "👶", label: "Growth", score: score(r.births), better: r.births - 1, value: times(r.births) },
    { icon: "🚀", label: "Tech", score: score(r.tech), better: r.tech - 1, value: times(r.tech) },
    { icon: "⏳", label: "Lifespan", score: score(life / HUMAN_LIFE), better: r.lifespan, value: `${life} yrs` },
    { icon: "🏛️", label: "Stability", score: score(stability / 50), better: r.stability, value: r.stability ? `${r.stability > 0 ? "+" : ""}${r.stability}` : "±0" },
    { icon: "🍖", label: "Appetite", score: score(1 / r.appetite), better: 1 - r.appetite, value: `eats ${times(r.appetite)}` },
    { icon: "🏃", label: "Speed", score: score(r.speed), better: r.speed - 1, value: times(r.speed) },
  ];
}

const RES_ICON: Record<keyof Resources, string> = { food: "🌾", wood: "🪵", stone: "🪨", metal: "⚙️", gold: "💰", herbs: "🌿" };

export default function RaceStats({ race, compact = false }: { race: RaceId; compact?: boolean }) {
  const r = RACE[race];
  const gather = (Object.entries(r.yield) as [keyof Resources, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {!compact && <p className="text-[11px] text-white/45">Compared to humans: a human is 50/100 and ×1 (the white line). Score = 50 × the multiplier.</p>}
      {raceStats(r).map((s) => {
        const tone = s.better > 0 ? "bg-emerald-400" : s.better < 0 ? "bg-rose-400" : "bg-sky-300";
        const text = s.better > 0 ? "text-emerald-300" : s.better < 0 ? "text-rose-300" : "text-white/60";
        return (
          <div key={s.label} className="flex items-center gap-2 text-xs" title={`${s.label}: ${s.score}/100, ${s.value} compared to a human (human = 50/100, ×1)`}>
            <span className="w-4 text-center">{s.icon}</span>
            <span className={`${compact ? "w-14" : "w-16"} shrink-0 text-white/70`}>{s.label}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${tone} opacity-80`} style={{ width: `${Math.max(2, s.score)}%` }} />
              <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${HUMAN}%` }} />
              {/* The score out of 10 (human = 5), printed over the bar */}
              <span className="absolute inset-y-0 left-1.5 flex items-center text-[11px] font-bold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
                {s.score}/100
              </span>
            </div>
            <span className={`${compact ? "w-[4.5rem]" : "w-20"} shrink-0 text-right tabular-nums ${text}`}>{s.value}</span>
          </div>
        );
      })}
      {gather.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {gather.map(([res, x]) => (
            <span key={res} className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${x > 1 ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
              {RES_ICON[res]} {res} {times(x)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
