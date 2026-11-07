// Hand-drawn SVG portrait of a nation's leader. One base face per race, varied by the
// leader's seed (skin, hair, headwear) and dressed in the nation's colour. The planet
// itself stays as tiny dots; this is the only close-up of a character in the game.
import type { RaceId } from "@/sim/races";
import { RACE } from "@/sim/races";

export type Mood = "pleased" | "angry" | "afraid" | "defiant" | "scheming";

const HAIR = ["#2b1d14", "#6b3e1f", "#b7742f", "#d9c27a", "#8c8c8c", "#e9e4d8", "#3a2a4a"];

export default function Portrait({ race, seed, color, mood = "pleased", size = 200 }: { race: RaceId; seed: number; color: string; mood?: Mood; size?: number }) {
  const r = RACE[race];
  const skin = r.skin[seed % r.skin.length];
  const hair = race === "elf" ? ["#f3e6b0", "#e9e4d8", "#c9d6ff", "#d9c27a"][seed % 4] : HAIR[(seed >> 3) % HAIR.length];
  const variant = (seed >> 6) % 3;
  const id = `p${race}${seed}`;
  // Eyebrow tilt shows the mood: angry and defiant slope inwards, afraid slopes up.
  const brow = mood === "angry" || mood === "defiant" ? 7 : mood === "afraid" ? -6 : mood === "scheming" ? 3 : 0;
  const shade = "rgba(0,0,0,0.18)";

  return (
    <svg viewBox="0 0 200 220" width={size} height={(size * 220) / 200} role="img" aria-label={`${r.name} leader`}>
      <defs>
        <radialGradient id={`${id}bg`} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor="#05060f" stopOpacity="1" />
        </radialGradient>
        <linearGradient id={`${id}robe`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#0b0b18" />
        </linearGradient>
      </defs>
      <rect width="200" height="220" rx="18" fill={`url(#${id}bg)`} />

      {/* Back hair (long styles) */}
      {race === "elf" && <path d="M52 92 Q48 170 70 206 L130 206 Q152 170 148 92 Q100 60 52 92Z" fill={hair} />}
      {race === "human" && variant === 1 && <path d="M60 90 Q54 160 66 196 L134 196 Q146 160 140 90Z" fill={hair} />}

      {/* Shoulders and robe in the nation's colour */}
      <path d="M22 220 Q30 168 100 160 Q170 168 178 220Z" fill={`url(#${id}robe)`} />
      <path d="M78 164 L100 192 L122 164" fill="none" stroke="#ffd447" strokeWidth="3" opacity="0.8" />
      <rect x="86" y="140" width="28" height="28" rx="6" fill={skin} />
      <rect x="86" y="140" width="28" height="10" fill={shade} />

      {/* Ears */}
      {race === "goblin" && (
        <>
          <path d="M58 104 L6 78 L56 124Z" fill={skin} stroke={shade} strokeWidth="2" />
          <path d="M142 104 L194 78 L144 124Z" fill={skin} stroke={shade} strokeWidth="2" />
        </>
      )}
      {race === "elf" && (
        <>
          <path d="M60 104 L34 58 L62 118Z" fill={skin} stroke={shade} strokeWidth="2" />
          <path d="M140 104 L166 58 L138 118Z" fill={skin} stroke={shade} strokeWidth="2" />
        </>
      )}
      {(race === "human" || race === "dwarf") && (
        <>
          <ellipse cx="60" cy="108" rx="8" ry="13" fill={skin} />
          <ellipse cx="140" cy="108" rx="8" ry="13" fill={skin} />
        </>
      )}
      {race === "lizardfolk" && (
        <>
          <path d="M58 92 L26 74 L40 100 L22 104 L58 116Z" fill={["#d94f4f", "#e0a43a", "#3f7fd9"][variant]} opacity="0.9" />
          <path d="M142 92 L174 74 L160 100 L178 104 L142 116Z" fill={["#d94f4f", "#e0a43a", "#3f7fd9"][variant]} opacity="0.9" />
        </>
      )}

      {/* Head */}
      {race === "lizardfolk" ? (
        <path d="M62 80 Q100 40 138 80 Q146 118 132 138 Q118 156 100 156 Q82 156 68 138 Q54 118 62 80Z" fill={skin} />
      ) : (
        <ellipse cx="100" cy="106" rx={race === "goblin" ? 44 : race === "dwarf" ? 42 : 38} ry={race === "elf" ? 50 : 46} fill={skin} />
      )}
      {race === "lizardfolk" && (
        // Scales
        <g fill={shade}>
          {[[84, 70], [100, 64], [116, 70], [76, 86], [124, 86], [92, 80], [108, 80]].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="4" />
          ))}
        </g>
      )}

      {/* Eyes */}
      <Eyes race={race} brow={brow} hair={hair} />

      {/* Nose */}
      {race === "goblin" && <path d="M100 104 Q124 132 102 138 Q96 132 100 104Z" fill={skin} stroke={shade} strokeWidth="2" />}
      {race === "dwarf" && <ellipse cx="100" cy="122" rx="11" ry="9" fill={skin} stroke={shade} strokeWidth="2" />}
      {(race === "human" || race === "elf") && <path d="M100 106 L95 124 L102 125" fill="none" stroke={shade} strokeWidth="2.5" strokeLinecap="round" />}
      {race === "lizardfolk" && (
        <>
          <circle cx="93" cy="124" r="2" fill="#1b1b1b" />
          <circle cx="107" cy="124" r="2" fill="#1b1b1b" />
        </>
      )}

      {/* Mouth */}
      <Mouth race={race} mood={mood} />

      {/* Dwarf beard over the mouth area and chest */}
      {race === "dwarf" && (
        <g>
          <path d="M60 116 Q62 196 100 214 Q138 196 140 116 Q128 140 100 140 Q72 140 60 116Z" fill={hair} />
          <path d="M84 132 Q100 126 116 132" fill="none" stroke={skin} strokeWidth="6" strokeLinecap="round" />
          <path d="M92 170 L92 206 M108 170 L108 206" stroke="#ffd447" strokeWidth="4" strokeDasharray="5 5" />
        </g>
      )}

      {/* Front hair */}
      {race === "human" && (
        <path d={variant === 2 ? "M62 96 Q70 52 100 52 Q130 52 138 96 Q120 74 100 72 Q80 74 62 96Z" : "M62 100 Q64 54 100 54 Q136 54 138 100 Q128 76 108 70 Q86 80 62 100Z"} fill={hair} />
      )}
      {race === "elf" && <path d="M62 100 Q66 52 100 52 Q134 52 138 100 Q120 64 100 66 Q80 64 62 100Z" fill={hair} />}
      {race === "dwarf" && <path d="M58 100 Q60 58 100 58 Q140 58 142 100 Q126 80 100 80 Q74 80 58 100Z" fill={hair} />}
      {race === "goblin" && (
        <path d="M84 62 Q80 44 72 40 M100 60 Q100 40 96 32 M116 62 Q122 44 130 42" fill="none" stroke={hair} strokeWidth="3" strokeLinecap="round" />
      )}

      {/* Headwear: every leader wears something that marks their rank */}
      <Headwear race={race} variant={variant} color={color} />
    </svg>
  );
}

function Eyes({ race, brow, hair }: { race: RaceId; brow: number; hair: string }) {
  const y = race === "lizardfolk" ? 98 : 100;
  const dx = race === "goblin" ? 20 : 17;
  const iris = race === "goblin" ? "#ffcf33" : race === "lizardfolk" ? "#e8d13a" : race === "elf" ? "#6fd3ff" : race === "dwarf" ? "#5a3b22" : "#3b6ea8";
  const slit = race === "goblin" || race === "lizardfolk";
  return (
    <g>
      {[-1, 1].map((s) => (
        <g key={s}>
          <ellipse cx={100 + s * dx} cy={y} rx={race === "elf" ? 9 : 8} ry={race === "elf" ? 5 : 6.5} fill={slit ? iris : "#fbfbf7"} />
          {slit ? <ellipse cx={100 + s * dx} cy={y} rx="1.8" ry="5.5" fill="#111" /> : <circle cx={100 + s * dx} cy={y} r="4" fill={iris} />}
          {!slit && <circle cx={100 + s * dx} cy={y} r="1.8" fill="#111" />}
          <circle cx={100 + s * dx + 2} cy={y - 2} r="1.2" fill="#fff" opacity="0.8" />
          {/* Brows tilt with mood */}
          {race !== "lizardfolk" && (
            <path
              d={`M${100 + s * (dx - 9)} ${y - 11 + brow} L${100 + s * (dx + 10)} ${y - 12 - brow * 0.4}`}
              stroke={race === "goblin" ? "#2b3a1a" : hair}
              strokeWidth={race === "dwarf" ? 6 : 3.5}
              strokeLinecap="round"
            />
          )}
        </g>
      ))}
    </g>
  );
}

function Mouth({ race, mood }: { race: RaceId; mood: Mood }) {
  const y = race === "lizardfolk" ? 138 : 136;
  const happy = mood === "pleased" || mood === "scheming";
  const curve = happy ? 8 : mood === "afraid" ? -4 : -6;
  if (race === "goblin") {
    return (
      <g>
        <path d={`M76 ${y} Q100 ${y + 12 + curve} 124 ${y}`} fill="#3a1414" stroke="#2b1010" strokeWidth="2" />
        <path d={`M84 ${y + 1} L88 ${y + 8} L92 ${y + 2} M108 ${y + 2} L112 ${y + 8} L116 ${y + 1}`} fill="#f6f1dc" />
      </g>
    );
  }
  if (race === "lizardfolk") return <path d={`M72 ${y} Q100 ${y + curve * 0.4} 128 ${y}`} fill="none" stroke="#1b1b1b" strokeWidth="2.5" strokeLinecap="round" />;
  return <path d={`M88 ${y} Q100 ${y + curve} 112 ${y}`} fill="none" stroke="#6b2b2b" strokeWidth="3" strokeLinecap="round" />;
}

function Headwear({ race, variant, color }: { race: RaceId; variant: number; color: string }) {
  const gold = "#ffd447";
  if (race === "human") {
    if (variant === 0) return <path d="M66 66 L74 38 L87 58 L100 32 L113 58 L126 38 L134 66Z" fill={gold} stroke="#b8902a" strokeWidth="2" />;
    if (variant === 1) return <path d="M64 70 Q100 54 136 70 L136 62 Q100 46 64 62Z" fill={gold} />;
    return (
      <g>
        <path d="M66 66 L134 66 L128 44 L72 44Z" fill={color} stroke={gold} strokeWidth="3" />
        <circle cx="100" cy="54" r="5" fill={gold} />
      </g>
    );
  }
  if (race === "elf")
    return (
      <g>
        <path d="M64 74 Q100 56 136 74" fill="none" stroke={gold} strokeWidth="3" />
        <path d="M100 62 L94 74 L100 84 L106 74Z" fill={variant === 0 ? "#6fd3ff" : variant === 1 ? "#a7ff9a" : "#e7a6ff"} stroke={gold} strokeWidth="1.5" />
      </g>
    );
  if (race === "dwarf")
    return (
      <g>
        <path d="M56 82 Q56 36 100 34 Q144 36 144 82Z" fill="#8f98a8" stroke="#5c6474" strokeWidth="3" />
        <rect x="54" y="76" width="92" height="10" rx="4" fill={gold} />
        {variant !== 2 && (
          <>
            <path d="M60 56 Q34 40 38 14 Q48 38 66 46Z" fill="#efe6cf" />
            <path d="M140 56 Q166 40 162 14 Q152 38 134 46Z" fill="#efe6cf" />
          </>
        )}
      </g>
    );
  if (race === "goblin")
    return (
      <g>
        <path d="M64 70 L70 40 L80 62 L88 30 L98 60 L108 34 L116 60 L128 38 L136 70Z" fill="#e9e1c6" stroke="#8a7f5e" strokeWidth="2" />
        {variant === 1 && <circle cx="98" cy="60" r="5" fill="#ff3b3b" />}
      </g>
    );
  // Lizardfolk: a sun disc headdress
  return (
    <g>
      <circle cx="100" cy="44" r={variant === 2 ? 22 : 18} fill="none" stroke={gold} strokeWidth="4" />
      <circle cx="100" cy="44" r="8" fill={gold} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1={100 + Math.cos((a * Math.PI) / 180) * 22} y1={44 + Math.sin((a * Math.PI) / 180) * 22} x2={100 + Math.cos((a * Math.PI) / 180) * 30} y2={44 + Math.sin((a * Math.PI) / 180) * 30} stroke={gold} strokeWidth="3" />
      ))}
    </g>
  );
}
