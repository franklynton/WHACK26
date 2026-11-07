# Petri: team plan

WHACK26 runs from Saturday 7 Nov, about 11:30, to Sunday 8 Nov, about 11:00 (UK time). This page says what we're building, who does what, and how we work. Each track also has a GitHub issue with a checklist.

## The game in one paragraph

You're a god with your own 3D planet. Tiny people live on it, farm, build villages and share one AI mind. They worship you, talk to you and decide what to do next. Each planet is rich in different resources (food, wood, stone, metal, gold, medicinal herbs). Your job is to keep your nations at peace so the planet produces as much as possible. You then spend resources to upgrade your civilisation, trade with other players' planets, or invade them.

## What already works (on `main`)

- A 3D globe with about 27,000 tiles, five planet types, and ore, gold and herb deposits.
- God powers: spawn people, raise or sink land, forest, rain, drought, miracle, fire and meteor.
- People who eat, have children, die, and found villages with farmland.
- The AI mind (`/api/mind`), which names the civ, invents its religion, talks to you and picks a focus that changes behaviour.
- Needs (food, faith, stability), crises (famine, revolution, cult), random natural disasters, and a resource stockpile.
- The front page, and a Vercel deploy on every merge to `main`.

Read `CLAUDE.md` first. It maps every file.

## Tracks

| Track | Owner | Main files | Goal |
| --- | --- | --- | --- |
| 1. Nations and war | Frank | `src/sim/planet.ts`, `src/lib/narrator.ts`, `/api/mind` | Several nations per planet, each with its own mind, beliefs and borders, able to trade or fight |
| 2. Database and multiplayer | _tbc_ | `src/lib/galaxy.ts` (branch `galaxy`), `src/lib/supabase/`, new `/api/planets` | Save planets to Supabase, a shared universe, trade and invasions between planets |
| 3. Economy and upgrades | _tbc_ | new `src/sim/upgrades.ts`, new `src/components/Upgrades.tsx` | Spend resources on upgrades, and balance the game |
| 4. AI voice, polish and pitch | _tbc_ | `src/lib/narrator.ts` prompts, `src/components/Globe.tsx` effects, `public/sounds/`, `docs/` | People feel alive, powers look and sound great, and the pitch is ready |

Tracks 1 and 4 both touch `narrator.ts`. Track 1 owns the data shape (`World`, `Civ`); track 4 owns the prompt wording. Talk before changing the other's part.

### 1. Nations and war

- Give each village a `nation`. Seed 2 or 3 nations at the start, each with its own colour, name and mind.
- Show nation borders on the globe by tinting tiles near each nation's villages.
- Each nation's mind thinks separately and has an `attitude` towards each other nation (ally, trade, rival, war).
- At war, people near the border fight, villages can be captured, and stability and resources drop. At peace or in trade, both gain resources.
- The god can calm nations (a "peace" power, or by talking to them) or stir them up.

### 2. Database and multiplayer

- Create a Supabase project and a `planets` table (`id`, `owner_name`, `type`, `seed`, `population`, `resources` jsonb, `civ` jsonb, `nations` jsonb, `updated_at`) with Row Level Security.
- Save a summary of the planet every 30 seconds, and load it again by seed on return.
- Universe view: a map of other players' planets online (port `joinGalaxy` from the `galaxy` branch).
- Trade: offer resources to another planet; the two AI minds negotiate and accept or refuse.
- Invasion: spend military to attack; the result changes both planets' resources and the attacker's stability.

### 3. Economy and upgrades

- An upgrade tree bought with resources. For example: Irrigation (more food, costs wood), Stone houses (stability, costs stone), Medicine (herbs: longer lives, less plague), Smithing (metal: tools, then soldiers), Temples (gold: slower faith decay), Army (metal and food: needed to invade).
- Each upgrade changes a number in the sim, so the effect is visible.
- Balance: a crisis should come about 3 minutes after neglect, disasters should feel fair, and resources should feel scarce enough that trading matters.

### 4. AI voice, polish and pitch

- Pick the OpenRouter model (reliable JSON, fast) and tune the prompts so the people are funny, strange and use their own words.
- Visual and sound effects for each power, such as a meteor streak, rain and a miracle glow. Millennium Bug's sound files are reusable.
- A short "how to play" on first load.
- Demo script (2 minutes), slides, and the submission write-up. Record a backup video of the demo by Sunday 08:00.

## How we work

- One branch per track, named after it (`nations`, `multiplayer`, `economy`, `polish`). Small PRs into `main`.
- Run `npm run build` before you push. Vercel redeploys on every merge to `main`.
- Never commit keys. They go in `.env.local` locally and in Vercel's Environment Variables.
- Every AI call needs a pre-written fallback, so the demo never stalls.
- Post in the group chat when you change something in `src/types/world.ts`.

## Timeline

| When (UK) | Goal |
| --- | --- |
| Sat 13:00 | Everyone has the game running locally and has read their issue |
| Sat 19:00 | First working version of each track merged |
| Sun 03:30 | Feature freeze: no new features after this |
| Sun 07:30 | Everything joined up and deployed; fix bugs only |
| Sun 08:00 | Backup demo video recorded |
| Sun 10:00 | Final rehearsal |
