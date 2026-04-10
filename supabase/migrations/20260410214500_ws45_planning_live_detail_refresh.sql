create or replace function public.handle_launch_refresh_state_from_ws45_planning()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  effective_start timestamptz := coalesce(new.valid_start, old.valid_start);
  effective_end timestamptz := coalesce(new.valid_end, old.valid_end);
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if to_regprocedure('public.touch_launch_detail_refresh_state(uuid)') is null then
    return coalesce(new, old);
  end if;

  if effective_start is null or effective_end is null or effective_end <= effective_start then
    effective_start := now() - interval '6 hours';
    effective_end := now() + interval '7 days';
  end if;

  for launch_row in
    select l.id
    from public.launches l
    where l.hidden is not true
      and upper(coalesce(l.pad_state, '')) = 'FL'
      and coalesce(l.window_start, l.net) <= effective_end
      and coalesce(l.window_end, l.window_start, l.net) >= effective_start
      and coalesce(l.window_end, l.window_start, l.net) >= now() - interval '6 hours'
      and coalesce(l.window_start, l.net) <= now() + interval '7 days'
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.id);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists touch_launch_refresh_state_ws45_planning_forecasts on public.ws45_planning_forecasts;
create trigger touch_launch_refresh_state_ws45_planning_forecasts
after insert or update or delete
on public.ws45_planning_forecasts
for each row
execute function public.handle_launch_refresh_state_from_ws45_planning();

create or replace function public.handle_launch_refresh_state_from_ws45_live_weather()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if to_regprocedure('public.touch_launch_detail_refresh_state(uuid)') is null then
    return coalesce(new, old);
  end if;

  for launch_row in
    select l.id
    from public.launches l
    where l.hidden is not true
      and upper(coalesce(l.pad_state, '')) = 'FL'
      and coalesce(l.window_end, l.window_start, l.net) >= now() - interval '6 hours'
      and coalesce(l.window_start, l.net) <= now() + interval '24 hours'
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.id);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists touch_launch_refresh_state_ws45_live_weather_snapshots on public.ws45_live_weather_snapshots;
create trigger touch_launch_refresh_state_ws45_live_weather_snapshots
after insert or update or delete
on public.ws45_live_weather_snapshots
for each row
execute function public.handle_launch_refresh_state_from_ws45_live_weather();
