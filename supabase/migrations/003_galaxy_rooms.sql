-- Galaxies are temporary rooms of up to 5 planets, named by a code (3 to 12 letters or digits).
-- The first god to use a code creates the galaxy; others join it until it's full. Gods can leave
-- whenever they like, and a god whose game stops syncing for 30 seconds (tab closed, laptop asleep)
-- is dropped. When the last god leaves, the galaxy is deleted, and its code can be used again.
-- A planet's own row (and everything trades or invasions did to it) is never deleted by leaving.
-- Safe to run more than once.

create table if not exists public.galaxies (
  code text primary key check (code ~ '^[A-Z0-9]{3,12}$'),
  created_at timestamptz not null default now()
);
alter table public.galaxies enable row level security; -- only the functions below touch it
grant all privileges on table public.galaxies to service_role;

alter table public.planets add column if not exists galaxy text references public.galaxies(code) on delete set null;
create index if not exists planets_galaxy on public.planets (galaxy) where galaxy is not null;
grant select (galaxy) on table public.planets to anon, authenticated;

create or replace function public.galaxy_max() returns integer language sql immutable as $$ select 5 $$;

-- Drops gods who stopped syncing, then deletes galaxies nobody is in.
create or replace function public.galaxy_tidy()
returns void language plpgsql security definer set search_path = public as $$
begin
  update planets set galaxy = null where galaxy is not null and updated_at < now() - interval '30 seconds';
  delete from galaxies g where not exists (select 1 from planets p where p.galaxy = g.code);
end;
$$;

-- Joins the galaxy with this code, creating it if nobody is using the code.
-- Returns {ok, created, galaxy, members} or {ok: false, reason: 'invalid' | 'full' | 'no_planet', members}.
create or replace function public.join_galaxy(p_world_id text, p_owner_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c text := upper(trim(coalesce(p_code, '')));
  me planets%rowtype;
  made text;
  members integer;
begin
  if c !~ '^[A-Z0-9]{3,12}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into me from planets where world_id = p_world_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_planet'); end if;
  if me.owner_token <> p_owner_token then raise exception 'Not your planet'; end if;

  perform galaxy_tidy();
  insert into galaxies (code) values (c) on conflict (code) do nothing returning code into made;
  perform 1 from galaxies where code = c for update; -- one join at a time per galaxy, so a 6th can't slip in

  if me.galaxy = c then
    select count(*) into members from planets where galaxy = c;
    return jsonb_build_object('ok', true, 'created', false, 'galaxy', c, 'members', members);
  end if;

  select count(*) into members from planets where galaxy = c;
  if members >= galaxy_max() then
    return jsonb_build_object('ok', false, 'reason', 'full', 'galaxy', c, 'members', members);
  end if;

  update planets set galaxy = c, updated_at = now() where world_id = p_world_id;
  if me.galaxy is not null then
    delete from galaxies g where g.code = me.galaxy and not exists (select 1 from planets p where p.galaxy = g.code);
  end if;
  return jsonb_build_object('ok', true, 'created', made is not null, 'galaxy', c, 'members', members + 1);
end;
$$;

-- Leaves the current galaxy (deleting it if this was the last god). The planet itself stays as it is.
create or replace function public.leave_galaxy(p_world_id text, p_owner_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me planets%rowtype;
begin
  select * into me from planets where world_id = p_world_id for update;
  if not found then return jsonb_build_object('ok', true); end if;
  if me.owner_token <> p_owner_token then raise exception 'Not your planet'; end if;
  update planets set galaxy = null where world_id = p_world_id;
  if me.galaxy is not null then
    delete from galaxies g where g.code = me.galaxy and not exists (select 1 from planets p where p.galaxy = g.code);
  end if;
  return jsonb_build_object('ok', true, 'left', me.galaxy);
end;
$$;

-- How full a galaxy is, for the landing page's check before you start. Doesn't join.
create or replace function public.peek_galaxy(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c text := upper(trim(coalesce(p_code, '')));
  members integer;
begin
  if c !~ '^[A-Z0-9]{3,12}$' then return jsonb_build_object('reason', 'invalid'); end if;
  perform galaxy_tidy();
  select count(*) into members from planets where galaxy = c;
  return jsonb_build_object('galaxy', c, 'members', members, 'max', galaxy_max(), 'exists', exists (select 1 from galaxies where code = c));
end;
$$;

-- Syncing is unchanged from 002 (it never moves a planet between galaxies), plus the tidy-up,
-- so quiet gods are dropped and empty galaxies deleted even when nobody joins or leaves.
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
    p_world_id, p_owner_token, left(p_owner_name, 40), left(p_planet_name, 40), p_planet_type, greatest(p_population, 0),
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

  perform galaxy_tidy();
  return (select to_jsonb(p) - 'owner_token' from planets p where p.world_id = p_world_id);
end;
$$;

-- Trades and invasions only reach planets in the same galaxy. These wrap the 001 functions,
-- which still do the real work, so their rules stay in one place.
create or replace function public.same_galaxy(p_source text, p_target text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.galaxy is not null and s.galaxy = t.galaxy from planets s, planets t where s.world_id = p_source and t.world_id = p_target), false);
$$;

create or replace function public.galaxy_trade(
  p_source_world_id text, p_owner_token text, p_target_world_id text, p_resource text, p_amount integer
)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not same_galaxy(p_source_world_id, p_target_world_id) then
    raise exception 'That planet is not in your galaxy';
  end if;
  return trade_planet(p_source_world_id, p_owner_token, p_target_world_id, p_resource, p_amount);
end;
$$;

create or replace function public.galaxy_invade(p_source_world_id text, p_owner_token text, p_target_world_id text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not same_galaxy(p_source_world_id, p_target_world_id) then
    raise exception 'That planet is not in your galaxy';
  end if;
  return invade_planet(p_source_world_id, p_owner_token, p_target_world_id);
end;
$$;

-- Only the server (service role, through /api/galaxy) may call these.
do $$
declare f text;
begin
  foreach f in array array[
    'galaxy_tidy()', 'join_galaxy(text, text, text)', 'leave_galaxy(text, text)', 'peek_galaxy(text)',
    'same_galaxy(text, text)', 'galaxy_trade(text, text, text, text, integer)', 'galaxy_invade(text, text, text)',
    'sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
