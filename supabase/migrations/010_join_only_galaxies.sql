-- Galaxy names are created only by Arda's automatic galaxy creation flow.
-- A user-entered code may join an existing galaxy, but can never create one.

create or replace function public.join_galaxy(p_world_id text, p_owner_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c text := upper(trim(coalesce(p_code, '')));
  me planets%rowtype;
  members integer;
begin
  if c !~ '^[A-Z0-9]{3,12}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not exists (select 1 from galaxies where code = c) then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'galaxy', c);
  end if;

  select * into me from planets where world_id = p_world_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_planet'); end if;
  if me.owner_token <> p_owner_token then raise exception 'Not your planet'; end if;

  perform 1 from galaxies where code = c for update;

  if me.galaxy = c then
    select count(*) into members from planets where galaxy = c;
    return jsonb_build_object('ok', true, 'created', false, 'galaxy', c, 'members', members);
  end if;

  select count(*) into members from planets where galaxy = c;
  if members >= galaxy_max() then
    return jsonb_build_object('ok', false, 'reason', 'full', 'galaxy', c, 'members', members);
  end if;

  update planets set galaxy = c, updated_at = now() where world_id = p_world_id;
  perform galaxy_tidy();
  select count(*) into members from planets where galaxy = c;
  return jsonb_build_object('ok', true, 'created', false, 'galaxy', c, 'members', members);
end;
$$;
