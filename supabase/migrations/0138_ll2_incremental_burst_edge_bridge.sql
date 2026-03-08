-- Optional bridge: move the 15s LL2 burst sleep loop out of Postgres.
-- When ll2_incremental_use_edge_burst=true, this cron-invoked function triggers a single Edge Function
-- (ll2-incremental-burst) which performs the 4x/15s cadence.
--
-- Safe default: ll2_incremental_use_edge_burst=false keeps the legacy Postgres sleep loop.

insert into public.system_settings (key, value)
values ('ll2_incremental_use_edge_burst', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.invoke_ll2_incremental_burst()
returns void
language plpgsql
as $$
declare
  enabled boolean := true;
  use_edge boolean := false;
  calls int := 4;
  interval_seconds int := 15;
  i int := 0;
begin
  -- Prevent overlap if a prior burst is still running.
  if not pg_try_advisory_xact_lock(hashtext('ll2_incremental_burst')::bigint) then
    return;
  end if;

  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else true
    end
  into enabled
  from public.system_settings
  where key = 'll2_incremental_job_enabled';

  if not enabled then
    return;
  end if;

  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into use_edge
  from public.system_settings
  where key = 'll2_incremental_use_edge_burst';

  if use_edge then
    perform public.invoke_edge_job('ll2-incremental-burst');
    return;
  end if;

  -- Legacy behavior: burst 4 calls spaced by interval_seconds inside Postgres.
  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else 4
    end
  into calls
  from public.system_settings
  where key = 'll2_incremental_calls_per_minute';

  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else 15
    end
  into interval_seconds
  from public.system_settings
  where key = 'll2_incremental_interval_seconds';

  calls := greatest(1, least(20, coalesce(calls, 4)));
  interval_seconds := greatest(1, least(60, coalesce(interval_seconds, 15)));
  calls := least(calls, (55 / interval_seconds) + 1);

  for i in 1..calls loop
    perform public.invoke_edge_job('ll2-incremental');
    if i < calls then
      perform pg_sleep(interval_seconds);
    end if;
  end loop;
end;
$$;

