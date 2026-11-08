"use client";

import type { RefObject } from "react";
import type { GalaxyStatus } from "./Galaxy";
import Portrait, { type Mood } from "./Portrait";
import { SettingsPopover } from "./GamePanels";
import { ERAS, RACE } from "@/sim/races";
import type { ChronicleEntry, Civ, NationInfo, Needs, Policy } from "@/types/world";

export const cap = (value: string) => value[0].toUpperCase() + value.slice(1);

const POLICY_LABEL: Record<Policy, string> = {
  settle: "Settling down",
  expand: "Expanding",
  farm: "Farming",
  worship: "Worshipping you",
  explore: "Exploring",
  hoard: "Hoarding",
  rebel: "Rebelling",
};

function NeedBars({ needs, love }: { needs: Needs; love?: number }) {
  const bars: [string, number][] = [
    ["Food", needs.food],
    ["Stability", needs.stability],
    ...(love != null ? [["Love for you", love] as [string, number]] : []),
  ];
  return (
    <div className="mt-1 mb-4 space-y-2.5 border-t border-white/10 pt-2">
      {bars.map(([name, value]) => (
        <div key={name}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="hud-meta-label text-white/65">{name}</span>
            <span className="text-[11px] font-semibold tabular-nums text-white/65">
              {Math.round(value)}
            </span>
          </div>
          <div className="h-1 rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all ${value < 25 ? "bg-rose-400" : "bg-sky-300"}`}
              style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GameRightPanel({
  nation,
  civ,
  mood,
  reason,
  settingsOpen,
  settingsRef,
  onSettingsToggle,
  onSettingsClose,
  demo,
  onNewPlanet,
  onGalaxy,
  muted,
  onMute,
  link,
  spacefaring,
  onOpenGalaxy,
  chronicle,
  busy,
  onOpenChronicle,
}: {
  nation: NationInfo;
  civ: Civ | null;
  mood: Mood;
  reason?: string;
  settingsOpen: boolean;
  settingsRef: RefObject<HTMLDivElement | null>;
  onSettingsToggle: () => void;
  onSettingsClose: () => void;
  demo?: boolean;
  onNewPlanet?: () => void;
  onGalaxy: () => void;
  muted: boolean;
  onMute: () => void;
  link: GalaxyStatus;
  spacefaring: boolean;
  onOpenGalaxy: (view: "join" | "invade" | "market" | "offers") => void;
  chronicle: (ChronicleEntry & { nation?: number })[];
  busy: "" | "narrating" | "thinking";
  onOpenChronicle: () => void;
}) {
  return (
    <aside className="glass subtle-scrollbar absolute bottom-4 right-4 top-4 flex w-72 flex-col p-4">
      <div className="mb-3 space-y-2 border-b border-white/10 pb-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: nation.color }} />
            <p className="truncate text-lg font-semibold">{cap(nation.name)}</p>
          </div>
          <SettingsPopover
            open={settingsOpen}
            onToggle={onSettingsToggle}
            panelRef={settingsRef}
            onClose={onSettingsClose}
            demo={demo}
            onNewPlanet={onNewPlanet}
            onGalaxy={onGalaxy}
            muted={muted}
            onMute={onMute}
            link={link}
          />
        </div>
        <div className={`flex w-full items-center gap-3 rounded-xl bg-white/5 p-2 text-left ${nation.alive ? "" : "opacity-40"}`}>
          <span className="shrink-0 overflow-hidden rounded-lg">
            <Portrait race={nation.race} seed={nation.leader.seed} color={nation.color} mood={mood} size={52} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {nation.leader.title} {nation.leader.name}
            </span>
            <span className="block text-xs text-white/55">
              {RACE[nation.race].icon} {RACE[nation.race].name} · {ERAS[nation.era]}
            </span>
          </span>
        </div>
        <NeedBars needs={nation.needs} love={nation.love} />
        {civ ? (
          <>
            <div className="hud-meta-row">
              <span className="hud-meta-label">Crisis</span>
              <span className={`hud-meta-value ${nation.crisis ? "!text-rose-300" : "text-white/45"}`}>
                {nation.crisis ? cap(nation.crisis) : "None"}
              </span>
            </div>
            <div className="hud-meta-row">
              <span className="hud-meta-label">Focus</span>
              <span className={`hud-meta-value ${nation.policy === "rebel" ? "text-rose-300" : ""}`}>
                {POLICY_LABEL[nation.policy]}
              </span>
              {reason && <span className="hud-meta-note">{reason}</span>}
            </div>
            <div className="hud-meta-row">
              <span className="hud-meta-label">Faith</span>
              <span className="hud-meta-value">{civ.religion.name}</span>
            </div>
            <div className="hud-meta-row">
              <span className="hud-meta-label">Their belief</span>
              <span className="hud-meta-note text-white/70">
                They call you <b>{civ.religion.godName}</b>. {civ.religion.belief}
              </span>
            </div>
            <div className="hud-meta-row">
              <span className="hud-meta-label">Attitude</span>
              <span className={`hud-meta-value ${civ.attitude === "hostile" || civ.attitude === "resentful" ? "text-rose-300" : ""}`}>
                {cap(civ.attitude)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-white/50">{nation.alive ? "They do not know you yet." : "This nation is gone."}</p>
        )}
      </div>

      <div className="mb-4 border-b border-white/10 pb-4">
        <p className="label mb-2">Galaxy</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["invade", "", "Invade", "Launch an attack"],
            ["market", "", "Market", "Trade resources"],
            ["offers", "", "Offers", "Swap with a god"],
          ] as const).map(([view, icon, label, action]) => {
            const disabled = view === "invade" ? false : !link.galaxy;
            const className =
              view === "invade"
                ? "group rounded-lg border border-rose-300/15 bg-rose-400/10 px-3 py-3 text-left text-rose-100 transition hover:border-rose-300/30 hover:bg-rose-400/20"
                : view === "market"
                  ? "group rounded-lg border border-amber-300/15 bg-amber-400/10 px-3 py-3 text-left transition hover:border-amber-300/30 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/30"
                  : "group rounded-lg border border-sky-300/15 bg-sky-400/10 px-3 py-3 text-left transition hover:border-sky-300/30 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/30";
            return (
              <button
                key={view}
                disabled={disabled}
                onClick={() => onOpenGalaxy(view)}
                className={className}
                title={
                  !link.galaxy
                    ? view === "invade"
                      ? "Join a galaxy to invade"
                      : view === "market"
                        ? "Join a galaxy to use the market"
                        : "Join a galaxy to trade with other gods"
                    : view === "invade"
                      ? !spacefaring
                        ? "Reach the Space Age to invade"
                        : "Choose a planet to invade"
                      : view === "market"
                        ? "Open the galaxy market"
                        : "Offer a swap to another god"
                }
              >
                {icon && <span className="block text-lg">{icon}</span>}
                <span className="mt-1 block text-sm font-semibold">{label}</span>
                <span className="block text-[10px] text-current opacity-60">
                  {!link.galaxy ? "Join a galaxy first" : view === "invade" && !spacefaring ? "Space Age required" : action}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => onOpenGalaxy("join")}
          className={`mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${link.galaxy ? "bg-indigo-400/15 text-indigo-100 hover:bg-indigo-400/25" : "bg-indigo-400/30 text-white hover:bg-indigo-400/40"}`}
        >
          {link.galaxy ? `Galaxy ${link.galaxy} · Manage` : "Join a galaxy"}
        </button>
      </div>

      <div className="mt-auto flex min-h-0 flex-1 flex-col border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={onOpenChronicle}
          className="group -mx-1 flex shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-sky-200/30 hover:bg-sky-200/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/50"
        >
          <span>
            <span className="label block">Chronicle Book</span>
            <span className="mt-1 block text-xs text-white/55">
              {chronicle.length ? "Recent events from your world" : "The story of this world will appear here."}
            </span>
          </span>
        </button>
        <div className="subtle-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/5 bg-black/10 px-2">
          {chronicle.length ? (
            <div className="divide-y divide-white/[0.07]">
              {[...chronicle].reverse().slice(0, 6).map((entry, index) => (
                <button
                  key={`${entry.year}-${index}-${entry.text}`}
                  type="button"
                  onClick={onOpenChronicle}
                  className="block w-full py-2 text-left transition hover:text-white"
                >
                  <span className="block text-[10px] uppercase tracking-wider text-sky-200/55">
                    Year {Math.floor(entry.year)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-white/65">{entry.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-3 text-xs leading-relaxed text-white/40">
              New events will be recorded here as your nations settle, worship, and struggle.
            </p>
          )}
        </div>
        {busy === "narrating" && (
          <span className="mt-1 block shrink-0 text-right text-[10px] uppercase tracking-wider text-amber-200/60 animate-pulse">Writing…</span>
        )}
      </div>
    </aside>
  );
}
