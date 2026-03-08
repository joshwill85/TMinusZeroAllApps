-- Restore cron scheduling for SpaceX X snapshot ingestion and keep it enabled.

insert into public.system_settings (key, value)
values ('spacex_x_snapshot_enabled', 'true'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'spacex_x_post_snapshot') then
    perform cron.unschedule('spacex_x_post_snapshot');
  end if;

  perform cron.schedule(
    'spacex_x_post_snapshot',
    '*/15 * * * *',
    $job$select public.invoke_edge_job('spacex-x-post-snapshot');$job$
  );
end $$;
