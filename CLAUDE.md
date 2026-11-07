# CLAUDE.md

## Project
WHACK26 hackathon, 23.5 hours, team of 4. **Petri**: instead of a pet, you tend a pocket-sized planet. Its tiny civilisation is narrated by an LLM: it invents its own name, language, religion about you, myths and laws, and reacts to what you do (flood, raise mountains, drought, miracles). Needs decay (food, faith, stability); neglect causes famine, revolution, or a cult that decides you're evil.
**Multiplayer feature:** a shared galaxy over Supabase Realtime. When two players' civilisations meet, two LLMs negotiate, misunderstand, trade or go to war, and neither player fully controls it.
Optimise for a working, impressive live demo over completeness.

## Stack
- Next.js (App Router) + TypeScript + Tailwind CSS 4
- react-three-fiber + drei for the 3D low-poly planet
- Supabase Realtime (presence + broadcast) for the galaxy, same pattern as Millennium Bug's lobby
- OpenRouter, called only from route handlers (`/api/*`). The key never reaches the browser.
- Deploy: Vercel

## Shared contracts (change together, tell the team)
- `src/types/world.ts`: the world-state schema everyone reads and writes.
- The planet has 12 regions (ids 0-11), one per icosahedron vertex.
- `src/lib/sim.ts` functions are pure: world in, new world out.
- `/api/narrate` takes `{ world, kind, detail }` and returns `{ civ, entry }`. It never fails: no key or a bad reply falls back to canned text.

## Tracks (one owner each)
- A. Planet and god tools: `src/components/Planet.tsx`, the god tools in `src/app/page.tsx`
- B. Simulation: `src/lib/sim.ts` (decay, growth, crises, balancing)
- C. Narrator: `src/lib/narrator.ts`, `src/app/api/narrate/route.ts`, `src/lib/openrouter.ts`
- D. Multiplayer galaxy: `src/lib/galaxy.ts` (to write, port `joinLobby` from Millennium Bug's `src/lib/realtime.ts`), `/api/contact` for two-LLM negotiation, a galaxy map view

## Rules
- Branch per track, small PRs into `main`, run `npm run build` before pushing.
- Secrets only in `.env.local`. Never commit keys.
- Every LLM call needs a canned fallback so the demo never stalls.
- Short comments only where logic isn't obvious; we need to explain the code to judges.
- Desktop browser is the demo target.
