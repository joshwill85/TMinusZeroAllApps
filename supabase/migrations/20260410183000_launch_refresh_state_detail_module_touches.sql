create or replace function public.touch_launch_detail_refresh_state(
  p_launch_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_launch_id is null then
    return;
  end if;

  perform public.touch_launch_refresh_state('detail:public:' || p_launch_id::text, 'detail_public', p_launch_id);
  perform public.touch_launch_refresh_state('detail:live:' || p_launch_id::text, 'detail_live', p_launch_id);
end;
$$;

create or replace function public.handle_launch_refresh_state_from_named_launch_column()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  launch_id_text text := null;
  current_launch_id uuid := null;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_nargs < 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    launch_id_text := to_jsonb(old) ->> tg_argv[0];
  else
    launch_id_text := coalesce(to_jsonb(new) ->> tg_argv[0], to_jsonb(old) ->> tg_argv[0]);
  end if;

  if launch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    current_launch_id := launch_id_text::uuid;
  end if;

  perform public.touch_launch_detail_refresh_state(current_launch_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.handle_launch_refresh_state_from_snapi_items()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_snapi_uid text := null;
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    current_snapi_uid := trim(coalesce(old.snapi_uid, ''));
  else
    current_snapi_uid := trim(coalesce(new.snapi_uid, old.snapi_uid, ''));
  end if;
  if current_snapi_uid = '' then
    return coalesce(new, old);
  end if;

  for launch_row in
    select distinct launch_id
    from public.snapi_item_launches
    where snapi_uid = current_snapi_uid
      and launch_id is not null
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.launch_id);
  end loop;

  return coalesce(new, old);
end;
$$;

create or replace function public.handle_launch_refresh_state_from_ll2_events()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_event_id bigint := null;
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    current_event_id := old.ll2_event_id;
  else
    current_event_id := coalesce(new.ll2_event_id, old.ll2_event_id);
  end if;
  if current_event_id is null then
    return coalesce(new, old);
  end if;

  for launch_row in
    select distinct launch_id
    from public.ll2_event_launches
    where ll2_event_id = current_event_id
      and launch_id is not null
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.launch_id);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists touch_launch_refresh_state_launch_external_resources on public.launch_external_resources;
create trigger touch_launch_refresh_state_launch_external_resources
after insert or update or delete
on public.launch_external_resources
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_ll2_launch_landings on public.ll2_launch_landings;
create trigger touch_launch_refresh_state_ll2_launch_landings
after insert or update or delete
on public.ll2_launch_landings
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_launch_weather on public.launch_weather;
create trigger touch_launch_refresh_state_launch_weather
after insert or update or delete
on public.launch_weather
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_faa_launch_matches on public.faa_launch_matches;
create trigger touch_launch_refresh_state_faa_launch_matches
after insert or update or delete
on public.faa_launch_matches
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_trajectory_products on public.launch_trajectory_products;
create trigger touch_launch_refresh_state_trajectory_products
after insert or update or delete
on public.launch_trajectory_products
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_trajectory_constraints on public.launch_trajectory_constraints;
create trigger touch_launch_refresh_state_trajectory_constraints
after insert or update or delete
on public.launch_trajectory_constraints
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_ws45_launch_forecasts on public.ws45_launch_forecasts;
create trigger touch_launch_refresh_state_ws45_launch_forecasts
after insert or update or delete
on public.ws45_launch_forecasts
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('matched_launch_id');

drop trigger if exists touch_launch_refresh_state_snapi_item_launches on public.snapi_item_launches;
create trigger touch_launch_refresh_state_snapi_item_launches
after insert or update or delete
on public.snapi_item_launches
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_snapi_items on public.snapi_items;
create trigger touch_launch_refresh_state_snapi_items
after insert or update or delete
on public.snapi_items
for each row
execute function public.handle_launch_refresh_state_from_snapi_items();

drop trigger if exists touch_launch_refresh_state_ll2_event_launches on public.ll2_event_launches;
create trigger touch_launch_refresh_state_ll2_event_launches
after insert or update or delete
on public.ll2_event_launches
for each row
execute function public.handle_launch_refresh_state_from_named_launch_column('launch_id');

drop trigger if exists touch_launch_refresh_state_ll2_events on public.ll2_events;
create trigger touch_launch_refresh_state_ll2_events
after insert or update or delete
on public.ll2_events
for each row
execute function public.handle_launch_refresh_state_from_ll2_events();
