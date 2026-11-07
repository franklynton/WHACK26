# CLAUDE.md

## Project
WHACK26 hackathon, 23.5 hours, team of 4. **Petri**: a god game on your own 3D planet, in the WorldBox genre (our own take, not a copy). Tiny people wander, farm and build villages on a detailed globe. They share one collective mind, powered by an LLM: once they settle they invent a name, language and a religion about you (their god), talk to you, and decide what to focus on (settle, expand, farm, worship, explore, hoard, or rebel), which changes how they behave. Needs decay (food, faith, stability). Neglect brings famine, revolution, or a cult that decides you're evil.
**Goal loop:** keep your people (later: several nations per planet) at peace so the planet produces the most resources. Planets roll a type (Verdant, Timberworld, Ironworld, Gilded, Archipelago), so each is rich in different resources (food, wood, stone, metal, gold, medicinal herbs).
**Later:** nations within a planet, each with its own mind, trading or fighting; a Supabase database for each planet's state; multiplayer planets in a shared universe to trade with, start trade wars with, or invade.
Optimise for a working, impressive live demo over completeness.

## Stack
- Next.js (App Router) + TypeScript + Tailwind CSS 4
- react-three-fiber + drei for the 3D globe
- OpenRouter, called only from route handlers (`/api/*`). The key never reaches the browser.
- Supabase (later): Realtime for multiplayer (port `joinLobby` from Millennium Bug, started on branch `galaxy`), Postgres for saves
- Deploy: Vercel

## How it fits together
- `src/sim/planet.ts`: `PlanetSim`, the whole simulation. ~27k triangular tiles in typed arrays (elevation, moisture, forest, food, fire, deposits), people, villages, god powers (`apply`), random disasters, needs, resources, planet types. Mutated in place for speed.
- `src/components/Globe.tsx`: renders the sim (tiles as one mesh, people and houses as instanced meshes) and turns mouse drags into god powers. It also steps the sim every frame.
- `src/components/Game.tsx`: the HUD. Polls the sim ~3x a second, queues sim events for narration, and runs one LLM call at a time.
- `src/types/world.ts`: shared types. `World` is the snapshot sent to the LLM.
- `src/lib/narrator.ts` + `/api/narrate` (genesis and reactions to events) and `/api/mind` (the mind talks to the god and picks a `Policy`). Every LLM call has a canned fallback, so it works without a key.
- `src/components/Landing.tsx`: the front page.

## Rules
- Branch per track, small PRs into `main`, run `npm run build` before pushing.
- Secrets only in `.env.local`. Never commit keys.
- Every LLM call needs a canned fallback so the demo never stalls.
- Short comments only where logic isn't obvious; we need to explain the code to judges.
- Desktop browser is the demo target.
