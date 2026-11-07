-- Galaxy codes: planets only see, trade with and invade planets that share their code.
-- No code (or 'PUBLIC') is the open galaxy everyone shares. Safe to run more than once.

alter table public.planets add column if not exists galaxy text not null default 'PUBLIC';
create index if not exists planets_galaxy_updated on public.planets (galaxy, updated_at desc);
grant select (galaxy) on table public.planets to anon, authenticated;

-- Upper-case letters and digits, 1 to 12 long; anything else is the open galaxy.
create or replace function public.clean_galaxy(p text)
returns text language sql immutable as $$
  select case when upper(coalesce(p, '')) ~ '^[A-Z0-9]{1,12}$' then upper(p) else 'PUBLIC' end;
$$;

-- sync_planet gains p_galaxy, so the old 12-argument version is replaced.
drop function if exists public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real);

create or replace function public.sync_planet(
  p_world_id text, p_owner_token text, p_owner_name text, p_planet_name text, p_planet_type text,
  p_population integer, p_villages integer, p_output integer, p_military integer, p_resources jsonb,
  p_position_x real, p_position_y real, p_galaxy text default 'PUBLIC'
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
    output, military, resources, position_x, position_y, galaxy
  ) values (
    p_world_id, p_owner_token, left(p_owner_name, 40), left(p_planet_name, 40), p_planet_type, greatest(p_population, 0),
    greatest(p_villages, 0), greatest(p_output, 0), greatest(p_military, 0), p_resources,
    least(greatest(p_position_x, 0), 1), least(greatest(p_position_y, 0), 1), clean_galaxy(p_galaxy)
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
    galaxy = excluded.galaxy,
    updated_at = now();

  return (select to_jsonb(p) - 'owner_token' from planets p where p.world_id = p_world_id);
end;
$$;

-- Trades and invasions only reach planets in the same galaxy. These wrap the 001 functions,
-- which still do the real work, so their rules stay in one place.
create or replace function public.same_galaxy(p_source text, p_target text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.galaxy = t.galaxy from planets s, planets t where s.world_id = p_source and t.world_id = p_target), false);
$$;

create or replace function public.galaxy_trade(
  p_source_world_id text, p_owner_token text, p_target_world_id text, p_resource text, p_amount integer
)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not same_galaxy(p_source_world_id, p_target_world_id) then
    raise exception 'That planet is in another galaxy';
  end if;
  return trade_planet(p_source_world_id, p_owner_token, p_target_world_id, p_resource, p_amount);
end;
$$;

create or replace function public.galaxy_invade(p_source_world_id text, p_owner_token text, p_target_world_id text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not same_galaxy(p_source_world_id, p_target_world_id) then
    raise exception 'That planet is in another galaxy';
  end if;
  return invade_planet(p_source_world_id, p_owner_token, p_target_world_id);
end;
$$;

revoke all on function public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real, text) from public;
revoke all on function public.galaxy_trade(text, text, text, text, integer) from public;
revoke all on function public.galaxy_invade(text, text, text) from public;
grant execute on function public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real, text) to service_role;
grant execute on function public.galaxy_trade(text, text, text, text, integer) to service_role;
grant execute on function public.galaxy_invade(text, text, text) to service_role;
