-- Fixes for 001_galaxy.sql. Safe to run more than once.

-- 1. Owner tokens are the password for acting as a planet, so the browser (anon key) must never read them.
--    Only the other columns are readable, and planets leave the Realtime feed (rows there carry every column).
revoke select on table public.planets from anon, authenticated;
grant select (world_id, owner_name, planet_name, planet_type, population, villages, output, military, resources,
  position_x, position_y, invasion_cooldown_until, updated_at) on table public.planets to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planets') then
    alter publication supabase_realtime drop table public.planets;
  end if;
end;
$$;

-- 2. Sync now also writes resources: the game is the source of truth, so trades check what the planet really holds.
create or replace function public.sync_planet(
  p_world_id text, p_owner_token text, p_owner_name text, p_planet_name text, p_planet_type text,
  p_population integer, p_villages integer, p_output integer, p_military integer, p_resources jsonb,
  p_position_x real, p_position_y real
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing_token text;
begin
  select owner_token into existing_token from planets where world_id = p_world_id;
  if existing_token is not null and existing_token <> p_owner_token then
    raise exception 'World is owned by another player';
  end if;

  insert into planets (
    world_id, owner_token, owner_name, planet_name, planet_type, population, villages,
    output, military, resources, position_x, position_y
  ) values (
    p_world_id, p_owner_token, p_owner_name, p_planet_name, p_planet_type, greatest(p_population, 0),
    greatest(p_villages, 0), greatest(p_output, 0), greatest(p_military, 0), p_resources,
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

  return (select to_jsonb(p) - 'owner_token' from planets p where p.world_id = p_world_id);
end;
$$;
