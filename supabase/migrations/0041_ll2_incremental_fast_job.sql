-- High-frequency LL2 incremental ingestion (premium key) at ~15s cadence.
-- pg_cron cannot schedule seconds directly, so we run a 1-minute job that bursts 4 calls spaced 15s apart.

insert into public.system_settings (key, value)
values
  ('ll2_incremental_job_enabled', 'true'::jsonb),
  ('ll2_incremental_limit', '100'::jsonb),
  ('ll2_incremental_interval_seconds', '15'::jsonb),
  ('ll2_incremental_calls_per_minute', '4'::jsonb),
  ('ll2_incremental_offset', '0'::jsonb),
  ('ll2_incremental_last_success_at', to_jsonb(now())),
  ('ll2_incremental_last_error', '""'::jsonb),
  (
    'll2_incremental_cursor',
    coalesce(
      to_jsonb((select max(last_updated_source) from public.launches)),
      to_jsonb(now())
    )
  )
on conflict (key) do nothing;

create or replace function public.invoke_ll2_incremental_burst()
returns void
language plpgsql
as $$
declare
  enabled boolean := true;
  calls int := 4;
  interval_seconds int := 15;
  i int := 0;
begin
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_incremental_burst') then
    perform cron.unschedule('ll2_incremental_burst');
  end if;
  perform cron.schedule('ll2_incremental_burst', '* * * * *', $job$select public.invoke_ll2_incremental_burst();$job$);
end $$;
