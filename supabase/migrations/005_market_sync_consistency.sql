-- Market trades and sells are settled server-side. Planet resource sync must not
-- overwrite those authoritative balances or an old browser snapshot can erase a fill.
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
    position_x = excluded.position_x,
    position_y = excluded.position_y,
    updated_at = now();

  perform galaxy_tidy();
  return (select to_jsonb(p) - 'owner_token' from planets p where p.world_id = p_world_id);
end;
$$;

grant execute on function public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real) to service_role;
revoke all on function public.sync_planet(text, text, text, text, text, integer, integer, integer, integer, jsonb, real, real) from public, anon, authenticated;
