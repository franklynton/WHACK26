# CLAUDE.md

## Project
WHACK26 hackathon, 23.5 hours, team of 4. **Arda**: a god game on your own 3D planet, in the WorldBox genre (our own take, not a copy). Tiny people wander, farm and build villages on a detailed globe. They share one collective mind, powered by an LLM: once they settle they invent a name, language and a religion about you (their god), talk to you, and decide what to focus on (settle, expand, farm, worship, explore, hoard, or rebel), which changes how they behave. Needs decay (food, faith, stability). Neglect brings famine, revolution, or a cult that decides you're evil.
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
- Nations (`seedNations`, 2-5 per planet): each has its own policy, needs, borders (`owner`) and relations (peace, trade, rival, war) driven by `tension`. Crowded villages send pioneers to found new ones. The Peace and Discord powers and each mind's `toward` stance move tension.
- Races (`src/sim/races.ts`): each nation is a race (human, goblin, elf, dwarf, lizardfolk) with multipliers on births, appetite, war, speed, lifespan, faith, stability, gathering and tech speed, plus a voice for the AI. The god picks their own race on the landing page; other nations get other races. Nations climb eras (Stone Age to Space Age) via `tech`; goblins are ~10x slower than humans.
- Planet types also have a `hazard` (the disaster they suffer most) and `weakTo` (the planet type that beats them in invasions; `invasionBonus` for multiplayer).
- Leaders: every nation has a `leader` (name, title, portrait seed). `Portrait.tsx` draws them as SVG. (The "talk to the leader" audience was removed from the UI; `LeaderDialog.tsx` and `/api/leader` are unused.)
- God powers (`stepGod` in planet.ts): devotion (earned from worship and love) pays for miracles (`cast`), answering prayers (`answerPrayer`) and stepping in when a disaster, war or revolution starts (`decide`). Each nation has `love` for the god. Goal: keep the first nation alive to `GOAL_YEAR`, loved (`outcome`).
- Seas (`stepNavy`): warships from the Iron Age, merchant ships between nations at peace, pirates that raid; routes by BFS over water.
- `src/components/Globe.tsx`: renders the sim (tiles as one mesh, people and houses as instanced meshes) and turns mouse drags into god powers. It also steps the sim every frame.
- `src/components/Game.tsx`: the HUD. Polls the sim ~3x a second, queues sim events for narration (per nation), and runs one LLM call at a time. Each nation has its own civ, chat and mind; minds take turns to think.
- `src/types/world.ts`: shared types. `World` is the snapshot sent to the LLM.
- `src/lib/narrator.ts` + `/api/narrate` (genesis and reactions to events) and `/api/mind` (the mind talks to the god and picks a `Policy`). Every LLM call has a canned fallback, so it works without a key.
- Galaxy (multiplayer): `src/components/Galaxy.tsx` + `/api/galaxy` + `supabase/migrations/`. Every planet syncs a snapshot every 5s; when your nation reaches the Space Age (`sim.spacefaring`) it can trade with and invade the planets in its galaxy, settled by SQL functions and applied to each sim (`galaxyTrade`, `galaxyLoot`, `invadedFromSpace`). Galaxies are temporary rooms of up to 5 (migration 003: `join_galaxy`, `leave_galaxy`, `galaxy_tidy`; `src/lib/galaxyCode.ts`): first use of a code creates one, anyone can join or leave any time, quiet gods are dropped after 30s and empty galaxies deleted. Resources sync by changes (migration 008, `galaxySnapshot`/`galaxyAdopt`): the game sends what it gained or spent, the database adds it and returns the true totals, which include market fills, trade offers and invasion loot settled there. The market (Shash's order book, 004-007; `GalaxyMarket.tsx`) is one shared book for every player in every galaxy or none since migration 012 (`galaxy = 'GLOBAL'` in the market tables); goods or credits are held while an order is open. Trade offers (migration 009, `TradeOffers.tsx`): give X for Y to a god in your galaxy; the offered goods are held, the other god has 30s to accept or decline, otherwise they come back. Invasions (migration 011, `InvasionFleets.tsx`): the attacker sends part of its army (`launchSpaceFleet`), the fleet flies 30s, the defender can fight, pay tribute or spend devotion on shields; `settle_invasions` rolls attack (fleet x race x planet matchup) vs defence (army, warships, race, era) and moves loot; each game applies its half (`fleetHome`, `raidedFromSpace`).
- `src/components/Landing.tsx`: the front page.

## Rules
- Branch per track, small PRs into `main`, run `npm run build` before pushing.
- Secrets only in `.env.local`. Never commit keys.
- Every LLM call needs a canned fallback so the demo never stalls.
- Short comments only where logic isn't obvious; we need to explain the code to judges.
- Desktop browser is the demo target.
