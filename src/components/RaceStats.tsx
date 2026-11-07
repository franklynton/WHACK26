// A race's strengths and weaknesses as stat bars, read straight from the numbers the
// sim uses (src/sim/races.ts), so the bars always match how the race really plays.
// Every number compares to humans: multipliers like ×1.3 mean 30% more than a human, and the
// score over each bar is out of 10 with humans at 5. Green is better than human, red is worse.
import { RACE, type Race, type RaceId } from "@/sim/races";
import type { Resources } from "@/types/world";

interface Stat {
  icon: string;
  label: string;
  score: number; // 0..1 along the bar
  better: number; // > 0 better than human, < 0 worse, 0 the same
  value: string; // e.g. "×2" or "43 yrs"
}

const clamp = (n: number) => Math.max(0.04, Math.min(1, n));
const times = (x: number) => `×${+x.toFixed(2)}`;
const HUMAN = 0.5; // where the human baseline sits on every bar

// Higher multiplier is better: map 1 to the middle and 2 (or 0.25) to the ends on a log scale.
const ratio = (x: number, range = 2) => clamp(HUMAN + Math.log(x) / Math.log(range) / 2);

export function raceStats(r: Race): Stat[] {
  const life = 55 + r.lifespan + 12; // average lifespan in years (sim adds 0-24)
  return [
    { icon: "⚔️", label: "War", score: ratio(r.fight), better: r.fight - 1, value: times(r.fight) },
    { icon: "👶", label: "Growth", score: ratio(r.births), better: r.births - 1, value: times(r.births) },
    { icon: "🚀", label: "Tech", score: ratio(r.tech, 10), better: r.tech - 1, value: r.tech >= 1 ? times(r.tech) : `${+(1 / r.tech).toFixed(1)}× slower` },
    { icon: "⏳", label: "Lifespan", score: clamp(HUMAN + r.lifespan / 60), better: r.lifespan, value: `${life} yrs` },
    { icon: "🙏", label: "Faith", score: ratio(1 / r.faithDecay, 2.5), better: 1 - r.faithDecay, value: r.faithDecay === 1 ? "normal" : `fades ${times(r.faithDecay)}` },
    { icon: "🏛️", label: "Stability", score: clamp(HUMAN + r.stability / 30), better: r.stability, value: r.stability ? `${r.stability > 0 ? "+" : ""}${r.stability}` : "±0" },
    { icon: "🍖", label: "Appetite", score: ratio(1 / r.appetite, 2), better: 1 - r.appetite, value: r.appetite === 1 ? "normal" : `eats ${times(r.appetite)}` },
    { icon: "🏃", label: "Speed", score: ratio(r.speed, 2), better: r.speed - 1, value: times(r.speed) },
  ];
}

const RES_ICON: Record<keyof Resources, string> = { food: "🌾", wood: "🪵", stone: "🪨", metal: "⚙️", gold: "🪙", herbs: "🌿" };

export default function RaceStats({ race, compact = false }: { race: RaceId; compact?: boolean }) {
  const r = RACE[race];
  const gather = (Object.entries(r.yield) as [keyof Resources, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <p className="text-[11px] text-white/45">Compared to humans: 5/10 and ×1 is human, the white line marks it.</p>
      {raceStats(r).map((s) => {
        const tone = s.better > 0 ? "bg-emerald-400" : s.better < 0 ? "bg-rose-400" : "bg-sky-300";
        const text = s.better > 0 ? "text-emerald-300" : s.better < 0 ? "text-rose-300" : "text-white/60";
        return (
          <div key={s.label} className="flex items-center gap-2 text-xs" title={`${s.label}: ${Math.round(s.score * 10)}/10, ${s.value} compared to a human (human = 5/10, ×1)`}>
            <span className="w-4 text-center">{s.icon}</span>
            <span className={`${compact ? "w-14" : "w-16"} shrink-0 text-white/70`}>{s.label}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${tone} opacity-80`} style={{ width: `${s.score * 100}%` }} />
              <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${HUMAN * 100}%` }} />
              {/* The score out of 10 (human = 5), printed over the bar */}
              <span className="absolute inset-y-0 left-1.5 flex items-center text-[11px] font-bold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
                {Math.round(s.score * 10)}/10
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
