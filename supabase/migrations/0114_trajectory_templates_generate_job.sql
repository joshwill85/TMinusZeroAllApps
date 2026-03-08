-- Schedule trajectory templates generation (learned priors for Tier-2 fallback).

insert into public.system_settings (key, value)
values ('trajectory_templates_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_templates_lookback_days', '540'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_templates_launch_limit', '1200'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_templates_min_samples', '6'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_templates_v1', '{}'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_templates_generate') then
    perform cron.unschedule('trajectory_templates_generate');
  end if;

  -- Runs daily to keep templates fresh as new constraints are ingested.
  perform cron.schedule(
    'trajectory_templates_generate',
    '15 3 * * *',
    $job$select public.invoke_edge_job('trajectory-templates-generate');$job$
  );
end $$;

