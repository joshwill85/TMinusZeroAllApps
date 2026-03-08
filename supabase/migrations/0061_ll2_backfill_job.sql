-- LL2 historical launch backfill job (runs alongside ll2-incremental).

insert into public.system_settings (key, value)
values
  ('ll2_backfill_job_enabled', 'true'::jsonb),
  ('ll2_backfill_limit', '100'::jsonb),
  ('ll2_backfill_cursor', '"1960-01-01T00:00:00Z"'::jsonb),
  ('ll2_backfill_offset', '0'::jsonb),
  ('ll2_backfill_done', 'false'::jsonb),
  ('ll2_backfill_completed_at', 'null'::jsonb),
  ('ll2_backfill_last_success_at', to_jsonb(now())),
  ('ll2_backfill_last_error', '""'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_backfill') then
    perform cron.unschedule('ll2_backfill');
  end if;
  perform cron.schedule('ll2_backfill', '* * * * *', $job$select public.invoke_edge_job('ll2-backfill');$job$);
end $$;
