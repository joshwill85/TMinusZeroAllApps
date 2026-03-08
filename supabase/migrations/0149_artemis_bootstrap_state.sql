-- Artemis bootstrap checkpointing and job schedules.

create table if not exists public.artemis_ingest_checkpoints (
  source_key text primary key,
  source_type text not null,
  status text not null default 'pending',
  cursor text,
  records_ingested bigint not null default 0,
  last_announced_time timestamptz,
  last_event_time timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint artemis_ingest_checkpoints_status_check check (status in ('pending', 'running', 'complete', 'error'))
);

alter table public.artemis_ingest_checkpoints enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_ingest_checkpoints' and policyname = 'admin read artemis ingest checkpoints'
  ) then
    create policy "admin read artemis ingest checkpoints" on public.artemis_ingest_checkpoints
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_ingest_checkpoints' and policyname = 'service role manage artemis ingest checkpoints'
  ) then
    create policy "service role manage artemis ingest checkpoints" on public.artemis_ingest_checkpoints
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

insert into public.artemis_ingest_checkpoints (source_key, source_type)
values
  ('nasa_campaign_pages', 'nasa_primary'),
  ('nasa_blog_posts', 'nasa_primary'),
  ('nasa_reference_timelines', 'nasa_primary'),
  ('nasa_rss', 'nasa_primary'),
  ('oig_reports', 'oversight'),
  ('gao_reports', 'oversight'),
  ('moon_to_mars_docs', 'technical'),
  ('ntrs_api', 'technical'),
  ('techport_api', 'technical'),
  ('nasa_budget_docs', 'budget'),
  ('usaspending_awards', 'procurement'),
  ('nasa_media_assets', 'media')
on conflict (source_key) do nothing;

insert into public.system_settings (key, value)
values
  ('artemis_bootstrap_required', 'true'::jsonb),
  ('artemis_bootstrap_complete', 'false'::jsonb),
  ('artemis_bootstrap_job_enabled', 'true'::jsonb),
  ('artemis_nasa_job_enabled', 'true'::jsonb),
  ('artemis_nasa_poll_interval_minutes', '60'::jsonb),
  ('artemis_oversight_job_enabled', 'true'::jsonb),
  ('artemis_budget_job_enabled', 'true'::jsonb),
  ('artemis_procurement_job_enabled', 'true'::jsonb),
  ('artemis_snapshot_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_bootstrap') then
    perform cron.unschedule('artemis_bootstrap');
  end if;
  if exists (select 1 from cron.job where jobname = 'artemis_nasa_ingest') then
    perform cron.unschedule('artemis_nasa_ingest');
  end if;
  if exists (select 1 from cron.job where jobname = 'artemis_oversight_ingest') then
    perform cron.unschedule('artemis_oversight_ingest');
  end if;
  if exists (select 1 from cron.job where jobname = 'artemis_budget_ingest') then
    perform cron.unschedule('artemis_budget_ingest');
  end if;
  if exists (select 1 from cron.job where jobname = 'artemis_procurement_ingest') then
    perform cron.unschedule('artemis_procurement_ingest');
  end if;
  if exists (select 1 from cron.job where jobname = 'artemis_snapshot_build') then
    perform cron.unschedule('artemis_snapshot_build');
  end if;

  perform cron.schedule('artemis_bootstrap', '*/15 * * * *', $job$select public.invoke_edge_job('artemis-bootstrap');$job$);
  perform cron.schedule('artemis_nasa_ingest', '7 * * * *', $job$select public.invoke_edge_job('artemis-nasa-ingest');$job$);
  perform cron.schedule('artemis_oversight_ingest', '35 */12 * * *', $job$select public.invoke_edge_job('artemis-oversight-ingest');$job$);
  perform cron.schedule('artemis_budget_ingest', '50 2 * * *', $job$select public.invoke_edge_job('artemis-budget-ingest');$job$);
  perform cron.schedule('artemis_procurement_ingest', '15 3 * * *', $job$select public.invoke_edge_job('artemis-procurement-ingest');$job$);
  perform cron.schedule('artemis_snapshot_build', '20 * * * *', $job$select public.invoke_edge_job('artemis-snapshot-build');$job$);
end $$;
