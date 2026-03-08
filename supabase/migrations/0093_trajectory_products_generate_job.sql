-- Schedule trajectory products generation for top eligible launches.

insert into public.system_settings (key, value)
values ('trajectory_products_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_products_eligible_limit', '3'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_products_lookahead_limit', '50'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_products_lookback_hours', '24'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_products_expiry_hours', '3'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_products_top3_ids', '[]'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_products_generate') then
    perform cron.unschedule('trajectory_products_generate');
  end if;

  -- Runs every 6 hours to refresh top-3 AR trajectory products.
  perform cron.schedule(
    'trajectory_products_generate',
    '27 */6 * * *',
    $job$select public.invoke_edge_job('trajectory-products-generate');$job$
  );
end $$;
