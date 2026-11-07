-- Fixes market accounting, galaxy price initialization, and function privileges.

-- Credits must never become negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'planets_credits_nonnegative'
      and conrelid = 'public.planets'::regclass
  ) then
    alter table public.planets
      add constraint planets_credits_nonnegative check (credits >= 0) not valid;
    alter table public.planets validate constraint planets_credits_nonnegative;
  end if;
end;
$$;

-- Only the galaxy wrappers and service-role RPCs should be callable.
revoke all on function public.trade_planet(text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.invade_planet(text, text, text)
  from public, anon, authenticated;
grant execute on function public.trade_planet(text, text, text, text, integer) to service_role;
grant execute on function public.invade_planet(text, text, text) to service_role;

create or replace function public.initialize_market_prices(p_galaxy text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.market_prices (galaxy, resource, base_price, current_price)
  select p_galaxy, resource, base_price, base_price
  from (values
    ('food'::text, 8::bigint),
    ('wood'::text, 12::bigint),
    ('stone'::text, 15::bigint),
    ('metal'::text, 20::bigint),
    ('gold'::text, 30::bigint),
    ('herbs'::text, 25::bigint)
  ) as p(resource, base_price)
  on conflict (galaxy, resource) do nothing;

  insert into public.market_price_history (galaxy, resource, price, created_at)
  select galaxy, resource, base_price, now()
  from public.market_prices m
  where m.galaxy = p_galaxy
    and not exists (
      select 1 from public.market_price_history h
      where h.galaxy = m.galaxy and h.resource = m.resource
    );
end;
$$;

revoke all on function public.initialize_market_prices(text) from public, anon, authenticated;
grant execute on function public.initialize_market_prices(text) to service_role;

-- Ensure every new and existing galaxy has price state.
select public.initialize_market_prices(code) from public.galaxies;

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
  perform public.initialize_market_prices(c);
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
  if me.galaxy is not null then
    delete from galaxies g where g.code = me.galaxy
      and not exists (select 1 from planets p where p.galaxy = g.code);
  end if;
  return jsonb_build_object('ok', true, 'created', made is not null, 'galaxy', c, 'members', members + 1);
end;
$$;

create or replace function public.place_market_order(
  p_world_id text,
  p_owner_token text,
  p_side text,
  p_resource text,
  p_price bigint,
  p_quantity integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me planets%rowtype;
  incoming market_orders%rowtype;
  resting market_orders%rowtype;
  trade_price bigint;
  filled integer;
  reserve_qty integer;
  cost bigint;
  refunded bigint;
begin
  if p_side not in ('buy', 'sell') then raise exception 'Side must be buy or sell'; end if;
  if p_resource not in ('food', 'wood', 'stone', 'metal', 'gold', 'herbs') then raise exception 'Unknown resource'; end if;
  if p_price < 1 or p_price > 1000000000 then raise exception 'Price must be between 1 and 1000000000'; end if;
  if p_quantity < 1 or p_quantity > 100000 then raise exception 'Quantity must be between 1 and 100000'; end if;

  select * into me from planets where world_id = p_world_id for update;
  if not found then raise exception 'Planet not found'; end if;
  if me.owner_token <> p_owner_token then raise exception 'Not your planet'; end if;
  if me.galaxy is null then raise exception 'Join a galaxy first'; end if;

  if p_side = 'buy' then
    cost := p_price * p_quantity;
    if me.credits < cost then raise exception 'Not enough credits'; end if;
    update planets set credits = credits - cost, updated_at = now() where world_id = p_world_id;
    insert into market_orders(galaxy, world_id, side, resource, price, quantity, remaining, escrow_credits, status)
    values (me.galaxy, p_world_id, 'buy', p_resource, p_price, p_quantity, p_quantity, cost, 'open')
    returning * into incoming;
  else
    reserve_qty := greatest(coalesce((me.resources->>p_resource)::integer, 0), 0);
    if reserve_qty < p_quantity then raise exception 'Not enough %', p_resource; end if;
    update planets set resources = jsonb_set(resources, array[p_resource], to_jsonb(reserve_qty - p_quantity), true), updated_at = now()
    where world_id = p_world_id;
    insert into market_orders(galaxy, world_id, side, resource, price, quantity, remaining, escrow_quantity, status)
    values (me.galaxy, p_world_id, 'sell', p_resource, p_price, p_quantity, p_quantity, p_quantity, 'open')
    returning * into incoming;
  end if;

  loop
    if incoming.side = 'buy' then
      select * into resting from market_orders
      where galaxy = incoming.galaxy and resource = incoming.resource and side = 'sell'
        and status in ('open', 'partial') and price <= incoming.price
        and world_id <> incoming.world_id
      order by price asc, created_at asc, id asc limit 1 for update;
    else
      select * into resting from market_orders
      where galaxy = incoming.galaxy and resource = incoming.resource and side = 'buy'
        and status in ('open', 'partial') and price >= incoming.price
        and world_id <> incoming.world_id
      order by price desc, created_at asc, id asc limit 1 for update;
    end if;
    exit when not found;

    filled := least(incoming.remaining, resting.remaining);
    if filled < 1 then exit; end if;
    trade_price := resting.price;

    if incoming.side = 'buy' then
      cost := trade_price * filled;
      refunded := (incoming.price - trade_price) * filled;
      update planets
        set credits = credits + refunded,
            resources = jsonb_set(resources, array[p_resource], to_jsonb(greatest(coalesce((resources->>p_resource)::integer, 0), 0) + filled), true)
        where world_id = incoming.world_id;
      update planets set credits = credits + cost where world_id = resting.world_id;
      update market_orders
        set remaining = remaining - filled,
            escrow_credits = greatest(escrow_credits - incoming.price * filled, 0),
            status = case when remaining - filled = 0 then 'filled' else 'partial' end
        where id = incoming.id;
      update market_orders
        set remaining = remaining - filled,
            escrow_quantity = greatest(escrow_quantity - filled, 0),
            status = case when remaining - filled = 0 then 'filled' else 'partial' end
        where id = resting.id;
    else
      cost := trade_price * filled;
      update planets
        set resources = jsonb_set(resources, array[p_resource], to_jsonb(greatest(coalesce((resources->>p_resource)::integer, 0), 0) + filled), true)
        where world_id = resting.world_id;
      update planets set credits = credits + cost where world_id = incoming.world_id;
      update market_orders
        set remaining = remaining - filled,
            escrow_quantity = greatest(escrow_quantity - filled, 0),
            status = case when remaining - filled = 0 then 'filled' else 'partial' end
        where id = incoming.id;
      update market_orders
        set remaining = remaining - filled,
            escrow_credits = greatest(escrow_credits - cost, 0),
            status = case when remaining - filled = 0 then 'filled' else 'partial' end
        where id = resting.id;
    end if;

    insert into market_trades(galaxy, resource, price, quantity, buyer_world_id, seller_world_id)
    values (incoming.galaxy, p_resource, trade_price, filled,
      case when incoming.side = 'buy' then incoming.world_id else resting.world_id end,
      case when incoming.side = 'sell' then incoming.world_id else resting.world_id end);

    select * into incoming from market_orders where id = incoming.id for update;
    exit when incoming.remaining = 0;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', incoming.id,
    'status', incoming.status,
    'remaining', incoming.remaining
  );
end;
$$;

grant execute on function public.place_market_order(text, text, text, text, bigint, integer) to service_role;
revoke all on function public.place_market_order(text, text, text, text, bigint, integer)
  from public, anon, authenticated;
