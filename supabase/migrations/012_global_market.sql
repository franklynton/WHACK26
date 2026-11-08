-- One market for everyone: a single order book, price list and price history shared by every
-- player, whichever galaxy they're in (or none). Before this, each galaxy had its own book, so
-- there was rarely anyone to trade with, and the prices and history were deleted whenever a
-- galaxy emptied (so the price chart never had more than one point).
--
-- The market tables keep their `galaxy` column; for the shared market it always holds 'GLOBAL'
-- (which isn't a galaxy, so the foreign keys to galaxies are dropped).
-- Needs 001-011 first. Safe to run more than once.

-- 1. The market no longer belongs to a galaxy, so deleting a galaxy mustn't delete market rows.
do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and con.contype = 'f'
      and rel.relname in ('market_orders', 'market_trades', 'market_prices', 'market_price_history')
      and con.confrelid = 'public.galaxies'::regclass
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end;
$$;

-- 2. Open orders from the old per-galaxy books go back to their owners (credits or goods).
do $$
declare o record;
begin
  for o in select * from market_orders where galaxy <> 'GLOBAL' and status in ('open', 'partial') for update loop
    if o.side = 'buy' then
      update planets set credits = credits + o.escrow_credits where world_id = o.world_id;
    else
      perform add_resource(o.world_id, o.resource, o.escrow_quantity);
    end if;
    update market_orders set status = 'cancelled', remaining = 0, escrow_quantity = 0, escrow_credits = 0 where id = o.id;
  end loop;
end;
$$;

-- 3. One price list, starting from the base prices, and a first point on each price chart.
create or replace function public.initialize_market_prices(p_galaxy text default 'GLOBAL')
returns void language sql security definer set search_path = public as $$
  -- The argument is ignored: there is only the shared market now (kept so join_galaxy still works).
  insert into market_prices (galaxy, resource, base_price, current_price)
  select 'GLOBAL', p.resource, p.base_price, p.base_price
  from (values ('food', 8::bigint), ('wood', 12::bigint), ('stone', 15::bigint),
               ('metal', 20::bigint), ('gold', 30::bigint), ('herbs', 25::bigint)) as p(resource, base_price)
  on conflict (galaxy, resource) do nothing;
  insert into market_price_history (galaxy, resource, price, created_at)
  select 'GLOBAL', m.resource, m.current_price, now()
  from market_prices m
  where m.galaxy = 'GLOBAL'
    and not exists (select 1 from market_price_history h where h.galaxy = 'GLOBAL' and h.resource = m.resource);
$$;
select public.initialize_market_prices('GLOBAL');
delete from market_prices where galaxy <> 'GLOBAL';
create index if not exists market_orders_book on public.market_orders (galaxy, resource, side, status, price);

-- 4. Placing an order: no galaxy needed; it matches against every player's orders.
--    (007's version, with the galaxy check removed and every order in the 'GLOBAL' book.)
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
  traded integer := 0;
begin
  if p_side not in ('buy', 'sell') then raise exception 'Side must be buy or sell'; end if;
  if p_resource not in ('food', 'wood', 'stone', 'metal', 'gold', 'herbs') then raise exception 'Unknown resource'; end if;
  if p_price < 1 or p_price > 1000000000 then raise exception 'Price must be between 1 and 1000000000'; end if;
  if p_quantity < 1 or p_quantity > 100000 then raise exception 'Quantity must be between 1 and 100000'; end if;

  select * into me from planets where world_id = p_world_id for update;
  if not found then raise exception 'Planet not found'; end if;
  if me.owner_token <> p_owner_token then raise exception 'Not your planet'; end if;

  if p_side = 'buy' then
    cost := p_price * p_quantity;
    if me.credits < cost then raise exception 'Not enough credits: you have %, this order needs %', me.credits, cost; end if;
    update planets set credits = credits - cost where world_id = p_world_id;
    insert into market_orders(galaxy, world_id, side, resource, price, quantity, remaining, escrow_credits, status)
    values ('GLOBAL', p_world_id, 'buy', p_resource, p_price, p_quantity, p_quantity, cost, 'open')
    returning * into incoming;
  else
    reserve_qty := greatest(coalesce((me.resources->>p_resource)::numeric, 0)::integer, 0);
    if reserve_qty < p_quantity then raise exception 'Not enough %: you have %', p_resource, reserve_qty; end if;
    update planets set resources = jsonb_set(resources, array[p_resource], to_jsonb(reserve_qty - p_quantity), true)
    where world_id = p_world_id;
    insert into market_orders(galaxy, world_id, side, resource, price, quantity, remaining, escrow_quantity, status)
    values ('GLOBAL', p_world_id, 'sell', p_resource, p_price, p_quantity, p_quantity, p_quantity, 'open')
    returning * into incoming;
  end if;

  loop
    if incoming.side = 'buy' then
      select * into resting from market_orders
      where galaxy = 'GLOBAL' and resource = incoming.resource and side = 'sell'
        and status in ('open', 'partial') and price <= incoming.price
        and world_id <> incoming.world_id
      order by price asc, created_at asc, id asc limit 1 for update;
    else
      select * into resting from market_orders
      where galaxy = 'GLOBAL' and resource = incoming.resource and side = 'buy'
        and status in ('open', 'partial') and price >= incoming.price
        and world_id <> incoming.world_id
      order by price desc, created_at asc, id asc limit 1 for update;
    end if;
    exit when not found;

    filled := least(incoming.remaining, resting.remaining);
    if filled < 1 then exit; end if;
    trade_price := resting.price;
    traded := traded + filled;

    if incoming.side = 'buy' then
      cost := trade_price * filled;
      refunded := (incoming.price - trade_price) * filled;
      update planets
        set credits = credits + refunded,
            resources = jsonb_set(resources, array[p_resource], to_jsonb(greatest(coalesce((resources->>p_resource)::numeric, 0)::bigint, 0) + filled), true)
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
        set resources = jsonb_set(resources, array[p_resource], to_jsonb(greatest(coalesce((resources->>p_resource)::numeric, 0)::bigint, 0) + filled), true)
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

    -- The trigger from 006 moves the price and adds a point to the chart.
    insert into market_trades(galaxy, resource, price, quantity, buyer_world_id, seller_world_id)
    values ('GLOBAL', p_resource, trade_price, filled,
      case when incoming.side = 'buy' then incoming.world_id else resting.world_id end,
      case when incoming.side = 'sell' then incoming.world_id else resting.world_id end);

    select * into incoming from market_orders where id = incoming.id for update;
    exit when incoming.remaining = 0;
  end loop;

  return jsonb_build_object('ok', true, 'order_id', incoming.id, 'status', incoming.status, 'remaining', incoming.remaining, 'filled', traded);
end;
$$;

-- 5. Leaving a galaxy no longer cancels market orders (they aren't tied to a galaxy any more).
--    009's galaxy_tidy without its market section.
create or replace function public.galaxy_tidy()
returns void language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  update planets set galaxy = null where galaxy is not null and updated_at < now() - interval '30 seconds';

  for o in select id from trade_offers where status = 'pending' and expires_at <= now() loop
    perform refund_trade_offer(o.id, 'expired', 'No answer in time');
  end loop;
  for o in
    select t.id from trade_offers t
    join planets f on f.world_id = t.from_world_id
    join planets r on r.world_id = t.to_world_id
    where t.status = 'pending' and (f.galaxy is distinct from t.galaxy or r.galaxy is distinct from t.galaxy)
  loop
    perform refund_trade_offer(o.id, 'cancelled', 'A god left the galaxy');
  end loop;

  delete from galaxies g where not exists (select 1 from planets p where p.galaxy = g.code);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['initialize_market_prices(text)', 'place_market_order(text, text, text, text, bigint, integer)', 'galaxy_tidy()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
