"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChronicleEntry } from "@/types/world";

const KIND_LABEL: Record<string, string> = {
  genesis: "Genesis",
  village: "Settlement",
  milestone: "Milestone",
  disaster: "Disaster",
  famine: "Famine",
  revolution: "Revolution",
  cult: "Cult",
  war: "War",
  peace: "Peace",
  diplomacy: "Diplomacy",
  extinct: "Extinction",
  fallen: "Fallen",
  mind: "People's mind",
  contact: "Contact",
  captured: "Captured",
};

export default function ChronicleBook({
  entries,
  busy,
  nationColors,
  onClose,
}: {
  entries: (ChronicleEntry & { nation?: number })[];
  busy: "" | "narrating" | "thinking";
  nationColors: { name: string; color: string }[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...entries].reverse().filter((entry) => {
      if (!term) return true;
      const nation = entry.nation != null ? nationColors[entry.nation]?.name ?? "" : "";
      const kind = KIND_LABEL[entry.kind] ?? entry.kind;
      return `${entry.text} ${nation} ${kind} Year ${Math.floor(entry.year)}`
        .toLowerCase()
        .includes(term);
    });
  }, [entries, nationColors, query]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#080b14]/75 p-4 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Chronicle"
    >
      <section
        className="glass flex h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-[1180px] flex-col overflow-hidden rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-sky-200/50">The world remembers</p>
            <h2 className="mt-1 font-serif text-3xl font-semibold text-white/95">Chronicle</h2>
          </div>
          <div className="flex items-center gap-3">
            {busy === "narrating" && (
              <span className="text-xs text-amber-200/60 animate-pulse">Writing new history…</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-white/55 transition hover:bg-white/10 hover:text-white"
              aria-label="Close Chronicle"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-3">
          <p className="text-xs text-white/40">
            {filtered.length} {filtered.length === 1 ? "record" : "records"}
          </p>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the Chronicle"
            className="w-72 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-sky-300/40"
          />
        </div>

        <div className="subtle-scrollbar flex-1 overflow-y-auto px-6 py-2">
          {!filtered.length ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-white/35">
              {entries.length ? "No records match your search." : "No history has been written yet."}
            </div>
          ) : (
            <ol className="divide-y divide-white/[0.07]">
              {filtered.map((entry, index) => {
                const nation = entry.nation != null ? nationColors[entry.nation] : undefined;
                return (
                  <li key={`${entry.year}-${index}-${entry.text}`} className="grid grid-cols-[7rem_1fr] gap-5 py-5">
                    <div className="border-r border-white/[0.08] pr-5 text-right">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Year</p>
                      <p className="mt-1 font-serif text-2xl text-sky-200/80">{Math.floor(entry.year)}</p>
                    </div>
                    <article className="min-w-0">
                      <div className="mb-2 flex items-center gap-2">
                        {nation && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: nation.color }}
                          />
                        )}
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
                          {nation?.name ?? KIND_LABEL[entry.kind] ?? entry.kind}
                        </p>
                        {nation && (
                          <span className="text-[10px] uppercase tracking-[0.12em] text-white/25">
                            · {KIND_LABEL[entry.kind] ?? entry.kind}
                          </span>
                        )}
                      </div>
                      <p className="max-w-3xl font-serif text-[18px] leading-[1.55] text-white/85">
                        {entry.text}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
