# Arda

A god game on your own 3D planet, built for WHACK26. Tiny AI-driven people live on it, worship you, talk back, and decide what to do next. Keep them at peace, grow your resources, and trade with (or invade) other gods' planets.

## Team and tracks

| Who | Track | Issue |
| --- | --- | --- |
| @franklynton | Nations and war | [#3](https://github.com/franklynton/WHACK26/issues/3) |
| @shash-v | Database and multiplayer | [#4](https://github.com/franklynton/WHACK26/issues/4) |
| @linaslabs | Economy and upgrades | [#5](https://github.com/franklynton/WHACK26/issues/5) |
| @piyushgurnani06 | AI voice, polish and pitch | [#6](https://github.com/franklynton/WHACK26/issues/6) |

**Start here:** read [docs/PLAN.md](docs/PLAN.md) for the full plan and timeline, then your issue's checklist. [CLAUDE.md](CLAUDE.md) maps every file in the code.

Feature freeze is **Sunday 03:30**, and the backup demo video is due by **Sunday 08:00** (UK time).

## Run it

```bash
npm install
cp .env.example .env.local   # add your OpenRouter key (optional: without one the people use pre-written lines)
npm run dev
```

Open http://localhost:3000, enter your name and create your planet.

## Multiplayer galaxy

1. Create a Supabase project.
2. Copy the project URL and anon/service-role keys into `.env.local`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
3. Run `supabase/migrations/001_galaxy.sql`, then `002_galaxy_fixes.sql`, then `003_galaxy_codes.sql`, in the Supabase SQL editor.
4. Add the same three variables to the Vercel project's environment variables.

Every planet syncs to the galaxy every five seconds. Planets only meet planets with the same galaxy code (set on the landing page, in the Galaxy panel, or with a `/?galaxy=CODE` link); no code is the open galaxy. Once your nation reaches the Space Age, the Galaxy button unlocks: send resources to, or invade, any planet that is online. Server-side SQL functions validate tokens, amounts and invasion cooldowns, and the result lands in both games (the other player's planet gets the resources, or loses people and gold).

## How we work

- One branch per track (`nations`, `multiplayer`, `economy`, `polish`), with small PRs into `main`.
- Run `npm run build` before pushing. Vercel redeploys on every merge to `main` and builds a preview for every PR.
- Never commit keys.
