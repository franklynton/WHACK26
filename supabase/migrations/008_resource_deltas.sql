-- Resources sync by changes, so the database holds the true stockpile.
--
-- Before: 005 stopped syncs overwriting resources (so a stale browser couldn't erase a market fill),
-- but then nothing the planet produced ever reached the database, and opening the market copied the
-- stale totals back into the game.
--
-- Now: each sync sends p_delta, what the game gained or spent since the totals it last got back.
-- The database adds that to its own totals (which also hold market fills, trade offers and invasion
-- loot settled here), never below zero, and returns the result; the game then adopts those totals.
-- A first sync from a new planet (p_delta null) sends its whole stockpile instead.
-- Safe to run more than once.

drop function if exists public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real);

create or replace function public.sync_planet(
  p_world_id text, p_owner_token text, p_owner_name text, p_planet_name text, p_planet_type text,
  p_population integer, p_villages integer, p_output integer, p_military integer, p_resources jsonb,
  p_position_x real, p_position_y real, p_delta jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing planets%rowtype;
  totals jsonb;
  r text;
begin
  select * into existing from planets where world_id = p_world_id for update;
  if found and existing.owner_token <> p_owner_token then
    raise exception 'World is owned by another player';
  end if;

  if not found or p_delta is null then
    totals := p_resources; -- a new planet: its own stockpile is the truth
  else
    totals := existing.resources;
    foreach r in array array['food', 'wood', 'stone', 'metal', 'gold', 'herbs'] loop
      totals := jsonb_set(totals, array[r], to_jsonb(greatest(0,
        coalesce((totals->>r)::numeric, 0) + least(greatest(coalesce((p_delta->>r)::numeric, 0), -1000000), 1000000)
      )::bigint), true);
    end loop;
  end if;

  insert into planets (
    world_id, owner_token, owner_name, planet_name, planet_type, population, villages,
    output, military, resources, position_x, position_y
  ) values (
    p_world_id, p_owner_token, left(p_owner_name, 40), left(p_planet_name, 40), p_planet_type, greatest(p_population, 0),
    greatest(p_villages, 0), greatest(p_output, 0), greatest(p_military, 0), totals,
    least(greatest(p_position_x, 0), 1), least(greatest(p_position_y, 0), 1)
  )
  on conflict (world_id) do update set
    owner_name = excluded.owner_name,
    planet_name = excluded.planet_name,
    planet_type = excluded.planet_type,
    population = excluded.population,
    villages = excluded.villages,
    output = excluded.output,
    military = excluded.military,
    resources = excluded.resources,
    position_x = excluded.position_x,
    position_y = excluded.position_y,
    updated_at = now();

  perform galaxy_tidy();
  return (select to_jsonb(p) - 'owner_token' from planets p where p.world_id = p_world_id);
end;
$$;

revoke all on function public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real, jsonb) from public, anon, authenticated;
grant execute on function public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real, jsonb) to service_role;
